import { BlendMode, ClipOp, FilterMode, MipmapMode, PaintStyle, Skia, TileMode, type SkCanvas, type SkImage } from '@shopify/react-native-skia';

import { TILE } from '../core/floor';
import { isBasement, isCampFloor, type GameState } from '../core/game';
import { torchRadius } from '../core/vision';
import { diamond, fill, flame, glow, rgba } from './art';
import type { LightMask } from './lightMask';

/**
 * Draws the board imperatively into one Skia canvas (no React element per tile):
 * the baked floor architecture, a few sprites, the light mask, the torch tint, the
 * player. The camera follows the player; `view` is in tile units.
 */
export type View = {
  /** tile coordinates at the centre of the board */
  camX: number;
  camY: number;
  /** board size in px and px per tile */
  board: number;
  tilePx: number;
};

const maskPaint = Skia.Paint();
maskPaint.setBlendMode(BlendMode.DstIn);

const tintPaint = Skia.Paint();
tintPaint.setBlendMode(BlendMode.SrcATop);
tintPaint.setStyle(PaintStyle.Fill);

const layerPaint = Skia.Paint();

export function drawGame(
  canvas: SkCanvas,
  s: GameState,
  art: SkImage | null,
  mask: LightMask,
  view: View,
  flicker: number,
) {
  const { size, stairs, start } = s.floor;
  const { board, tilePx: t } = view;
  const world = size * t;
  canvas.drawColor(rgba('#000000'));
  canvas.save();
  canvas.clipRect({ x: 0, y: 0, width: board, height: board }, ClipOp.Intersect, false);
  canvas.translate(board / 2 - view.camX * t, board / 2 - view.camY * t);

  canvas.saveLayer(layerPaint);
  if (art) canvas.drawImageRectOptions(art, { x: 0, y: 0, width: art.width(), height: art.height() }, { x: 0, y: 0, width: world, height: world }, FilterMode.Linear, MipmapMode.None);

  // things lying on the floor: they sit under the light mask like everything else
  const basement = isBasement(s.pyramid, s.floorIndex);
  const tx = (i: number) => ((i % size) + 0.5) * t;
  const ty = (i: number) => (Math.floor(i / size) + 0.5) * t;
  for (const i of s.oil) jar(canvas, tx(i), ty(i), t, flicker);
  if (basement) artifact(canvas, tx(stairs), ty(stairs), t, flicker);
  else glow(canvas, tx(stairs), ty(stairs), t * 1.8, 0.35, '#5f86e8');
  if (isCampFloor(s.pyramid, s.floorIndex)) brazier(canvas, s, start, t, flicker);

  const image = mask.render(s, flicker);
  if (image) canvas.drawImageRectOptions(image, { x: 0, y: 0, width: mask.px, height: mask.px }, { x: 0, y: 0, width: world, height: world }, FilterMode.Linear, MipmapMode.None, maskPaint);

  // warm torch light on whatever the mask let through
  const px = tx(s.pos);
  const py = ty(s.pos);
  const reach = (torchRadius(s.fuel) + 1) * t * (0.96 + 0.04 * flicker);
  tintPaint.setShader(Skia.Shader.MakeRadialGradient({ x: px, y: py }, reach, [rgba('#ff9a3c', 0.34), rgba('#ff8a2c', 0.0)], null, TileMode.Clamp));
  canvas.drawCircle(px, py, reach, tintPaint);
  tintPaint.setShader(null);
  canvas.restore();

  player(canvas, px, py, t, flicker);
  canvas.restore();
}

function jar(canvas: SkCanvas, x: number, y: number, t: number, flicker: number) {
  glow(canvas, x, y, t * 0.9, 0.3 * flicker, '#ff9a3c');
  canvas.drawOval({ x: x - t * 0.24, y: y + t * 0.2, width: t * 0.5, height: t * 0.16 }, fill(rgba('#000000', 0.4)));
  canvas.drawOval({ x: x - t * 0.22, y: y - t * 0.22, width: t * 0.44, height: t * 0.5 }, fill(rgba('#a4521f')));
  canvas.drawOval({ x: x - t * 0.15, y: y - t * 0.18, width: t * 0.14, height: t * 0.3 }, fill(rgba('#d88a45', 0.7)));
  canvas.drawRect({ x: x - t * 0.09, y: y - t * 0.33, width: t * 0.18, height: t * 0.14 }, fill(rgba('#7e3d16')));
  canvas.drawOval({ x: x - t * 0.07, y: y - t * 0.37, width: t * 0.14, height: t * 0.06 }, fill(rgba('#ffcf6a')));
}

function artifact(canvas: SkCanvas, x: number, y: number, t: number, flicker: number) {
  glow(canvas, x, y, t * 2.2 * flicker, 0.75);
  canvas.drawOval({ x: x - t * 0.36, y: y + t * 0.05, width: t * 0.72, height: t * 0.36 }, fill(rgba('#3b2f26')));
  canvas.drawOval({ x: x - t * 0.3, y: y - t * 0.02, width: t * 0.6, height: t * 0.3 }, fill(rgba('#6e5a46')));
  diamond(canvas, x, y - t * 0.2, t * 0.17, t * 0.3, rgba('#f3c55a'));
  diamond(canvas, x, y - t * 0.2, t * 0.09, t * 0.17, rgba('#ffe7a3'));
}

/** The camp brazier stands on the nearest open tile beside the landing. */
function brazier(canvas: SkCanvas, s: GameState, start: number, t: number, flicker: number) {
  const { size, solid, tiles } = s.floor;
  const sx = start % size;
  const sy = Math.floor(start / size);
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const i = (sy + dy) * size + sx + dx;
    if (solid[i] || tiles[i] === TILE.DOOR) continue;
    const x = (sx + dx + 0.5) * t;
    const y = (sy + dy + 0.6) * t;
    canvas.drawOval({ x: x - t * 0.26, y: y - t * 0.04, width: t * 0.52, height: t * 0.2 }, fill(rgba('#000000', 0.35)));
    canvas.drawRect({ x: x - t * 0.2, y: y - t * 0.2, width: t * 0.4, height: t * 0.22 }, fill(rgba('#5c4a2a')));
    canvas.drawOval({ x: x - t * 0.26, y: y - t * 0.3, width: t * 0.52, height: t * 0.2 }, fill(rgba('#8c7440')));
    flame(canvas, x, y - t * 0.2, t * 0.3, flicker);
    return;
  }
}

function player(canvas: SkCanvas, x: number, y: number, t: number, flicker: number) {
  glow(canvas, x, y, t * 1.1 * flicker, 0.4, '#ffcf7a');
  canvas.drawOval({ x: x - t * 0.26, y: y + t * 0.16, width: t * 0.52, height: t * 0.2 }, fill(rgba('#000000', 0.45)));
  // robe, head, torch in the raised hand
  canvas.drawOval({ x: x - t * 0.24, y: y - t * 0.08, width: t * 0.48, height: t * 0.46 }, fill(rgba('#6a4a2c')));
  canvas.drawOval({ x: x - t * 0.16, y: y - t * 0.3, width: t * 0.32, height: t * 0.32 }, fill(rgba('#d9b283')));
  canvas.drawOval({ x: x - t * 0.18, y: y - t * 0.34, width: t * 0.36, height: t * 0.18 }, fill(rgba('#2a1c10')));
  canvas.drawRect({ x: x + t * 0.2, y: y - t * 0.26, width: t * 0.05, height: t * 0.3 }, fill(rgba('#7a5a30')));
  flame(canvas, x + t * 0.225, y - t * 0.22, t * 0.17, flicker);
}
