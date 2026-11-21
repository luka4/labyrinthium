import type { ArchProfileId } from './architecture';
import { WADE, releasePending, sandLevel, startCollapse, tickCollapse, COVER, type CollapseRun } from './collapse';
import { DIRS, floorSeed, type Floor, type Grid, type TrapKind } from './floor';
import { floorFor } from './generate';
import {
  BAG_SIZE,
  CARRY,
  EMBER,
  FIXTURE,
  LOW_SECONDS,
  OIL_MIN_GAIN,
  STEP_SECONDS,
  fixtureRadius,
  radiusOf,
  radiusQ,
  type Carried,
  type FixtureKind,
  type ItemKind,
} from './lights';
import { EXIT_LIGHT, takeArtifact, tickEscape, type EscapeRun } from './escape';
import { NOISE, QUIET_GAP, followGap, noteGuardianSeen, startGuardian, tickGuardian, touchIfMet, type GuardianRun } from './guardian';
import { bfsFrom } from './graph';
import { pushSeal, secretAtSeal, takeSecretAt, tickSecrets, type TreasureKind } from './secrets';
import { emit, lightSpare, noise, setHand } from './runtime';
import { LAND_STUN, pressPlate, resolveLanding, tickTraps } from './traps';
import { clearLine, computeLight } from './vision';

/**
 * Deterministic game core: no React, no rendering. The same seed and the same
 * sequence of actions always give the same result, which later makes ghosts,
 * replays, server-side checks and real-time multiplayer possible.
 */

export type Direction = 0 | 1 | 2 | 3; // index into DIRS: right, left, down, up

/** The rules of one pyramid. Display data (names, colors, artifacts) lives in pyramids.ts. */
export type Pyramid = {
  id: string;
  seed: number;
  floorCount: number;
  /** which architecture profile builds its floors */
  architecture: ArchProfileId;
  /** 0-based camp floors, ascending (the basement may be one) */
  camps: readonly number[];
};

/**
 * descending: on the stairs; falling: through a trapdoor (`continue` lands you below);
 * buried: sand closed every way down (`retry`); caught: the guardian took you on embers (`retry`);
 * escaped: you left the basement (through the false door when it has one).
 */
export type Status = 'playing' | 'descending' | 'falling' | 'burntOut' | 'buried' | 'caught' | 'escaped';

/** What the UI may react to (captions, haptics). Only the last EVENT_LOG are kept. */
export type GameEvent = {
  seq: number;
  type:
    | 'pickup'
    | 'refill'
    | 'lit'
    | 'bagFull'
    | 'autoLight'
    | 'swap'
    | 'lowLight'
    | 'plate'
    | 'trapFired'
    | 'hit'
    | 'fell'
    | 'quake'
    | 'sandNear'
    | 'sealed'
    | 'buriedItem'
    | 'guardianWake'
    | 'guardianStep'
    | 'guardianSpotted'
    | 'guardianLost'
    | 'guardianNear'
    | 'guardianTouch'
    | 'guardianHit'
    | 'guardianFollow'
    | 'guardianGone'
    | 'snuffed'
    | 'caught'
    | 'artifactTaken'
    | 'exitOpened'
    | 'secretKnock'
    | 'secretBreak'
    | 'secretOpen'
    | 'treasure'
    | 'fragment';
  kind: ItemKind | FixtureKind | TrapKind | TreasureKind | null;
  /** the tile it happened on (stereo sound, haptics), or -1 */
  at: number;
};

/** Something lying on the floor: a light source with its seconds, or an oil jar. */
export type Lying = { kind: ItemKind; left: number };

/** How far a fixed light can be seen through open line of sight, in tiles. */
export const FIXED_SIGHT = 12;

export type GameState = {
  pyramid: Pyramid;
  floorIndex: number;
  floor: Floor;
  pos: number;
  /** the tile before the last move (where a block pushes you back to) */
  prevPos: number;
  /** per-run copies of the floor's masks: traps and the collapse change them; core reads these, never the floor's */
  grid: Grid;
  /** per trap: 0 armed, 1 pressed, 2 fired, 3 jammed or shut */
  trapPhase: Uint8Array;
  /** per trap: seconds to fire (pressed) or since fired (sandfall) */
  trapTimer: Float32Array;
  collapse: CollapseRun | null;
  /** live collapse sand per tile, 0..255 */
  sand: Uint8Array;
  /** sand as last seen (memory shows what you saw) */
  seenSand: Uint8Array;
  /** sandfall sand per tile: wading and burying, never blocks */
  localSand: Uint8Array;
  /** an opaque tile changed: light must be recomputed */
  opaqueDirty: boolean;
  /** a tile turned solid: check that a way down is left */
  solidDirty: boolean;
  /** the tile you landed on after a fall, or -1 */
  landing: number;
  /** floors left through a trapdoor this run (a stars hook for task 05) */
  skipped: number;
  /** the source in your hand; left <= 0 means embers: you still hold the burnt-out source */
  hand: Carried;
  bag: Carried[];
  /** seconds spent on embers */
  ember: number;
  steps: number;
  /** the light burns from the first move */
  burning: boolean;
  status: Status;
  /** tile -> what still lies there */
  items: Map<number, Lying>;
  /** per fixture: -1 unlit, > 0 seconds left, 0 burnt out, Infinity eternal */
  fixtureLeft: Float32Array;
  /** per fixture: radius (quantised) of its current light */
  fixtureR: Float32Array;
  /** seconds until the next move is allowed (>= -STEP_SECONDS) */
  cooldown: number;
  /** successful moves on this floor: the memory clock */
  trail: number;
  /** per tile: trail when last lit (-1 never) */
  seenAt: Int32Array;
  /** per tile: trail when last stood on (-1 never) */
  walkedAt: Int32Array;
  /** 0..1 from the hand source */
  lightHand: Float32Array;
  /** 0..1 union of lit fixtures, before line of sight to the player */
  lightFixed: Float32Array;
  /** lit fixtures you can see from where you stand */
  lightSeen: Float32Array;
  /** what the player sees now */
  light: Float32Array;
  events: GameEvent[];
  eventSeq: number;
  /** quantised radius of the hand light now */
  handR: number;
  fixedDirty: boolean;
  lowWarned: boolean;
  /** the tomb guardian (plan 04), or null on floors without one */
  guardian: GuardianRun | null;
  /** the basement's escape (null when the floor has no false door) */
  escape: EscapeRun | null;
  /** seconds since the last move: a step after a pause is quiet */
  idle: number;
  /** burning seconds on this floor (a stars hook for task 05) */
  floorTime: number;
  /** pending [tile, radius] pairs the guardian will hear */
  noises: number[];
  /** per secret: 0 sealed, 1 knocked (hollow), 2 breaking, 3 open (secrets.ts) */
  secretPhase: Uint8Array;
  /** per secret: seconds of breaking left */
  secretTimer: Float32Array;
  /** bitmask of the secrets whose grave good you took this run */
  secretsFound: number;
};

export type StartOptions = {
  /** a trapdoor fall: the world point (floor centre = 0,0) you drop to */
  landing?: { x: number; y: number };
  skipped?: number;
  /** a guardian was after you on the floor above: it arrives after `gap` seconds of burning */
  follow?: { gap: number };
};

export type Action =
  | { type: 'move'; dir: Direction }
  | { type: 'tick'; seconds: number }
  | { type: 'swap'; slot: number }
  | { type: 'continue' }
  | { type: 'retry' };

export { floorSeed };

/** Camps save progress and refill the light: the floors listed in `pyramid.camps`. */
export function isCampFloor(pyramid: Pyramid, floorIndex: number): boolean {
  return floorIndex > 0 && pyramid.camps.includes(floorIndex);
}

/** The floor a burnt-out torch sends you back to: the last camp at or above this floor, or the top floor. */
export function lastCamp(pyramid: Pyramid, floorIndex: number): number {
  for (let i = floorIndex; i > 0; i--) if (isCampFloor(pyramid, i)) return i;
  return 0;
}

export function isBasement(pyramid: Pyramid, floorIndex: number): boolean {
  return floorIndex === pyramid.floorCount - 1;
}

export const startHand = (): Carried => ({ kind: 'torch', left: CARRY.torch.seconds });

export function startFloor(
  pyramid: Pyramid,
  floorIndex: number,
  hand: Carried = startHand(),
  bag: Carried[] = [],
  steps = 0,
  ember = 0,
  opts: StartOptions = {},
): GameState {
  const floor = floorFor(pyramid, floorIndex);
  const tiles = floor.size * floor.size;
  const items = new Map<number, Lying>();
  for (const it of floor.items) items.set(it.tile, { kind: it.kind, left: it.kind === 'oilJar' ? 0 : CARRY[it.kind].seconds });
  const fixtureLeft = new Float32Array(floor.fixtures.length);
  floor.fixtures.forEach((f, i) => (fixtureLeft[i] = f.eternal ? Infinity : -1));
  const state: GameState = {
    pyramid,
    floorIndex,
    floor,
    pos: floor.start,
    prevPos: floor.start,
    grid: { size: floor.size, solid: floor.solid.slice(), opaque: floor.opaque.slice() },
    trapPhase: new Uint8Array(floor.traps.length),
    trapTimer: new Float32Array(floor.traps.length),
    collapse: startCollapse(floor.collapse),
    sand: new Uint8Array(tiles),
    seenSand: new Uint8Array(tiles),
    localSand: new Uint8Array(tiles),
    opaqueDirty: false,
    solidDirty: false,
    landing: -1,
    skipped: opts.skipped ?? 0,
    hand: { ...hand },
    bag: bag.map((b) => ({ ...b })),
    ember,
    steps,
    burning: false,
    status: 'playing',
    items,
    fixtureLeft,
    fixtureR: new Float32Array(floor.fixtures.length).fill(-1),
    cooldown: 0,
    trail: 0,
    seenAt: new Int32Array(tiles).fill(-1),
    walkedAt: new Int32Array(tiles).fill(-1),
    lightHand: new Float32Array(tiles),
    lightFixed: new Float32Array(tiles),
    lightSeen: new Float32Array(tiles),
    light: new Float32Array(tiles),
    events: [],
    eventSeq: 0,
    handR: -1,
    fixedDirty: true,
    lowWarned: false,
    guardian: startGuardian(floor, opts.follow),
    escape: floor.exit >= 0 ? { taken: false, t: 0, open: false, openIn: 0 } : null,
    idle: 1,
    floorTime: 0,
    noises: [],
    secretPhase: new Uint8Array(floor.secrets.length),
    secretTimer: new Float32Array(floor.secrets.length),
    secretsFound: 0,
  };
  state.walkedAt[floor.start] = 0;
  if (opts.landing) {
    const land = resolveLanding(floor, opts.landing, floor.collapse, floor.guardian ? [floor.guardian.lair] : []);
    if (land >= 0) {
      state.pos = state.prevPos = land;
      state.landing = land;
      state.cooldown = LAND_STUN;
      state.walkedAt[land] = 0;
      state.walkedAt[floor.start] = -1;
    }
  }
  relight(state, true);
  noteGuardianSeen(state);
  return state;
}

/**
 * Recomputes light when something changed: the hand radius (quantised to 1/8 tile), a
 * fixture that lit, changed radius or went out, or a move. Never per frame by default.
 */
function relight(s: GameState, moved: boolean) {
  const { floor, grid } = s;
  if (s.opaqueDirty) {
    // a wall appeared (a block, a portcullis, sand to the ceiling): light and sight change
    s.opaqueDirty = false;
    s.handR = -1;
    s.fixedDirty = true;
  }
  const r = s.hand.left > 0 ? radiusOf(CARRY[s.hand.kind], s.hand.left) : EMBER.radius;
  const q = radiusQ(r);
  const handChanged = moved || q !== s.handR;
  if (handChanged) {
    computeLight(grid, s.pos, q, s.hand.left > 0 ? CARRY[s.hand.kind].falloff : EMBER.falloff, s.lightHand);
    s.handR = q;
  }
  const dirty = s.fixedDirty;
  if (dirty) {
    s.lightFixed.fill(0);
    floor.fixtures.forEach((f, i) => {
      const left = s.fixtureLeft[i];
      if (left <= 0) return;
      const fr = radiusQ(fixtureRadius(f.kind, left));
      s.fixtureR[i] = fr;
      computeLight(grid, f.tile, fr, FIXTURE[f.kind].falloff, s.lightFixed, true);
    });
    // daylight down the escape shaft once the false door is open
    if (s.escape?.open) computeLight(grid, floor.exit, EXIT_LIGHT.radius, EXIT_LIGHT.falloff, s.lightFixed, true);
    s.fixedDirty = false;
  }
  if (!handChanged && !dirty) return;
  if (moved || dirty) {
    const { size } = floor;
    const px = s.pos % size;
    const py = (s.pos - px) / size;
    for (let i = 0; i < s.lightFixed.length; i++) {
      const v = s.lightFixed[i];
      if (v <= 0) {
        s.lightSeen[i] = 0;
        continue;
      }
      const x = i % size;
      const y = (i - x) / size;
      s.lightSeen[i] = Math.abs(x - px) <= FIXED_SIGHT && Math.abs(y - py) <= FIXED_SIGHT && clearLine(grid, px, py, x, y) ? v : 0;
    }
  }
  for (let i = 0; i < s.light.length; i++) {
    const v = Math.max(s.lightHand[i], s.lightSeen[i]);
    s.light[i] = v;
    if (v > 0) {
      s.seenAt[i] = s.trail;
      s.seenSand[i] = Math.max(s.sand[i], s.localSand[i]);
    }
  }
}

function pickUp(s: GameState) {
  const item = s.items.get(s.pos);
  if (!item) return;
  if (item.kind === 'oilJar') {
    const spec = CARRY[s.hand.kind];
    if (s.hand.left <= spec.seconds - OIL_MIN_GAIN) {
      s.hand.left = spec.seconds;
      s.ember = 0;
      s.lowWarned = false;
      s.items.delete(s.pos);
      emit(s, 'refill', s.hand.kind);
      return;
    }
    let best = -1;
    let deficit = OIL_MIN_GAIN - 1e-9;
    s.bag.forEach((b, i) => {
      const d = CARRY[b.kind].seconds - b.left;
      if (d > deficit) {
        deficit = d;
        best = i;
      }
    });
    if (best >= 0) {
      s.bag[best].left = CARRY[s.bag[best].kind].seconds;
      s.items.delete(s.pos);
      emit(s, 'refill', s.bag[best].kind);
    }
    return;
  }
  const carried: Carried = { kind: item.kind as Carried['kind'], left: item.left };
  if (s.hand.left <= 0) {
    setHand(s, carried);
    s.items.delete(s.pos);
    emit(s, 'pickup', carried.kind);
  } else if (s.bag.length < BAG_SIZE) {
    s.bag.push(carried);
    s.items.delete(s.pos);
    emit(s, 'pickup', carried.kind);
  } else {
    emit(s, 'bagFull', carried.kind);
  }
}

function lightFixtures(s: GameState) {
  if (s.hand.left <= 0) return;
  const { size } = s.floor;
  const px = s.pos % size;
  const py = (s.pos - px) / size;
  s.floor.fixtures.forEach((f, i) => {
    if (s.fixtureLeft[i] !== -1) return;
    const dx = Math.abs((f.tile % size) - px);
    const dy = Math.abs(Math.floor(f.tile / size) - py);
    // sconces need you on or orthogonally next to their tile; the rest within one tile
    const near = f.kind === 'sconce' ? dx + dy <= 1 : dx <= 1 && dy <= 1;
    if (!near) return;
    s.fixtureLeft[i] = FIXTURE[f.kind].seconds;
    s.fixedDirty = true;
    emit(s, 'lit', f.kind);
  });
}

function burn(s: GameState, dt: number) {
  const h = s.hand;
  if (h.left > 0) {
    h.left -= dt;
    if (h.left <= 0) {
      h.left = 0;
      lightSpare(s);
    } else if (h.left <= LOW_SECONDS && !s.lowWarned && !s.bag.length) {
      s.lowWarned = true;
      emit(s, 'lowLight', h.kind);
    }
  } else {
    s.ember += dt;
    if (s.ember > EMBER.seconds) s.status = 'burntOut';
  }
  s.floor.fixtures.forEach((f, i) => {
    const left = s.fixtureLeft[i];
    if (left <= 0 || left === Infinity) return;
    const nl = Math.max(0, left - dt);
    s.fixtureLeft[i] = nl;
    if (nl === 0 || radiusQ(fixtureRadius(f.kind, nl)) !== s.fixtureR[i]) s.fixedDirty = true;
  });
}

/** Is any way down left (the stairs, the false door once the artifact is taken, or a trapdoor that is still armed)? */
function wayDownLeft(s: GameState): boolean {
  const dist = new Int32Array(s.grid.size * s.grid.size);
  bfsFrom(s.grid.solid, s.grid.size, s.pos, dist);
  if (dist[s.escape?.taken ? s.floor.exitFront : s.floor.stairs] >= 0) return true;
  const { traps } = s.floor;
  for (let k = 0; k < traps.length; k++) if (traps[k].kind === 'trapdoor' && s.trapPhase[k] === 0 && dist[traps[k].tile] >= 0) return true;
  return false;
}

/** Applies one action. Mutates and returns the state, or returns a new state on a floor change. */
export function step(s: GameState, action: Action): GameState {
  switch (action.type) {
    case 'move': {
      if (s.status !== 'playing' || s.cooldown > 0) return s;
      const { size, solid } = s.grid;
      const [dx, dy] = DIRS[action.dir];
      const x = (s.pos % size) + dx;
      const y = Math.floor(s.pos / size) + dy;
      const next = y * size + x;
      if (x < 0 || y < 0 || x >= size || y >= size) return s;
      const g = s.guardian;
      if (g && (g.mode === 'dormant' || g.mode === 'waking') && g.pos === next) {
        // a statue in the way: you bump it, and it hears that
        noise(s, next, NOISE.bump);
        return s;
      }
      if (solid[next]) {
        if (action.dir === 3) {
          const k = secretAtSeal(s.floor, next);
          if (k >= 0 && s.pos === s.floor.secrets[k].front) pushSeal(s, k);
        }
        return s;
      }
      const quiet = s.idle >= QUIET_GAP;
      s.idle = 0;
      // carry the unused part of the last tick over: an exact cadence at any frame rate; wading is slower
      const wade = sandLevel(s, next) >= COVER ? WADE : 1;
      s.cooldown = (s.cooldown > -STEP_SECONDS ? s.cooldown : 0) + STEP_SECONDS * wade;
      s.prevPos = s.pos;
      s.pos = next;
      releasePending(s);
      s.steps++;
      s.burning = true;
      s.trail++;
      s.walkedAt[next] = s.trail;
      const seq0 = s.eventSeq;
      pickUp(s);
      takeSecretAt(s);
      lightFixtures(s);
      if (s.eventSeq !== seq0 && s.events.some((e) => e.seq > seq0 && (e.type === 'pickup' || e.type === 'refill' || e.type === 'lit'))) noise(s, next, NOISE.pickup);
      if (next === s.floor.stairs) {
        if (!isBasement(s.pyramid, s.floorIndex)) s.status = 'descending';
        else if (s.escape) takeArtifact(s);
        else s.status = 'escaped';
      } else if (s.escape?.open && next === s.floor.exit) {
        s.status = 'escaped';
      } else {
        const k = s.floor.trapAt[next];
        if (k >= 0 && s.trapPhase[k] === 0) pressPlate(s, k, 'player');
      }
      noise(s, next, quiet ? NOISE.quiet : NOISE.step);
      touchIfMet(s);
      relight(s, true);
      noteGuardianSeen(s);
      return s;
    }
    case 'tick': {
      s.idle += action.seconds;
      if (s.status !== 'playing') return s;
      s.cooldown = Math.max(-STEP_SECONDS, s.cooldown - action.seconds);
      if (!s.burning) return s;
      burn(s, action.seconds);
      if (s.status !== 'playing') {
        relight(s, false);
        return s;
      }
      const from = s.pos;
      s.floorTime += action.seconds;
      tickTraps(s, action.seconds);
      tickCollapse(s, action.seconds);
      tickEscape(s, action.seconds);
      tickSecrets(s, action.seconds);
      tickGuardian(s, action.seconds);
      if (s.solidDirty) {
        s.solidDirty = false;
        if (s.status === 'playing' && !wayDownLeft(s)) {
          s.status = 'buried';
          emit(s, 'sealed', null);
        }
      }
      relight(s, s.pos !== from);
      noteGuardianSeen(s);
      return s;
    }
    case 'swap': {
      if (s.status !== 'playing' || action.slot < 0 || action.slot >= s.bag.length) return s;
      const spare = s.bag[action.slot];
      if (s.hand.left > 0) s.bag[action.slot] = s.hand;
      else s.bag.splice(action.slot, 1);
      setHand(s, spare);
      emit(s, 'swap', spare.kind);
      relight(s, false);
      return s;
    }
    case 'continue': {
      if (s.status === 'falling') {
        const trap = s.floor.traps.find((t, k) => t.kind === 'trapdoor' && t.tile === s.pos && s.trapPhase[k] === 2);
        return startFloor(s.pyramid, s.floorIndex + 1, s.hand, s.bag, s.steps, s.hand.left > 0 ? 0 : s.ember, {
          landing: trap?.landingWorld ?? undefined,
          skipped: s.skipped,
        });
      }
      if (s.status !== 'descending') return s;
      const next = s.floorIndex + 1;
      let hand = s.hand;
      if (isCampFloor(s.pyramid, next)) {
        // a camp relights the better of your source and a plain torch, full
        const kind = CARRY[hand.kind].seconds >= CARRY.torch.seconds ? hand.kind : 'torch';
        hand = { kind, left: CARRY[kind].seconds };
      }
      return startFloor(s.pyramid, next, hand, s.bag, s.steps, hand.left > 0 ? 0 : s.ember, { skipped: s.skipped, follow: followGap(s) });
    }
    case 'retry': {
      if (s.status !== 'burntOut' && s.status !== 'buried' && s.status !== 'caught') return s;
      return startFloor(s.pyramid, lastCamp(s.pyramid, s.floorIndex), startHand(), [], s.steps);
    }
  }
}
