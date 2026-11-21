import type { GameEvent, GameState } from '../game/core/game';
import type { PyramidId } from '../game/core/pyramids';
import type { StoryFragment } from '../game/story';
import { COMMON_HINTS, commonCaption } from './common';
import { EGYPT_KIT } from './egypt';
import { genericKit } from './generic';
import type { PyramidKit } from './types';

export type { BedSpec, DrawCtx, DrawHook, PyramidKit, RenderKit, Win } from './types';

/**
 * The kit of a pyramid (data half; the drawing half is `renderKitFor` in `./render`). Tasks 07-09 add
 * `src/kits/<id>.ts` and one line here.
 */
const KITS: Partial<Record<PyramidId, PyramidKit>> = { egypt: EGYPT_KIT };
const generic: Partial<Record<PyramidId, PyramidKit>> = {};

export function kitFor(id: string): PyramidKit {
  const key = id as PyramidId;
  return KITS[key] ?? (generic[key] ??= genericKit(key));
}

export function storyOf(id: string): readonly StoryFragment[] {
  return kitFor(id).story;
}

/** The text of a hint: the culture's own, else the common ones. */
export function hintText(id: string, hint: string): string {
  return kitFor(id).hints[hint] ?? COMMON_HINTS[hint] ?? '';
}

/** The caption of an event: the culture's first, then the common ones. */
export function captionFor(e: GameEvent, s: GameState): string | null {
  const own = kitFor(s.pyramid.id).caption?.(e, s);
  return own !== undefined ? own : commonCaption(e, s);
}
