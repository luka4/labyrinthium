import { BlendMode, ClipOp, FilterMode, MipmapMode, Skia, type SkCanvas } from '@shopify/react-native-skia';

import { isBasement, type GameState } from '../core/game';
import { STEP_SECONDS } from '../core/lights';
import { diamond, fill, glow, hash01, rgba } from './art';
import type { FloorArt } from './floorArt';
import { createSandRenderer, type SandRenderer } from './drawSand';
import { drawTraps } from './drawTraps';
import type { FloorTheme } from './themes';
import { drawFixtureBody, drawFlame, drawGlint, drawItemBody, fixtureFlames, flameAnchor, softGlow } from './drawItems';
import type { LightMask } from './lightMask';
import { EMBER_STYLE, LIGHT_STYLE, flicker } from './lightStyle';

/**
 * Draws the board imperatively into one Skia canvas (no React element per tile):
 * the baked floor architecture, the sprites of light sources, the light mask, the
 * coloured light of the hand and of every lit fixture, the player. The camera follows the
 * player; `view` is in tile units. Everything the player cannot see sits under the mask.
 */
export type View = {
  /** tile coordinates at the centre of the board */
  camX: number;
  camY: number;
  /** board size in px and px per tile */
  board: number;
  tilePx: number;
};

/** Render-only clock and animation state, owned by the Board component. */
export type Frame = {
  /** seconds, counts only running time */
  time: number;
  /** tile the player stood on before the last move (for the walking animation) */
  prevPos: number;
  /** 0..1 while a trapdoor opens under you (status `falling`) */
  fall: number;
};

/** What the board draws besides the game state: the floor's art, the light mask, the sand and the palette. */
export type Layers = { art: FloorArt | null; mask: LightMask; sand: SandRenderer; theme: FloorTheme };

/**
 * The tiles to render around the camera: the view plus `margin` tiles, clamped to the floor.
 * One helper for the light mask, the sand layer and the art chunks.
 */
export function viewWindow(view: Pick<View, 'camX' | 'camY' | 'board' | 'tilePx'>, size: number, margin: number) {
  const half = view.board / 2 / view.tilePx;
  const x0 = Math.max(0, Math.floor(view.camX - half) - margin);
  const y0 = Math.max(0, Math.floor(view.camY - half) - margin);
  const x1 = Math.min(size - 1, Math.ceil(view.camX + half) + margin);
  const y1 = Math.min(size - 1, Math.ceil(view.camY + half) + margin);
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export { createSandRenderer };

const layerPaint = Skia.Paint();
const maskPaint = Skia.Paint();
maskPaint.setBlendMode(BlendMode.DstIn);

/** The most coloured fixture glows drawn per frame. */
const MAX_FIXED_TINTS = 10;

export function drawGame(canvas: SkCanvas, s: GameState, layers: Layers, view: View, frame: Frame) {
  const { art, mask, sand, theme } = layers;
  const { size, stairs } = s.floor;
  const { board, tilePx: t } = view;
  const time = frame.time;
  const prog = Math.min(1, Math.max(0, 1 - s.cooldown / STEP_SECONDS));

  const style = s.hand.left > 0 ? LIGHT_STYLE[s.hand.kind] : EMBER_STYLE;
  const handF = flicker(style, time);

  canvas.drawColor(rgba('#000000'));
  canvas.save();
  canvas.clipRect({ x: 0, y: 0, width: board, height: board }, ClipOp.Intersect, false);
  canvas.translate(board / 2 - view.camX * t, board / 2 - view.camY * t);

  // the player and the light slide from the last tile to this one
  const fx = frame.prevPos % size;
  const fy = Math.floor(frame.prevPos / size);
  const tx = s.pos % size;
  const ty = Math.floor(s.pos / size);
  const px = (fx + (tx - fx) * prog + 0.5) * t;
  const py = (fy + (ty - fy) * prog + 0.5) * t;

  // visible tile window (with a margin for tall sprites)
  const half = board / 2 / t + 2;
  const x0 = Math.floor(view.camX - half);
  const x1 = Math.ceil(view.camX + half);
  const y0 = Math.floor(view.camY - half);
  const y1 = Math.ceil(view.camY + half);
  const inView = (i: number) => {
    const x = i % size;
    const y = (i - x) / size;
    return x >= x0 && x <= x1 && y >= y0 && y <= y1;
  };
  const cx = (i: number) => ((i % size) + 0.5) * t;
  const cy = (i: number) => (Math.floor(i / size) + 0.5) * t;

  const win = viewWindow(view, size, 2);
  canvas.saveLayer(layerPaint);
  art?.draw(canvas, win, t);
  drawTraps(canvas, s, theme, t, win, { time, fall: frame.fall });

  // things lying on the floor and the bodies of fixtures: they sit under the light mask
  for (const [i, it] of s.items) {
    if (!inView(i)) continue;
    drawItemBody(canvas, it.kind, cx(i), cy(i), t);
    drawGlint(canvas, cx(i), cy(i), t, time);
  }
  s.floor.fixtures.forEach((f, k) => {
    if (!inView(f.tile)) return;
    const lit = s.fixtureLeft[k] !== 0 && s.fixtureLeft[k] !== -1;
    // sconces sit on the wall face above their tile: pass the tile's top edge
    drawFixtureBody(canvas, f.kind, cx(f.tile), f.kind === 'sconce' ? (Math.floor(f.tile / size)) * t : cy(f.tile), t, lit);
  });
  sand.draw(canvas, s, win, t, time);
  if (isBasement(s.pyramid, s.floorIndex)) artifact(canvas, cx(stairs), cy(stairs), t, handF);
  else glow(canvas, cx(stairs), cy(stairs), t * 1.8, 0.35, '#5f86e8');

  const lit = mask.render(s, prog, handF, 1, win);
  if (lit) canvas.drawImageRectOptions(lit.image, { x: 0, y: 0, width: lit.w * 2, height: lit.h * 2 }, { x: lit.x0 * t, y: lit.y0 * t, width: lit.w * t, height: lit.h * t }, FilterMode.Linear, MipmapMode.None, maskPaint);

  // coloured light on whatever the mask let through: the hand light, then each lit fixture
  const handReach = (s.handR + 1) * t * handF;
  softGlow(canvas, px, py - t * 0.15, handReach, style.tint * (s.hand.left > 0 ? 1 : 0.8), style.color, BlendMode.SrcATop);
  let tints = 0;
  s.floor.fixtures.forEach((f, k) => {
    const left = s.fixtureLeft[k];
    if (left <= 0 || tints >= MAX_FIXED_TINTS || !inView(f.tile) || s.lightSeen[f.tile] <= 0) return;
    tints++;
    const st = LIGHT_STYLE[f.kind];
    const fl = flicker(st, time, hash01(f.tile) * 6.28);
    softGlow(canvas, cx(f.tile), cy(f.tile) - (f.kind === 'sconce' ? t * 0.55 : t * 0.2), (s.fixtureR[k] + 1) * t * fl, st.tint, st.color, BlendMode.SrcATop);
  });
  canvas.restore();

  // flames of what burns and is in sight: emissive, over the dark
  s.floor.fixtures.forEach((f, k) => {
    if (s.fixtureLeft[k] <= 0 || !inView(f.tile) || s.light[f.tile] <= 0.03) return;
    const st = LIGHT_STYLE[f.kind];
    const baseY = f.kind === 'sconce' ? Math.floor(f.tile / size) * t : cy(f.tile);
    fixtureFlames(f.kind).forEach(([dx, dy, h], n) => {
      const fl = flicker(st, time, hash01(f.tile + n * 7) * 6.28);
      softGlow(canvas, cx(f.tile) + dx * t, baseY + dy * t - h * t * 0.4, h * t * 2.2, 0.5, st.color);
      drawFlame(canvas, cx(f.tile) + dx * t, baseY + dy * t, h * t, st.color, fl, Math.sin(time * 5 + n) * 0.3);
    });
  });

  // dropping through a trapdoor: smaller and darker into the pit
  const sink = s.status === 'falling' ? 1 - 0.75 * frame.fall : 1;
  player(canvas, s, px, py + (1 - sink) * t * 0.2, t * sink, style.color, handF, frame.prevPos === s.pos ? 0 : Math.sign(tx - fx) * (1 - prog), time);
  if (sink < 1) canvas.drawCircle(px, py, t * 0.5 * (1 - sink), fill(rgba('#000000', 0.5 * (1 - sink))));
  canvas.restore();
}

function artifact(canvas: SkCanvas, x: number, y: number, t: number, flick: number) {
  glow(canvas, x, y, t * 2.2 * flick, 0.75);
  canvas.drawOval({ x: x - t * 0.36, y: y + t * 0.05, width: t * 0.72, height: t * 0.36 }, fill(rgba('#3b2f26')));
  canvas.drawOval({ x: x - t * 0.3, y: y - t * 0.02, width: t * 0.6, height: t * 0.3 }, fill(rgba('#6e5a46')));
  diamond(canvas, x, y - t * 0.2, t * 0.17, t * 0.3, rgba('#f3c55a'));
  diamond(canvas, x, y - t * 0.2, t * 0.09, t * 0.17, rgba('#ffe7a3'));
}

function player(canvas: SkCanvas, s: GameState, x: number, y: number, t: number, color: string, flick: number, lean: number, time: number) {
  canvas.drawOval({ x: x - t * 0.26, y: y + t * 0.16, width: t * 0.52, height: t * 0.2 }, fill(rgba('#000000', 0.45)));
  // robe, head
  canvas.drawOval({ x: x - t * 0.24, y: y - t * 0.08, width: t * 0.48, height: t * 0.46 }, fill(rgba('#6a4a2c')));
  canvas.drawOval({ x: x - t * 0.16, y: y - t * 0.3, width: t * 0.32, height: t * 0.32 }, fill(rgba('#d9b283')));
  canvas.drawOval({ x: x - t * 0.18, y: y - t * 0.34, width: t * 0.36, height: t * 0.18 }, fill(rgba('#2a1c10')));
  // the source in the raised right hand, flame leaning against the motion
  const hx = x + t * 0.3;
  const hy = y + t * 0.02;
  const k = 0.8;
  drawItemBody(canvas, s.hand.kind, hx, hy, t * k, true);
  const a = flameAnchor(s.hand.kind);
  const fxp = hx + a.dx * t * k;
  const fyp = hy + a.dy * t * k;
  if (s.hand.left > 0) {
    const low = Math.min(1, s.hand.left / 12);
    const style = LIGHT_STYLE[s.hand.kind];
    const h = style.flame * t * (0.55 + 0.45 * low);
    softGlow(canvas, fxp, fyp - h * 0.4, h * 2.4, 0.5, color);
    drawFlame(canvas, fxp, fyp, h, color, flick, lean + Math.sin(time * 6) * 0.1);
  } else {
    // a dying coal
    const pulse = 0.5 + 0.5 * Math.sin(time * 4);
    softGlow(canvas, fxp, fyp, t * 0.2, 0.25 + 0.5 * pulse * (1 - s.ember / 6), EMBER_STYLE.color);
  }
}
