import { STORY } from '../game/story';
import { BEDS } from './beds';
import type { PyramidKit } from './types';

/** Egypt's presentation data: its bed, the painted-wall story and the trap and guardian hints. */
export const EGYPT_KIT: PyramidKit = {
  bed: BEDS.egypt,
  story: STORY.egypt ?? [],
  hints: {
    plate: 'A granite slab set in the limestone. A pressure plate.',
    block: 'Chips of fallen stone around it.',
    portcullis: 'A slab hangs in the slots above the passage.',
    sandfall: 'Sand trickles from the ceiling here.',
    trapdoor: 'A slab on pivots. It would drop you to the floor below.',
    collapse: 'The ceiling over the stairs gives way. Get away from the sand.',
    guardian: 'A guardian in linen and gold. Your light shows you to it; it hears you walk. Slow steps are quiet.',
    guardianWake: 'Stone grinds somewhere. Something is awake.',
    escape: 'A false door has opened somewhere. The Scarab points the way, briefly.',
    secret: 'This plaster is newer than the stone around it. Push it.',
  },
};
