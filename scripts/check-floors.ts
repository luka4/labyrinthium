/**
 * Floor generator checks (plan 01). Run: npm run check:floors
 *   npm run check:floors -- --ascii egypt 10     dump one floor
 *   npm run check:floors -- --update             rewrite scripts/floors.snapshot.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { profileFor } from '../src/game/core/architecture';
import { DIRS, TILE, distancesFrom, type Floor, type RoomKind, type TrapKind } from '../src/game/core/floor';
import { addFeatures, floorFor, generateFloor, generateLayout, layoutFor, specFor } from '../src/game/core/generate';
import { CARRY } from '../src/game/core/lights';
import { runStarChecks } from './check-stars';
import { checkSecretsFloor, newSecretStats, runSecretRules, secretsHash } from './check-secrets';
import { checkGuardianFloor, placementHash, runGuardianChecks } from './check-guardian';
import { runLightChecks } from './check-light-rules';
import { runPluginChecks } from './check-plugins';
import { runPowerChecks } from './check-powers';
import { runProgressChecks } from './check-progress';
import { runWorldChecks } from './check-world';
import { KINDS, checkTraps, featHash, type TrapStats } from './check-traps';
import { runTrapRules } from './check-trap-rules';
import { floorSeed, isCampFloor, lastCamp, type Pyramid } from '../src/game/core/game';
import { PYRAMIDS, SEALS, type PyramidId } from '../src/game/core/pyramids';

const here = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = join(here, 'floors.snapshot.json');
const args = process.argv.slice(2);

const GLYPH: Record<number, string> = {
  [TILE.ROCK]: '#',
  [TILE.FLOOR]: '.',
  [TILE.DOOR]: '+',
  [TILE.PILLAR]: 'O',
  [TILE.NICHE]: 'n',
  [TILE.STAIRS_DOWN]: '>',
  [TILE.STAIRS_UP]: '<',
  [TILE.BENCH]: 'b',
  [TILE.SARCOPHAGUS]: 'S',
  [TILE.BRAZIER]: 'k',
};

const ITEM_GLYPH: Record<string, string> = { smallTorch: 't', torch: 'T', bigTorch: 'B', lamp: 'l', candle: 'i', oilJar: 'o' };

/** block X, portcullis plate P and its port =, sandfall $, trapdoor v (b stays the bench, s the sconce) */
const TRAP_GLYPH: Record<TrapKind, string> = { block: 'X', portcullis: 'P', sandfall: '$', trapdoor: 'v' };

/** the guardian's lair G (sentinel post S), its waypoints w and the false door E (--ascii) */
function markOf(f: Floor, i: number): string | null {
  if (f.guardian && i === f.guardian.lair) return f.guardian.sentinel ? 'S' : 'G';
  if (f.guardian?.route.includes(i)) return 'w';
  if (i === f.exit) return 'E';
  return null;
}

/** --sand: the sand rank in deciles 0-9 over the ranked part, '.' elsewhere */
function sandDigit(f: Floor, i: number): string | null {
  if (!args.includes('--sand') || !f.collapse) return null;
  const r = f.collapse.rank[i];
  return r < 0 ? null : String(Math.min(9, Math.floor((r * 10) / f.collapse.order.length)));
}

function ascii(f: Floor): string {
  const rows: string[] = [];
  for (let y = 0; y < f.size; y++) {
    let row = '';
    for (let x = 0; x < f.size; x++) {
      const i = y * f.size + x;
      const it = f.items.find((o) => o.tile === i);
      const fx = f.fixtures.find((o) => o.tile === i && o.kind !== 'brazier');
      const tk = f.trapAt[i] >= 0 ? f.traps[f.trapAt[i]] : null;
      const port = f.traps.some((t) => t.kind === 'portcullis' && t.target === i);
      const sand = sandDigit ? sandDigit(f, i) : null;
      const mark = markOf(f, i);
      row +=
        i === f.start
          ? '@'
          : mark
            ? mark
            : tk
            ? TRAP_GLYPH[tk.kind]
            : port
              ? '='
              : it
                ? ITEM_GLYPH[it.kind]
                : fx
                  ? fx.kind === 'sconce'
                    ? 's'
                    : 'c'
                  : sand !== null && !f.solid[i]
                    ? sand
                    : f.water && !f.solid[i] && f.water[i] >= 32
                      ? f.water[i] >= 224
                        ? 'W'
                        : f.water[i] >= 128
                          ? '~'
                          : ','
                      : i === f.stairs && f.tiles[i] === TILE.FLOOR
                      ? 'A'
                      : GLYPH[f.tiles[i]];
    }
    rows.push(row);
  }
  return rows.join('\n');
}

function fnv(f: Floor): string {
  let h = 0x811c9dc5;
  const mix = (v: number) => {
    h ^= v & 255;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  for (const t of f.tiles) mix(t);
  const ids = ['smallTorch', 'torch', 'bigTorch', 'lamp', 'candle', 'oilJar', 'sconce', 'brazier', 'shrineCandles'];
  const nums = [f.start, f.stairs];
  for (const it of f.items) nums.push(it.tile, ids.indexOf(it.kind));
  for (const fx of f.fixtures) nums.push(fx.tile, ids.indexOf(fx.kind), fx.eternal ? 1 : 0);
  for (const v of nums) for (let b = 0; b < 4; b++) mix(v >> (8 * b));
  return h.toString(16).padStart(8, '0');
}

if (args[0] === '--ascii') {
  const id = (args[1] ?? 'egypt') as PyramidId;
  const index = Number(args[2] ?? 1) - 1;
  const f = floorFor(PYRAMIDS[id], index);
  console.log(`${id} floor ${index + 1}: size ${f.size}, rooms ${f.rooms.length}, loops ${f.loops}, items ${f.items.length} fixtures ${f.fixtures.length}, traps ${f.traps.map((t) => t.kind).join(',') || '-'}, collapse ${f.collapse ? `cap ${f.collapse.cap}` : '-'}`);
  console.log(ascii(f));
  console.log(f.rooms.map((r) => `${r.id}:${r.kind}`).join(' '));
  process.exit(0);
}

let failures = 0;
let warnings = 0;
const fail = (msg: string) => {
  failures++;
  console.error(`FAIL ${msg}`);
};
const warn = (msg: string) => {
  warnings++;
  console.warn(`warn ${msg}`);
};

type Metrics = { open: number; kinds: Record<string, number>; run: number; roomShare: number; thick: number };

const MIN_FLOOR: Record<string, number> = { smallTorch: 1, torch: 2, bigTorch: 5, lamp: 3, candle: 1, oilJar: 1 };
const manhattan = (size: number, a: number, b: number) => Math.abs((a % size) - (b % size)) + Math.abs(Math.floor(a / size) - Math.floor(b / size));
let foundTotal = 0;
let floorsChecked = 0;

/** Placement assertions (plan 02). */
function checkLights(label: string, f: Floor, floorIndex: number, basement: boolean, camp: boolean, path: Set<number>, dist: Int32Array) {
  const size = f.size;
  const seen = new Set<number>();
  let found = 0;
  let onPath = 0;
  let jars = 0;
  for (const it of f.items) {
    if (f.solid[it.tile] || f.tiles[it.tile] === TILE.ROCK || dist[it.tile] < 0) fail(`${label}: item ${it.kind} not on a reachable open tile`);
    if (it.tile === f.stairs || it.tile === f.start) fail(`${label}: item on start or stairs`);
    if (seen.has(it.tile)) fail(`${label}: two items on one tile`);
    seen.add(it.tile);
    if (path.has(it.tile)) onPath++;
    if (it.kind === 'oilJar') jars++;
    if (floorIndex + 1 < MIN_FLOOR[it.kind]) fail(`${label}: ${it.kind} below its minimum floor`);
    found += it.kind === 'oilJar' ? 60 : CARRY[it.kind].seconds;
  }
  for (let a = 0; a < f.items.length; a++)
    for (let b = a + 1; b < f.items.length; b++) {
      const d = manhattan(size, f.items[a].tile, f.items[b].tile);
      if (d < 5) fail(`${label}: item spacing ${d}`);
    }
  if (jars < 1) fail(`${label}: no oil jar`);
  if (onPath !== (floorIndex < 2 ? 1 : 0)) fail(`${label}: ${onPath} items on the main path`);
  const budget = Math.round(f.items.length ? 0 : 0);
  void budget;
  const sconces = f.fixtures.filter((x) => x.kind === 'sconce');
  for (const sc of sconces) {
    if (f.tiles[sc.tile - size] !== TILE.ROCK) fail(`${label}: sconce without a wall`);
    if (f.solid[sc.tile] || dist[sc.tile] < 0) fail(`${label}: sconce tile not reachable`);
    if (sc.tile === f.start || sc.tile === f.stairs) fail(`${label}: sconce on start or stairs`);
  }
  for (let a = 0; a < sconces.length; a++)
    for (let b = a + 1; b < sconces.length; b++) if (manhattan(size, sconces[a].tile, sconces[b].tile) < 7) fail(`${label}: sconce spacing`);
  if (floorIndex < 1 && sconces.length) fail(`${label}: sconces on floor 1`);
  const eternal = f.fixtures.filter((x) => x.kind === 'brazier' && x.eternal).length;
  for (const fx of f.fixtures) if (fx.kind === 'brazier' && f.tiles[fx.tile] !== TILE.BRAZIER) fail(`${label}: brazier fixture without BRAZIER tile`);
  if (camp && eternal < 1) fail(`${label}: no eternal brazier on a camp floor`);
  if (basement && eternal < 2) fail(`${label}: burial chamber has ${eternal} eternal braziers (want 2)`);
  if (floorIndex >= 2) {
    const shrines = f.spots.filter((x) => x.kind === 'shrine').length;
    if (f.fixtures.filter((x) => x.kind === 'shrineCandles').length !== shrines) fail(`${label}: shrine candles missing`);
  }
  foundTotal += found;
  floorsChecked++;
}

/** Structural assertions for one floor. */
function check(label: string, f: Floor, basement: boolean, floorIndex: number, camp = false): Metrics {
  const solid = f.solid;
  const dist = distancesFrom(solid, f.size, f.start);
  let open = 0;
  for (let i = 0; i < f.tiles.length; i++) {
    if (f.solid[i]) continue;
    if (f.tiles[i] === TILE.ROCK) fail(`${label}: solid mask disagrees at ${i}`);
    open++;
    if (dist[i] < 0) fail(`${label}: open tile ${i} unreachable`);
  }
  let down = 0;
  for (const t of f.tiles) if (t === TILE.STAIRS_DOWN) down++;
  if (down !== (basement ? 0 : 1)) fail(`${label}: ${down} STAIRS_DOWN tiles`);
  if (solid[f.stairs] || dist[f.stairs] < 0) fail(`${label}: stairs unreachable`);
  if (!basement && f.tiles[f.stairs] !== TILE.STAIRS_DOWN) fail(`${label}: stairs tile is not STAIRS_DOWN`);
  const sr = f.rooms[f.room[f.stairs]];
  if (!sr.leaf || sr.doors.length !== 1) fail(`${label}: stairs room is not a leaf with one door`);
  const maxDist = Math.max(...dist);
  if (dist[f.stairs] < 0.6 * maxDist) fail(`${label}: stairs dist ${dist[f.stairs]} < 0.6 x ${maxDist}`);
  const path = new Set(f.mainPath);
  checkLights(label, f, floorIndex, basement, camp, path, dist);
  if (f.tiles[f.start] === TILE.ROCK || solid[f.start]) fail(`${label}: start is not open`);
  for (let i = 0; i < f.size; i++)
    for (const j of [i, (f.size - 1) * f.size + i, i * f.size, i * f.size + f.size - 1])
      if (f.tiles[j] !== TILE.ROCK) fail(`${label}: border tile ${j} is open`);

  // not-a-grid metrics
  const kinds: Record<string, number> = {};
  for (const r of f.rooms) kinds[r.kind] = (kinds[r.kind] ?? 0) + 1;
  let roomTiles = 0;
  for (let i = 0; i < f.tiles.length; i++) if (!f.solid[i] && f.room[i] >= 0 && f.rooms[f.room[i]].kind !== 'passage') roomTiles++;
  // mean straight run length of passage tiles
  let runs = 0;
  let runTiles = 0;
  const isPass = (x: number, y: number) => x >= 0 && y >= 0 && x < f.size && y < f.size && f.room[y * f.size + x] >= 0 && f.rooms[f.room[y * f.size + x]].kind === 'passage' && !f.solid[y * f.size + x];
  for (const horizontal of [true, false])
    for (let a = 0; a < f.size; a++) {
      let len = 0;
      for (let b = 0; b <= f.size; b++) {
        const here2 = horizontal ? isPass(b, a) : isPass(a, b);
        if (here2) len++;
        else {
          if (len >= 2) {
            runs++;
            runTiles += len;
          }
          len = 0;
        }
      }
    }
  // mean rock thickness between open tiles scanning rows and columns
  let gaps = 0;
  let gapTiles = 0;
  for (const horizontal of [true, false])
    for (let a = 1; a < f.size - 1; a++) {
      let len = 0;
      let seen = false;
      for (let b = 0; b < f.size; b++) {
        const i = horizontal ? a * f.size + b : b * f.size + a;
        if (f.tiles[i] === TILE.ROCK) len++;
        else {
          if (seen && len > 0) {
            gaps++;
            gapTiles += len;
          }
          seen = true;
          len = 0;
        }
      }
    }
  return { open, kinds, run: runs ? runTiles / runs : 0, roomShare: roomTiles / open, thick: gaps ? gapTiles / gaps : 0 };
}

const snapshot: Record<string, string> = {};
const old: Record<string, string> = (() => {
  try {
    return JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
  } catch {
    return {};
  }
})();

console.log('pyramid floor size open rooms(by kind) mainPath loops items+fixtures run room% thick ms');
let genMs = 0;
let genCount = 0;
const newStats = (): Record<TrapKind, TrapStats> => ({ block: { target: 0, placed: 0 }, portcullis: { target: 0, placed: 0 }, sandfall: { target: 0, placed: 0 }, trapdoor: { target: 0, placed: 0 } });
const fixedStats = newStats();
const fixedSecrets = newSecretStats();
const fuzzSecrets = newSecretStats();
const fuzzStats: Array<Record<TrapKind, TrapStats>> = Array.from({ length: 25 }, newStats);
for (const id of Object.keys(PYRAMIDS) as PyramidId[]) {
  const p = PYRAMIDS[id];
  if (p.floorCount > profileFor(p.architecture).sites.length) fail(`${id}: floorCount ${p.floorCount} exceeds the size table`);
  for (let i = 0; i < p.floorCount; i++) {
    const label = `${id} floor ${i + 1}`;
    const t0 = performance.now();
    const f = floorFor(p, i);
    const again = generateFloor(specFor(p, i), i + 1 < p.floorCount ? layoutFor(p, i + 1) : null);
    genMs += (performance.now() - t0) / 2;
    genCount++;
    const h = fnv(f);
    if (fnv(again) !== h) fail(`${label}: not deterministic`);
    snapshot[`${id}:${i}`] = h;
    const fh = featHash(f);
    if (featHash(again) !== fh) fail(`${label}: features not deterministic`);
    snapshot[`${id}:${i}:feat`] = fh;
    if (old[`${id}:${i}:feat`] && old[`${id}:${i}:feat`] !== fh && !args.includes('--update')) fail(`${label}: features snapshot changed (npm run check:floors -- --update)`);
    checkTraps(label, p, i, f, i + 1 < p.floorCount ? floorFor(p, i + 1) : null, true, { fail, warn }, id === 'egypt' ? fixedStats : undefined);
    checkGuardianFloor(label, p, i, f, { fail, warn });
    if (id === 'egypt' && i >= 17) {
      const gh = placementHash(f);
      if (placementHash(again) !== gh) fail(`${label}: guardian placement not deterministic`);
      snapshot[`${id}:${i}:g`] = gh;
      if (old[`${id}:${i}:g`] && old[`${id}:${i}:g`] !== gh && !args.includes('--update')) fail(`${label}: guardian snapshot changed (npm run check:floors -- --update)`);
    }
    checkSecretsFloor(label, p, i, f, { fail, warn }, true, id === 'egypt' ? fixedSecrets : undefined);
    if (id === 'egypt') {
      const sh = secretsHash(f);
      if (secretsHash(again) !== sh) fail(`${label}: secrets not deterministic`);
      snapshot[`${id}:${i}:sec`] = sh;
      if (old[`${id}:${i}:sec`] && old[`${id}:${i}:sec`] !== sh && !args.includes('--update')) fail(`${label}: secrets snapshot changed (npm run check:floors -- --update)`);
    }
    if (old[`${id}:${i}`] && old[`${id}:${i}`] !== h && !args.includes('--update')) fail(`${label}: snapshot changed ${old[`${id}:${i}`]} -> ${h} (npm run check:floors -- --update)`);
    const m = check(label, f, i === p.floorCount - 1, i, isCampFloor(p, i));
    const kinds = Object.entries(m.kinds)
      .map(([k, v]) => `${k}:${v}`)
      .join(',');
    console.log(
      `${id} ${i + 1} ${f.size} ${m.open} ${f.rooms.length}(${kinds}) ${f.mainPath.length} ${f.loops} ${f.items.length}+${f.fixtures.length} ${m.run.toFixed(1)} ${(m.roomShare * 100).toFixed(0)} ${m.thick.toFixed(1)}`,
    );
    if (id === 'egypt') {
      if (i < 3 && f.loops !== 0) fail(`${label}: loops on an early floor`);
      if (i >= 4 && !m.kinds.hall && i >= 2) warn(`${label}: no hall`);
      if (i >= 5 && !f.tiles.includes(TILE.PILLAR)) fail(`${label}: no pillared hall`);
      if (i >= 3 && !m.kinds.gallery) warn(`${label}: no gallery`);
      if (i >= 2 && Object.keys(m.kinds).length < 3) fail(`${label}: fewer than 3 room kinds`);
      if (m.roomShare < 0.3 || m.roomShare > 0.7) warn(`${label}: room share ${(m.roomShare * 100).toFixed(0)}%`);
    }
  }
}

// Egypt over many seeds: layouts first (arrival chain), then features from the bottom up
const egypt = PYRAMIDS.egypt;
let loopFloors = 0;
const FUZZ_FULL = 100;
const FUZZ_EARLY = 300;
const fuzzT0 = performance.now();
let fuzzFloors = 0;
let loweredCaps = 0;
for (let seed = 1; seed <= FUZZ_EARLY && failures <= 40; seed++) {
  const count = seed <= FUZZ_FULL ? egypt.floorCount : 10;
  const pyr: Pyramid = { ...egypt, id: `fuzz${seed}`, seed };
  const layouts: ReturnType<typeof generateLayout>[] = [];
  for (let i = 0; i <= Math.min(count, egypt.floorCount - 1); i++) {
    let arrivalWorld: { x: number; y: number } | null = null;
    if (i > 0) {
      const above = layouts[i - 1];
      arrivalWorld = { x: (above.stairs % above.size) - (above.size >> 1), y: Math.floor(above.stairs / above.size) - (above.size >> 1) };
    }
    layouts.push(generateLayout({ ...specFor({ ...pyr, architecture: 'egypt' }, i), seed: seed * 7919 + i * 104729, arrivalWorld }));
  }
  const floors: Floor[] = [];
  for (let i = layouts.length - 1; i >= 0; i--) {
    const spec = { ...specFor({ ...pyr, architecture: 'egypt' }, i), seed: seed * 7919 + i * 104729, arrivalWorld: null };
    floors[i] = addFeatures(layouts[i], spec, i + 1 < layouts.length ? layouts[i + 1] : null);
  }
  for (let i = 0; i < count; i++) {
    const f = floors[i];
    const label = `egypt seed ${seed} floor ${i + 1}`;
    check(label, f, i === egypt.floorCount - 1, i, isCampFloor(egypt, i));
    checkGuardianFloor(label, pyr, i, f, { fail, warn });
    checkSecretsFloor(label, pyr, i, f, { fail, warn }, false, fuzzSecrets);
    if (checkTraps(label, pyr, i, f, i + 1 < layouts.length ? floors[i + 1] : null, false, { fail, warn }, fuzzStats[i]).lowered) loweredCaps++;
    fuzzFloors++;
    if (i < 3 && f.loops) fail(`${label}: loops on an early floor`);
    if (seed === 1 && i >= 7 && i <= 9 && f.loops > 0) loopFloors++;
  }
}
if (loopFloors < 2) fail('loops: fewer than 2 of egypt floors 8-10 have loop edges');
console.log(`fuzz: ${fuzzFloors} floors in ${((performance.now() - fuzzT0) / 1000).toFixed(1)} s, collapse cap lowered on ${loweredCaps}`);
for (let i = 0; i < 25; i++) {
  const st = fuzzStats[i];
  const target = KINDS.reduce((a, k) => a + st[k].target, 0);
  const placed = KINDS.reduce((a, k) => a + st[k].placed, 0);
  if (target >= 2 * (i < 10 ? FUZZ_EARLY : FUZZ_FULL) && placed < 0.5 * target) fail(`egypt floor ${i + 1}: fuzz placed ${placed} of ${target} traps (< 50 %)`);
  if (target) {
    const short = KINDS.filter((k) => st[k].placed < st[k].target).map((k) => `${k} ${st[k].placed}/${st[k].target}`);
    if (short.length) console.log(`fuzz shortfall floor ${i + 1}: ${short.join(', ')}`);
  }
}
const fixedShort = KINDS.filter((k) => fixedStats[k].placed < fixedStats[k].target).map((k) => `${k} ${fixedStats[k].placed}/${fixedStats[k].target}`);
console.log(`fixed seed traps placed/target: ${KINDS.map((k) => `${k} ${fixedStats[k].placed}/${fixedStats[k].target}`).join(', ')}${fixedShort.length ? ' (short: ' + fixedShort.join(', ') + ')' : ''}`);

{
  const off = fixedSecrets.total ? fixedSecrets.offPath / fixedSecrets.total : 1;
  console.log(`secrets: ${fixedSecrets.total} on the fixed seed (${(off * 100).toFixed(0)} % off the main path); fuzz ${fuzzSecrets.total} secrets, ${fuzzSecrets.short} of ${fuzzSecrets.floors} floors short of the full count`);
  if (off < 0.8) fail(`secrets: only ${(off * 100).toFixed(0)} % of the fixed-seed secrets are off the main path (want >= 80 %)`);
  if (fuzzSecrets.short > 0.1 * fuzzSecrets.floors) warn(`secrets: ${fuzzSecrets.short} of ${fuzzSecrets.floors} fuzz floors short of the full count`);
}
runSecretRules({ fail, warn });
runStarChecks({ fail, warn });
runTrapRules({ fail, warn });
runGuardianChecks({ fail, warn });
runLightChecks({ fail, warn, snapshot, old, update: args.includes('--update') });
// plan 06: powers and water, the plug-in and profile registries, progress v6, the globe's geography
runPowerChecks({ fail, warn, snapshot, old, update: args.includes('--update') });
runPluginChecks({ fail, warn, fnv });
runProgressChecks({ fail, warn });
runWorldChecks({ fail, warn });

// camps
const campIndices = Array.from({ length: egypt.floorCount }, (_, i) => i).filter((i) => isCampFloor(egypt, i));
if (campIndices.join() !== '4,9,13,16,19,21,23,24') fail(`egypt camps at ${campIndices} (want 4,9,13,16,19,21,23,24)`);
if (lastCamp(egypt, 3) !== 0 || lastCamp(egypt, 6) !== 4 || lastCamp(egypt, 9) !== 9 || lastCamp(egypt, 12) !== 9 || lastCamp(egypt, 13) !== 13 || lastCamp(egypt, 24) !== 24) fail('lastCamp values');
for (const id of Object.keys(PYRAMIDS) as PyramidId[]) {
  const q = PYRAMIDS[id];
  if (q.floorCount > profileFor(q.architecture).sites.length) fail(`${id}: floorCount exceeds the size table`);
  if (q.camps.some((c, k) => c < 0 || c >= q.floorCount || (k > 0 && c <= q.camps[k - 1]))) fail(`${id}: camps not ascending and in range`);
}
for (let i = 0; i < egypt.floorCount; i++) {
  const f = floorFor(egypt, i);
  if (f.traps.some((t) => t.kind === 'trapdoor') && (isCampFloor(egypt, i + 1) || i + 1 >= egypt.floorCount - 1)) fail(`egypt floor ${i + 1}: trapdoor above a camp or the basement`);
}
for (const id of SEALS) if (!isCampFloor(PYRAMIDS[id], PYRAMIDS[id].floorCount - 1)) fail(`${id}: basement is not a camp`);

// timing on this machine (a Redmi 9 is roughly 5-10x slower): warn above the desktop budgets
{
  const spec = (i: number) => specFor({ ...egypt, id: 'timing', seed: 99 }, i);
  let t0 = performance.now();
  const ls: ReturnType<typeof generateLayout>[] = [];
  for (let i = 0; i < egypt.floorCount; i++) ls.push(generateLayout({ ...spec(i), arrivalWorld: i ? { x: (ls[i - 1].stairs % ls[i - 1].size) - (ls[i - 1].size >> 1), y: Math.floor(ls[i - 1].stairs / ls[i - 1].size) - (ls[i - 1].size >> 1) } : null }));
  const chainMs = performance.now() - t0;
  t0 = performance.now();
  addFeatures(ls[23], spec(23), ls[24]);
  const f24 = performance.now() - t0;
  console.log(`generation: layout chain 1-25 ${chainMs.toFixed(0)} ms, features of floor 24 ${f24.toFixed(1)} ms, ${(genMs / genCount).toFixed(2)} ms per floor on average (full)`);
  if (chainMs > 80) warn(`layout chain ${chainMs.toFixed(0)} ms (target < 80)`);
  if (f24 > 12) warn(`features of floor 24 ${f24.toFixed(1)} ms (target < 12)`);
}

if (args.includes('--update')) {
  writeFileSync(SNAPSHOT, JSON.stringify(snapshot, null, 1) + '\n');
  console.log('snapshot written');
}
console.log(failures ? `${failures} failure(s), ${warnings} warning(s)` : `ok, ${warnings} warning(s)`);
void DIRS;
void (null as RoomKind | null);
process.exit(failures ? 1 : 0);
