/**
 * Rule tests for the traps, the trapdoor and the collapse (plan 03), on scripted states of the
 * real Egypt floors. Called from check-floors.ts. Pure core code only.
 */
import { COVER, SLOPE, WADE, rebuildRank, sandLevel } from '../src/game/core/collapse';
import { DIRS, TILE, type Floor, type TrapKind } from '../src/game/core/floor';
import { floorFor } from '../src/game/core/generate';
import { lastCamp, startFloor, step, type Direction, type GameState } from '../src/game/core/game';
import { CARRY, STEP_SECONDS } from '../src/game/core/lights';
import { PYRAMIDS } from '../src/game/core/pyramids';
import { LAND_STUN, resolveLanding } from '../src/game/core/traps';
import { exits, holdDir, runDir } from '../src/game/core/walk';
import type { Report } from './check-traps';

const egypt = PYRAMIDS.egypt;

/** the first Egypt floor (0-based) that has a trap of this kind and (optionally) a collapse */
function floorWith(kind: TrapKind, from = 0, collapse = false): number {
  for (let i = from; i < egypt.floorCount; i++) {
    const f = floorFor(egypt, i);
    if (f.traps.some((t) => t.kind === kind) && (!collapse || f.collapse)) return i;
  }
  return -1;
}

/** direction from tile a to the adjacent tile b */
function dirTo(size: number, a: number, b: number): Direction {
  const dx = (b % size) - (a % size);
  const dy = Math.floor(b / size) - Math.floor(a / size);
  return DIRS.findIndex(([x, y]) => x === dx && y === dy) as Direction;
}

/** A state standing next to `to` with the light burning, ready to step on it. */
function readyNextTo(i: number, to: number, from: number, bag: Array<{ kind: 'lamp'; left: number }> = []): GameState {
  const s = startFloor(egypt, i, { kind: 'bigTorch', left: 100 }, bag);
  s.pos = s.prevPos = from;
  s.cooldown = 0;
  s.burning = true;
  void to;
  return s;
}

/** Replaces the sand order of a run with these tiles (sdist 1, 2, 3...). */
function doctor(s: GameState, tiles: number[]) {
  const c = s.collapse!;
  c.order = Int32Array.from(tiles);
  c.sdist = new Int32Array(c.sdist.length).fill(-1);
  c.rank = new Int32Array(c.rank.length).fill(-1);
  tiles.forEach((t, k) => {
    c.sdist[t] = k + 1;
    c.rank[t] = k;
  });
}

/** `n` open tiles far from the start, spread apart, not in `not`. */
function farTiles(f: Floor, n: number, not: number[]): number[] {
  const out: number[] = [];
  for (let t = f.size * f.size - 1; t >= 0 && out.length < n; t--) {
    if (f.solid[t] || f.dist[t] < 20 || not.includes(t) || out.some((o) => Math.abs((o % f.size) - (t % f.size)) + Math.abs(Math.floor(o / f.size) - Math.floor(t / f.size)) < 4)) continue;
    out.push(t);
  }
  return out;
}

const tick = (s: GameState, seconds: number) => step(s, { type: 'tick', seconds });
const move = (s: GameState, dir: Direction) => step(s, { type: 'move', dir });
const has = (s: GameState, type: string) => s.events.some((e) => e.type === type);
const openNb = (f: Floor, t: number) => DIRS.map(([dx, dy]) => t + dy * f.size + dx).filter((q) => !f.solid[q]);

export function runTrapRules({ fail, warn }: Report) {
  const eventsOf = (s: GameState, type: string) => s.events.filter((e) => e.type === type).length;

  // ---- block ---------------------------------------------------------------------------
  {
    const i = floorWith('block');
    const f = floorFor(egypt, i);
    const k = f.traps.findIndex((t) => t.kind === 'block');
    const plate = f.traps[k].tile;
    const from = openNb(f, plate)[0];
    // standing on the plate: the block falls after 0.5 s, the hand light is lost, you are pushed back
    let s = readyNextTo(i, plate, from, [{ kind: 'lamp', left: 100 }]);
    s = move(s, dirTo(f.size, from, plate));
    if (s.trapPhase[k] !== 1 || !has(s, 'plate')) fail('rules: stepping on a block plate did not press it');
    s = tick(s, 0.49);
    if (s.grid.solid[plate]) fail('rules: the block fell before 0.5 s');
    s = tick(s, 0.02);
    if (!s.grid.solid[plate] || !s.grid.opaque[plate]) fail('rules: the block did not fill its tile');
    if (!has(s, 'hit') || s.pos !== from) fail('rules: a block did not hit and push you back to the tile before');
    if (s.hand.kind !== 'lamp' || s.bag.length !== 0) fail('rules: a block hit did not light the spare');
    if (s.cooldown < 0.7) fail('rules: a block hit did not stun');
    // with an empty bag: embers
    let e = readyNextTo(i, plate, from);
    e = move(e, dirTo(f.size, from, plate));
    e = tick(e, 0.55);
    if (e.hand.left !== 0 || e.status !== 'playing') fail('rules: a block hit with an empty bag should leave embers');
    // walking on: no hit, the tile is solid behind you
    let w = readyNextTo(i, plate, from);
    w = move(w, dirTo(f.size, from, plate));
    w = tick(w, STEP_SECONDS);
    const onward = openNb(f, plate).find((q) => q !== from);
    if (onward !== undefined) {
      w = move(w, dirTo(f.size, plate, onward));
      w = tick(w, 0.6);
      if (has(w, 'hit') || w.pos !== onward || !w.grid.solid[plate]) fail('rules: walking over a block plate should drop the block behind you');
    }
    // the static floor is never changed by a run
    if (f.solid[plate]) fail('rules: a run changed the floor mask');
  }

  // ---- portcullis ----------------------------------------------------------------------
  {
    const i = floorWith('portcullis');
    const f = floorFor(egypt, i);
    const k = f.traps.findIndex((t) => t.kind === 'portcullis');
    const { tile: plate, target: port } = f.traps[k];
    const from = openNb(f, plate).find((q) => q !== port)!;
    const beyond = 2 * port - plate;
    let s = readyNextTo(i, plate, from);
    s = move(s, dirTo(f.size, from, plate));
    s = tick(s, STEP_SECONDS);
    s = move(s, dirTo(f.size, plate, port));
    s = tick(s, STEP_SECONDS);
    s = move(s, dirTo(f.size, port, beyond));
    s = tick(s, 0.4);
    if (!s.grid.solid[port] || has(s, 'hit') || s.pos !== beyond) fail('rules: a portcullis should seal behind a walker');
    let t = readyNextTo(i, plate, from);
    t = move(t, dirTo(f.size, from, plate));
    t = tick(t, STEP_SECONDS);
    t = move(t, dirTo(f.size, plate, port));
    t = tick(t, 0.5);
    if (!has(t, 'hit') || t.pos !== beyond || !t.grid.solid[port]) fail('rules: stopping on a portcullis port should push you to the far side');
    // auto-walk never steps onto the plate
    const avoid = (q: number) => f.trapAt[q] >= 0;
    const before = from;
    const ex = exits(f, before);
    const toward = dirTo(f.size, before, plate);
    if (ex.length === 2 && runDir(f, f, before, toward, () => false, avoid) !== null) fail('rules: runDir stepped onto an armed plate');
    const ho = holdDir(f, before, toward, avoid);
    if (ho === toward && f.solid[plate]) fail('rules: holdDir into a solid plate');
    void ho;
  }
  // a bend never turns onto a trap
  {
    let tested = 0;
    for (let i = 0; i < egypt.floorCount && tested < 20; i++) {
      const f = floorFor(egypt, i);
      for (const t of f.traps) {
        for (const q of openNb(f, t.tile)) {
          const ex = exits(f, q);
          if (ex.length !== 2 || ex[0] >> 1 === ex[1] >> 1) continue;
          // q is a bend; arrive from the exit that is not the trap
          const toTrap = dirTo(f.size, q, t.tile);
          const other = ex.find((d) => d !== toTrap)!;
          const heading = ([1, 0, 3, 2] as Direction[])[other];
          if (holdDir(f, q, heading, (x) => x === t.tile) === toTrap) fail('rules: holdDir turned a bend onto an armed trap');
          tested++;
        }
      }
    }
  }

  // ---- sandfall ------------------------------------------------------------------------
  {
    const i = floorWith('sandfall');
    const f = floorFor(egypt, i);
    const k = f.traps.findIndex((t) => t.kind === 'sandfall');
    const tr = f.traps[k];
    const from = openNb(f, tr.tile)[0];
    let s = readyNextTo(i, tr.tile, from);
    const hadItem = s.items.has(tr.target);
    s = move(s, dirTo(f.size, from, tr.tile));
    for (let n = 0; n < 40; n++) s = tick(s, 0.1); // 4 s
    if (sandLevel(s, tr.target) < 0.35) fail('rules: a sandfall did not bury the guarded tile');
    if (hadItem && s.items.has(tr.target)) fail('rules: a sandfall did not bury the guarded item');
    if (s.grid.solid[tr.target] !== f.solid[tr.target]) fail('rules: a sandfall must never block movement');
  }

  // ---- trapdoor ------------------------------------------------------------------------
  {
    const i = floorWith('trapdoor');
    const f = floorFor(egypt, i);
    const k = f.traps.findIndex((t) => t.kind === 'trapdoor');
    const tr = f.traps[k];
    const from = openNb(f, tr.tile)[0];
    let s = readyNextTo(i, tr.tile, from);
    s = move(s, dirTo(f.size, from, tr.tile));
    s = tick(s, 0.2);
    if (s.status !== 'falling' || !has(s, 'fell') || s.skipped !== 1) fail('rules: a trapdoor did not drop you');
    const next = step(s, { type: 'continue' });
    const below = floorFor(egypt, i + 1);
    if (next.floorIndex !== i + 1 || next.status !== 'playing') fail('rules: continue after a fall did not start the floor below');
    const land = resolveLanding(below, tr.landingWorld!);
    if (next.pos !== land || next.landing !== land || next.cooldown !== LAND_STUN || next.skipped !== 1) fail('rules: the landing tile, stun or skipped count is wrong');
    if (next.grid.solid[next.pos]) fail('rules: landed in a wall');
  }

  // ---- collapse ------------------------------------------------------------------------
  {
    const i = 10; // floor 11
    const f = floorFor(egypt, i);
    const c = f.collapse!;
    let s = startFloor(egypt, i, { kind: 'bigTorch', left: 1000 });
    for (let n = 0; n < 4000; n++) s = tick(s, 0.1);
    if (s.collapse!.fill !== 0 || s.sand.some((v) => v > 0)) fail('rules: the collapse ran before the first move');
    // the clock starts at the first move
    const nb = openNb(f, f.start).find((q) => !f.solid[q])!;
    s = move(s, dirTo(f.size, f.start, nb));
    let q = 0;
    while (q < c.delay - 1) {
      s = tick(s, 1);
      q++;
    }
    if (has(s, 'quake') || s.collapse!.started) fail('rules: quake before the delay');
    s = tick(s, 2.5);
    if (!has(s, 'quake') || !s.collapse!.started) fail('rules: no quake after the delay');
    // monotone covered / blocked
    let covered = s.collapse!.covered;
    let blocked = s.collapse!.blocked;
    for (let n = 0; n < 1500 && s.status === 'playing'; n++) {
      s = tick(s, 0.1);
      if (s.collapse!.covered < covered || s.collapse!.blocked < blocked) fail('rules: covered or blocked went down');
      covered = s.collapse!.covered;
      blocked = s.collapse!.blocked;
    }
    if (s.collapse!.fill <= 0) fail('rules: the sand did not pour');
    // the sand order is respected: every blocked tile is solid and opaque
    for (let k = 0; k < s.collapse!.blocked; k++) {
      const t = s.collapse!.order[k];
      if (t !== s.collapse!.pending && (!s.grid.solid[t] || !s.grid.opaque[t])) fail('rules: a blocked tile is open');
    }
    // sand never builds beyond the cap + slope
    if (s.collapse!.covered > c.order.length) fail('rules: sand beyond the order');
  }
  {
    // the tile you stand on waits until you leave it (a doctored order: your tile first, far tiles behind it)
    const i = 10;
    const f = floorFor(egypt, i);
    let s = startFloor(egypt, i, { kind: 'bigTorch', left: 1000 });
    s.burning = true;
    const far = farTiles(f, 8, [f.start]);
    doctor(s, [f.start, ...far]);
    s.collapse!.t = f.collapse!.delay;
    for (let n = 0; n < 300 && s.collapse!.pending < 0; n++) s = tick(s, 0.1);
    if (s.collapse!.pending !== f.start) fail(`rules: the player's tile should be pending (pending ${s.collapse!.pending}, start ${f.start})`);
    else {
      if (s.grid.solid[f.start]) fail('rules: the tile under the player turned solid');
      const nb = openNb(f, f.start).filter((x) => !s.grid.solid[x])[0];
      if (nb === undefined) fail('rules: test setup');
      else {
        s.cooldown = 0;
        s = move(s, dirTo(f.size, f.start, nb));
        if (s.pos !== nb || !s.grid.solid[f.start] || !s.grid.opaque[f.start]) fail('rules: the pending tile did not fill once you left it');
      }
    }
    // wading: moving into covered sand costs 1.8 steps
    let w = startFloor(egypt, i, { kind: 'bigTorch', left: 1000 });
    const a = openNb(f, f.start)[0];
    w.sand[a] = 255;
    w.cooldown = 0;
    w = move(w, dirTo(f.size, f.start, a));
    if (Math.abs(w.cooldown - STEP_SECONDS * WADE) > 1e-6) fail(`rules: wading cadence ${w.cooldown}, want ${STEP_SECONDS * WADE}`);
    if (sandLevel(w, a) < COVER) fail('rules: test setup');
  }
  {
    // items and fixtures are buried, plates jammed, memory shows what you saw
    const i = floorWith('block', 10, true);
    const f = floorFor(egypt, i);
    let s = startFloor(egypt, i, { kind: 'bigTorch', left: 1000 });
    const c = s.collapse!;
    const k = f.traps.findIndex((t) => t.kind === 'block');
    const plate = f.traps[k].tile;
    const jar = openNb(f, f.start).find((x) => x !== f.start && !f.solid[x])!;
    s.items.set(jar, { kind: 'oilJar', left: 0 });
    // a doctored order: plate, jar, then far tiles that push the front along
    doctor(s, [plate, jar, ...farTiles(f, 8, [plate, jar, f.start])]);
    s.burning = true;
    c.t = f.collapse!.delay;
    for (let n = 0; n < 300; n++) s = tick(s, 0.1);
    if (s.items.has(jar) || !has(s, 'buriedItem')) fail('rules: the sand did not bury an item');
    if (s.trapPhase[k] !== 3) fail('rules: the sand did not jam the plate');
    void SLOPE;
  }
  {
    // cut off from every way down: buried, and retry starts at the last camp
    const i = 10;
    const f = floorFor(egypt, i);
    let s = startFloor(egypt, i, { kind: 'bigTorch', left: 1000 });
    s.burning = true;
    for (const q of openNb(f, s.pos)) s.grid.solid[q] = 1;
    s.solidDirty = true;
    s = tick(s, 0.05);
    if (s.status !== 'buried' || !has(s, 'sealed')) fail('rules: sealed in did not end the run');
    const r = step(s, { type: 'retry' });
    if (r.status !== 'playing' || r.floorIndex !== lastCamp(egypt, i)) fail('rules: retry from buried did not go to the last camp');
  }
  {
    // after a portcullis seals, sand cannot pass the port
    const i = floorWith('portcullis', 10, true);
    const f = floorFor(egypt, i);
    let s = startFloor(egypt, i, { kind: 'bigTorch', left: 1000 });
    const port = f.traps.find((t) => t.kind === 'portcullis')!.target;
    const before = f.collapse!.rank[port];
    s.grid.solid[port] = 1;
    s.grid.opaque[port] = 1;
    rebuildRank(s);
    const c = s.collapse!;
    if (c.rank[port] !== -1) fail('rules: a sealed port is still in the sand order');
    // every ranked tile must be reachable from the stairwell over open tiles
    const { size } = f;
    const seen = new Uint8Array(size * size);
    const queue: number[] = [];
    for (let t = 0; t < size * size; t++) if (f.tiles[t] === TILE.STAIRS_UP) (seen[t] = 1), queue.push(t);
    for (let h = 0; h < queue.length; h++) {
      const p = queue[h];
      for (const [dx, dy] of DIRS) {
        const q = p + dy * size + dx;
        if (!seen[q] && !s.grid.opaque[q] && f.tiles[q] !== TILE.STAIRS_DOWN) (seen[q] = 1), queue.push(q);
      }
    }
    for (const t of c.order) if (!seen[t]) fail('rules: the rebuilt sand order passes a sealed port');
    if (before < 0) warn('rules: portcullis test port was outside the original sand order (weak test)');
  }
}
