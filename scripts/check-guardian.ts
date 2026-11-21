/**
 * Guardian and escape checks (plan 04), called from check-floors.ts: placement and fairness of
 * the false door, the lair and the route on every floor; rule tests on scripted states of the
 * real Egypt floors. Pure core code only: no Skia, no React.
 */
import { SLOPE, sandLevel } from '../src/game/core/collapse';
import { profileFor } from '../src/game/core/architecture';
import { EGYPT_ROWS } from '../src/game/core/egypt';
import { ESCAPE_SPEED, EXIT_OPEN } from '../src/game/core/escape';
import { DIRS, TILE, distancesFrom, type Floor } from '../src/game/core/floor';
import { floorFor, addFeatures, generateLayout, layoutFor, specFor } from '../src/game/core/generate';
import { lastCamp, startFloor, step, type Direction, type GameState, type Pyramid } from '../src/game/core/game';
import { reachable } from '../src/game/core/graph';
import { CARRY, radiusOf, radiusQ } from '../src/game/core/lights';
import {
  CLOSE,
  FOLLOW_WARN,
  QUIET_GAP,
  type GuardianMode,
  RECOIL,
  RISE,
  SENTINEL_RISE,
  STUN_TOUCH,
  guardianCue,
  sees,
  sightRange,
  touchIfMet,
  tickGuardian,
} from '../src/game/core/guardian';
import { PYRAMIDS } from '../src/game/core/pyramids';
import { pressPlate } from '../src/game/core/traps';
import { computeLight } from '../src/game/core/vision';
import type { Report } from './check-traps';

const egypt = PYRAMIDS.egypt;

const manhattan = (size: number, a: number, b: number) => Math.abs((a % size) - (b % size)) + Math.abs(Math.floor(a / size) - Math.floor(b / size));
const tick = (s: GameState, seconds: number) => step(s, { type: 'tick', seconds });
const move = (s: GameState, dir: Direction) => step(s, { type: 'move', dir });
const has = (s: GameState, type: string) => s.events.some((e) => e.type === type);

/** FNV of the guardian and exit placement of a floor (the `egypt:i:g` snapshot keys). */
export function placementHash(f: Floor): string {
  let h = 0x811c9dc5;
  const mix = (v: number) => {
    h ^= v & 255;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  const num = (v: number) => {
    for (let b = 0; b < 4; b++) mix(v >> (8 * b));
  };
  num(f.exit);
  num(f.exitFront);
  if (f.guardian) {
    num(f.guardian.lair);
    num(f.guardian.facing);
    for (const r of f.guardian.route) num(r);
  } else num(-7);
  if (f.collapse) num(f.collapse.capLen);
  return h.toString(16).padStart(8, '0');
}

/** Placement and fairness of the false door and the guardian of one floor (plan 04 §Verification). */
export function checkGuardianFloor(label: string, p: Pyramid, i: number, f: Floor, { fail, warn }: Report) {
  const profile = profileFor(p.architecture);
  const row = profile.guardian?.(i) ?? null;
  const basement = i === p.floorCount - 1;
  const { size } = f;
  const n = size * size;
  const wantExit = profile.falseDoor && basement;
  const trapTile = new Set(f.traps.map((t) => t.tile));
  const items = new Set(f.items.map((it) => it.tile));
  const fixtureTiles = new Set(f.fixtures.map((x) => x.tile));
  let open = 0;
  for (let k = 0; k < n; k++) if (!f.solid[k]) open++;

  // the worst case: every tile the sand may take, every trap tile and portcullis port
  const worst = f.solid.slice();
  const noSand = f.solid.slice();
  for (const t of f.traps) {
    worst[t.tile] = 1;
    noSand[t.tile] = 1;
    if (t.kind === 'portcullis') {
      worst[t.target] = 1;
      noSand[t.target] = 1;
    }
  }
  if (f.collapse) for (const t of f.collapse.order) worst[t] = 1;

  if (!wantExit) {
    if (f.exit >= 0 || f.exitFront >= 0) fail(`${label}: a false door on a floor that should have none`);
  } else if (f.exit < 0) {
    fail(`${label}: no false door`);
  } else {
    const R = f.exit;
    const T = f.exitFront;
    if (T !== R + size) fail(`${label}: exitFront is not south of the door`);
    if (f.tiles[R] !== TILE.ROCK || f.tiles[R - size] !== TILE.ROCK) fail(`${label}: false door tile is not rock with rock behind`);
    if (f.tiles[R - 1] !== TILE.ROCK || f.tiles[R + 1] !== TILE.ROCK) warn(`${label}: false door without side rock (fallback)`);
    if (f.tiles[T] !== TILE.FLOOR || f.solid[T]) fail(`${label}: exitFront is not open floor`);
    if (f.collapse && f.collapse.rank[T] !== -1) fail(`${label}: exitFront is in the sand order`);
    if (trapTile.has(T) || items.has(T) || fixtureTiles.has(T)) fail(`${label}: exitFront on a trap, item or fixture`);
    const kind = f.rooms[f.room[T]]?.kind;
    if (kind === 'stairsUp' || kind === 'stairsDown' || kind === 'burial' || kind === 'antechamber') fail(`${label}: exit in a ${kind}`);
    if (f.collapse?.protect) {
      for (let t = 0; t < n; t++) if (f.collapse.protect[t] && f.collapse.rank[t] >= 0) fail(`${label}: protected route tile ${t} is in the sand order`);
    }
    const w = worst.slice();
    if (f.guardian?.sentinel) w[f.guardian.lair] = 1;
    if (distancesFrom(w, size, f.stairs)[T] < 0) fail(`${label}: exitFront unreachable from the artifact on the worst-case mask`);
    // distance band: 0.45-0.85 of the best candidate (candidates: the same filters, no sand tile)
    const d = distancesFrom(f.solid, size, f.stairs);
    // the placement's own mask: static + traps + ports + the sand that falls before the artifact is taken
    const wo = f.solid.slice();
    for (const t of f.traps) {
      wo[t.tile] = 1;
      if (t.kind === 'portcullis') wo[t.target] = 1;
    }
    if (f.collapse) for (let k = 0; k < f.collapse.capLen; k++) wo[f.collapse.order[k]] = 1;
    const reach = distancesFrom(wo, size, f.stairs);
    let D = 0;
    for (let t = 2 * size; t < n - size; t++) {
      if (f.tiles[t] !== TILE.FLOOR || f.solid[t] || f.tiles[t - size] !== TILE.ROCK || f.tiles[t - 2 * size] !== TILE.ROCK) continue;
      if (f.tiles[t - size - 1] !== TILE.ROCK || f.tiles[t - size + 1] !== TILE.ROCK) continue;
      if (f.collapse && f.collapse.rank[t] >= 0 && f.collapse.rank[t] < f.collapse.capLen) continue;
      if (reach[t] < 0 || trapTile.has(t) || items.has(t) || fixtureTiles.has(t) || t === f.stairs) continue;
      if (DIRS.some(([dx, dy]) => trapTile.has(t + dy * size + dx))) continue;
      const rk = f.rooms[f.room[t]]?.kind;
      if (rk === 'stairsUp' || rk === 'stairsDown' || rk === 'burial' || rk === 'antechamber') continue;
      if (d[t] > D) D = d[t];
    }
    if (D > 0 && (d[T] < 0.45 * D - 1 || d[T] > 0.85 * D + 1)) warn(`${label}: exit distance ${d[T]} outside 0.45-0.85 of ${D}`);
  }

  if (!row) {
    if (f.guardian) fail(`${label}: a guardian on a floor without a guardian row`);
    return;
  }
  const g = f.guardian;
  if (!g) {
    fail(`${label}: no guardian placed`);
    return;
  }
  const L = g.lair;
  if (f.solid[L] || f.tiles[L] !== TILE.FLOOR) fail(`${label}: guardian lair is not plain floor`);
  if (new Set(f.mainPath).has(L)) fail(`${label}: guardian lair on the main path`);
  const near = (set: Set<number>) => set.has(L) || DIRS.some(([dx, dy]) => set.has(L + dy * size + dx));
  // the sentinel's chamber is tiny: beside an eternal brazier is allowed there, never on a fixture
  if (near(trapTile) || near(items) || (row.sentinel ? fixtureTiles.has(L) : near(fixtureTiles))) fail(`${label}: guardian lair on or next to a trap, item or fixture`);
  const gone = f.solid.slice();
  gone[L] = 1;
  if (reachable(gone, size, f.start) !== open - 1) fail(`${label}: the guardian's tile cuts the floor`);
  const m = noSand.slice();
  m[L] = 1;
  if (distancesFrom(m, size, f.start)[f.stairs] < 0) fail(`${label}: the guardian's tile cuts the way to the stairs`);
  if (f.exitFront >= 0) {
    const w = worst.slice();
    w[L] = 1;
    if (distancesFrom(w, size, f.stairs)[f.exitFront] < 0) fail(`${label}: the sentinel cuts the artifact from the exit`);
  }
  if (row.sentinel) {
    const door = f.rooms[f.room[f.stairs]].doors[0];
    if (distancesFrom(f.solid, size, door)[L] > 3) fail(`${label}: sentinel post farther than 3 steps from the burial door`);
  } else if (f.collapse && f.collapse.rank[L] >= 0 && f.collapse.rank[L] <= f.collapse.cap + 4 * SLOPE) fail(`${label}: guardian lair inside the sand`);
  const route = Array.from(g.route);
  if (route.length < 3 || route.length > 8) fail(`${label}: route has ${route.length} anchors`);
  const fromLair = distancesFrom(f.solid, size, L);
  for (const r of route) {
    const kind = f.rooms[f.room[r]]?.kind;
    if (kind === 'stairsUp' || kind === 'stairsDown' || kind === 'burial') fail(`${label}: route anchor in a ${kind}`);
    if (fromLair[r] < 0) fail(`${label}: route anchor unreachable`);
    if (trapTile.has(r)) fail(`${label}: route anchor on a trap`);
  }
}

// ---- rule tests --------------------------------------------------------------------------------------

/** The hand light for a scripted state: the real light around the player, nothing else. */
function relightHere(s: GameState) {
  const spec = CARRY[s.hand.kind];
  const burning = s.hand.left > 0;
  computeLight(s.grid, s.pos, burning ? radiusQ(radiusOf(spec, s.hand.left)) : 0.875, burning ? spec.falloff : 1.6, s.lightHand);
  s.light.set(s.lightHand);
  s.handR = burning ? radiusQ(radiusOf(spec, s.hand.left)) : 0.875;
}

type Arena = { s: GameState; y: number; at: (x: number) => number };

/** A floor-18 run with a straight carved corridor along row 1, the burning light and the guardian awake or not. */
function arena(floorIndex = 17, hand: GameState['hand'] = { kind: 'torch', left: 1000 }, bag: GameState['bag'] = []): Arena {
  const s = startFloor(egypt, floorIndex, hand, bag);
  const { size } = s.floor;
  for (let x = 1; x < size - 1; x++) {
    s.grid.solid[size + x] = 0;
    s.grid.opaque[size + x] = 0;
  }
  s.burning = true;
  s.cooldown = 0;
  s.collapse = null;
  return { s, y: 1, at: (x) => size + x };
}

/** Puts the guardian (awake in `mode`) and the player on the corridor. */
function stage(a: Arena, gx: number, px: number, mode: GuardianMode) {
  const { s } = a;
  const g = s.guardian!;
  g.pos = g.prev = a.at(gx);
  g.mode = mode;
  g.facing = 0;
  g.distFrom = g.toTargetFor = -1;
  g.cooldown = 0;
  g.target = -1;
  s.pos = s.prevPos = a.at(px);
  relightHere(s);
}

export function runGuardianChecks({ fail, warn }: Report) {
  const G = 17; // floor 18: the first guardian
  const row = EGYPT_ROWS[G].guardian!;

  // ---- waking ---------------------------------------------------------------------------------------
  {
    let s = startFloor(egypt, G, { kind: 'bigTorch', left: 100 });
    s.burning = true;
    s.collapse = null;
    let steps = 0;
    for (let k = 0; k < 449; k++) {
      s = tick(s, 0.1);
      if (has(s, 'guardianStep')) steps++;
    }
    if (s.guardian!.mode !== 'dormant' || steps) fail('guardian: it moved or woke before its wake time');
    for (let k = 0; k < 20 && s.guardian!.mode === 'dormant'; k++) s = tick(s, 0.1);
    if (s.guardian!.mode !== 'waking' || !has(s, 'guardianWake') || s.floorTime < row.wake - 1e-6 || s.floorTime > row.wake + 0.5) fail(`guardian: it did not wake after ${row.wake} s of burning (${s.guardian!.mode} at ${s.floorTime})`);
    for (let k = 0; k < 20; k++) s = tick(s, 0.1);
    if (s.guardian!.mode !== 'patrol') fail(`guardian: waking by the clock should end in a patrol (${s.guardian!.mode})`);
  }
  {
    // noise: a normal step at path 5 wakes it, a quiet one at path 3 does not, a bump wakes it
    const a = arena();
    stage(a, 5, 11, 'dormant');
    a.s.guardian!.mode = 'dormant';
    a.s.idle = 0.1;
    let s = move(a.s, 1);
    s = tick(s, 0.01);
    if (s.guardian!.mode !== 'waking') fail('guardian: a normal step at path 5 did not wake it');
    const b = arena();
    stage(b, 5, 9, 'dormant');
    b.s.idle = QUIET_GAP + 0.1;
    let t = move(b.s, 1);
    t = tick(t, 0.01);
    if (t.guardian!.mode !== 'dormant') fail('guardian: a quiet step at path 3 woke it');
    const c = arena();
    stage(c, 5, 9, 'dormant');
    c.s.idle = 0.1;
    let u = move(c.s, 1);
    u = tick(u, 0.01);
    if (u.guardian!.mode !== 'waking') fail('guardian: a normal step at path 4 did not wake it');
    // a dormant guardian is in the way; bumping it wakes it
    const d = arena();
    stage(d, 5, 6, 'dormant');
    let v = tick(d.s, 0.2);
    v = move(v, 1);
    if (v.pos !== d.at(6)) fail('guardian: you walked into a dormant guardian');
    v = tick(v, 0.01);
    if (v.guardian!.mode !== 'waking') fail('guardian: bumping a dormant guardian did not wake it');
    // close sight wakes it
    const e = arena();
    stage(e, 5, 7, 'dormant');
    const w = tick(e.s, 0.1);
    if (w.guardian!.mode !== 'waking') fail('guardian: a dormant guardian two tiles away did not wake');
  }

  // ---- sight ----------------------------------------------------------------------------------------
  {
    const test = (name: string, gx: number, px: number, mode: Parameters<typeof stage>[3], want: boolean, hand?: GameState['hand']) => {
      const a = arena(G, hand);
      stage(a, gx, px, mode);
      if (hand) a.s.hand = hand;
      relightHere(a.s);
      if (sees(a.s, a.s.guardian!) !== want) fail(`guardian: sight ${name}: want ${want}`);
    };
    test('torch in the cone at 10', 3, 13, 'patrol', true);
    test('torch in the cone at 12', 3, 15, 'patrol', false);
    test('behind it at 6 while patrolling', 20, 14, 'patrol', false);
    test('behind it at 6 while hunting', 20, 14, 'hunt', true);
    test('embers at 3', 20, 23, 'patrol', false, { kind: 'torch', left: 0 });
    test('embers adjacent', 20, 21, 'patrol', true, { kind: 'torch', left: 0 });
    test('candle at 5', 3, 8, 'patrol', true, { kind: 'candle', left: 90 });
    test('candle at 6', 3, 9, 'patrol', false, { kind: 'candle', left: 90 });
    test('anywhere within 2', 20, 18, 'patrol', true, { kind: 'candle', left: 90 });
    const a = arena(G, { kind: 'candle', left: 90 });
    if (Math.abs(sightRange(a.s) - 5.75) > 0.1) fail(`guardian: candle sight range ${sightRange(a.s)}, want about 5.8`);
    // a wall in between
    const b = arena();
    stage(b, 3, 9, 'patrol');
    b.s.grid.opaque[b.at(6)] = 1;
    if (sees(b.s, b.s.guardian!)) fail('guardian: it saw through a wall');
    void CLOSE;
  }

  // ---- contact --------------------------------------------------------------------------------------
  {
    const a = arena(G, { kind: 'torch', left: 100 }, [{ kind: 'lamp', left: 100 }]);
    stage(a, 10, 10, 'patrol');
    a.s.prevPos = a.at(9);
    touchIfMet(a.s);
    const s = a.s;
    if (s.hand.kind !== 'lamp' || s.bag.length) fail('guardian: contact did not light the spare');
    if (s.cooldown < STUN_TOUCH - 1e-9) fail('guardian: contact did not stun');
    if (s.pos !== a.at(9)) fail('guardian: contact did not push you to the tile before');
    if (s.guardian!.mode !== 'recoil' || Math.abs(s.guardian!.timer - RECOIL) > 1e-9 || !has(s, 'guardianTouch')) fail('guardian: contact did not make it recoil');
    // it steps away only after the still part
    const b = arena(G, { kind: 'torch', left: 0 });
    stage(b, 10, 10, 'patrol');
    touchIfMet(b.s);
    if (b.s.status !== 'caught' || !has(b.s, 'caught')) fail('guardian: contact on embers did not catch you');
    const back = step(b.s, { type: 'retry' });
    if (back.floorIndex !== lastCamp(egypt, G) || back.status !== 'playing') fail('guardian: retry after caught did not go to the last camp');
    // the recoil lets go of you: a recoiling guardian does not touch
    const c = arena(G, { kind: 'torch', left: 100 });
    stage(c, 10, 10, 'recoil');
    touchIfMet(c.s);
    if (c.s.guardian!.touches !== 0) fail('guardian: a recoiling guardian touched');
  }

  // ---- plates ---------------------------------------------------------------------------------------
  {
    let i = -1;
    for (let k = G; k < egypt.floorCount && i < 0; k++) if (floorFor(egypt, k).traps.some((t) => t.kind === 'block')) i = k;
    const f = floorFor(egypt, i);
    const k = f.traps.findIndex((t) => t.kind === 'block');
    const plate = f.traps[k].tile;
    // hunting: it rushes over an armed plate
    const s = startFloor(egypt, i, { kind: 'bigTorch', left: 100 });
    s.burning = true;
    const { size } = s.floor;
    const A = plate - 1;
    const B = plate + 1;
    for (const t of [A, plate, B]) {
      s.grid.solid[t] = 0;
      s.grid.opaque[t] = 0;
    }
    for (const t of [A, plate, B]) for (const d of [size, -size]) {
      s.grid.solid[t + d] = 1;
      s.grid.opaque[t + d] = 1;
    }
    s.grid.solid[A - 1] = 1;
    s.grid.solid[B + 1] = 1;
    const g = s.guardian!;
    g.pos = g.prev = A;
    g.mode = 'hunt';
    g.target = B;
    g.facing = 0;
    g.distFrom = g.toTargetFor = -1;
    s.pos = s.prevPos = f.start;
    s.light.fill(0);
    let t = tick(s, 0.01);
    if (t.guardian!.pos !== plate || t.trapPhase[k] !== 1 || !has(t, 'plate')) fail('guardian: a hunting guardian did not trip the plate');
    // standing on a fired block: the stone drives it back and it recoils
    t.guardian!.cooldown = 5;
    t = tick(t, 0.6);
    if (!t.grid.solid[plate] || !has(t, 'trapFired')) fail('guardian: the block did not fall');
    if (t.guardian!.pos === plate || t.guardian!.mode !== 'recoil' || !has(t, 'guardianHit')) fail('guardian: the block did not push the guardian and stun it');
    // patrolling never steps on an armed plate or trapdoor over 600 s
    let r = startFloor(egypt, G, { kind: 'torch', left: 1000 });
    r.burning = true;
    r.collapse = null;
    const rg = r.guardian!;
    rg.mode = 'patrol';
    let samples = 0;
    let bad = 0;
    let steps = 0;
    let lastPos = rg.pos;
    for (let q = 0; q < 6000 && r.status === 'playing'; q++) {
      if (r.hand.left < 1e8) r.hand = { kind: 'torch', left: 1e9 };
      r = tick(r, 0.1);
      const gp = r.guardian!;
      if (gp.mode === 'hunt') continue;
      samples++;
      const trap = r.floor.trapAt[gp.pos];
      if (trap >= 0 && r.trapPhase[trap] === 0) bad++;
      if (gp.pos !== lastPos) steps++;
      lastPos = gp.pos;
    }
    if (bad) fail(`guardian: a patrol stood on an armed plate or trapdoor ${bad} times`);
    if (samples < 3000) warn(`guardian: only ${samples} patrol samples in the 600 s plate test`);
    if (!steps) fail('guardian: it never walked in 600 s of patrol');
  }

  // ---- fixtures, sand ---------------------------------------------------------------------------------
  {
    let i = -1;
    for (let k = G; k < egypt.floorCount - 1 && i < 0; k++) if (floorFor(egypt, k).fixtures.some((x) => x.kind === 'sconce')) i = k;
    const f = floorFor(egypt, i);
    const sc = f.fixtures.findIndex((x) => x.kind === 'sconce');
    const s = startFloor(egypt, i, { kind: 'bigTorch', left: 100 });
    s.burning = true;
    s.fixtureLeft[sc] = 100;
    const d = distancesFrom(f.solid, f.size, f.fixtures[sc].tile);
    let from = -1;
    for (let t = 0; t < d.length; t++) if (d[t] === 3 && from < 0) from = t;
    const g = s.guardian!;
    g.pos = g.prev = from;
    g.mode = 'investigate';
    g.target = f.fixtures[sc].tile;
    g.distFrom = g.toTargetFor = -1;
    s.pos = s.prevPos = f.start;
    s.light.fill(0);
    let t = s;
    for (let k = 0; k < 40 && t.fixtureLeft[sc] > 0; k++) t = tick(t, 0.1);
    if (t.fixtureLeft[sc] !== -1 || !has(t, 'snuffed')) fail('guardian: a lit sconce on its path was not put out');
    // wading is slower
    const a = arena(G, { kind: 'bigTorch', left: 1000 });
    stage(a, 5, 45, 'investigate');
    a.s.guardian!.target = a.at(15);
    a.s.sand[a.at(6)] = 128;
    const w = tick(a.s, 0.01);
    if (Math.abs(w.guardian!.stepDur - row.search * 1.8) > 1e-6) fail(`guardian: wading step ${w.guardian!.stepDur}, want ${row.search * 1.8}`);
    const b = arena(G, { kind: 'bigTorch', left: 1000 });
    stage(b, 5, 45, 'investigate');
    b.s.guardian!.target = b.at(15);
    const dry = tick(b.s, 0.01);
    if (Math.abs(dry.guardian!.stepDur - row.search) > 1e-6) fail('guardian: dry step is not the search pace');
    // a tile that turns to rock under it pushes it to an open neighbour
    const c = arena(G, { kind: 'bigTorch', left: 1000 });
    stage(c, 5, 45, 'patrol');
    c.s.guardian!.mode = 'listen';
    c.s.guardian!.timer = 100;
    c.s.grid.solid[c.at(5)] = 1;
    const e = tick(c.s, 0.01);
    if (e.grid.solid[e.guardian!.pos]) fail('guardian: it was left standing in solid sand');
  }

  // ---- following down the stairs ------------------------------------------------------------------------
  {
    const F = 21; // floor 22: follow starts here
    let s = startFloor(egypt, F, { kind: 'bigTorch', left: 100 });
    s.burning = true;
    const g = s.guardian!;
    g.mode = 'hunt';
    g.pos = g.prev = s.floor.guardian!.lair;
    g.distFrom = -1;
    s.pos = s.floor.stairs;
    s.status = 'descending';
    let n = step(s, { type: 'continue' });
    const fg = n.guardian!;
    if (fg.mode !== 'arriving' || fg.timer < 5 || fg.timer > 25) fail(`guardian: a hunting guardian did not follow (${fg.mode}, ${fg.timer})`);
    n.burning = true;
    n.collapse = null;
    const far = Array.from({ length: n.floor.size * n.floor.size }, (_, t) => t).find((t) => !n.floor.solid[t] && n.floor.dist[t] > 12)!;
    n.pos = n.prevPos = far;
    relightHere(n);
    const gap = fg.timer;
    let warnedAt = -1;
    let arrivedAt = -1;
    for (let q = 0; q < 400 && arrivedAt < 0; q++) {
      n = tick(n, 0.1);
      const tt = (q + 1) * 0.1;
      if (warnedAt < 0 && has(n, 'guardianFollow')) warnedAt = tt;
      if (n.guardian!.mode !== 'arriving') arrivedAt = tt;
    }
    if (Math.abs(arrivedAt - warnedAt - FOLLOW_WARN) > 0.25) fail(`guardian: follow warning ${arrivedAt - warnedAt} s before arrival, want ${FOLLOW_WARN}`);
    if (Math.abs(arrivedAt - gap) > 0.25) fail('guardian: follower arrived off its gap');
    if (n.guardian!.mode === 'gone' || !['investigate', 'hunt'].includes(n.guardian!.mode)) fail(`guardian: the follower did not come after you (${n.guardian!.mode})`);
    if (n.guardian!.target !== far && n.guardian!.mode === 'investigate') fail('guardian: the follower did not track your position');
    // sand on the landing seals it out
    let m = step(Object.assign(startFloor(egypt, F, { kind: 'bigTorch', left: 100 }), {}), { type: 'tick', seconds: 0 });
    m.guardian!.mode = 'hunt';
    m.guardian!.distFrom = -1;
    m.pos = m.floor.stairs;
    m.status = 'descending';
    m = step(m, { type: 'continue' });
    m.burning = true;
    m.collapse = null;
    m.grid.solid[m.floor.start] = 1;
    m.pos = m.prevPos = far;
    for (let q = 0; q < 400 && m.guardian!.mode === 'arriving'; q++) m = tick(m, 0.1);
    if (m.guardian!.mode !== 'gone' || !has(m, 'guardianGone')) fail('guardian: sand on the landing did not seal the follower out');
    // a trapdoor fall loses it; a calm guardian does not follow
    let q = startFloor(egypt, F, { kind: 'bigTorch', left: 100 });
    q.guardian!.mode = 'hunt';
    q.status = 'falling';
    const after = step(q, { type: 'continue' });
    if (after.guardian && after.guardian.mode === 'arriving') fail('guardian: a fall through a trapdoor was followed');
    q = startFloor(egypt, F, { kind: 'bigTorch', left: 100 });
    q.pos = q.floor.stairs;
    q.status = 'descending';
    const calm = step(q, { type: 'continue' });
    if (calm.guardian && calm.guardian.mode === 'arriving') fail('guardian: a dormant guardian followed');
  }

  // ---- the escape ------------------------------------------------------------------------------------------
  {
    const B = egypt.floorCount - 1;
    const f = floorFor(egypt, B);
    const nbOf = (t: number) => DIRS.map(([dx, dy], d) => ({ d: d as Direction, q: t + dy * f.size + dx })).find((o) => !f.solid[o.q] && o.q !== t)!;
    const base = () => {
      const s = startFloor(egypt, B, { kind: 'bigTorch', left: 100 });
      s.burning = true;
      return s;
    };
    let s = base();
    const nb = nbOf(f.stairs);
    s.pos = s.prevPos = nb.q;
    s.cooldown = 0;
    const opp: Record<number, Direction> = { 0: 1, 1: 0, 2: 3, 3: 2 };
    s = move(s, opp[nb.d]);
    if (!s.escape?.taken || s.status !== 'playing') fail('escape: stepping on the artifact did not take it');
    if (s.collapse!.limit !== s.collapse!.order.length || s.collapse!.speed !== ESCAPE_SPEED || !s.collapse!.started) fail('escape: the sand did not start or speed up');
    if (!has(s, 'artifactTaken') || !has(s, 'quake')) fail('escape: missing artifactTaken or quake events');
    if (s.collapse!.order.length <= f.collapse!.capLen) warn('escape: the escape sand is not longer than the plain collapse on the fixed seed');
    if (s.guardian!.mode !== 'waking' || Math.abs(s.guardian!.timer - SENTINEL_RISE) > 1e-9) fail('escape: the sentinel did not start to rise');
    s.pos = s.prevPos = f.exitFront;
    relightHere(s);
    let t = 0;
    for (; t < 2 && !s.escape.open; t += 0.1) s = tick(s, 0.1);
    if (!s.escape.open || Math.abs(t - EXIT_OPEN) > 0.25 || s.grid.solid[f.exit] || !has(s, 'exitOpened')) fail('escape: the false door did not open after 1.5 s');
    if (s.lightFixed[f.exit] <= 0 || s.light[f.exit] <= 0) fail('escape: the shaft gives no light');
    for (let k = 0; k < 40; k++) s = tick(s, 0.1);
    if (s.guardian!.mode !== 'hunt' && s.guardian!.mode !== 'recoil') fail(`escape: the sentinel did not hunt after rising (${s.guardian!.mode})`);
    s.cooldown = 0;
    s.guardian!.pos = s.guardian!.prev = f.start;
    s = move(s, 3);
    if (s.status !== 'escaped' || s.pos !== f.exit) fail('escape: stepping into the open false door did not end the run');
    // the false door is shut until opened
    let c = base();
    c.pos = c.prevPos = f.exitFront;
    c.cooldown = 0;
    c = move(c, 3);
    if (c.pos === f.exit) fail('escape: you walked through a closed false door');
    // the cut-off check looks at the exit once the artifact is taken
    let d = base();
    d.pos = d.prevPos = f.exitFront;
    d.escape!.taken = true;
    d.escape!.open = true;
    for (const [dx, dy] of DIRS) d.grid.solid[f.exitFront + dy * f.size + dx] = 1;
    d.grid.solid[f.exitFront] = 0;
    d.solidDirty = true;
    d.pos = d.floor.stairs;
    d = tick(d, 0.1);
    if (d.status !== 'buried') fail('escape: being cut off from the exit did not bury you');
    let e = base();
    e.pos = e.floor.stairs;
    for (const [dx, dy] of DIRS) e.grid.solid[f.exitFront + dy * f.size + dx] = 1;
    e.solidDirty = true;
    e = tick(e, 0.1);
    if (e.status === 'buried') fail('escape: before the artifact is taken the stairs are the goal, not the exit');
    // other pyramids: the artifact still wins at once
    const mf = floorFor(PYRAMIDS.maya, PYRAMIDS.maya.floorCount - 1);
    let m = startFloor(PYRAMIDS.maya, PYRAMIDS.maya.floorCount - 1);
    m.burning = true;
    const mn = DIRS.map(([dx, dy], dd) => ({ dd: dd as Direction, q: mf.stairs + dy * mf.size + dx })).find((o) => !mf.solid[o.q])!;
    m.pos = m.prevPos = mn.q;
    m = move(m, opp[mn.dd]);
    if (m.status !== 'escaped') fail('escape: a basement without a false door should still end at once');
    // a dormant sentinel holds its post and is not woken by noise
    let z = base();
    z.guardian!.mode = 'dormant';
    z.noises.push(z.guardian!.pos, 16);
    z = tick(z, 5);
    if (z.guardian!.mode !== 'dormant') fail('escape: noise woke the sentinel');
  }

  // ---- cue and timing -------------------------------------------------------------------------------------
  {
    const a = arena();
    stage(a, 5, 11, 'patrol');
    const cue = guardianCue(a.s);
    if (!cue || cue.path !== 6 || cue.dx !== -6 || cue.dy !== 0 || cue.mode !== 'patrol') fail('guardian: guardianCue disagrees with the staging');
    void sandLevel;
    // a hunting guardian on floor 24 for 60 s: tickGuardian cost
    let s = startFloor(egypt, 23, { kind: 'torch', left: 1000 });
    s.burning = true;
    s.guardian!.mode = 'hunt';
    let worstMs = 0;
    let total = 0;
    let n = 0;
    const walk = [3, 2, 3, 3, 1, 1, 2, 0];
    for (let q = 0; q < 600; q++) {
      s.cooldown = 0;
      const dir = walk[q % walk.length] as Direction;
      s = move(s, dir);
      const t0 = performance.now();
      tickGuardian(s, 0.1);
      const ms = performance.now() - t0;
      // the first calls are JIT warm-up, not the steady state a phone sees every frame
      if (q < 20) continue;
      worstMs = Math.max(worstMs, ms);
      total += ms;
      n++;
      if (s.status !== 'playing') break;
      if (s.hand.left < 1e8) s.hand = { kind: 'torch', left: 1e9 };
    }
    const avg = total / Math.max(1, n);
    console.log(`guardian timing: tickGuardian average ${avg.toFixed(3)} ms, worst ${worstMs.toFixed(2)} ms (floor 24)`);
    if (avg > 0.05) warn(`guardian: tickGuardian average ${avg.toFixed(3)} ms (target < 0.05)`);
    if (worstMs > 1) warn(`guardian: tickGuardian worst ${worstMs.toFixed(2)} ms (target < 1)`);
    const lay = layoutFor(egypt, 24);
    const below = null;
    const spec = specFor(egypt, 24);
    let t0 = performance.now();
    const gl = generateLayout({ ...spec, arrivalWorld: spec.arrivalWorld });
    const lms = performance.now() - t0;
    t0 = performance.now();
    addFeatures(lay, spec, below);
    const fms = performance.now() - t0;
    void gl;
    void lms;
    console.log(`generation: features of the basement incl. false door and sentinel ${fms.toFixed(1)} ms`);
    if (fms > 14) warn(`basement features ${fms.toFixed(1)} ms (target < 14)`);
    void manhattan;
    void pressPlate;
  }
}
