import { getEngine } from './index';
import type { SoundId } from './manifest';

/**
 * Interface sounds (plan 05): taps, toggles, panels, the star chimes and the sounds of the overview
 * between floors, all on the ui bus. Every call also resumes the audio context, which web needs after a
 * gesture. Safe to call anywhere; silent when the engine is missing or the sound is not loaded yet.
 */
function p(id: SoundId, gain = 1) {
  const e = getEngine();
  void e.resume();
  e.play(id, { bus: 'ui', gain, priority: 9 });
}

export const uiSound = {
  tap: () => p('ui.tap'),
  toggle: () => p('ui.toggle'),
  back: () => p('ui.back'),
  panel: () => p('ui.panel'),
  seal: () => p('ui.seal'),
  star: (i: 0 | 1 | 2) => p(`star.${i + 1}` as SoundId),
  newBest: () => p('newBest'),
  descend: () => p('descend'),
  fall: () => p('fall'),
  escapeOut: () => p('escape.out'),
};
