/**
 * Floor generator checks (plan 01). Run: npm run check:floors
 *   npm run check:floors -- --ascii egypt 10     dump one floor
 *   npm run check:floors -- --update             rewrite scripts/floors.snapshot.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { profileFor } from '../src/game/core/architecture';
import { DIRS, TILE, distancesFrom, type Floor, type RoomKind } from '../src/game/core/floor';
import { generateFloor } from '../src/game/core/generate';
import { floorFor } from '../src/game/core/generate';
import { floorSeed, isCampFloor, lastCamp } from '../src/game/core/game';
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
};

function ascii(f: Floor): string {
  const rows: string[] = [];
  for (let y = 0; y < f.size; y++) {
    let row = '';
    for (let x = 0; x < f.size; x++) {
      const i = y * f.size + x;
      row += i === f.start ? '@' : f.oil.includes(i) ? '*' : i === f.stairs && f.tiles[i] === TILE.FLOOR ? 'A' : GLYPH[f.tiles[i]];
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
  for (const v of [f.start, f.stairs, ...f.oil]) for (let b = 0; b < 4; b++) mix(v >> (8 * b));
  return h.toString(16).padStart(8, '0');
}

if (args[0] === '--ascii') {
  const id = (args[1] ?? 'egypt') as PyramidId;
  const index = Number(args[2] ?? 1) - 1;
  const f = floorFor(PYRAMIDS[id], index);
  console.log(`${id} floor ${index + 1}: size ${f.size}, rooms ${f.rooms.length}, loops ${f.loops}, oil ${f.oil.length}`);
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

/** Structural assertions for one floor. */
function check(label: string, f: Floor, basement: boolean, floorIndex: number): Metrics {
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
  if (f.oil.length < 1) fail(`${label}: no oil`);
  for (const o of f.oil) {
    if (path.has(o)) fail(`${label}: oil on main path`);
    if (solid[o] || dist[o] < 0) fail(`${label}: oil not reachable`);
  }
  for (let a = 0; a < f.oil.length; a++)
    for (let b = a + 1; b < f.oil.length; b++) {
      const d = Math.abs((f.oil[a] % f.size) - (f.oil[b] % f.size)) + Math.abs(Math.floor(f.oil[a] / f.size) - Math.floor(f.oil[b] / f.size));
      if (d < 6) fail(`${label}: oil spacing ${d}`);
    }
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
  void floorIndex;
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

console.log('pyramid floor size open rooms(by kind) mainPath loops oil run room% thick ms');
let genMs = 0;
let genCount = 0;
for (const id of Object.keys(PYRAMIDS) as PyramidId[]) {
  const p = PYRAMIDS[id];
  if (p.floorCount > profileFor(p.architecture).sites.length) fail(`${id}: floorCount ${p.floorCount} exceeds the size table`);
  for (let i = 0; i < p.floorCount; i++) {
    const label = `${id} floor ${i + 1}`;
    const t0 = performance.now();
    const f = floorFor(p, i);
    const again = generateFloor({
      seed: floorSeed(p, i),
      floorIndex: i,
      basement: i === p.floorCount - 1,
      profile: p.architecture,
      arrivalWorld: i === 0 ? null : (() => {
        const above = floorFor(p, i - 1);
        const half = above.size >> 1;
        return { x: (above.stairs % above.size) - half, y: Math.floor(above.stairs / above.size) - half };
      })(),
    });
    genMs += (performance.now() - t0) / 2;
    genCount++;
    const h = fnv(f);
    if (fnv(again) !== h) fail(`${label}: not deterministic`);
    snapshot[`${id}:${i}`] = h;
    if (old[`${id}:${i}`] && old[`${id}:${i}`] !== h && !args.includes('--update')) fail(`${label}: snapshot changed ${old[`${id}:${i}`]} -> ${h} (npm run check:floors -- --update)`);
    const m = check(label, f, i === p.floorCount - 1, i);
    const kinds = Object.entries(m.kinds)
      .map(([k, v]) => `${k}:${v}`)
      .join(',');
    console.log(
      `${id} ${i + 1} ${f.size} ${m.open} ${f.rooms.length}(${kinds}) ${f.mainPath.length} ${f.loops} ${f.oil.length} ${m.run.toFixed(1)} ${(m.roomShare * 100).toFixed(0)} ${m.thick.toFixed(1)}`,
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

// Egypt over many seeds: same checks with other layouts
const egypt = PYRAMIDS.egypt;
let loopFloors = 0;
for (let seed = 1; seed <= 300; seed++) {
  let world: { x: number; y: number } | null = null;
  for (let i = 0; i < egypt.floorCount; i++) {
    const f = generateFloor({ seed: seed * 7919 + i * 104729, floorIndex: i, basement: i === egypt.floorCount - 1, profile: 'egypt', arrivalWorld: world });
    check(`egypt seed ${seed} floor ${i + 1}`, f, i === egypt.floorCount - 1, i);
    if (i < 3 && f.loops) fail(`egypt seed ${seed} floor ${i + 1}: loops on an early floor`);
    if (seed === 1 && i >= 7 && f.loops > 0) loopFloors++;
    world = { x: (f.stairs % f.size) - (f.size >> 1), y: Math.floor(f.stairs / f.size) - (f.size >> 1) };
    if (failures > 40) break;
  }
  if (failures > 40) break;
}
if (loopFloors < 2) fail('loops: fewer than 2 of egypt floors 8-10 have loop edges');

// camps
const campIndices = Array.from({ length: egypt.floorCount }, (_, i) => i).filter((i) => isCampFloor(egypt, i));
if (campIndices.join() !== '4,9') fail(`egypt camps at ${campIndices} (want 4,9)`);
if (lastCamp(egypt, 3) !== 0 || lastCamp(egypt, 6) !== 4 || lastCamp(egypt, 9) !== 9) fail('lastCamp values');
for (const id of SEALS) if (!isCampFloor(PYRAMIDS[id], PYRAMIDS[id].floorCount - 1)) fail(`${id}: basement is not a camp`);

const avg = genMs / genCount;
console.log(`generation: ${avg.toFixed(2)} ms per floor on average`);
if (avg > 2) warn(`generation ${avg.toFixed(2)} ms per floor (target < 2)`);

if (args.includes('--update')) {
  writeFileSync(SNAPSHOT, JSON.stringify(snapshot, null, 1) + '\n');
  console.log('snapshot written');
}
console.log(failures ? `${failures} failure(s), ${warnings} warning(s)` : `ok, ${warnings} warning(s)`);
void DIRS;
void (null as RoomKind | null);
process.exit(failures ? 1 : 0);
