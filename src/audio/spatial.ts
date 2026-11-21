import type { RoomKind } from '../game/core/floor';
import type { GameState } from '../game/core/game';
import { bfsFrom } from '../game/core/graph';
import { clearLine } from '../game/core/vision';

/**
 * Where a sound is, as the listener hears it (plan 05, section 11). Sound travels along open tiles, as
 * the guardian's own hearing does: distance is path steps from the player over the run's grid (a door
 * that is shut is a wall), direction gives the pan, a wall in the line of sight muffles it, and far
 * sounds carry more reverb. Pure functions over the state; no audio objects.
 */
export const HEAR_STEPS = 24;

export type Placement = {
  /** 0..1 distance falloff, 0 = out of earshot */
  gain: number;
  /** -0.8..0.8 */
  pan: number;
  /** low-pass cutoff in Hz, 0 = none */
  lowpass: number;
  /** reverb send 0..1 */
  send: number;
  /** path steps (or a Euclidean estimate behind walls) */
  steps: number;
};

/** The player's path-distance field over the run's grid, rebuilt when the position or the grid changes. */
export class DistanceField {
  dist = new Int32Array(0);
  private pos = -1;
  private floor: unknown = null;
  private opened = 0;

  /** `gridStamp` changes whenever a door or a chamber opened or closed (any value that moves with the grid). */
  update(s: GameState, gridStamp: number): Int32Array {
    if (this.pos === s.pos && this.floor === s.floor && this.opened === gridStamp && this.dist.length) return this.dist;
    if (this.dist.length !== s.grid.size * s.grid.size) this.dist = new Int32Array(s.grid.size * s.grid.size);
    bfsFrom(s.grid.solid, s.grid.size, s.pos, this.dist);
    this.pos = s.pos;
    this.floor = s.floor;
    this.opened = gridStamp;
    return this.dist;
  }
}

/** A cheap stamp of what changed in the grid: the open seals and the false door. */
export function gridStamp(s: GameState): number {
  let v = s.escape?.open ? 1 : 0;
  for (let k = 0; k < s.secretPhase.length; k++) v = v * 4 + s.secretPhase[k];
  // traps and the collapse close ways too; their phases move with the trap tick
  for (let k = 0; k < s.trapPhase.length; k++) v = (v * 31 + s.trapPhase[k]) | 0;
  return v;
}

export function place(s: GameState, field: Int32Array, at: number): Placement {
  const { size } = s.grid;
  const px = s.pos % size;
  const py = (s.pos - px) / size;
  const ax = at % size;
  const ay = (at - ax) / size;
  const dx = ax - px;
  const dy = ay - py;
  const e = Math.hypot(dx, dy);
  const reach = field[at];
  const steps = reach >= 0 ? reach : e + 6;
  const gain = steps > HEAR_STEPS ? 0 : 1 / (1 + Math.pow(steps / 3, 1.4));
  const pan = Math.max(-1, Math.min(1, dx / Math.max(3, e))) * 0.8;
  const occluded = !clearLine(s.grid, px, py, ax, ay);
  const lowpass = occluded ? Math.max(700, Math.min(4000, 4000 / (1 + steps / 4))) : 0;
  return {
    gain: occluded ? gain * 0.708 : gain,
    pan,
    lowpass,
    send: 0.15 + 0.5 * Math.min(1, steps / 16),
    steps,
  };
}

const LARGE: ReadonlySet<RoomKind> = new Set<RoomKind>(['hall', 'gallery', 'burial', 'antechamber']);
const MID: ReadonlySet<RoomKind> = new Set<RoomKind>(['chamber', 'shrine', 'magazines', 'stairsUp', 'stairsDown']);

/** Which reverb the room around the player picks, and how much of the large one. */
export function roomOf(s: GameState): { size: 'small' | 'large'; mix: number } {
  const r = s.floor.room[s.pos];
  const kind = r >= 0 ? s.floor.rooms[r].kind : 'passage';
  if (LARGE.has(kind)) return { size: 'large', mix: 1 };
  if (MID.has(kind)) return { size: 'large', mix: 0.6 };
  return { size: 'small', mix: 0 };
}

/** The nearest of `tiles` within `maxSteps` path steps, or -1. */
export function nearest(field: Int32Array, tiles: ArrayLike<number>, maxSteps: number, count = 1): number[] {
  const found: Array<[number, number]> = [];
  for (let i = 0; i < tiles.length; i++) {
    const d = field[tiles[i]];
    if (d >= 0 && d <= maxSteps) found.push([d, tiles[i]]);
  }
  found.sort((a, b) => a[0] - b[0]);
  return found.slice(0, count).map((f) => f[1]);
}
