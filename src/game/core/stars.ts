import { distancesFrom, type Floor } from './floor';
import type { GameState } from './game';
import { STEP_SECONDS } from './lights';
import { popcount } from './secrets';

/**
 * Stars (plan 05): three independent goals per floor. Cleared (you found its way down) and fast
 * (under a par time) are stored bits; the third, every secret found, is derived from the saved
 * secret bitmask. Par is computed from the floor itself, so every player has the same one.
 */
export const STAR = { CLEARED: 1, FAST: 2 } as const;

/** par = ceil5(slack x route steps x STEP_SECONDS + base (+ guardian on floors with one)): the known way at half top speed */
export const PAR = { slack: 2.0, base: 8, guardian: 10, round: 5 } as const;

/** Steps of the known way: start to stairs (basement: stairs to the false door's front, plus the step in) on the static mask. */
export function routeSteps(floor: Floor): number {
  const from = distancesFrom(floor.solid, floor.size, floor.start);
  let steps = Math.max(0, from[floor.stairs]);
  if (floor.exitFront >= 0) {
    const back = distancesFrom(floor.solid, floor.size, floor.stairs);
    steps += Math.max(0, back[floor.exitFront]) + 1;
  }
  return steps;
}

export function parTime(floor: Floor): number {
  const raw = PAR.slack * routeSteps(floor) * STEP_SECONDS + PAR.base + (floor.guardian ? PAR.guardian : 0);
  return Math.ceil(raw / PAR.round - 1e-9) * PAR.round;
}

export type FloorResult = {
  floorIndex: number;
  /** left by the stairs (or out of the basement), not by a trapdoor */
  cleared: boolean;
  /** burning seconds on the floor */
  time: number;
  /** cleared under par, entered at the arrival (not by a fall) */
  fast: boolean;
  par: number;
  /** secrets found this run / on the floor */
  found: number;
  total: number;
};

export function floorResult(s: GameState): FloorResult {
  const par = parTime(s.floor);
  const cleared = s.status === 'descending' || s.status === 'escaped';
  return {
    floorIndex: s.floorIndex,
    cleared,
    time: s.floorTime,
    fast: cleared && s.landing < 0 && s.floorTime <= par,
    par,
    found: popcount(s.secretsFound),
    total: s.floor.secrets.length,
  };
}

/** Stars held on a floor record, 0..3. */
export function starCount(rec: { s: number; f: number; n: number } | undefined): number {
  if (!rec) return 0;
  return popcount(rec.s & 3) + (rec.n > 0 && rec.f === (1 << rec.n) - 1 ? 1 : 0);
}
