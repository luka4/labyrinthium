/**
 * Light, memory, walking and replay checks (plan 02), called from check-floors.ts.
 * Pure core code only: no Skia, no React.
 */
import { DIRS, TILE } from '../src/game/core/floor';
import {
  isCampFloor,
  startFloor,
  startHand,
  step,
  type Direction,
  type GameState,
  type Pyramid,
} from '../src/game/core/game';
import { BAG_SIZE, CARRY, EMBER, STEP_SECONDS, radiusOf } from '../src/game/core/lights';
import { MEMORY_STEPS, memoryLevel } from '../src/game/core/memory';
import { PYRAMIDS } from '../src/game/core/pyramids';
import { createRng } from '../src/game/core/rng';
import { exits, holdDir, runDir } from '../src/game/core/walk';

type Report = { fail: (m: string) => void; warn: (m: string) => void };

/** a player walks slower than the 0.15 s cadence: swipes, looking around, backtracking */
const BOT_STEP = 0.3;

const OPP: Record<Direction, Direction> = { 0: 1, 1: 0, 2: 3, 3: 2 };

function openNeighbors(s: GameState, pos = s.pos): Array<{ dir: Direction; tile: number }> {
  const { size, solid } = s.floor;
  const out: Array<{ dir: Direction; tile: number }> = [];
  for (let d = 0; d < 4; d++) {
    const x = (pos % size) + DIRS[d][0];
    const y = Math.floor(pos / size) + DIRS[d][1];
    const i = y * size + x;
    if (x >= 0 && y >= 0 && x < size && y < size && !solid[i]) out.push({ dir: d as Direction, tile: i });
  }
  return out;
}

/** Waits out the cadence, then moves. */
function go(s: GameState, dir: Direction): GameState {
  s = step(s, { type: 'tick', seconds: 0.2 });
  return step(s, { type: 'move', dir });
}

function hashState(s: GameState): string {
  let h = 0x811c9dc5;
  const mix = (v: number) => {
    h ^= v & 255;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  const num = (v: number) => {
    const b = new DataView(new ArrayBuffer(8));
    b.setFloat64(0, v);
    for (let i = 0; i < 8; i++) mix(b.getUint8(i));
  };
  num(s.pos);
  num(s.hand.left);
  num(CARRY[s.hand.kind].seconds);
  for (const b of s.bag) {
    num(b.left);
    num(CARRY[b.kind].seconds);
  }
  for (const [t, it] of [...s.items.entries()].sort((a, b) => a[0] - b[0])) {
    num(t);
    num(it.left);
  }
  for (const v of s.fixtureLeft) num(v);
  for (const v of s.seenAt) num(v);
  for (const v of s.walkedAt) num(v);
  num(s.status === 'playing' ? 0 : s.status.length);
  num(s.trail);
  return h.toString(16);
}

function forced(s: GameState, kind: 'oilJar' | 'candle' | 'smallTorch' | 'lamp' | 'torch'): { s: GameState; dir: Direction } {
  // an item on the first open neighbour, ready to be walked onto
  const n = openNeighbors(s).find((o) => o.tile !== s.floor.stairs)!;
  s.items.set(n.tile, { kind, left: kind === 'oilJar' ? 0 : CARRY[kind].seconds });
  return { s, dir: n.dir };
}

export function runLightChecks({ fail, warn }: Report) {
  const egypt = PYRAMIDS.egypt;

  // ---- rules --------------------------------------------------------------------
  {
    let { s, dir } = forced(startFloor(egypt, 1, { kind: 'torch', left: 20 }), 'oilJar');
    s = go(s, dir);
    if (s.hand.left !== CARRY.torch.seconds) fail('rules: an oil jar did not refill the hand light');
    if (s.items.size !== startFloor(egypt, 1).items.size) fail('rules: oil jar not consumed');
  }
  {
    // hand full: the spare with the largest deficit is refilled
    let { s, dir } = forced(startFloor(egypt, 1, startHand(), [{ kind: 'candle', left: 80 }, { kind: 'lamp', left: 20 }]), 'oilJar');
    s = go(s, dir);
    if (s.bag[1].left !== CARRY.lamp.seconds || s.bag[0].left !== 80) fail('rules: oil jar did not refill the spare with the largest deficit');
  }
  {
    // nothing to gain (< 5 s): the jar stays
    let { s, dir } = forced(startFloor(egypt, 1, startHand(), [{ kind: 'candle', left: 88 }]), 'oilJar');
    const before = s.items.size;
    s = go(s, dir);
    if (s.items.size !== before) fail('rules: a useless oil jar was taken');
  }
  {
    const bag = Array.from({ length: BAG_SIZE }, () => ({ kind: 'candle' as const, left: 50 }));
    let { s, dir } = forced(startFloor(egypt, 1, startHand(), bag), 'smallTorch');
    s = go(s, dir);
    if (s.bag.length !== BAG_SIZE || !s.items.has(s.pos) || !s.events.some((e) => e.type === 'bagFull')) fail('rules: full bag should leave the item and emit bagFull');
  }
  {
    let s = startFloor(egypt, 1, { kind: 'torch', left: 0.1 }, [{ kind: 'candle', left: 30 }, { kind: 'lamp', left: 100 }]);
    s = go(s, openNeighbors(s)[0].dir);
    s = step(s, { type: 'tick', seconds: 0.5 });
    if (s.hand.kind !== 'lamp' || s.hand.left !== 100 || s.bag.length !== 1 || !s.events.some((e) => e.type === 'autoLight')) fail('rules: burnt-out hand did not light the longest spare');
  }
  {
    let s = startFloor(egypt, 1, { kind: 'torch', left: 0.05 });
    s = go(s, openNeighbors(s)[0].dir);
    s = step(s, { type: 'tick', seconds: 0.1 });
    if (s.hand.left !== 0 || s.status !== 'playing') fail('rules: embers should start at 0');
    s = step(s, { type: 'tick', seconds: EMBER.seconds - 0.5 });
    if (s.status !== 'playing') fail('rules: embers ended early');
    s = step(s, { type: 'tick', seconds: 1 });
    if (s.status !== 'burntOut') fail('rules: embers did not burn out after EMBER.seconds');
  }
  {
    // a carried item picked up on embers relights; an oil jar on embers refills
    let s = startFloor(egypt, 1, { kind: 'torch', left: 0 });
    s.burning = true;
    const f = forced(s, 'lamp');
    s = go(f.s, f.dir);
    if (s.hand.kind !== 'lamp' || s.hand.left <= 0) fail('rules: item picked up on embers did not light');
    let t = startFloor(egypt, 1, { kind: 'torch', left: 0 });
    const g = forced(t, 'oilJar');
    t = go(g.s, g.dir);
    if (t.hand.left !== CARRY.torch.seconds) fail('rules: oil jar did not rescue embers');
  }
  {
    // fixtures light only from a burning hand; swap keeps seconds
    const s0 = startFloor(egypt, 2);
    const idx = s0.floor.fixtures.findIndex((f) => f.kind === 'sconce');
    const sc = s0.floor.fixtures[idx];
    if (idx < 0) fail('rules: no sconce on egypt floor 3 to test');
    else {
      const size = s0.floor.size;
      const west = sc.tile - 1;
      const east = sc.tile + 1;
      const from = !s0.floor.solid[west] ? west : east;
      const dir: Direction = from === west ? 0 : 1;
      for (const hand of [0, 30]) {
        const s = startFloor(egypt, 2, { kind: 'torch', left: hand });
        s.pos = from;
        s.cooldown = 0;
        s.burning = true;
        void size;
        const after = step(s, { type: 'move', dir });
        const lit = after.fixtureLeft[idx] > 0;
        if (lit !== (hand > 0)) fail(`rules: sconce lit=${lit} with hand ${hand}`);
      }
    }
    let s = startFloor(egypt, 1, startHand(), [{ kind: 'lamp', left: 70 }]);
    s.hand.left = 33;
    s = step(s, { type: 'swap', slot: 0 });
    if (s.hand.kind !== 'lamp' || s.hand.left !== 70 || s.bag[0].kind !== 'torch' || s.bag[0].left !== 33) fail('rules: swap does not keep seconds');
  }
  {
    // the cadence is enforced by the core
    let s = startFloor(egypt, 1);
    const dirA = openNeighbors(s)[0];
    s = step(s, { type: 'move', dir: dirA.dir });
    const p = s.pos;
    const back = step(s, { type: 'move', dir: OPP[dirA.dir] });
    if (back.pos !== p) fail('rules: a move was accepted during the cooldown');
  }
  {
    // hold-walking for 1000 ticks of 1/60 s gives 1000/60/0.15 moves +- 1
    const s0 = startFloor(egypt, 2, { kind: 'bigTorch', left: 100 });
    let s = s0;
    let moves = 0;
    let dir: Direction = openNeighbors(s)[0].dir;
    const noStairs = (st: GameState) => openNeighbors(st).filter((o) => o.tile !== st.floor.stairs);
    for (let i = 0; i < 1000; i++) {
      s = step(s, { type: 'tick', seconds: 1 / 60 });
      const before = s.pos;
      let d = holdDir(s.floor, s.pos, dir);
      if (d === null || openNeighbors(s).find((o) => o.dir === d)?.tile === s.floor.stairs) d = noStairs(s).find((o) => o.dir !== OPP[dir])?.dir ?? noStairs(s)[0].dir;
      dir = d;
      s = step(s, { type: 'move', dir });
      if (s.pos !== before) moves++;
    }
    const want = 1000 / 60 / STEP_SECONDS;
    if (Math.abs(moves - want) > 1.01) fail(`rules: ${moves} moves in 1000 ticks, want ${want.toFixed(1)}`);
  }

  // ---- memory -------------------------------------------------------------------
  {
    if (memoryLevel(0) !== 1 || memoryLevel(6) !== 1) fail('memory: recent steps must be fully remembered');
    if (memoryLevel(MEMORY_STEPS) !== 0 || memoryLevel(25) !== 0) fail('memory: 20 steps ago must be forgotten');
    let prev = 1;
    for (let a = 0; a <= 26; a += 0.05) {
      const v = memoryLevel(a);
      if (v > prev + 1e-12) fail(`memory: not monotonic at ${a}`);
      if (prev - v > 0.06) fail(`memory: jump at ${a}`);
      prev = v;
    }
    let s = startFloor(egypt, 2, { kind: 'bigTorch', left: 100 });
    const first = openNeighbors(s)[0];
    s = go(s, first.dir);
    const firstTile = s.pos;
    let dir: Direction = first.dir;
    const visited = new Set<number>([s.floor.start, firstTile]);
    for (let k = 0; k < 24; k++) {
      // always step to a tile not visited yet (never the stairs); stop if boxed in
      const nxt = openNeighbors(s).find((o) => !visited.has(o.tile) && o.tile !== s.floor.stairs);
      if (!nxt) break;
      dir = nxt.dir;
      s = go(s, dir);
      visited.add(s.pos);
    }
    if (s.trail >= 25 && memoryLevel(s.trail - s.walkedAt[firstTile]) !== 0) fail('memory: the first tile should be forgotten after 25 moves');
    if (s.seenAt[s.pos] !== s.trail) fail('memory: the tile you stand on must be stamped now');
  }

  // ---- walk ---------------------------------------------------------------------
  {
    const s = startFloor(egypt, 2);
    const { floor } = s;
    let bend = 0;
    let tee = 0;
    let dead = 0;
    for (let i = 0; i < floor.tiles.length; i++) {
      if (floor.solid[i]) continue;
      const ex = exits(floor, i);
      if (ex.length === 2 && ex[0] >> 1 !== ex[1] >> 1) {
        // exits a and b are perpendicular: arriving along the opposite of a, hold follows b
        const [a, b] = ex;
        if (holdDir(floor, i, OPP[a]) !== b || holdDir(floor, i, OPP[b]) !== a) fail('walk: holdDir does not follow a bend');
        bend++;
      } else if (ex.length === 3) {
        const blocked = ([0, 1, 2, 3] as Direction[]).find((d) => !ex.includes(d))!;
        if (holdDir(floor, i, blocked) !== null) fail('walk: holdDir does not stop at a T junction');
        if (runDir(floor, i, ex[0], () => false) !== null) fail('walk: runDir does not stop at a junction');
        tee++;
      } else if (ex.length === 1) {
        if (holdDir(floor, i, ex[0]) !== null && holdDir(floor, i, OPP[ex[0]]) !== null) fail('walk: holdDir does not stop at a dead end');
        dead++;
      }
      if (floor.tiles[i] === TILE.DOOR && ex.length === 2 && runDir(floor, i, ex[0], () => false) !== null) fail('walk: runDir does not stop at a door');
    }
    if (!bend || !tee || !dead) warn(`walk: coverage bend ${bend} tee ${tee} dead end ${dead}`);
    const ci = floor.start;
    const cex = exits(floor, ci);
    if (cex.length === 2 && runDir(floor, ci, cex[0], () => true) !== null) fail('walk: runDir does not stop next to an item');
  }

  // ---- replay determinism -----------------------------------------------------------
  for (const fi of [0, 4, 9]) {
    const hashes: string[] = [];
    for (let run = 0; run < 2; run++) {
      const rng = createRng(1234 + fi);
      let s = startFloor(egypt, fi, { kind: 'bigTorch', left: 100 }, [{ kind: 'lamp', left: 150 }, { kind: 'candle', left: 90 }]);
      for (let a = 0; a < 3000; a++) {
        if (s.status !== 'playing') break;
        if (a % 2 === 0) s = step(s, { type: 'tick', seconds: 1 / 60 });
        else {
          const opts = openNeighbors(s).filter((o) => o.tile !== s.floor.stairs);
          const dir = rng() < 0.75 && opts.length ? opts[Math.floor(rng() * opts.length)].dir : (Math.floor(rng() * 4) as Direction);
          s = step(s, { type: 'move', dir });
        }
        if (a % 400 === 399) s = step(s, { type: 'swap', slot: Math.floor(rng() * 3) });
      }
      hashes.push(hashState(s));
    }
    if (hashes[0] !== hashes[1]) fail(`replay: egypt floor ${fi + 1} diverged between two runs`);
  }

  // ---- light budget bot ---------------------------------------------------------------
  const left = (s: GameState) => Math.max(0, s.hand.left) + s.bag.reduce((t, b) => t + b.left, 0);
  type Row = { used: number; found: number; atStairs: number; burnt: number; runs: number };
  const rows: Row[] = Array.from({ length: egypt.floorCount }, () => ({ used: 0, found: 0, atStairs: 0, burnt: 0, runs: 0 }));
  const SEEDS = 16;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const pyramid: Pyramid = { ...egypt, id: `bot${seed}`, seed };
    let s = startFloor(pyramid, 0);
    let floorTime = 0;
    let foundSecs = 0;
    let guard = 0;
    while (s.floorIndex < pyramid.floorCount && guard++ < 6000) {
      const row = rows[s.floorIndex];
      if (s.status === 'burntOut') {
        row.burnt++;
        row.runs++;
        row.used += floorTime;
        row.found += foundSecs;
        // the bot gives up on this seed at the first burnout to keep the report about a single descent
        break;
      }
      if (s.status === 'descending') {
        row.runs++;
        row.used += floorTime;
        row.found += foundSecs;
        row.atStairs += left(s);
        floorTime = 0;
        foundSecs = 0;
        s = step(s, { type: 'continue' });
        continue;
      }
      if (s.status === 'escaped') {
        row.runs++;
        row.used += floorTime;
        row.found += foundSecs;
        row.atStairs += left(s);
        break;
      }
      const dir = botDir(s);
      if (dir === null) break;
      s = step(s, { type: 'tick', seconds: BOT_STEP });
      floorTime += BOT_STEP;
      const items = s.items.size;
      const handBefore = s.hand.left;
      const bagBefore = s.bag.length;
      s = step(s, { type: 'move', dir });
      if (s.items.size < items) {
        const ev = s.events[s.events.length - 1];
        foundSecs += ev?.type === 'pickup' ? CARRY[ev.kind as keyof typeof CARRY].seconds : ev?.type === 'refill' ? Math.max(0, CARRY[s.hand.kind].seconds - handBefore) : 0;
        void bagBefore;
      }
    }
  }
  console.log('light budget bot (explore until the stairs are seen, take items within 8 steps, never swap):');
  console.log('floor runs used(s) found(s) left@stairs(s) burnouts');
  rows.forEach((r, i) => {
    const n = Math.max(1, r.runs - r.burnt);
    console.log(`${i + 1} ${r.runs} ${(r.used / Math.max(1, r.runs)).toFixed(0)} ${(r.found / Math.max(1, r.runs)).toFixed(0)} ${(r.atStairs / n).toFixed(0)} ${r.burnt}`);
    if (i < 3 && r.burnt > 0) fail(`budget: the bot burnt out on floor ${i + 1}`);
    if (i < 3 && r.runs - r.burnt > 0 && r.atStairs / n < 20) fail(`budget: floor ${i + 1} leaves only ${(r.atStairs / n).toFixed(0)} s (want >= 20)`);
  });
  void radiusOf;
  void isCampFloor;
}

/** BFS target choice for the bot; null when nothing is left to do. */
function botDir(s: GameState): Direction | null {
  const { floor } = s;
  const { size, solid } = floor;
  const dist = new Int32Array(size * size).fill(-1);
  const first = new Int8Array(size * size).fill(-1);
  const queue = [s.pos];
  dist[s.pos] = 0;
  const stairsSeen = s.seenAt[floor.stairs] >= 0;
  let target = -1;
  for (let h = 0; h < queue.length && target < 0; h++) {
    const p = queue[h];
    const px = p % size;
    const py = (p - px) / size;
    for (let d = 0; d < 4; d++) {
      const x = px + DIRS[d][0];
      const y = py + DIRS[d][1];
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const q = y * size + x;
      if (solid[q] || dist[q] >= 0) continue;
      // never walk over the stairs before the bot wants them
      if (q === floor.stairs && !stairsSeen) continue;
      dist[q] = dist[p] + 1;
      first[q] = p === s.pos ? d : first[p];
      queue.push(q);
      const wantItem = s.items.has(q) && s.seenAt[q] >= 0 && dist[q] <= 8 && itemUseful(s, q);
      if (wantItem || (stairsSeen && q === floor.stairs) || (!stairsSeen && s.seenAt[q] < 0)) {
        target = q;
        break;
      }
    }
  }
  return target < 0 ? null : (first[target] as Direction);
}

function itemUseful(s: GameState, tile: number): boolean {
  const it = s.items.get(tile)!;
  if (it.kind !== 'oilJar') return s.bag.length < BAG_SIZE || s.hand.left <= 0;
  return s.hand.left <= CARRY[s.hand.kind].seconds - 5 || s.bag.some((b) => b.left <= CARRY[b.kind].seconds - 5);
}
