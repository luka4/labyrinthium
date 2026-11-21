import { SLOPE, COVER, WADE, sandLevel } from './collapse';
import type { GuardianRow } from './egypt';
import { DIRS, TILE, distancesFrom, type Collapse, type Fixture, type GuardianPlan, type Item, type Layout, type Trap } from './floor';
import type { Direction, GameState } from './game';
import { bfsFrom, nearestOpen, reachable } from './graph';
import { radiusQ } from './lights';
import { handRadius, isFrozen } from './powers';
import { createRng, nextRandom, shuffle } from './rng';
import { emit, loseHand, recoilGuardian } from './runtime';
import { pressPlate } from './traps';
import { clearLine } from './vision';

/**
 * The tomb guardian (plan 04): a mummified priest-guardian that stands dormant in a lair, wakes
 * after a while or on a noise, walks the floor, sees you by your own light, hears you along the
 * corridors, trips the plates it rushes over, snuffs the fixtures it passes and follows you down
 * the stairs late in the pyramid. Everything here is deterministic: integer BFS in `DIRS` order,
 * a stored mulberry32 state, and time only through `tickGuardian(dt)`.
 */

export type GuardianMode = 'dormant' | 'waking' | 'patrol' | 'listen' | 'investigate' | 'hunt' | 'recoil' | 'arriving' | 'gone';

export type GuardianRun = {
  mode: GuardianMode;
  pos: number;
  prev: number;
  facing: Direction;
  /** seconds to the next step; carries the remainder like the player's cadence */
  cooldown: number;
  /** seconds of the current step (render interpolation) */
  stepDur: number;
  /** dormant: wake clock; waking / listen / recoil: seconds left; arriving: seconds until it reaches the landing */
  timer: number;
  target: number;
  lastSeen: number;
  waypoint: number;
  /** mulberry32 state, seeded `floor.seed ^ 0x6c8e9cf5` */
  rng: number;
  /** BFS steps from the guardian over grid.solid; distFrom = the position it was built at, -1 stale */
  dist: Int32Array;
  distFrom: number;
  /** BFS steps from the target over the path mask */
  toTarget: Int32Array;
  toTargetFor: number;
  toTargetPlates: boolean;
  /** path mask buffer */
  scratch: Uint8Array;
  /** escape: seconds to the next Scarab pulse */
  sense: number;
  lastNear: number;
  warned: boolean;
  /** your memory of it: the trail when it was last in your light, and where */
  seenTrail: number;
  seenPos: number;
  touches: number;
};

export const QUIET_GAP = 0.35;
/** Noise carry in path steps. */
export const NOISE = { quiet: 2, step: 5, pickup: 3, lit: 3, bump: 5 } as const;
export const CLOSE = 2;
export const RISE = 1.5;
export const SENTINEL_RISE = 3.0;
export const LISTEN = 2.5;
export const RECOIL = 4;
export const RECOIL_STILL = 1.5;
export const STUN_TOUCH = 1.0;
export const HEAR_STEPS = 16;
export const NEAR_PATH = 6;
export const NEAR_EVERY = 1.5;
export const FOLLOW_MIN = 5;
export const FOLLOW_MAX = 25;
export const FOLLOW_WARN = 3;
export const ESCAPE_SENSE = 4;
/** A fixture's light lets it see you this far, at least. */
export const FIXTURE_SIGHT = 9;
const SEED_XOR = 0x6c8e9cf5;

const manhattan = (size: number, a: number, b: number) => Math.abs((a % size) - (b % size)) + Math.abs(Math.floor(a / size) - Math.floor(b / size));

// ---- placement --------------------------------------------------------------------------------------

export type GuardianPlaceArgs = {
  layout: Layout;
  row: GuardianRow;
  items: Item[];
  fixtures: Fixture[];
  traps: Trap[];
  collapse: Collapse | null;
  exit: number;
  exitFront: number;
  basement: boolean;
};

/** The tile of a direction index from a to the adjacent b, as a Direction. */
function dirTowards(size: number, a: number, b: number): Direction {
  const dx = (b % size) - (a % size);
  const dy = Math.floor(b / size) - Math.floor(a / size);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 0 : 1;
  return dy >= 0 ? 2 : 3;
}

/**
 * Where the guardian stands while dormant, which way it faces and the rooms it walks through; or
 * null if no fair place exists (the checks fail for Egypt). Own rng stream `seed ^ 0x6c8e9cf5`.
 */
export function placeGuardian(a: GuardianPlaceArgs): GuardianPlan | null {
  const { layout, row, items, fixtures, traps, collapse, exit, exitFront, basement } = a;
  const { size, tiles, solid, room: roomOf, rooms, dist, mainPath, start, stairs } = layout;
  const n = size * size;
  const rng = createRng(layout.seed ^ SEED_XOR);
  const onPath = new Uint8Array(n);
  for (const p of mainPath) onPath[p] = 1;
  const near = new Uint8Array(n);
  const mark = (t: number) => {
    near[t] = 1;
    for (const [dx, dy] of DIRS) near[t + dy * size + dx] = 1;
  };
  for (const it of items) mark(it.tile);
  for (const f of fixtures) mark(f.tile);
  for (const t of traps) mark(t.tile);
  // everything a trap, the sand or the plates may close: the worst-case mask of plan 03 and 04
  const worst = solid.slice();
  const noSand = solid.slice();
  for (const t of traps) {
    worst[t.tile] = 1;
    noSand[t.tile] = 1;
    if (t.kind === 'portcullis') {
      worst[t.target] = 1;
      noSand[t.target] = 1;
    }
  }
  if (collapse) for (let i = 0; i < n; i++) if (collapse.rank[i] >= 0) worst[i] = 1;
  let open = 0;
  for (let i = 0; i < n; i++) if (!solid[i]) open++;

  const outsideSand = (t: number) => !collapse || collapse.rank[t] < 0 || collapse.rank[t] > collapse.cap + 4 * SLOPE;
  /** removing the tile keeps the floor whole and the way to the stairs (and, in the basement, to the exit) */
  const fair = (t: number) => {
    const gone = solid.slice();
    gone[t] = 1;
    if (reachable(gone, size, start) !== open - 1) return false;
    const m = noSand.slice();
    m[t] = 1;
    if (distancesFrom(m, size, start)[stairs] < 0) return false;
    if (exitFront >= 0) {
      const w = worst.slice();
      w[t] = 1;
      if (distancesFrom(w, size, stairs)[exitFront] < 0) return false;
    }
    return true;
  };
  const plain = (t: number) => tiles[t] === TILE.FLOOR && !solid[t] && !near[t] && t !== start && t !== stairs && t !== exitFront;

  let lair = -1;
  if (row.sentinel && basement) {
    const sr = rooms[layout.stairsRoom];
    const door = sr.doors[0];
    const fromDoor = distancesFrom(solid, size, door);
    let outer = -1;
    for (const [dx, dy] of DIRS) {
      const q = door + dy * size + dx;
      if (!solid[q] && roomOf[q] !== sr.id) outer = q;
    }
    const cands: number[] = [];
    if (outer >= 0) {
      const ox = outer % size;
      const oy = (outer - ox) / size;
      for (let i = 0; i < n; i++) {
        if (i === outer || roomOf[i] !== roomOf[outer] || !plain(i) || onPath[i] || fromDoor[i] < 0 || fromDoor[i] > 3) continue;
        const x = i % size;
        const y = (i - x) / size;
        if (Math.max(Math.abs(x - ox), Math.abs(y - oy)) > 2) continue;
        // its back to a wall
        if (!DIRS.some(([dx, dy]) => tiles[i + dy * size + dx] === TILE.ROCK || tiles[i + dy * size + dx] === TILE.PILLAR)) continue;
        cands.push(i);
      }
      cands.sort((p, q) => manhattan(size, p, outer) - manhattan(size, q, outer) || p - q);
    }
    for (const t of cands) {
      if (fair(t)) {
        lair = t;
        break;
      }
    }
    if (lair < 0) {
      // fallback: inside the burial chamber, beside the door's inner neighbour
      let inner = -1;
      for (const [dx, dy] of DIRS) {
        const q = door + dy * size + dx;
        if (!solid[q] && roomOf[q] === sr.id) inner = q;
      }
      for (const [dx, dy] of DIRS) {
        const t = inner + dy * size + dx;
        if (inner >= 0 && plain(t) && !onPath[t] && roomOf[t] === sr.id && fair(t)) {
          lair = t;
          break;
        }
      }
    }
    // last resorts: any free tile within 3 steps of the door, first off the main path, then on it
    for (const allowPath of [false, true]) {
      for (let t = 0; t < n && lair < 0; t++) {
        if (tiles[t] !== TILE.FLOOR || solid[t] || fromDoor[t] < 0 || fromDoor[t] > 3 || t === stairs || t === start || t === exitFront) continue;
        if (!allowPath && onPath[t]) continue;
        if (items.some((it) => it.tile === t) || fixtures.some((f) => f.tile === t) || traps.some((tr) => tr.tile === t)) continue;
        if (fair(t)) lair = t;
      }
    }
  } else {
    const goal = dist[stairs];
    const far = (t: number) => dist[t] >= 0.4 * goal;
    const ok = (t: number) => plain(t) && !onPath[t] && far(t) && outsideSand(t) && fair(t);
    const leafKinds = new Set(['chamber', 'shrine', 'magazines']);
    const cand = shuffle(
      rooms.filter((r) => r.leaf && leafKinds.has(r.kind) && !r.main && r.doors.length > 0 && far(r.doors[0])),
      rng,
    );
    for (const r of cand) {
      const inside: number[] = [];
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (roomOf[y * size + x] === r.id && tiles[y * size + x] === TILE.FLOOR) inside.push(y * size + x);
      inside.sort((p, q) => dist[q] - dist[p] || p - q);
      const t = inside.find(ok);
      if (t !== undefined) {
        lair = t;
        break;
      }
    }
    if (lair < 0) {
      const all: number[] = [];
      for (let i = 0; i < n; i++) if (plain(i) && !onPath[i] && far(i)) all.push(i);
      shuffle(all, rng);
      lair = all.find(ok) ?? -1;
    }
  }
  if (lair < 0) return null;

  // facing: towards its open neighbour (dormant niche) / the burial door's approach (sentinel)
  let facing: Direction = 2;
  if (row.sentinel && basement) {
    const door = rooms[layout.stairsRoom].doors[0];
    facing = dirTowards(size, lair, door);
  } else {
    const d = DIRS.findIndex(([dx, dy]) => !solid[lair + dy * size + dx]);
    if (d >= 0) facing = d as Direction;
  }

  // route: one anchor per room, away from the stairwells and the burial chamber
  const fromLair = distancesFrom(solid, size, lair);
  const trapTile = new Uint8Array(n);
  for (const t of traps) trapTile[t.tile] = 1;
  const anchorOf = (r: (typeof rooms)[number]): number => {
    const cx = r.x + (r.w - 1) / 2;
    const cy = r.y + (r.h - 1) / 2;
    let best = -1;
    let bestD = Infinity;
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        const i = y * size + x;
        if (roomOf[i] !== r.id || tiles[i] !== TILE.FLOOR || solid[i] || trapTile[i] || fromLair[i] < 0) continue;
        const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    return best;
  };
  const skip = (k: string) => k === 'stairsUp' || k === 'stairsDown' || k === 'burial';
  const pool = rooms.filter((r) => !skip(r.kind) && r.id !== roomOf[lair]);
  const anchors: number[] = [];
  for (const r of shuffle(pool.slice(), rng)) {
    const t = anchorOf(r);
    if (t >= 0) anchors.push(t);
    if (anchors.length >= 8) break;
  }
  if (anchors.length < 3) {
    for (const r of rooms) {
      if (r.kind === 'burial' || anchors.length >= 3) continue;
      const t = anchorOf(r);
      if (t >= 0 && !anchors.includes(t)) anchors.push(t);
    }
  }
  return { ...row, lair, facing, route: Int32Array.from(anchors) };
}

// ---- runtime ----------------------------------------------------------------------------------------

export function startGuardian(floor: { size: number; seed: number; guardian: GuardianPlan | null }, follow?: { gap: number }): GuardianRun | null {
  const plan = floor.guardian;
  if (!plan) return null;
  const n = floor.size * floor.size;
  const arriving = !!follow && plan.follow && !plan.sentinel;
  return {
    mode: arriving ? 'arriving' : 'dormant',
    pos: arriving ? -1 : plan.lair,
    prev: arriving ? -1 : plan.lair,
    facing: plan.facing,
    cooldown: 0,
    stepDur: 0.3,
    timer: arriving ? follow!.gap : 0,
    target: -1,
    lastSeen: -1,
    waypoint: 0,
    rng: (floor.seed ^ SEED_XOR) | 0,
    dist: new Int32Array(n).fill(-1),
    distFrom: -1,
    toTarget: new Int32Array(n).fill(-1),
    toTargetFor: -1,
    toTargetPlates: false,
    scratch: new Uint8Array(n),
    sense: ESCAPE_SENSE,
    lastNear: -1e9,
    warned: false,
    seenTrail: -1e9,
    seenPos: -1,
    touches: 0,
  };
}

const walking = (m: GuardianMode) => m === 'patrol' || m === 'listen' || m === 'investigate' || m === 'hunt' || m === 'recoil';
const awake = (m: GuardianMode) => m === 'patrol' || m === 'listen' || m === 'investigate' || m === 'hunt';

/** BFS steps from the guardian over the run's solid mask (fresh for the current position). */
function ensureDist(s: GameState, g: GuardianRun) {
  if (g.distFrom === g.pos) return;
  bfsFrom(s.grid.solid, s.grid.size, g.pos, g.dist);
  g.distFrom = g.pos;
}

/** How far your light lets it see you, in tiles. */
export function sightRange(s: GameState): number {
  let r = s.hand.left > 0 ? 2 * radiusQ(handRadius(s)) + 1 : 1.5;
  if (s.lightFixed[s.pos] >= 0.15 && r < FIXTURE_SIGHT) r = FIXTURE_SIGHT;
  return r;
}

/** Does the guardian see you now? `close`: only the all-round Chebyshev-2 test (a dormant one wakes to it). */
export function sees(s: GameState, g: GuardianRun, close = false): boolean {
  const { size } = s.floor;
  const gx = g.pos % size;
  const gy = (g.pos - gx) / size;
  const px = s.pos % size;
  const py = (s.pos - px) / size;
  const dx = px - gx;
  const dy = py - gy;
  const cheb = Math.max(Math.abs(dx), Math.abs(dy));
  let can = cheb <= CLOSE;
  if (!can && !close && s.light[s.pos] > 0) {
    const d2 = dx * dx + dy * dy;
    const r = sightRange(s);
    if (d2 <= r * r) {
      if (g.mode === 'hunt' || g.mode === 'listen') can = true;
      else {
        const [fx, fy] = DIRS[g.facing];
        const dot = dx * fx + dy * fy;
        can = dot >= 0 && 4 * dot * dot >= d2;
      }
    }
  }
  return can && clearLine(s.grid, gx, gy, px, py);
}

function wake(s: GameState, g: GuardianRun, at: number, rise: number) {
  g.mode = 'waking';
  g.timer = rise;
  g.target = at;
  emit(s, 'guardianWake', null, g.pos);
}

/** The Scarab is lifted: the sentinel rises (escape.ts). */
export function wakeSentinel(s: GameState) {
  const g = s.guardian;
  if (g && g.mode === 'dormant' && s.floor.guardian?.sentinel) wake(s, g, -1, SENTINEL_RISE);
}

function startHunt(s: GameState, g: GuardianRun) {
  if (g.mode !== 'hunt') {
    g.mode = 'hunt';
    emit(s, 'guardianSpotted', null, g.pos);
  }
  g.target = g.lastSeen = s.pos;
}

function nextWaypoint(s: GameState, g: GuardianRun, plan: GuardianPlan) {
  const len = plan.route.length;
  if (len < 2) return;
  ensureDist(s, g);
  const a = Math.floor(nextRandom(g) * len);
  const b = Math.floor(nextRandom(g) * len);
  const cur = g.waypoint % len;
  const pa = a === cur ? (a + 1) % len : a;
  const pb = b === cur ? (b + 1) % len : b;
  const da = g.dist[plan.route[pa]];
  const db = g.dist[plan.route[pb]];
  g.waypoint = (da < 0 ? -1 : da) >= (db < 0 ? -1 : db) ? pa : pb;
}

function paceOf(plan: GuardianPlan, mode: GuardianMode): number {
  return mode === 'hunt' ? plan.hunt : mode === 'investigate' ? plan.search : plan.patrol;
}

/** Fills the path field towards `target`; false if the guardian cannot get there. */
function pathTo(s: GameState, g: GuardianRun, target: number, plates: boolean): boolean {
  if (g.toTargetFor !== target || g.toTargetPlates !== plates) {
    const { size, solid } = s.grid;
    const m = g.scratch;
    const build = (withPlates: boolean) => {
      m.set(solid);
      if (s.floor.tiles[s.floor.stairs] === TILE.STAIRS_DOWN) m[s.floor.stairs] = 1;
      if (s.floor.exit >= 0) m[s.floor.exit] = 1;
      const { traps } = s.floor;
      for (let k = 0; k < traps.length; k++) {
        if (s.trapPhase[k] !== 0) continue;
        if (traps[k].kind === 'trapdoor' || !withPlates) m[traps[k].tile] = 1;
      }
      bfsFrom(m, size, target, g.toTarget);
    };
    build(plates);
    // plates are only avoided when there is another way
    if (!plates && g.toTarget[g.pos] < 0) build(true);
    g.toTargetFor = target;
    g.toTargetPlates = plates;
  }
  return g.toTarget[g.pos] >= 0;
}

function snuff(s: GameState, g: GuardianRun) {
  const { size } = s.floor;
  const gx = g.pos % size;
  const gy = (g.pos - gx) / size;
  s.floor.fixtures.forEach((f, k) => {
    const left = s.fixtureLeft[k];
    if (f.eternal || left <= 0 || left === Infinity) return;
    const x = f.tile % size;
    const y = (f.tile - x) / size;
    if (Math.max(Math.abs(x - gx), Math.abs(y - gy)) > 1) return;
    s.fixtureLeft[k] = -1;
    s.fixedDirty = true;
    emit(s, 'snuffed', f.kind, f.tile);
  });
}

/** An awake guardian on your tile: it smothers your light (a spare lights itself), or takes you on embers. */
export function touchIfMet(s: GameState) {
  const g = s.guardian;
  if (!g || s.status !== 'playing' || g.pos !== s.pos || !awake(g.mode) || (s.powers.length > 0 && isFrozen(s))) return;
  g.touches++;
  if (s.hand.left > 0) {
    loseHand(s);
    emit(s, 'guardianTouch', null, s.pos);
    s.cooldown = Math.max(s.cooldown, STUN_TOUCH);
    const { size, solid } = s.grid;
    let to = s.prevPos !== g.pos && s.prevPos >= 0 && !solid[s.prevPos] ? s.prevPos : -1;
    if (to < 0) {
      for (const [dx, dy] of DIRS) {
        const q = s.pos + dy * size + dx;
        if (q !== g.pos && !solid[q]) {
          to = q;
          break;
        }
      }
    }
    if (to >= 0) s.pos = to;
    recoilGuardian(s, RECOIL);
  } else {
    s.status = 'caught';
    emit(s, 'caught', null, s.pos);
  }
}

/** Remembers where you last saw it (call after the light is up to date). */
export function noteGuardianSeen(s: GameState) {
  const g = s.guardian;
  if (!g || g.pos < 0 || g.mode === 'arriving' || g.mode === 'gone') return;
  if (s.light[g.pos] > 0) {
    g.seenTrail = s.trail;
    g.seenPos = g.pos;
  }
}

/** A guardian that is after you comes down the stairs after you: when it arrives, in seconds. */
export function followGap(s: GameState): { gap: number } | undefined {
  const g = s.guardian;
  const plan = s.floor.guardian;
  if (!g || !plan || (g.mode !== 'hunt' && g.mode !== 'investigate' && g.mode !== 'listen')) return undefined;
  ensureDist(s, g);
  const d = g.dist[s.floor.stairs];
  if (d < 0) return undefined;
  return { gap: Math.min(FOLLOW_MAX, Math.max(FOLLOW_MIN, d * plan.hunt + 3)) };
}

/** What sound and the flame need each frame: where it is relative to you, how far along the corridors, and whether you see it. */
export type GuardianCue = { dx: number; dy: number; path: number; visible: boolean; mode: GuardianMode };

export function guardianCue(s: GameState): GuardianCue | null {
  const g = s.guardian;
  if (!g || g.pos < 0 || g.mode === 'arriving' || g.mode === 'gone') return null;
  ensureDist(s, g);
  const { size } = s.floor;
  return { dx: (g.pos % size) - (s.pos % size), dy: Math.floor(g.pos / size) - Math.floor(s.pos / size), path: g.dist[s.pos], visible: s.light[g.pos] > 0, mode: g.mode };
}

function hearNoises(s: GameState, g: GuardianRun, plan: GuardianPlan) {
  const list = s.noises;
  if (!list.length) return;
  if (g.mode === 'dormant' && plan.sentinel) {
    list.length = 0;
    return;
  }
  ensureDist(s, g);
  for (let i = 0; i < list.length; i += 2) {
    const at = list[i];
    const d = g.dist[at];
    if (d < 0 || d > list[i + 1]) continue;
    if (g.mode === 'dormant') wake(s, g, at, RISE);
    else if (g.mode === 'waking') g.target = at;
    else if (g.mode === 'patrol' || g.mode === 'listen' || g.mode === 'investigate') {
      g.mode = 'investigate';
      g.target = at;
    } else if (g.mode === 'hunt' && !sees(s, g)) g.target = at;
  }
  list.length = 0;
}

/** Advances the guardian. Call while the light burns (burning seconds are its clock). */
export function tickGuardian(s: GameState, dt: number) {
  const g = s.guardian;
  const plan = s.floor.guardian;
  if (!g || !plan || g.mode === 'gone') return;
  if (g.mode === 'arriving') {
    s.noises.length = 0;
    g.timer -= dt;
    if (g.timer <= FOLLOW_WARN && !g.warned) {
      g.warned = true;
      emit(s, 'guardianFollow', null, s.floor.start);
    }
    if (g.timer > 0) return;
    const start = s.floor.start;
    if (s.grid.solid[start]) {
      g.mode = 'gone';
      emit(s, 'guardianGone', null, start);
      return;
    }
    const sx = start % s.floor.size;
    const px = s.pos % s.floor.size;
    if (Math.max(Math.abs(sx - px), Math.abs(Math.floor(start / s.floor.size) - Math.floor(s.pos / s.floor.size))) <= 1) {
      g.timer = 0;
      return;
    }
    g.pos = g.prev = start;
    g.distFrom = g.toTargetFor = -1;
    g.mode = 'investigate';
    g.target = s.pos;
    g.cooldown = 0;
    return;
  }

  hearNoises(s, g, plan);

  // clocks
  if (g.mode === 'dormant') {
    if (!plan.sentinel) {
      g.timer += dt;
      if (g.timer >= plan.wake || sees(s, g, true)) wake(s, g, -1, RISE);
    }
  } else if (g.mode === 'waking') {
    g.timer -= dt;
    if (g.timer <= 0) {
      g.cooldown = 0;
      if (plan.sentinel) {
        g.lastSeen = s.pos;
        startHunt(s, g);
      } else if (g.target >= 0) g.mode = 'investigate';
      else g.mode = 'patrol';
    }
  } else if (g.mode === 'listen') {
    g.timer -= dt;
    if (g.timer <= 0) g.mode = 'patrol';
  } else if (g.mode === 'recoil') {
    g.timer -= dt;
    if (g.timer <= 0) {
      if (s.escape?.taken) startHunt(s, g);
      else g.mode = 'patrol';
    }
  }

  if (!walking(g.mode)) return;

  // sight
  const visible = sees(s, g);
  if (visible && g.mode !== 'recoil') startHunt(s, g);
  else if (g.mode === 'hunt' && !visible && g.pos === g.lastSeen) {
    g.mode = 'listen';
    g.timer = LISTEN;
    emit(s, 'guardianLost', null, g.pos);
  }

  // the Scarab calls it
  if (s.escape?.taken && g.mode !== 'recoil') {
    g.sense -= dt;
    if (g.sense <= 0) {
      g.sense = ESCAPE_SENSE;
      startHunt(s, g);
    }
  }

  // steps
  g.cooldown = Math.max(g.cooldown - dt, -0.1);
  let guard = 0;
  while (g.cooldown <= 0 && guard++ < 3 && walking(g.mode) && g.mode !== 'listen' && !(g.mode === 'recoil' && g.timer > RECOIL - RECOIL_STILL)) {
    const target: number = g.mode === 'patrol' ? (plan.route.length ? plan.route[g.waypoint % plan.route.length] : -1) : g.target;
    if (target < 0 || g.pos === target) {
      arrive(s, g, plan);
      break;
    }
    if (!pathTo(s, g, target, g.mode === 'hunt')) {
      if (g.mode === 'patrol') nextWaypoint(s, g, plan);
      g.mode = 'listen';
      g.timer = 1;
      break;
    }
    const d = g.toTarget[g.pos];
    let dir = -1;
    for (let k = 0; k < 4; k++) {
      const [dx, dy] = DIRS[k];
      const x = (g.pos % s.grid.size) + dx;
      const y: number = Math.floor(g.pos / s.grid.size) + dy;
      if (x < 0 || y < 0 || x >= s.grid.size || y >= s.grid.size) continue;
      const q = y * s.grid.size + x;
      if (!s.grid.solid[q] && g.toTarget[q] >= 0 && g.toTarget[q] === d - 1) {
        dir = k;
        break;
      }
    }
    if (dir < 0) {
      g.mode = 'listen';
      g.timer = 1;
      break;
    }
    g.prev = g.pos;
    g.pos += DIRS[dir][1] * s.grid.size + DIRS[dir][0];
    g.facing = dir as Direction;
    const dur = paceOf(plan, g.mode) * (sandLevel(s, g.pos) >= COVER ? WADE : 1);
    g.cooldown += dur;
    g.stepDur = dur;
    g.distFrom = -1;
    const k = s.floor.trapAt[g.pos];
    if (k >= 0 && s.trapPhase[k] === 0 && s.floor.traps[k].kind !== 'trapdoor') pressPlate(s, k, 'other');
    snuff(s, g);
    ensureDist(s, g);
    const dd = g.dist[s.pos];
    if (dd >= 0 && dd <= HEAR_STEPS) emit(s, 'guardianStep', null, g.pos);
    touchIfMet(s);
  }

  // sand under its feet
  if (g.pos >= 0 && s.grid.solid[g.pos]) {
    const { size } = s.grid;
    let to = -1;
    for (const [dx, dy] of DIRS) {
      const q = g.pos + dy * size + dx;
      if (!s.grid.solid[q] && q !== s.pos) {
        to = q;
        break;
      }
    }
    if (to < 0) to = nearestOpen(s.grid.solid, size, g.pos % size, Math.floor(g.pos / size), (t) => t === s.pos);
    if (to >= 0) {
      g.prev = g.pos;
      g.pos = to;
      g.distFrom = -1;
    }
  }

  // felt before it is seen
  if (g.pos >= 0 && s.light[g.pos] <= 0 && awake(g.mode)) {
    ensureDist(s, g);
    const d = g.dist[s.pos];
    if (d >= 0 && d <= NEAR_PATH && s.floorTime - g.lastNear >= NEAR_EVERY) {
      g.lastNear = s.floorTime;
      emit(s, 'guardianNear', null, g.pos);
    }
  }
}

/** The target is reached (or there is none): what the guardian does next. */
function arrive(s: GameState, g: GuardianRun, plan: GuardianPlan) {
  if (g.mode === 'patrol') {
    g.mode = 'listen';
    g.timer = 1 + 2 * nextRandom(g);
    nextWaypoint(s, g, plan);
  } else if (g.mode === 'investigate') {
    g.mode = 'listen';
    g.timer = LISTEN;
    g.target = -1;
  } else if (g.mode === 'hunt') {
    if (!sees(s, g)) {
      g.mode = 'listen';
      g.timer = LISTEN;
      emit(s, 'guardianLost', null, g.pos);
    }
  } else if (g.mode === 'recoil') {
    if (s.escape?.taken) startHunt(s, g);
    else g.mode = 'patrol';
  } else {
    g.mode = 'patrol';
  }
}
