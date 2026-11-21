import type { SkCanvas } from '@shopify/react-native-skia';

import type { GameState } from '../core/game';
import { BAG_SIZE, CARRY, EMBER, type Carried } from '../core/lights';
import { fill, rgba, stroke } from './art';
import { drawFlame, drawItemBody, flameAnchor, softGlow } from './drawItems';
import { EMBER_STYLE, LIGHT_STYLE, flicker } from './lightStyle';

/**
 * The light strip above the board, drawn in the same canvas: a medallion with the source
 * in your hand (an arc of the time left in its own colour, a live flame) and the recesses
 * of the bag. Text and touch targets are React Native views over it (LightHud.tsx), so
 * the geometry below is shared.
 */
export const STRIP_H = 64;
export const MEDALLION = 48;
export const SLOT = 44;
export const SLOT_GAP = 8;
const PAD = 8;

export function medallionCenter() {
  return { x: PAD + MEDALLION / 2, y: STRIP_H / 2 };
}

/** Left edge of bag slot `i` for a strip `w` px wide. */
export function slotX(i: number, w: number) {
  return w - PAD - BAG_SIZE * SLOT - (BAG_SIZE - 1) * SLOT_GAP + i * (SLOT + SLOT_GAP);
}
export const slotY = (STRIP_H - SLOT) / 2;

const ROUND = (x: number, y: number, w: number, h: number, r: number) => ({ rect: { x, y, width: w, height: h }, rx: r, ry: r });

function icon(canvas: SkCanvas, c: Carried, cx: number, cy: number, size: number, time: number, burning: boolean) {
  drawItemBody(canvas, c.kind, cx, cy + size * 0.2, size, true);
  if (!burning) return;
  const st = LIGHT_STYLE[c.kind];
  const a = flameAnchor(c.kind);
  const fx = cx + a.dx * size;
  const fy = cy + size * 0.2 + a.dy * size;
  const h = st.flame * size * 0.9;
  softGlow(canvas, fx, fy - h * 0.4, h * 2.2, 0.5, st.color);
  drawFlame(canvas, fx, fy, h, st.color, flicker(st, time), Math.sin(time * 5) * 0.1);
}

export function drawLightHud(canvas: SkCanvas, s: GameState, w: number, time: number) {
  canvas.drawRRect(ROUND(0, 0, w, STRIP_H, 12), fill(rgba('#15110a', 0.96)));
  canvas.drawRRect(ROUND(0.5, 0.5, w - 1, STRIP_H - 1, 12), stroke(rgba('#5a4a30'), 1));

  // medallion
  const { x: cx, y: cy } = medallionCenter();
  const burning = s.hand.left > 0;
  const spec = CARRY[s.hand.kind];
  const frac = burning ? Math.min(1, s.hand.left / spec.seconds) : Math.max(0, 1 - s.ember / EMBER.seconds);
  const seconds = burning ? s.hand.left : EMBER.seconds - s.ember;
  const low = burning ? frac < 0.25 : true;
  const pulse = burning && s.hand.left < 10 ? 0.55 + 0.45 * Math.sin(time * Math.PI * 2) : 1;
  const style = burning ? LIGHT_STYLE[s.hand.kind] : EMBER_STYLE;
  const arc = low ? '#d9522b' : style.color;
  canvas.drawCircle(cx, cy, MEDALLION / 2, fill(rgba('#1d170d')));
  canvas.drawCircle(cx, cy, MEDALLION / 2 - 0.5, stroke(rgba('#8c7440'), 2));
  const r = MEDALLION / 2 - 5;
  canvas.drawArc({ x: cx - r, y: cy - r, width: r * 2, height: r * 2 }, 0, 360, false, stroke(rgba('#3a2f1c'), 4));
  if (frac > 0.002) canvas.drawArc({ x: cx - r, y: cy - r, width: r * 2, height: r * 2 }, -90, 360 * frac, false, stroke(rgba(arc, pulse), 4));
  if (burning) icon(canvas, s.hand, cx + 3, cy + 3, 24, time, true);
  else {
    // the burnt-out source with a dying coal
    drawItemBody(canvas, s.hand.kind, cx + 3, cy + 6, 24, true);
    const p = 0.5 + 0.5 * Math.sin(time * 4);
    softGlow(canvas, cx - 4, cy - 8, 8, 0.3 + 0.6 * p * Math.max(0, seconds / EMBER.seconds), '#c0401a');
  }

  // the Golden Scarab in your pack (plan 04): a small gold glyph beside the bag
  if (s.escape?.taken) {
    const gx = slotX(0, w) - 20;
    const gy = STRIP_H / 2;
    softGlow(canvas, gx, gy, 14 + 2 * Math.sin(time * 4), 0.45, '#ffcf5a');
    canvas.drawOval({ x: gx - 6, y: gy - 7, width: 12, height: 14 }, fill(rgba('#e8b240')));
    canvas.drawOval({ x: gx - 4, y: gy - 3, width: 8, height: 9 }, fill(rgba('#f6d36e')));
    canvas.drawRect({ x: gx - 0.5, y: gy - 3, width: 1, height: 9 }, fill(rgba('#7a5214', 0.8)));
    canvas.drawRect({ x: gx - 6, y: gy, width: 12, height: 1.5 }, fill(rgba('#2f5fa8', 0.9)));
  }

  // bag recesses
  for (let i = 0; i < BAG_SIZE; i++) {
    const x = slotX(i, w);
    const c = s.bag[i];
    canvas.drawRRect(ROUND(x, slotY, SLOT, SLOT, 9), fill(rgba(c ? '#1f180e' : '#100d08')));
    canvas.drawRRect(ROUND(x + 0.5, slotY + 0.5, SLOT - 1, SLOT - 1, 9), stroke(rgba(c ? '#6b5836' : '#2f2718'), 1));
    if (!c) continue;
    icon(canvas, c, x + SLOT / 2, slotY + SLOT / 2 - 3, 28, time, false);
    const f = Math.min(1, c.left / CARRY[c.kind].seconds);
    canvas.drawRRect(ROUND(x + 6, slotY + SLOT - 8, SLOT - 12, 3, 1.5), fill(rgba('#000000', 0.5)));
    canvas.drawRRect(ROUND(x + 6, slotY + SLOT - 8, (SLOT - 12) * f, 3, 1.5), fill(rgba(f < 0.25 ? '#d9522b' : LIGHT_STYLE[c.kind].color)));
  }
}
