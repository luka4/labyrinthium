import { DIRS, floorCells, generateFloor, type Floor } from './floor';
import { computeLight, torchRadius } from './vision';

/**
 * Deterministic game core: no React, no rendering. The same seed and the same
 * sequence of actions always give the same result, which later makes ghosts,
 * replays, server-side checks and real-time multiplayer possible.
 */

export const TORCH_SECONDS = 45;
export const EMBER_SECONDS = 6;

export type Direction = 0 | 1 | 2 | 3; // index into DIRS: right, left, down, up

/** The rules of one pyramid. Display data (names, colors, artifacts) lives in pyramids.ts. */
export type Pyramid = {
  id: string;
  seed: number;
  floorCount: number;
  /** cells per side on the top floor and in the basement */
  firstCells: number;
  lastCells: number;
  /** a camp every N floors (floor index N, 2N, ...); 0 = no camps */
  campEvery: number;
};

/** escaped: the artifact on the basement floor was taken */
export type Status = 'playing' | 'descending' | 'burntOut' | 'escaped';

export type GameState = {
  pyramid: Pyramid;
  floorIndex: number;
  floor: Floor;
  pos: number;
  /** 0..1 */
  fuel: number;
  /** seconds spent on embers after the fuel ran out */
  ember: number;
  steps: number;
  /** torch starts burning on the first move */
  burning: boolean;
  status: Status;
  oil: Set<number>;
  seen: Uint8Array;
  walked: Uint8Array;
  light: Float32Array;
};

export type Action =
  | { type: 'move'; dir: Direction }
  | { type: 'tick'; seconds: number }
  | { type: 'continue' }
  | { type: 'retry' };

export function floorSeed(pyramid: Pyramid, floorIndex: number): number {
  return (pyramid.seed * 7919 + floorIndex * 104729) | 0;
}

/** Camps save progress and refill the torch. The top floor is the entrance, not a camp. */
export function isCampFloor(pyramid: Pyramid, floorIndex: number): boolean {
  return pyramid.campEvery > 0 && floorIndex > 0 && floorIndex % pyramid.campEvery === 0;
}

/** The floor a burnt-out torch sends you back to: the last camp, or the top floor. */
export function lastCamp(pyramid: Pyramid, floorIndex: number): number {
  if (pyramid.campEvery <= 0) return 0;
  return floorIndex - (floorIndex % pyramid.campEvery);
}

export function isBasement(pyramid: Pyramid, floorIndex: number): boolean {
  return floorIndex === pyramid.floorCount - 1;
}

export function startFloor(pyramid: Pyramid, floorIndex: number, fuel = 1, steps = 0): GameState {
  const floor = generateFloor({
    cells: floorCells(floorIndex, pyramid.floorCount, pyramid.firstCells, pyramid.lastCells),
    seed: floorSeed(pyramid, floorIndex),
    loopRate: pyramid.floorCount <= 1 ? 0 : 0.05 * (floorIndex / (pyramid.floorCount - 1)),
  });
  const tiles = floor.size * floor.size;
  const state: GameState = {
    pyramid,
    floorIndex,
    floor,
    pos: floor.start,
    fuel,
    ember: 0,
    steps,
    burning: false,
    status: 'playing',
    oil: new Set(floor.oil),
    seen: new Uint8Array(tiles),
    walked: new Uint8Array(tiles),
    light: new Float32Array(tiles),
  };
  state.walked[floor.start] = 1;
  relight(state);
  return state;
}

function relight(s: GameState) {
  computeLight(s.floor, s.pos, torchRadius(s.fuel), s.light);
  for (let i = 0; i < s.light.length; i++) if (s.light[i] > 0) s.seen[i] = 1;
}

/** Applies one action. Mutates and returns the state, or returns a new state on a floor change. */
export function step(s: GameState, action: Action): GameState {
  switch (action.type) {
    case 'move': {
      if (s.status !== 'playing') return s;
      const { size, walls } = s.floor;
      const [dx, dy] = DIRS[action.dir];
      const x = (s.pos % size) + dx;
      const y = Math.floor(s.pos / size) + dy;
      const next = y * size + x;
      if (x < 0 || y < 0 || x >= size || y >= size || walls[next]) return s;
      s.pos = next;
      s.steps++;
      s.burning = true;
      s.walked[next] = 1;
      if (s.oil.delete(next)) {
        s.fuel = 1;
        s.ember = 0;
      }
      if (next === s.floor.stairs) {
        s.status = isBasement(s.pyramid, s.floorIndex) ? 'escaped' : 'descending';
      }
      relight(s);
      return s;
    }
    case 'tick': {
      if (s.status !== 'playing' || !s.burning) return s;
      if (s.fuel > 0) {
        s.fuel = Math.max(0, s.fuel - action.seconds / TORCH_SECONDS);
      } else {
        s.ember += action.seconds;
        if (s.ember > EMBER_SECONDS) s.status = 'burntOut';
      }
      relight(s);
      return s;
    }
    case 'continue': {
      if (s.status !== 'descending') return s;
      const next = s.floorIndex + 1;
      return startFloor(s.pyramid, next, isCampFloor(s.pyramid, next) ? 1 : s.fuel, s.steps);
    }
    case 'retry': {
      if (s.status !== 'burntOut') return s;
      return startFloor(s.pyramid, lastCamp(s.pyramid, s.floorIndex), 1, s.steps);
    }
  }
}
