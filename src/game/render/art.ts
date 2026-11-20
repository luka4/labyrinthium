import { PaintStyle, Skia, TileMode, type SkCanvas, type SkColor } from '@shopify/react-native-skia';

/** Shared drawing helpers for menu and transition art (not for the per-frame game board). */

export const paint = Skia.Paint();
paint.setAntiAlias(true);

export function rgba(hex: string, alpha = 1, factor = 1): SkColor {
  const n = parseInt(hex.slice(1), 16);
  const f = factor / 255;
  return Float32Array.of(((n >> 16) & 255) * f, ((n >> 8) & 255) * f, (n & 255) * f, alpha);
}

export function fill(color: SkColor) {
  paint.setShader(null);
  paint.setPathEffect(null);
  paint.setStyle(PaintStyle.Fill);
  paint.setColor(color);
  return paint;
}

export function stroke(color: SkColor, width: number, dash?: [number, number]) {
  paint.setShader(null);
  paint.setStyle(PaintStyle.Stroke);
  paint.setStrokeWidth(width);
  paint.setPathEffect(dash ? Skia.PathEffect.MakeDash(dash) : null);
  paint.setColor(color);
  return paint;
}

/** A soft warm light, like the torch glow in the design sketches. */
export function glow(canvas: SkCanvas, x: number, y: number, r: number, alpha: number, hex = '#ffcd5a') {
  if (r <= 0 || alpha <= 0) return;
  paint.setPathEffect(null);
  paint.setStyle(PaintStyle.Fill);
  paint.setColor(rgba('#ffffff'));
  paint.setShader(
    Skia.Shader.MakeRadialGradient({ x, y }, r, [rgba(hex, alpha), rgba(hex, 0)], null, TileMode.Clamp),
  );
  canvas.drawCircle(x, y, r, paint);
  paint.setShader(null);
}

export function diamond(canvas: SkCanvas, x: number, y: number, rx: number, ry: number, color: SkColor) {
  const path = Skia.PathBuilder.Make()
    .moveTo(x, y - ry)
    .lineTo(x + rx, y)
    .lineTo(x, y + ry)
    .lineTo(x - rx, y)
    .close()
    .build();
  canvas.drawPath(path, fill(color));
}

export function triangle(canvas: SkCanvas, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, color: SkColor) {
  const path = Skia.PathBuilder.Make().moveTo(x0, y0).lineTo(x1, y1).lineTo(x2, y2).close().build();
  canvas.drawPath(path, fill(color));
}

/** A small camp flame. */
export function flame(canvas: SkCanvas, x: number, y: number, size: number, flicker = 1) {
  glow(canvas, x, y - size * 0.3, size * 1.6 * flicker, 0.5, '#ff9a3c');
  triangle(canvas, x - size * 0.45, y, x, y - size * 1.2 * flicker, x + size * 0.45, y, rgba('#f08a2c'));
  canvas.drawCircle(x, y - size * 0.25, size * 0.28, fill(rgba('#ffe7a3')));
}

/** Stable pseudo-random 0..1 for decoration (not game logic). */
export function hash01(i: number): number {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Rising embers around (x, y): deterministic in `time`, so no per-frame allocation of state. */
export function embers(canvas: SkCanvas, x: number, y: number, spread: number, height: number, count: number, time: number) {
  const t = time / 1000;
  for (let i = 0; i < count; i++) {
    const speed = 0.12 + hash01(i) * 0.18;
    const phase = (t * speed + hash01(i + 50)) % 1;
    const ex = x + (hash01(i + 100) - 0.5) * spread + Math.sin(t * (1 + hash01(i + 7)) + i) * spread * 0.08;
    const ey = y - phase * height;
    const a = (1 - phase) * (phase < 0.1 ? phase * 10 : 1) * 0.9;
    canvas.drawCircle(ex, ey, 1 + hash01(i + 200) * 1.8, fill(rgba('#ffb85a', a)));
  }
}

export function easeOutCubic(t: number): number {
  const q = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - q, 3);
}
