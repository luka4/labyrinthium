import type { SkCanvas } from '@shopify/react-native-skia';

import type { GameEvent, GameState } from '../game/core/game';
import type { FloorTheme } from '../game/render/themes';
import type { StoryFragment } from '../game/story';
import type { Feedback } from '../audio/feedback';
import type { SoundGroup, SoundId } from '../audio/manifest';

/**
 * Presentation kits (plan 06): everything one culture adds on the presentation side, in one place, so a
 * later task (07-09) adds `src/kits/<id>.ts` and one line in `index.ts` and touches no Egypt file.
 * Core stays UI-free; kits read state and events only.
 *
 * Deviation from the plan's single `PyramidKit`: the kit is split in two so the audio checks (plain
 * node, no Skia) can read the data half: `PyramidKit` (bed, story, hints, captions, feedback, in
 * `src/kits/index.ts`) and `RenderKit` (theme, hunter drawers, draw hooks, in `src/kits/render.ts`).
 */

/** Ambience: two loops of co-prime length and random spot sounds; a low-pass makes a borrowed bed sound different. */
export type BedSpec = {
  group: SoundGroup;
  room: SoundId;
  air: SoundId;
  settle: string;
  trickle: string;
  /** a low-pass (Hz) that makes a borrowed bed sound different (0 = none) */
  lowpass: number;
};

export type PyramidKit = {
  bed: BedSpec;
  story: readonly StoryFragment[];
  /** HintId -> text (culture trap and hunter hints; namespaced 'maya:wheel') */
  hints: Record<string, string>;
  /** undefined = fall through to the common captions, null = no caption */
  caption?: (e: GameEvent, s: GameState) => string | null | undefined;
  /** merged over FEEDBACK (plug-in events need entries here) */
  feedback?: Partial<Record<GameEvent['type'], Feedback>>;
};

/** the tile window a hook may draw in */
export type Win = { x0: number; y0: number; x1: number; y1: number; w: number; h: number };

export type DrawCtx = {
  theme: FloorTheme;
  /** px per tile */
  t: number;
  /** render clock (running time) */
  time: number;
  /** the clock of mechanisms: stops while the Jade Seal holds them still */
  mechTime: number;
  win: Win;
};
export type DrawHook = (canvas: SkCanvas, s: GameState, ctx: DrawCtx) => void;

export type RenderKit = {
  theme: (color: string) => FloorTheme;
  /** hunter drawers by `GuardianRow.kind` / plug-in hunter id */
  hunters?: Record<string, { draw: DrawHook; dread?: SoundId }>;
  /** drawGame layers: under the light mask, over the mask, emissive over the dark */
  draw?: { floor?: DrawHook[]; overlay?: DrawHook[]; emissive?: DrawHook[] };
};
