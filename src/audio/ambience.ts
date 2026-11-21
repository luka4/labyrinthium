import type { PyramidId } from '../game/core/pyramids';
import type { SoundGroup, SoundId } from './manifest';
import type { AudioEngine, LoopVoice } from './types';

/**
 * Ambience (plan 05, section 13): two loops of co-prime length per pyramid (room tone and wind in the air
 * shafts) mixed by depth, plus random spot sounds (settling stone, trickling sand); the title and the map
 * get a night desert wind. Egypt has its own recordings; the other pyramids use its bed until tasks 07-09.
 */
export type BedSpec = {
  group: SoundGroup;
  room: SoundId;
  air: SoundId;
  settle: string;
  trickle: string;
  /** a low-pass (Hz) that makes a borrowed bed sound different (0 = none) */
  lowpass: number;
};

const EGYPT_BED: BedSpec = { group: 'bed:egypt', room: 'bed.egypt.room', air: 'bed.egypt.air', settle: 'spot.egypt.settle', trickle: 'spot.egypt.trickle', lowpass: 0 };

export const BEDS: Record<PyramidId, BedSpec> = {
  egypt: EGYPT_BED,
  maya: { ...EGYPT_BED, lowpass: 2600 },
  cambodia: { ...EGYPT_BED, lowpass: 3400 },
  china: { ...EGYPT_BED, lowpass: 3000 },
  black: { ...EGYPT_BED, lowpass: 1800 },
};

const VARIANTS = { settle: 4, trickle: 3 } as const;

export type Ambience = {
  /** the night wind of the title and the map */
  exterior: (on: boolean) => void;
  /** a run begins (or the floor changes): the bed of this pyramid at this depth */
  enter: (pyramid: PyramidId, floorIndex: number, floorCount: number) => void;
  leave: () => void;
  /** spot sounds; call every frame while playing */
  update: (dt: number, floorIndex: number) => void;
};

export function createAmbience(engine: AudioEngine, random: () => number = Math.random): Ambience {
  let ext: LoopVoice | null = null;
  let extWanted = false;
  let room: LoopVoice | null = null;
  let air: LoopVoice | null = null;
  let bed: BedSpec | null = null;
  let depth = 0;
  let nextSpot = 8;
  let token = 0;

  const startExterior = async () => {
    await engine.load('bed:exterior');
    if (extWanted && !ext) ext = engine.loop('bed.exterior', { bus: 'ambience', gain: 1, pan: 0 });
  };
  const levels = (d: number) => ({ air: 1 - 0.65 * d, room: 0.6 + 0.4 * d });

  return {
    exterior(on) {
      extWanted = on;
      if (on) void startExterior();
      else if (ext) {
        ext.stop(1.5);
        ext = null;
      }
    },

    enter(pyramid, floorIndex, floorCount) {
      depth = floorCount > 1 ? floorIndex / (floorCount - 1) : 0;
      const spec = BEDS[pyramid];
      if (bed === spec && room && air) {
        const l = levels(depth);
        room.set({ gain: l.room }, 1.5);
        air.set({ gain: l.air }, 1.5);
        return;
      }
      const mine = ++token;
      bed = spec;
      void engine.load(spec.group).then(() => {
        if (mine !== token) return;
        const l = levels(depth);
        room?.stop(1);
        air?.stop(1);
        room = engine.loop(spec.room, { bus: 'ambience', gain: l.room, lowpass: spec.lowpass });
        air = engine.loop(spec.air, { bus: 'ambience', gain: l.air, lowpass: spec.lowpass });
      });
    },

    leave() {
      token++;
      room?.stop(1);
      air?.stop(1);
      room = air = null;
      bed = null;
    },

    update(dt, floorIndex) {
      if (!bed) return;
      nextSpot -= dt;
      if (nextSpot > 0) return;
      // every 6-20 s, twice as often deep down
      const rate = floorIndex >= 17 ? 1 / 1.5 : 1;
      nextSpot = (6 + 14 * random()) * rate;
      const trickle = random() < 0.4;
      const id = `${trickle ? bed.trickle : bed.settle}.${Math.floor(random() * (trickle ? VARIANTS.trickle : VARIANTS.settle))}` as SoundId;
      // far and random: anywhere around you, in the big room's reverb
      engine.play(id, { bus: 'ambience', gain: 0.5 + 0.5 * random(), pan: (random() * 2 - 1) * 0.8, send: 0.5, lowpass: random() < 0.5 ? 1800 + 1800 * random() : 0, priority: 0 });
    },
  };
}
