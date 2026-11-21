import type { PyramidId } from '../game/core/pyramids';
import type { BedSpec } from './types';

/** Egypt has its own recordings; the other pyramids borrow its bed (low-passed) until tasks 07-09. */
export const EGYPT_BED: BedSpec = { group: 'bed:egypt', room: 'bed.egypt.room', air: 'bed.egypt.air', settle: 'spot.egypt.settle', trickle: 'spot.egypt.trickle', lowpass: 0 };

export const BEDS: Record<PyramidId, BedSpec> = {
  egypt: EGYPT_BED,
  maya: { ...EGYPT_BED, lowpass: 2600 },
  cambodia: { ...EGYPT_BED, lowpass: 3400 },
  china: { ...EGYPT_BED, lowpass: 3000 },
  black: { ...EGYPT_BED, lowpass: 1800 },
};
