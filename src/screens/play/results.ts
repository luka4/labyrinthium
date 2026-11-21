import { STAR, type FloorResult } from '../../game/core/stars';
import { popcount } from '../../game/core/secrets';
import type { StarState } from '../../ui/StarRow';

/** A floor result plus what the save held before it (stars, best time, secrets), for the star row. */
export type OverviewResult = FloorResult & {
  /** best cleared time including this run, or null */
  best: number | null;
  /** this run beat an earlier best */
  newBest: boolean;
  /** star bits held before this run */
  heldS: number;
  /** secrets found before this run (bitmask) */
  heldF: number;
  /** secrets found in this run (bitmask) */
  foundMask: number;
};

export const clock = (sec: number) => {
  const n = Math.max(0, Math.ceil(sec - 1e-9));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
};

const full = (n: number) => (1 << n) - 1;

export function starStates(r: OverviewResult): [StarState, StarState, StarState] {
  const of = (earnedNow: boolean, bit: number): StarState => (r.heldS & bit ? 'held' : earnedNow ? 'earned' : 'missing');
  const allNow = r.total > 0 && (r.heldF | r.foundMask) === full(r.total);
  const allBefore = r.total > 0 && r.heldF === full(r.total);
  return [of(r.cleared, STAR.CLEARED), of(r.fast, STAR.FAST), allBefore ? 'held' : allNow ? 'earned' : 'missing'];
}

export function starLabels(r: OverviewResult): [string, string, string] {
  return ['Cleared', `Under ${clock(r.par)}`, `Secrets ${popcount(r.heldF | r.foundMask)}/${r.total}`];
}
