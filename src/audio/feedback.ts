import type { GameEvent, GameState } from '../game/core/game';
import type { HapticName } from '../ui/hapticPatterns';
import type { SoundId } from './manifest';
import type { Bus } from './types';

/**
 * One table for what an event does (plan 05, section 13): the sound (positioned at the tile it happened
 * on), the haptic pattern and any ducking. Sound and haptics stay in step, and core never knows either
 * exists. Captions live in GameScreen (they need the strip). A sound id that is a base of variants
 * (`step.stone`) picks one at random.
 */
export type Feedback = {
  sound?: SoundId | string | ((e: GameEvent, s: GameState) => SoundId | string | null);
  /** at the tile of the event (path distance, pan, muffling, reverb); false = centred, dry */
  spatial?: boolean;
  bus?: Bus;
  /** extra linear gain on the design level */
  gain?: number;
  priority?: number;
  haptic?: HapticName | ((e: GameEvent, s: GameState) => HapticName | null);
  duck?: { bus: Bus; dB: number; attack: number; hold: number; release: number };
};

const pickupSound = (e: GameEvent): string => {
  if (e.kind === 'lamp') return 'pick.lamp';
  if (e.kind === 'candle') return 'pick.candle';
  return 'pick.torch';
};

const QUAKE_DUCK = { bus: 'ambience', dB: -8, attack: 0.05, hold: 1.2, release: 1.5 } as const;

export const FEEDBACK: Partial<Record<GameEvent['type'], Feedback>> = {
  pickup: { sound: pickupSound, haptic: 'pickup', priority: 3 },
  refill: { sound: 'pick.oil', haptic: 'refill', priority: 3 },
  lit: { sound: (e) => (e.kind === 'brazier' ? 'ignite.brazier' : e.kind === 'shrineCandles' ? 'ignite.candles' : 'ignite.small'), haptic: 'ignite', priority: 3 },
  bagFull: { sound: 'bagFull', priority: 2 },
  autoLight: { sound: 'autoLight', haptic: 'ignite', priority: 3 },
  swap: { sound: 'swap', haptic: 'tap', priority: 2 },
  lowLight: { haptic: 'lowLight' },
  plate: { sound: 'plate.click', spatial: true, haptic: 'plate', priority: 5 },
  trapFired: {
    sound: (e) => (e.kind === 'block' ? 'block.fall' : e.kind === 'portcullis' ? 'portcullis.drop' : e.kind === 'sandfall' ? 'sand.fall' : 'trapdoor.open'),
    spatial: true,
    priority: 6,
    haptic: (e) => (e.kind === 'portcullis' ? 'portcullis' : e.kind === 'sandfall' ? 'sandfall' : e.kind === 'trapdoor' ? 'trapdoor' : 'block'),
    duck: QUAKE_DUCK,
  },
  hit: { sound: 'hit', priority: 6, haptic: 'block' },
  guardianHit: { haptic: 'block' },
  fell: { haptic: 'trapdoor' },
  quake: { sound: 'quake', priority: 7, haptic: 'quake', duck: QUAKE_DUCK },
  sealed: { sound: 'sealed', priority: 6, haptic: 'block' },
  guardianWake: { sound: 'g.wake', spatial: true, bus: 'guardian', priority: 6, haptic: 'wake' },
  guardianStep: { sound: 'g.step', spatial: true, bus: 'guardian', priority: 4 },
  guardianSpotted: { sound: 'g.spotted', spatial: true, bus: 'guardian', priority: 7, haptic: 'spotted' },
  guardianLost: { sound: 'g.lost', spatial: true, bus: 'guardian', priority: 5 },
  guardianTouch: { sound: 'g.touch', bus: 'guardian', priority: 7, haptic: 'touch' },
  guardianFollow: { sound: 'g.follow', bus: 'guardian', priority: 5 },
  guardianGone: { sound: 'g.gone', spatial: true, bus: 'guardian', priority: 3 },
  snuffed: { sound: 'snuff', spatial: true, bus: 'guardian', priority: 4 },
  caught: { sound: 'g.caught', bus: 'guardian', priority: 8, haptic: 'caught' },
  artifactTaken: { sound: 'artifact.lift', priority: 7, haptic: 'artifact', duck: { bus: 'ambience', dB: -10, attack: 0.1, hold: 2.5, release: 1.5 } },
  exitOpened: { sound: 'exit.grind', spatial: true, priority: 6, haptic: 'grind', duck: { bus: 'world', dB: -4, attack: 0.05, hold: 1, release: 0.8 } },
  secretKnock: { sound: 'seal.knock', spatial: true, priority: 5, haptic: 'knock' },
  secretBreak: { sound: 'seal.break', spatial: true, priority: 5, haptic: 'break' },
  secretOpen: { sound: 'seal.open', spatial: true, priority: 5 },
  treasure: { sound: 'pick.treasure', priority: 4, haptic: 'pickup' },
  fragment: { sound: 'fragment', priority: 4, haptic: 'found' },
  // artifact powers (plan 06): interface sounds on the ui bus
  powerUsed: { sound: (e) => (e.kind === 'scarab' || e.kind === 'mirror' || e.kind === 'naga' || e.kind === 'jade' ? `power.${e.kind}` : null), bus: 'ui', priority: 6, haptic: (e) => (e.kind === 'jade' ? 'freeze' : 'power') },
  powerEnded: { sound: 'power.end', bus: 'ui', priority: 3 },
  powerEmpty: { sound: 'power.empty', bus: 'ui', priority: 2, haptic: 'tap' },
  // water: the footsteps in water carry the splash (the director picks water.wade / water.swim), so `splash` is a touch only
  splash: { haptic: 'stepSand' },
  dive: { sound: 'water.dive', spatial: true, priority: 5 },
  surface: { sound: 'water.surface', spatial: true, priority: 5 },
  breathLow: { sound: 'breath.low', priority: 6, haptic: 'breathLow' },
  drowned: { sound: 'drowned', priority: 8, haptic: 'caught' },
  flooded: { sound: 'water.wade', spatial: true, gain: 0.6, priority: 3, haptic: 'wall' },
};
