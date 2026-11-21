/**
 * Star checks (plan 05), called from check-floors.ts: the par table, an informed bot that must
 * clear every floor under 0.8 x par, floorResult cases, starCount, and the progress migrations.
 */
import { DIRS, TILE, distancesFrom, type Floor } from '../src/game/core/floor';
import { floorFor } from '../src/game/core/generate';
import { startFloor, step, type Direction, type GameState, type Pyramid } from '../src/game/core/game';
import { STEP_SECONDS } from '../src/game/core/lights';
import { PYRAMIDS } from '../src/game/core/pyramids';
import { STAR, floorResult, parTime, routeSteps, starCount } from '../src/game/core/stars';
import { migrateProgress, type ProgressData } from '../src/state/migrateProgress';
import type { Report } from './check-traps';

const egypt = PYRAMIDS.egypt;
const tick = (s: GameState, seconds: number) => step(s, { type: 'tick', seconds });
const move = (s: GameState, dir: Direction) => step(s, { type: 'move', dir });

/** BFS over the run's grid, armed trap tiles avoided when `avoidTraps`; the next direction towards `target`, or -1. */
function nextDir(s: GameState, target: number, avoidTraps: boolean): Direction | -1 {
  const { size } = s.grid;
  const mask = s.grid.solid.slice();
  if (avoidTraps) {
    s.floor.traps.forEach((t, k) => {
      if (s.trapPhase[k] === 0 && t.tile !== target) mask[t.tile] = 1;
    });
  }
  const dist = distancesFrom(mask, size, target);
  if (dist[s.pos] <= 0) return -1;
  for (let d = 0; d < 4; d++) {
    const [dx, dy] = DIRS[d];
    const nx = (s.pos % size) + dx;
    const ny = Math.floor(s.pos / size) + dy;
    if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
    const q = ny * size + nx;
    if (dist[q] >= 0 && dist[q] < dist[s.pos]) return d as Direction;
  }
  return -1;
}

/** Walks to `target` at full cadence; returns the state (status may have changed). */
function walk(s: GameState, target: number): GameState {
  let guard = 0;
  while (s.pos !== target && s.status === 'playing' && guard++ < 20000) {
    let dir = nextDir(s, target, true);
    if (dir < 0) dir = nextDir(s, target, false);
    if (dir < 0) {
      s = tick(s, 1 / 60);
      continue;
    }
    while (s.cooldown > 0 && s.status === 'playing') s = tick(s, 1 / 60);
    if (s.status !== 'playing') break;
    s = move(s, dir);
  }
  return s;
}

/** The informed bot: the known way to the stairs; basement: the artifact, then the false door. */
export function informedRun(p: Pyramid, i: number): GameState {
  let s = startFloor(p, i);
  s = walk(s, s.floor.stairs);
  if (s.status === 'playing' && s.escape?.taken) {
    s = walk(s, s.floor.exitFront);
    let guard = 0;
    while (s.status === 'playing' && !s.escape?.open && guard++ < 600) s = tick(s, 1 / 60);
    while (s.status === 'playing' && s.cooldown > 0) s = tick(s, 1 / 60);
    if (s.status === 'playing') s = move(s, 3);
  }
  return s;
}

export function runStarChecks({ fail, warn }: Report) {
  // starCount
  const cases: Array<[{ s: number; f: number; n: number } | undefined, number]> = [
    [undefined, 0],
    [{ s: 0, f: 0, n: 0 }, 0],
    [{ s: STAR.CLEARED, f: 0, n: 2 }, 1],
    [{ s: STAR.CLEARED | STAR.FAST, f: 0, n: 2 }, 2],
    [{ s: STAR.CLEARED | STAR.FAST, f: 3, n: 2 }, 3],
    [{ s: STAR.CLEARED, f: 1, n: 2 }, 1],
    [{ s: 0, f: 7, n: 3 }, 1],
    [{ s: STAR.CLEARED, f: 0, n: 0 }, 1],
  ];
  cases.forEach(([rec, want], k) => {
    if (starCount(rec) !== want) fail(`stars: starCount case ${k} = ${starCount(rec)}, want ${want}`);
  });

  // par table
  const table: string[] = [];
  const cleared = (f: Floor) => f;
  void cleared;
  const parOf: number[] = [];
  for (let i = 0; i < egypt.floorCount; i++) {
    const f = floorFor(egypt, i);
    const par = parTime(f);
    parOf.push(par);
    if (par <= 0 || par % 5 !== 0) fail(`stars: par ${par} on floor ${i + 1}`);
    table.push(`${i + 1}:${routeSteps(f)}->${par}`);
  }
  console.log(`stars: par table (steps->s) ${table.join(' ')}`);
  const expect: Record<number, [number, number]> = { 0: [50, 25], 1: [74, 35], 4: [127, 50], 9: [107, 45], 12: [192, 70], 17: [143, 65], 23: [197, 80] };
  for (const [i, [steps, par]] of Object.entries(expect)) {
    const f = floorFor(egypt, Number(i));
    if (routeSteps(f) !== steps || parTime(f) !== par) fail(`stars: floor ${Number(i) + 1} route ${routeSteps(f)} par ${parTime(f)}, plan says ${steps} / ${par}`);
  }

  // informed bot on the fixed seed
  let lax = 0;
  for (let i = 0; i < egypt.floorCount; i++) {
    const s = informedRun(egypt, i);
    const par = parOf[i];
    const r = floorResult(s);
    if (!r.cleared) fail(`stars: informed bot did not clear egypt floor ${i + 1} (status ${s.status})`);
    else if (r.time > 0.8 * par) fail(`stars: informed bot needs ${r.time.toFixed(1)} s on floor ${i + 1}, over 0.8 x par ${par}`);
    else if (r.time < 0.35 * par) {
      warn(`stars: par ${par} on floor ${i + 1} is lax (bot ${r.time.toFixed(1)} s)`);
      lax++;
    }
    if (r.cleared && !r.fast) fail(`stars: floor ${i + 1} cleared in time but not fast`);
  }
  void lax;
  console.log(`stars: informed bot cleared the fixed seed (steps x ${STEP_SECONDS} s = floor time)`);

  // fuzz
  let ok = 0;
  let n = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const pyr: Pyramid = { ...egypt, id: `star${seed}`, seed };
    for (let i = 0; i < pyr.floorCount; i++) {
      const s = informedRun(pyr, i);
      const r = floorResult(s);
      n++;
      if (r.cleared && r.time <= 0.8 * r.par) ok++;
    }
  }
  console.log(`stars: informed bot on fuzz seeds 1-30: ${ok} of ${n} floors under 0.8 x par`);
  if (ok < 0.95 * n) warn(`stars: only ${ok} of ${n} fuzz floors under 0.8 x par (want 95 %)`);

  // floorResult: stairs, trapdoor, landed by a fall
  {
    const fi = 6; // floor 7 has a trapdoor
    let s = startFloor(egypt, fi);
    const trap = s.floor.traps.find((t) => t.kind === 'trapdoor');
    if (!trap) fail('stars: floor 7 has no trapdoor to test');
    else {
      s.secretsFound = 1;
      s = walk(s, trap.tile);
      for (let t = 0; t < 400 && s.status === 'playing'; t++) s = tick(s, 0.05);
      const r = floorResult(s);
      if (s.status !== 'falling') fail(`stars: the trapdoor did not drop you (status ${s.status})`);
      if (r.cleared || r.fast) fail('stars: a trapdoor fall counted as a clear');
      if (r.found !== 1) fail('stars: a fall lost the secrets found');
      s = step(s, { type: 'continue' });
      if (s.landing < 0) fail('stars: no landing after a fall');
      s = walk(s, s.floor.stairs);
      const r2 = floorResult(s);
      if (!r2.cleared) fail('stars: a floor entered by a fall could not be cleared');
      if (r2.fast) fail('stars: a floor entered by a fall counted as fast');
    }
  }

  // migration
  const v3 = { artifacts: { egypt: true }, camp: { egypt: 9 }, deepest: { egypt: 12, maya: 2 }, completions: { egypt: 1 }, blackUnlockSeen: false, endingSeen: false, hints: { plate: true }, records: {} };
  const m3 = migrateProgress(structuredClone(v3), 3);
  const em = m3.floors.egypt ?? {};
  if (Object.keys(em).length !== 13 || !Array.from({ length: 12 }, (_, i) => em[i]).every((r) => r && r.s === STAR.CLEARED && r.t === null && r.f === 0 && r.n === 0)) fail('migration v3: egypt floors above the deepest are not all cleared');
  if (!em[24] || em[24].s !== STAR.CLEARED) fail('migration v3: a taken artifact did not clear the basement');
  if (em[12]) fail('migration v3: the deepest floor itself counted as cleared');
  if (Object.keys(m3.floors.maya ?? {}).length !== 2) fail('migration v3: maya floors');
  const v4 = { ...v3, records: { egypt: { escapes: 2, bestEscape: 31, untouched: 1 } } };
  const m4 = migrateProgress(structuredClone(v4), 4);
  const strip = (d: ProgressData) => {
    const { floors, ...rest } = d;
    void floors;
    return JSON.stringify(rest);
  };
  if (strip(m4) !== strip({ ...m4, ...v4, floors: {} } as ProgressData)) fail('migration v4: other fields changed');
  if (JSON.stringify(m3.floors) !== JSON.stringify(m4.floors)) fail('migration: v3 and v4 saves disagree about floors');
  if (migrateProgress(structuredClone(v4), 5).floors && Object.keys(migrateProgress(structuredClone(v4), 5).floors).length) fail('migration: a v5 save was rewritten');
  const old1 = migrateProgress({ deepest: { egypt: 99 }, camp: { egypt: 3 } }, 1);
  if ((old1.deepest.egypt ?? -1) !== 24 || !old1.floors.egypt || Object.keys(old1.floors.egypt).length !== 24) fail('migration v1: deepest not clamped before stars');
  void TILE;
}
