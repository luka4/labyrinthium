import type { GameState } from './game';
import { bfsFrom } from './graph';
import { DIRS } from './floor';
import { CARRY, EMBER, radiusOf } from './lights';
import { emit } from './runtime';
import { FLOODED, waterAt } from './water';

/**
 * Artifact powers (plan 06): one tool per artifact, a few uses that refill at camps, each strongest
 * ("attuned") in another pyramid. Deterministic core: used through `step({ type: 'power' })`, timed only
 * by `tick`, owned powers come in through `StartOptions.powers` (core never reads progress).
 */
export type PowerId = 'scarab' | 'mirror' | 'naga' | 'jade';
/** = the SEALS order of their pyramids */
export const POWER_ORDER: readonly PowerId[] = ['scarab', 'mirror', 'naga', 'jade'];

/** strength: scarab = tiles of the way shown (999 = all of it), mirror = radius factor, naga/jade unused (0) */
export type PowerSpec = {
  uses: number;
  seconds: number;
  strength: number;
  /** pyramid id where it is strongest */
  attuned: string;
  attunedUses: number;
  attunedSeconds: number;
  attunedStrength: number;
};

export const POWERS: Record<PowerId, PowerSpec> = {
  scarab: { uses: 2, seconds: 5, strength: 12, attuned: 'cambodia', attunedUses: 3, attunedSeconds: 8, attunedStrength: 999 },
  mirror: { uses: 2, seconds: 8, strength: 1.6, attuned: 'china', attunedUses: 3, attunedSeconds: 12, attunedStrength: 1.8 },
  naga: { uses: 2, seconds: 10, strength: 0, attuned: 'maya', attunedUses: 3, attunedSeconds: 16, attunedStrength: 0 },
  jade: { uses: 1, seconds: 4, strength: 0, attuned: 'egypt', attunedUses: 2, attunedSeconds: 6, attunedStrength: 0 },
};

/** tiles, the widest the mirror throws */
export const MIRROR_CAP = 9.5;
/** subtracted from the source's falloff while the mirror is active (a broader, softer pool) */
export const MIRROR_FALLOFF = 0.2;
/** the murk: your light in a flooded tile with the Naga active */
export const MURK = 0.6;
/** seconds between two uses of any power (no double taps) */
export const POWER_GAP = 0.5;

export type PowerRun = { id: PowerId; uses: number; max: number; seconds: number; strength: number; /** active seconds left, 0 = idle */ left: number; attuned: boolean };

/** POWER_ORDER filtered by owned; attuned numbers when `pyramidId` matches. */
export function freshPowers(pyramidId: string, owned: readonly PowerId[]): PowerRun[] {
  const out: PowerRun[] = [];
  for (const id of POWER_ORDER) {
    if (!owned.includes(id)) continue;
    const p = POWERS[id];
    const attuned = p.attuned === pyramidId;
    out.push({
      id,
      uses: attuned ? p.attunedUses : p.uses,
      max: attuned ? p.attunedUses : p.uses,
      seconds: attuned ? p.attunedSeconds : p.seconds,
      strength: attuned ? p.attunedStrength : p.strength,
      left: 0,
      attuned,
    });
  }
  return out;
}

/** The charges of the next floor: actives end; `refill` (a camp) restores the uses. */
export function carryPowers(s: GameState, refill: boolean): PowerRun[] {
  if (refill) return freshPowers(s.pyramid.id, s.powers.map((p) => p.id));
  return s.powers.map((p) => ({ ...p, left: 0 }));
}

export function power(s: Pick<GameState, 'powers'>, id: PowerId): PowerRun | null {
  for (const p of s.powers) if (p.id === id) return p;
  return null;
}

export const isActive = (s: Pick<GameState, 'powers'>, id: PowerId): boolean => (power(s, id)?.left ?? 0) > 0;
export const isFrozen = (s: Pick<GameState, 'powers'>): boolean => isActive(s, 'jade');

/** The hand light radius in tiles (unquantised): the source, widened by the Mirror, murky in flooded water with the Naga. */
export function handRadius(s: GameState): number {
  let r = s.hand.left > 0 ? radiusOf(CARRY[s.hand.kind], s.hand.left) : EMBER.radius;
  if (s.powers.length) {
    const m = power(s, 'mirror');
    if (m && m.left > 0) r = Math.min(MIRROR_CAP, r * m.strength);
    if (s.water && isActive(s, 'naga') && waterAt(s, s.pos) >= FLOODED) r *= MURK;
  }
  return r;
}

/** Called by step: ignored unless owned, idle and not in the gap; no uses left emits `powerEmpty`. */
export function usePower(s: GameState, id: PowerId): boolean {
  const p = power(s, id);
  if (!p) return false;
  if (p.uses <= 0) {
    emit(s, 'powerEmpty', id, s.pos);
    return false;
  }
  if (p.left > 0 || s.powerGap > 0) return false;
  p.uses--;
  p.left = p.seconds;
  s.powerGap = POWER_GAP;
  s.burning = true;
  emit(s, 'powerUsed', id, s.pos);
  return true;
}

/** Last in tick: the gap and every active power count down; at 0 the power ends. */
export function tickPowers(s: GameState, dt: number) {
  if (s.powerGap > 0) s.powerGap = Math.max(0, s.powerGap - dt);
  for (const p of s.powers) {
    if (p.left <= 0) continue;
    p.left = Math.max(0, p.left - dt);
    if (p.left === 0) emit(s, 'powerEnded', p.id, s.pos);
  }
}

/** The tile the Scarab leads to: the false door's front once the artifact is taken, else the stairs (or artifact). */
export function scarabGoal(s: GameState): number {
  return s.escape?.taken ? s.floor.exitFront : s.floor.stairs;
}

let scratch = new Int32Array(0);

/**
 * Pure query: the tiles from `s.pos` (excluded) towards the goal over the run's mask, at most `reach`
 * of them, ending at the goal. Each step takes the neighbour one nearer the goal, `DIRS` order breaking ties.
 * Empty when the goal cannot be reached (a fired portcullis on the only way).
 */
export function scarabPath(s: GameState, reach: number): Int32Array {
  const { size, solid } = s.grid;
  if (scratch.length !== size * size) scratch = new Int32Array(size * size);
  const goal = scarabGoal(s);
  if (goal < 0) return new Int32Array(0);
  bfsFrom(solid, size, goal, scratch);
  const d0 = scratch[s.pos];
  if (d0 <= 0) return new Int32Array(0);
  const n = Math.min(reach, d0);
  const out = new Int32Array(n);
  let at = s.pos;
  for (let k = 0; k < n; k++) {
    const x = at % size;
    const y = (at - x) / size;
    let next = -1;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const q = ny * size + nx;
      if (scratch[q] >= 0 && scratch[q] === scratch[at] - 1) {
        next = q;
        break;
      }
    }
    if (next < 0) return out.subarray(0, k);
    out[k] = next;
    at = next;
  }
  return out;
}
