import type { SkCanvas } from '@shopify/react-native-skia';

import type { GameState } from '../core/game';
import { POWER_ORDER, power, type PowerId } from '../core/powers';
import { POWER_INFO } from '../core/pyramids';
import { fill, glow, rgba, stroke } from './art';
import { drawEmblem } from './drawEmblems';

/**
 * The power bar under the board, drawn in the board canvas (Board.tsx); the Pressables over it are
 * PowerBar.tsx, so the geometry below is shared. Four sockets in POWER_ORDER: an unowned power is an
 * empty dark recess (the set to collect), an owned one a recessed bronze-rimmed socket with its emblem,
 * pips for the uses left, a fine gold ring when this pyramid is its attuned one, a depleting ring while
 * active, and a faded emblem at no uses.
 */
export const BAR_GAP = 10;
export const POWER_H = 72;
export const SOCKET = 56;
export const PITCH = 72;
const SOCKET_Y = 3;
const PIP_Y = 66;

/** left edge of socket `i` for a bar `w` px wide */
export const socketX = (i: number, w: number) => (w - (POWER_ORDER.length * PITCH - (PITCH - SOCKET))) / 2 + i * PITCH;
export const socketY = SOCKET_Y;

/** the clocks of the "no uses" shake: render time at which `powerEmpty` last fired for each power */
export type PowerFx = Partial<Record<PowerId, number>>;

const SHAKE_SECONDS = 0.25;

const ROUND = (x: number, y: number, w: number, h: number, r: number) => ({ rect: { x, y, width: w, height: h }, rx: r, ry: r });

export function drawPowerBar(canvas: SkCanvas, s: GameState, w: number, time: number, fx: PowerFx = {}) {
  canvas.drawRRect(ROUND(0, 0, w, POWER_H, 12), fill(rgba('#15110a', 0.96)));
  canvas.drawRRect(ROUND(0.5, 0.5, w - 1, POWER_H - 1, 12), stroke(rgba('#5a4a30'), 1));
  POWER_ORDER.forEach((id, i) => {
    const p = power(s, id);
    const info = POWER_INFO[id];
    let x = socketX(i, w) + SOCKET / 2;
    const y = SOCKET_Y + SOCKET / 2;
    const r = SOCKET / 2;
    if (!p) {
      // the set to collect: an empty dark recess
      canvas.drawCircle(x, y, r - 1, fill(rgba('#0b0906')));
      canvas.drawCircle(x, y, r - 1, stroke(rgba('#2f2718'), 1.2, [3, 4]));
      return;
    }
    const t0 = fx[id];
    if (t0 !== undefined && time - t0 < SHAKE_SECONDS) x += Math.sin((time - t0) * 70) * 3 * (1 - (time - t0) / SHAKE_SECONDS);
    const active = p.left > 0;
    const empty = p.uses <= 0 && !active;
    // recess with a bronze rim
    canvas.drawCircle(x, y, r, fill(rgba('#2a2112')));
    canvas.drawCircle(x, y, r - 0.5, stroke(rgba(empty ? '#4a3b22' : '#9a7a3e'), 2));
    canvas.drawCircle(x, y + 1.5, r - 4, fill(rgba('#0e0b06')));
    canvas.drawCircle(x, y, r - 4, stroke(rgba('#000000', 0.5), 2));
    if (p.attuned) canvas.drawCircle(x, y, r + 2.2, stroke(rgba('#f3c55a', empty ? 0.35 : 0.85), 1));
    if (active) {
      glow(canvas, x, y, r * 1.5, 0.5 + 0.12 * Math.sin(time * 6), info.color);
      const frac = Math.max(0, Math.min(1, p.left / p.seconds));
      const rr = r + 0.5;
      canvas.drawArc({ x: x - rr, y: y - rr, width: rr * 2, height: rr * 2 }, -90, 360 * frac, false, stroke(rgba(info.color, 0.95), 3));
    }
    drawEmblem(canvas, id, x, y, 40, { lit: active ? 1 : 0, dim: empty });
    // pips: the uses left (gold) and spent (hollow)
    const n = p.max;
    for (let k = 0; k < n; k++) {
      const px = x + (k - (n - 1) / 2) * 9;
      if (k < p.uses) canvas.drawCircle(px, PIP_Y, 2.6, fill(rgba('#f3c55a')));
      else canvas.drawCircle(px, PIP_Y, 2.4, stroke(rgba('#6b5836'), 1));
    }
  });
}
