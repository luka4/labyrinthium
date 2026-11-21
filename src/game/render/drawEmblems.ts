import { PaintStyle, Skia, TileMode, type SkCanvas, type SkShader } from '@shopify/react-native-skia';

import type { PowerId } from '../core/powers';
import { fill, glow, paint, rgba, stroke } from './art';

/**
 * The emblems of the four artifacts and the Builder's Heart: top-down vector pieces with gradients and a
 * specular glint, drawn at (cx, cy) in a square of `size`. Used by the power bar, the seal door, the site
 * cards, the pyramid page and the artifact screen. Tidy vector art behind this one function; task 14
 * swaps in the final art. No inscriptions on any of them (the fiction never copies real ones).
 */
export type EmblemId = PowerId | 'heart';
export type EmblemOpts = {
  /** 0..1 glow around the emblem in its power colour */
  lit: number;
  /** no uses left or not found: faded and desaturated */
  dim: boolean;
};

const GLOW: Record<EmblemId, string> = { scarab: '#ffcf5a', mirror: '#cfd3f0', naga: '#6fd0bf', jade: '#9fe0b4', heart: '#ff6a5a' };

const DESATURATE = Skia.ColorFilter.MakeMatrix([0.3, 0.5, 0.1, 0, 0, 0.3, 0.5, 0.1, 0, 0, 0.3, 0.5, 0.1, 0, 0, 0, 0, 0, 1, 0]);
const dimPaint = Skia.Paint();
dimPaint.setAlphaf(0.4);
dimPaint.setColorFilter(DESATURATE);

function shaded(canvas: SkCanvas, shader: SkShader, draw: () => void) {
  void canvas;
  paint.setPathEffect(null);
  paint.setStyle(PaintStyle.Fill);
  paint.setColor(rgba('#ffffff'));
  paint.setShader(shader);
  draw();
  paint.setShader(null);
}

const radial = (x: number, y: number, r: number, colors: string[]) =>
  Skia.Shader.MakeRadialGradient({ x, y }, r, colors.map((c) => rgba(c)), null, TileMode.Clamp);
const linear = (x0: number, y0: number, x1: number, y1: number, colors: string[]) =>
  Skia.Shader.MakeLinearGradient({ x: x0, y: y0 }, { x: x1, y: y1 }, colors.map((c) => rgba(c)), null, TileMode.Clamp);

export function drawEmblem(canvas: SkCanvas, id: EmblemId, cx: number, cy: number, size: number, o: EmblemOpts = { lit: 0, dim: false }) {
  const u = size / 2;
  if (o.dim) canvas.saveLayer(dimPaint);
  if (o.lit > 0 && !o.dim) glow(canvas, cx, cy, u * 1.7, 0.55 * o.lit, GLOW[id]);
  switch (id) {
    case 'scarab':
      scarab(canvas, cx, cy, u);
      break;
    case 'mirror':
      mirror(canvas, cx, cy, u);
      break;
    case 'naga':
      naga(canvas, cx, cy, u);
      break;
    case 'jade':
      jade(canvas, cx, cy, u);
      break;
    case 'heart':
      heart(canvas, cx, cy, u);
      break;
  }
  if (o.dim) canvas.restore();
}

/** a path of straight segments scaled around (cx, cy) */
function poly(cx: number, cy: number, u: number, pts: ReadonlyArray<readonly [number, number]>) {
  const b = Skia.PathBuilder.Make();
  pts.forEach(([x, y], i) => (i === 0 ? b.moveTo(cx + x * u, cy + y * u) : b.lineTo(cx + x * u, cy + y * u)));
  return b.close().build();
}

function scarab(canvas: SkCanvas, cx: number, cy: number, u: number) {
  const w = Math.max(1, u * 0.07);
  // six legs, three a side
  const legs: Array<[number, number, number, number]> = [
    [-0.42, -0.3, -0.85, -0.5],
    [-0.5, 0.05, -0.95, 0.05],
    [-0.42, 0.4, -0.85, 0.62],
  ];
  for (const [x0, y0, x1, y1] of legs) {
    for (const s of [-1, 1]) canvas.drawLine(cx + s * x0 * u * -1, cy + y0 * u, cx + s * x1 * u * -1, cy + y1 * u, stroke(rgba('#8a5f1c'), w));
  }
  // elytra: two shields under the pronotum
  const body = (s: number) => poly(cx, cy, u, [[0.02 * s, -0.22], [0.5 * s, -0.12], [0.56 * s, 0.3], [0.3 * s, 0.78], [0.02 * s, 0.82]]);
  for (const s of [-1, 1]) {
    shaded(canvas, linear(cx + s * 0.1 * u, cy - u * 0.2, cx + s * 0.6 * u, cy + u * 0.8, ['#f6d36e', '#d49a2b', '#8f5f14']), () => canvas.drawPath(body(s), paint));
    canvas.drawPath(body(s), stroke(rgba('#6a470c'), w * 0.8));
    // lapis inlay lines
    canvas.drawLine(cx + s * 0.18 * u, cy + 0.05 * u, cx + s * 0.28 * u, cy + 0.62 * u, stroke(rgba('#2f5fa8'), w * 1.1));
    canvas.drawLine(cx + s * 0.36 * u, cy + 0.0 * u, cx + s * 0.44 * u, cy + 0.38 * u, stroke(rgba('#2f5fa8'), w * 0.9));
  }
  canvas.drawLine(cx, cy - 0.2 * u, cx, cy + 0.82 * u, stroke(rgba('#5a3a08', 0.9), w));
  // pronotum
  shaded(canvas, linear(cx, cy - 0.58 * u, cx, cy - 0.12 * u, ['#fbe08a', '#d9a437']), () =>
    canvas.drawPath(poly(cx, cy, u, [[-0.4, -0.15], [-0.34, -0.42], [0, -0.52], [0.34, -0.42], [0.4, -0.15]]), paint),
  );
  canvas.drawPath(poly(cx, cy, u, [[-0.4, -0.15], [-0.34, -0.42], [0, -0.52], [0.34, -0.42], [0.4, -0.15]]), stroke(rgba('#6a470c'), w * 0.8));
  // head with its small horns
  shaded(canvas, radial(cx, cy - 0.72 * u, 0.3 * u, ['#f3c867', '#a97316']), () => canvas.drawOval({ x: cx - 0.26 * u, y: cy - 0.88 * u, width: 0.52 * u, height: 0.32 * u }, paint));
  for (const s of [-1, 1]) canvas.drawLine(cx + s * 0.12 * u, cy - 0.86 * u, cx + s * 0.22 * u, cy - 0.98 * u, stroke(rgba('#8a5f1c'), w));
  // specular glint
  canvas.drawOval({ x: cx - 0.34 * u, y: cy + 0.0 * u, width: 0.14 * u, height: 0.3 * u }, fill(rgba('#fff7d0', 0.5)));
}

function mirror(canvas: SkCanvas, cx: number, cy: number, u: number) {
  // carved grey stone backing with a ring of pyrite dots
  shaded(canvas, radial(cx - 0.2 * u, cy - 0.25 * u, 1.2 * u, ['#9a9a9a', '#5b5b5e', '#3a3a3d']), () => canvas.drawCircle(cx, cy, 0.98 * u, paint));
  canvas.drawCircle(cx, cy, 0.97 * u, stroke(rgba('#262628'), Math.max(1, u * 0.06)));
  const dots = 14;
  for (let i = 0; i < dots; i++) {
    const a = (i / dots) * Math.PI * 2;
    canvas.drawCircle(cx + Math.cos(a) * 0.84 * u, cy + Math.sin(a) * 0.84 * u, Math.max(0.8, u * 0.055), fill(rgba('#d9b44a')));
  }
  // the obsidian disc
  shaded(canvas, radial(cx - 0.25 * u, cy - 0.3 * u, 0.95 * u, ['#4b4660', '#1a1824', '#08070c']), () => canvas.drawCircle(cx, cy, 0.68 * u, paint));
  canvas.drawCircle(cx, cy, 0.68 * u, stroke(rgba('#0a0910'), Math.max(1, u * 0.05)));
  // a violet-grey sheen and one soft reflection arc
  canvas.drawOval({ x: cx - 0.5 * u, y: cy - 0.55 * u, width: 0.7 * u, height: 0.42 * u }, fill(rgba('#a9a4cf', 0.12)));
  canvas.drawArc({ x: cx - 0.5 * u, y: cy - 0.5 * u, width: 1.0 * u, height: 1.0 * u }, 200, 70, false, stroke(rgba('#e4e2ff', 0.55), Math.max(1.2, u * 0.07)));
}

function naga(canvas: SkCanvas, cx: number, cy: number, u: number) {
  const w = Math.max(1, u * 0.06);
  // coiled body: two nested arcs below the hood
  const coil = (r: number, c: string, k: number) => canvas.drawArc({ x: cx - r * u, y: cy + 0.1 * u - r * u * 0.5, width: 2 * r * u, height: r * u * 1.4 }, 20, 140, false, stroke(rgba(c), k));
  coil(0.62, '#7a5a1c', u * 0.2);
  coil(0.62, '#d9a93f', u * 0.12);
  coil(0.36, '#7a5a1c', u * 0.18);
  coil(0.36, '#e3b449', u * 0.1);
  // seven rounded serpent heads fanned over an arc
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = Math.PI * (1.12 + (0.76 * i) / (n - 1)); // fan from upper left to upper right
    const hx = cx + Math.cos(a) * 0.62 * u;
    const hy = cy + 0.18 * u + Math.sin(a) * 0.78 * u;
    const mid = i === 3;
    const hw = (mid ? 0.24 : 0.19) * u;
    const hh = (mid ? 0.34 : 0.28) * u;
    canvas.drawLine(cx, cy + 0.25 * u, hx, hy + hh * 0.4, stroke(rgba('#a87f2a'), u * 0.16));
    shaded(canvas, radial(hx - hw * 0.3, hy - hh * 0.3, hw * 1.6, ['#f1cd6d', '#c7922f', '#7a5214']), () => canvas.drawOval({ x: hx - hw, y: hy - hh, width: hw * 2, height: hh * 2 }, paint));
    canvas.drawOval({ x: hx - hw, y: hy - hh, width: hw * 2, height: hh * 2 }, stroke(rgba('#5a3d0c'), w * 0.7));
    canvas.drawCircle(hx - hw * 0.35, hy - hh * 0.2, Math.max(0.7, u * 0.025), fill(rgba('#1c1206')));
    canvas.drawCircle(hx + hw * 0.35, hy - hh * 0.2, Math.max(0.7, u * 0.025), fill(rgba('#1c1206')));
  }
  // verdigris in the recesses
  canvas.drawArc({ x: cx - 0.5 * u, y: cy - 0.1 * u, width: 1.0 * u, height: 0.8 * u }, 30, 120, false, stroke(rgba('#4fa593', 0.55), w));
  canvas.drawCircle(cx, cy + 0.3 * u, 0.1 * u, fill(rgba('#5fb9a4', 0.6)));
}

function jade(canvas: SkCanvas, cx: number, cy: number, u: number) {
  const top = (dy: number) => poly(cx, cy, u, [[-0.78, -0.1 + dy], [0, -0.52 + dy], [0.78, -0.1 + dy], [0, 0.32 + dy]]);
  // the sides: a darker left and right face under the top
  shaded(canvas, linear(cx - 0.8 * u, cy, cx, cy + 0.7 * u, ['#6f9d7a', '#46725a']), () => canvas.drawPath(poly(cx, cy, u, [[-0.78, -0.1], [0, 0.32], [0, 0.8], [-0.78, 0.4]]), paint));
  shaded(canvas, linear(cx + 0.8 * u, cy, cx, cy + 0.7 * u, ['#5b8a69', '#35604a']), () => canvas.drawPath(poly(cx, cy, u, [[0.78, -0.1], [0, 0.32], [0, 0.8], [0.78, 0.4]]), paint));
  // the lighter top face, with cloudy inclusions
  shaded(canvas, linear(cx - 0.6 * u, cy - 0.5 * u, cx + 0.6 * u, cy + 0.3 * u, ['#d4eed7', '#a7d3b2', '#8bbd9b']), () => canvas.drawPath(top(0), paint));
  canvas.drawOval({ x: cx - 0.36 * u, y: cy - 0.18 * u, width: 0.4 * u, height: 0.16 * u }, fill(rgba('#f1fbf0', 0.28)));
  canvas.drawOval({ x: cx + 0.06 * u, y: cy - 0.06 * u, width: 0.34 * u, height: 0.12 * u }, fill(rgba('#6c9f7e', 0.28)));
  canvas.drawPath(top(0), stroke(rgba('#3e6b52'), Math.max(1, u * 0.04)));
  // the crouching-beast knob: rounded and abstract, no inscription on the face
  shaded(canvas, radial(cx - 0.1 * u, cy - 0.45 * u, 0.5 * u, ['#e2f5e4', '#a4d0b0', '#6f9d7a']), () => canvas.drawOval({ x: cx - 0.26 * u, y: cy - 0.5 * u, width: 0.52 * u, height: 0.34 * u }, paint));
  shaded(canvas, radial(cx + 0.12 * u, cy - 0.62 * u, 0.3 * u, ['#e2f5e4', '#9dcaab']), () => canvas.drawCircle(cx + 0.14 * u, cy - 0.56 * u, 0.15 * u, paint));
  canvas.drawCircle(cx + 0.2 * u, cy - 0.6 * u, Math.max(0.7, u * 0.025), fill(rgba('#2c4c3a')));
  canvas.drawOval({ x: cx - 0.4 * u, y: cy - 0.32 * u, width: 0.1 * u, height: 0.2 * u }, fill(rgba('#ffffff', 0.35)));
}

function heart(canvas: SkCanvas, cx: number, cy: number, u: number) {
  const d = poly(cx, cy, u, [[0, -0.85], [0.6, 0], [0, 0.85], [-0.6, 0]]);
  shaded(canvas, linear(cx - 0.6 * u, cy - 0.8 * u, cx + 0.6 * u, cy + 0.8 * u, ['#ff9b8a', '#e0463a', '#7a1a14']), () => canvas.drawPath(d, paint));
  canvas.drawPath(d, stroke(rgba('#4a0e0a'), Math.max(1, u * 0.05)));
  canvas.drawPath(poly(cx, cy, u, [[0, -0.5], [0.34, 0], [0, 0.5], [-0.34, 0]]), fill(rgba('#ffc9b8', 0.7)));
  canvas.drawCircle(cx - 0.16 * u, cy - 0.3 * u, u * 0.1, fill(rgba('#ffffff', 0.8)));
}
