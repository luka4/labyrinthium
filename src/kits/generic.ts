import type { PyramidId } from '../game/core/pyramids';
import { BEDS } from './beds';
import { EGYPT_KIT } from './egypt';
import type { PyramidKit } from './types';

/**
 * The kit of every pyramid that has no culture of its own yet (Maya, Cambodia, China, the Black
 * Pyramid until tasks 07-09): the borrowed, low-passed bed, no story, and the generic trap hints.
 */
export function genericKit(id: PyramidId): PyramidKit {
  return { bed: BEDS[id], story: [], hints: { ...EGYPT_KIT.hints } };
}
