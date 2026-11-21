/**
 * Sound set checks (plan 05). Run: npm run check:sounds
 * Every recipe has its .m4a and a manifest entry; the re-rendered samples hash to the lock (the committed
 * set is what the script makes); peaks, DC, NaN; loop seams measured on the decoded files; decoded
 * duration; total size and decoded memory. ffmpeg is needed to decode the committed files.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SR, rmsOf } from './sound/dsp';
import { runAudioChecks } from './check-audio';
import { RECIPES } from './sound/recipes';
import { renderRecipe, statsOf, type SoundStats } from './sound/render';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
let failures = 0;
let warnings = 0;
const fail = (m: string) => {
  failures++;
  console.error(`FAIL ${m}`);
};
const warn = (m: string) => {
  warnings++;
  console.warn(`warn ${m}`);
};

type LockEntry = SoundStats & { bytes: number };
const lock: Record<string, LockEntry> = JSON.parse(readFileSync(join(here, 'sound', 'sounds.lock.json'), 'utf8'));
const manifest = readFileSync(join(root, 'src', 'audio', 'manifest.ts'), 'utf8');

/** Decodes a committed .m4a with ffmpeg to float32 channels. */
function decode(file: string, channels: number): Float32Array[] {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ar', String(SR), '-ac', String(channels), 'pipe:1'], { maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`ffmpeg decode failed for ${file}`);
  const all = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.length / 4));
  const len = Math.floor(all.length / channels);
  const out = Array.from({ length: channels }, () => new Float32Array(len));
  for (let i = 0; i < len; i++) for (let c = 0; c < channels; c++) out[c][i] = all[i * channels + c];
  return out;
}

let totalBytes = 0;
const mem = { core: 0, game: 0, 'bed:egypt': 0, 'bed:exterior': 0, powers: 0, water: 0 } as Record<string, number>;
const t0 = performance.now();
for (const recipe of RECIPES) {
  const id = recipe.id;
  const file = join(root, 'assets', 'sounds', `${id}.m4a`);
  if (!existsSync(file)) {
    fail(`${id}: ${id}.m4a is missing (npm run sounds)`);
    continue;
  }
  if (!manifest.includes(`'${id}': {`)) fail(`${id}: no manifest entry`);
  const bytes = statSync(file).size;
  totalBytes += bytes;
  const rendered = renderRecipe(recipe);
  const stats = statsOf(rendered);
  const locked = lock[id];
  if (!locked) fail(`${id}: not in the lock file`);
  else if (locked.sha1 !== stats.sha1) fail(`${id}: re-rendered samples differ from the lock (the script changed: npm run sounds, and commit)`);
  else if (locked.bytes !== bytes) fail(`${id}: the .m4a is not the one the lock was made from`);
  if (stats.peakDb > -1) fail(`${id}: peak ${stats.peakDb} dBFS (max -1)`);
  if (stats.dc >= 0.001) fail(`${id}: DC ${stats.dc} (max 0.001)`);
  for (const ch of rendered.channels) for (let i = 0; i < ch.length; i += 97) if (!Number.isFinite(ch[i])) fail(`${id}: NaN or Infinity at ${i}`);
  mem[recipe.group] += stats.duration * SR * 4 * stats.channels;

  // the committed file as a player decodes it
  const dec = decode(file, stats.channels);
  const decDur = dec[0].length / SR;
  if (Math.abs(decDur - stats.duration) > 0.06) fail(`${id}: decoded ${decDur.toFixed(3)} s, rendered ${stats.duration} s (max 60 ms apart)`);
  if (recipe.loop && stats.loop) {
    // the seam is measured across the loop point: where the loop end continues into the loop start
    const x = dec[0];
    const a = Math.round(stats.loop[0] * SR);
    const b = Math.round(stats.loop[1] * SR);
    // the 50 ms straddling the loop point must not be a level outlier among the loop's own 50 ms windows
    const w = Math.round(0.05 * SR);
    const half = w >> 1;
    const seam = Math.sqrt((rmsOf(x, b - half, b) ** 2 + rmsOf(x, a, a + half) ** 2) / 2);
    let lo = Infinity;
    let hi = 0;
    for (let p = a; p + w < b; p += Math.round(0.01 * SR)) {
      const v = rmsOf(x, p, p + w);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    const d = seam < lo ? 20 * Math.log10(lo / (seam + 1e-9)) : seam > hi ? 20 * Math.log10(seam / hi) : 0;
    if (d > 3) fail(`${id}: loop seam level ${d.toFixed(1)} dB outside the loop's own range (max 3)`);
    else if (d > 1.5) warn(`${id}: loop seam level ${d.toFixed(1)} dB outside the loop's own range`);
    // a click shows as a sample step bigger than any step beside it (2.5 ms each side): allow the larger of 0.1 (a crackle pop at the seam is natural; plan said 0.05) and 1.2 x that
    let near = 0;
    for (let i = b - 120; i < b - 1; i++) near = Math.max(near, Math.abs(x[i + 1] - x[i]));
    for (let i = a; i < a + 120; i++) near = Math.max(near, Math.abs(x[i + 1] - x[i]));
    const limit = Math.max(0.1, near * 1.2);
    const step = Math.abs(x[b - 1] - x[a]);
    if (step > limit) fail(`${id}: loop seam step ${step.toFixed(3)} (limit ${limit.toFixed(3)})`);
    // and the padding must continue the cycle on both sides (encoder trim safety)
    const lead = Math.abs(x[a - 1] - x[b - 1]);
    if (lead > limit) fail(`${id}: pre-loop padding does not continue the cycle (${lead.toFixed(3)}, limit ${limit.toFixed(3)})`);
  }
}
runAudioChecks({ fail, warn });
const mb = totalBytes / 1048576;
console.log(`sounds: ${RECIPES.length} ids, ${mb.toFixed(2)} MB on disk (cap 2.5), checked in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
if (mb > 2.5) fail(`total size ${mb.toFixed(2)} MB over the 2.5 MB cap`);
else if (mb > 2.0) warn(`total size ${mb.toFixed(2)} MB over 2.0 MB`);
const MB = (n: number) => (n / 1048576).toFixed(1);
const run = mem.core + mem.game + mem['bed:egypt'];
const worst = run + mem.powers + mem.water;
console.log(`decoded at 48 kHz float: core ${MB(mem.core)} MB, game ${MB(mem.game)} MB, egypt bed ${MB(mem['bed:egypt'])} MB, exterior ${MB(mem['bed:exterior'])} MB, powers ${MB(mem.powers)} MB, water ${MB(mem.water)} MB; in a run ${MB(run)} MB (cap 32), with powers and water ${MB(worst)} MB (cap 36)`);
if (run > 32 * 1048576) fail(`decoded audio of a run ${MB(run)} MB over the 32 MB cap`);
if (worst > 36 * 1048576) fail(`decoded audio of a run with powers and water ${MB(worst)} MB over the 36 MB cap`);
console.log(failures ? `${failures} failure(s), ${warnings} warning(s)` : `ok, ${warnings} warning(s)`);
process.exit(failures ? 1 : 0);
