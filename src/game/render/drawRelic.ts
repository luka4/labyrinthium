import type { SkCanvas } from '@shopify/react-native-skia';

import { easeOutCubic, embers, fill, glow, rgba, stroke } from './art';
import { drawEmblem, type EmblemId } from './drawEmblems';

/** The artifact reveal (and the title's torch): a light that grows out of the dark, with embers. */
export function drawRelic(
  canvas: SkCanvas,
  width: number,
  height: number,
  o: { color: string; time: number; reveal: number; heart?: boolean; emblem?: EmblemId },
) {
  const cx = width / 2;
  const cy = height * 0.5;
  const r = Math.min(width, height);
  const grow = easeOutCubic(o.reveal);
  const pulse = 0.9 + 0.1 * Math.sin(o.time / 300);
  canvas.drawColor(rgba('#0b0a08'));

  glow(canvas, cx, cy, r * 0.55 * grow * pulse, 0.45, o.heart ? '#ff6a5a' : '#ffcd5a');
  // slow turning rays
  const rays = 12;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2 + o.time / 6000;
    const len = r * 0.36 * grow * (i % 2 ? 0.7 : 1);
    canvas.drawLine(
      cx + Math.cos(a) * r * 0.1,
      cy + Math.sin(a) * r * 0.1,
      cx + Math.cos(a) * len,
      cy + Math.sin(a) * len,
      stroke(rgba(o.heart ? '#ff9b8a' : '#f3c55a', 0.18 * grow), 2),
    );
  }
  // the artifact's own emblem at the heart of the light
  drawEmblem(canvas, o.emblem ?? (o.heart ? 'heart' : 'scarab'), cx, cy, r * 0.34 * (0.4 + 0.6 * grow), { lit: grow, dim: false });
  embers(canvas, cx, cy + r * 0.2, r * 0.6, r * 0.6, 28, o.time);
}

/** The title screen: a torch flame in the dark. */
export function drawTorch(canvas: SkCanvas, width: number, height: number, time: number) {
  const cx = width / 2;
  const cy = height * 0.62;
  const f = 0.92 + 0.06 * Math.sin(time / 90) + 0.04 * Math.sin(time / 37);
  canvas.drawColor(rgba('#0b0a08'));
  glow(canvas, cx, cy, Math.min(width, height) * 0.55 * f, 0.38, '#ff8c28');
  glow(canvas, cx, cy, 60 * f, 0.9, '#ffb446');
  // handle
  canvas.drawRect({ x: cx - 4, y: cy + 10, width: 8, height: 70 }, fill(rgba('#6e5535')));
  canvas.drawRect({ x: cx - 7, y: cy + 4, width: 14, height: 10 }, fill(rgba('#8b6c44')));
  // flame
  canvas.drawCircle(cx, cy - 6, 14 * f, fill(rgba('#f08a2c')));
  canvas.drawCircle(cx, cy - 14 * f, 9 * f, fill(rgba('#ffb446')));
  canvas.drawCircle(cx, cy - 6, 6, fill(rgba('#fff1c4')));
  embers(canvas, cx, cy - 10, 70, height * 0.55, 22, time);
}
