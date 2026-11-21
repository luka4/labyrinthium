import type { PyramidId } from '../game/core/pyramids';
import { drawGuardian } from '../game/render/drawGuardian';
import { themeFor } from '../game/render/themes';
import type { RenderKit } from './types';

/**
 * The drawing half of a pyramid's kit: its palette, how its hunters look, extra draw layers. Egypt's
 * guardian is the Keeper; the other pyramids use the derived palette until tasks 07-09 add theirs.
 */
const KEEPER: RenderKit['hunters'] = {
  keeper: { draw: (canvas, s, ctx) => drawGuardian(canvas, s, ctx.theme, ctx.t, ctx.mechTime) },
};

const RENDER: Partial<Record<PyramidId, RenderKit>> = {};

export function renderKitFor(id: PyramidId): RenderKit {
  return (RENDER[id] ??= { theme: (color) => themeFor(id, color), hunters: KEEPER });
}
