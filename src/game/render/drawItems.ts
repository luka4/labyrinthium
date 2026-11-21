import { BlendMode, PaintStyle, Skia, TileMode, type SkCanvas, type SkPath, type SkShader } from '@shopify/react-native-skia';

import type { FixtureKind, ItemKind } from '../core/lights';
import { fill, rgba } from './art';
import { LIGHT_STYLE, type LightKind } from './lightStyle';

/**
 * Vector sprites for light sources, drawn inside the one board canvas. Tidy shapes with
 * a wood/clay/bronze palette; paths and gradients are cached, nothing is allocated per
 * frame. Task 12 swaps these for pixel-grid art behind the same functions.
 */

const glowPaint = Skia.Paint();
glowPaint.setAntiAlias(true);
glowPaint.setStyle(PaintStyle.Fill);
const glowShaders = new Map<string, SkShader>();

/** A unit radial gradient (radius 1, centre 0,0) of one colour fading to nothing. */
export function glowShader(hex: string): SkShader {
  let sh = glowShaders.get(hex);
  if (!sh) {
    sh = Skia.Shader.MakeRadialGradient({ x: 0, y: 0 }, 1, [rgba(hex, 1), rgba(hex, 0.35), rgba(hex, 0)], [0, 0.35, 1], TileMode.Clamp);
    glowShaders.set(hex, sh);
  }
  return sh;
}

/** A soft coloured disc of radius `r` px with peak opacity `alpha`; `blend` null = normal. */
export function softGlow(canvas: SkCanvas, x: number, y: number, r: number, alpha: number, hex: string, blend: BlendMode = BlendMode.SrcOver) {
  if (r <= 0 || alpha <= 0) return;
  glowPaint.setBlendMode(blend);
  glowPaint.setShader(glowShader(hex));
  glowPaint.setAlphaf(Math.min(1, alpha));
  canvas.save();
  canvas.translate(x, y);
  canvas.scale(r, r);
  canvas.drawCircle(0, 0, 1, glowPaint);
  canvas.restore();
  glowPaint.setShader(null);
}

let flamePath: SkPath | null = null;
let innerPath: SkPath | null = null;
function unitFlame(): SkPath {
  // a teardrop: base at (0,0), tip at (0,-1), half width 0.5
  flamePath ??= Skia.PathBuilder.Make()
    .moveTo(0, 0)
    .cubicTo(-0.55, -0.1, -0.5, -0.55, 0, -1)
    .cubicTo(0.5, -0.55, 0.55, -0.1, 0, 0)
    .close()
    .build();
  return flamePath;
}
function unitInner(): SkPath {
  innerPath ??= Skia.PathBuilder.Make()
    .moveTo(0, 0)
    .cubicTo(-0.35, -0.05, -0.3, -0.4, 0, -0.75)
    .cubicTo(0.3, -0.4, 0.35, -0.05, 0, 0)
    .close()
    .build();
  return innerPath;
}

/** An emissive flame: base at (x, y), `h` px tall; `flick` ~1 scales and leans it. */
export function drawFlame(canvas: SkCanvas, x: number, y: number, h: number, hex: string, flick: number, lean = 0) {
  if (h <= 0) return;
  canvas.save();
  canvas.translate(x, y);
  canvas.rotate(lean * 12, 0, 0);
  canvas.scale(h * 0.62 * (2 - flick), h * flick);
  canvas.drawPath(unitFlame(), fill(rgba(hex)));
  canvas.drawPath(unitInner(), fill(rgba('#fff0b8', 0.92)));
  canvas.restore();
}

const R = (canvas: SkCanvas, x: number, y: number, w: number, h: number, color: string, alpha = 1) =>
  canvas.drawRect({ x, y, width: w, height: h }, fill(rgba(color, alpha)));
const O = (canvas: SkCanvas, x: number, y: number, w: number, h: number, color: string, alpha = 1) =>
  canvas.drawOval({ x, y, width: w, height: h }, fill(rgba(color, alpha)));

let shadowOn = true;
function shadow(canvas: SkCanvas, x: number, y: number, w: number) {
  if (!shadowOn) return;
  O(canvas, x - w / 2, y - w * 0.14, w, w * 0.3, '#000000', 0.42);
}

/** A torch shaft with a wrapped head, leaning; head sizes and bands differ per kind. */
function torchBody(canvas: SkCanvas, x: number, y: number, t: number, kind: 'smallTorch' | 'torch' | 'bigTorch', lit: boolean) {
  const len = kind === 'smallTorch' ? 0.46 : kind === 'torch' ? 0.58 : 0.66;
  const thick = kind === 'bigTorch' ? 0.09 : 0.065;
  const head = kind === 'smallTorch' ? 0.13 : kind === 'torch' ? 0.16 : 0.22;
  const headLen = kind === 'smallTorch' ? 0.17 : kind === 'torch' ? 0.21 : 0.3;
  canvas.save();
  canvas.rotate(-22, x, y);
  R(canvas, x - t * thick * 0.5, y - t * len, t * thick, t * len, '#7a5a30');
  R(canvas, x - t * thick * 0.5, y - t * len, t * thick * 0.3, t * len, '#a07a46', 0.6);
  const top = y - t * len;
  // the head: linen, fat or pitch
  const body = kind === 'bigTorch' ? '#2b2118' : kind === 'torch' ? '#a8895a' : '#d9c9a0';
  O(canvas, x - t * head, top - t * headLen * 0.8, t * head * 2, t * headLen, lit ? '#3a2410' : body);
  R(canvas, x - t * head * 0.95, top - t * headLen * 0.25, t * head * 1.9, t * 0.025, '#5a4226');
  if (kind === 'bigTorch') {
    R(canvas, x - t * head * 0.95, top - t * headLen * 0.6, t * head * 1.9, t * 0.022, '#8c6a30'); // bronze bands
    O(canvas, x - t * head * 0.5, top - t * headLen * 0.75, t * head * 0.7, t * headLen * 0.25, '#ffffff', 0.12);
  }
  canvas.restore();
}

function lampBody(canvas: SkCanvas, x: number, y: number, t: number) {
  shadow(canvas, x, y + t * 0.1, t * 0.46);
  O(canvas, x - t * 0.21, y - t * 0.06, t * 0.42, t * 0.2, '#8a5632');
  O(canvas, x - t * 0.19, y - t * 0.1, t * 0.38, t * 0.17, '#b87a4a');
  // pinched spout with the wick, and a small handle
  R(canvas, x + t * 0.15, y - t * 0.09, t * 0.1, t * 0.045, '#b87a4a');
  O(canvas, x - t * 0.11, y - t * 0.08, t * 0.22, t * 0.08, '#4a2c14', 0.9);
  canvas.drawCircle(x + t * 0.25, y - t * 0.075, t * 0.015, fill(rgba('#1c1008')));
  O(canvas, x - t * 0.17, y - t * 0.08, t * 0.1, t * 0.04, '#ffffff', 0.16);
}

function candleBody(canvas: SkCanvas, x: number, y: number, t: number, h = 0.3) {
  shadow(canvas, x, y + t * 0.06, t * 0.2);
  R(canvas, x - t * 0.045, y - t * h, t * 0.09, t * h, '#e8d9b4');
  R(canvas, x - t * 0.045, y - t * h, t * 0.03, t * h, '#fff4d6', 0.55);
  O(canvas, x - t * 0.045, y - t * h - t * 0.015, t * 0.09, t * 0.03, '#f6ead0');
  R(canvas, x - t * 0.007, y - t * h - t * 0.045, t * 0.014, t * 0.04, '#2a1c10');
}

function jarBody(canvas: SkCanvas, x: number, y: number, t: number) {
  shadow(canvas, x, y + t * 0.28, t * 0.5);
  O(canvas, x - t * 0.2, y - t * 0.2, t * 0.4, t * 0.5, '#a4521f');
  O(canvas, x - t * 0.14, y - t * 0.17, t * 0.12, t * 0.3, '#d88a45', 0.65);
  R(canvas, x - t * 0.07, y - t * 0.32, t * 0.14, t * 0.14, '#7e3d16');
  O(canvas, x - t * 0.09, y - t * 0.36, t * 0.18, t * 0.07, '#c8a060');
  // handles and a painted band
  O(canvas, x - t * 0.26, y - t * 0.22, t * 0.1, t * 0.18, '#8c4418', 0.95);
  O(canvas, x + t * 0.16, y - t * 0.22, t * 0.1, t * 0.18, '#8c4418', 0.95);
  R(canvas, x - t * 0.19, y - t * 0.02, t * 0.38, t * 0.035, '#2c3f6a', 0.85);
}

/** A carried or lying source. Unlit; the flame is drawn separately where the source burns. */
export function drawItemBody(canvas: SkCanvas, kind: ItemKind, x: number, y: number, t: number, held = false) {
  shadowOn = !held;
  switch (kind) {
    case 'smallTorch':
    case 'torch':
    case 'bigTorch':
      shadow(canvas, x, y + t * 0.1, t * 0.4);
      torchBody(canvas, x, y + t * 0.06, t, kind, false);
      break;
    case 'lamp':
      lampBody(canvas, x, y + t * 0.12, t);
      break;
    case 'candle':
      candleBody(canvas, x, y + t * 0.16, t);
      break;
    case 'oilJar':
      jarBody(canvas, x, y, t);
      break;
  }
  shadowOn = true;
}

/** A faint specular glint so an unlit item can be found in dim light. */
export function drawGlint(canvas: SkCanvas, x: number, y: number, t: number, time: number) {
  const a = 0.35 + 0.35 * Math.sin(time * 3.1 + x * 0.05);
  const r = t * 0.1;
  canvas.drawCircle(x - t * 0.14, y - t * 0.22, r, fill(rgba('#fff4d0', a * 0.4)));
  canvas.drawCircle(x - t * 0.14, y - t * 0.22, r * 0.4, fill(rgba('#ffffff', a)));
}

/** Where the flame of a lying/carried item sits relative to its tile centre (tile units). */
export function flameAnchor(kind: ItemKind): { dx: number; dy: number } {
  switch (kind) {
    case 'smallTorch':
      return { dx: -0.17, dy: -0.52 };
    case 'torch':
      return { dx: -0.22, dy: -0.66 };
    case 'bigTorch':
      return { dx: -0.25, dy: -0.78 };
    case 'lamp':
      return { dx: 0.25, dy: 0.0 };
    case 'candle':
      return { dx: 0, dy: -0.18 };
    default:
      return { dx: 0, dy: 0 };
  }
}

/** The body of a fixture. Sconces sit on the wall face above their tile (y = tile top). */
export function drawFixtureBody(canvas: SkCanvas, kind: FixtureKind, x: number, y: number, t: number, lit: boolean) {
  switch (kind) {
    case 'sconce': {
      // bronze bracket on the wall face, an unlit torch in it; soot above once burning
      const wy = y - t * 0.32;
      if (lit) {
        O(canvas, x - t * 0.16, wy - t * 0.75, t * 0.32, t * 0.6, '#000000', 0.16);
        O(canvas, x - t * 0.1, wy - t * 0.6, t * 0.2, t * 0.42, '#000000', 0.22);
      }
      R(canvas, x - t * 0.03, wy - t * 0.02, t * 0.06, t * 0.16, '#7a5a2a');
      O(canvas, x - t * 0.12, wy + t * 0.04, t * 0.24, t * 0.09, '#9a7433');
      R(canvas, x - t * 0.045, wy - t * 0.28, t * 0.09, t * 0.32, '#7a5a30');
      O(canvas, x - t * 0.08, wy - t * 0.4, t * 0.16, t * 0.2, lit ? '#2a1a0a' : '#c9b78a');
      break;
    }
    case 'brazier': {
      shadow(canvas, x, y + t * 0.36, t * 0.7);
      // tripod legs, bowl, coals
      canvas.drawLine(x - t * 0.18, y + t * 0.02, x - t * 0.28, y + t * 0.38, stroke(rgba('#6d5428'), t * 0.05));
      canvas.drawLine(x + t * 0.18, y + t * 0.02, x + t * 0.28, y + t * 0.38, stroke(rgba('#6d5428'), t * 0.05));
      canvas.drawLine(x, y + t * 0.04, x, y + t * 0.4, stroke(rgba('#5a4420'), t * 0.05));
      O(canvas, x - t * 0.34, y - t * 0.2, t * 0.68, t * 0.3, '#8c7440');
      O(canvas, x - t * 0.3, y - t * 0.2, t * 0.6, t * 0.18, lit ? '#e0561e' : '#3a2f1c');
      R(canvas, x - t * 0.35, y - t * 0.08, t * 0.7, t * 0.03, '#b89a52', 0.7);
      break;
    }
    case 'shrineCandles': {
      O(canvas, x - t * 0.28, y + t * 0.1, t * 0.56, t * 0.14, '#6a5a44');
      candleBody(canvas, x - t * 0.15, y + t * 0.2, t, 0.2);
      candleBody(canvas, x + t * 0.03, y + t * 0.16, t, 0.3);
      candleBody(canvas, x + t * 0.18, y + t * 0.21, t, 0.16);
      break;
    }
  }
}

/** Flame anchors of a lit fixture, in tile units from the tile centre. */
export function fixtureFlames(kind: FixtureKind): Array<[number, number, number]> {
  switch (kind) {
    case 'sconce':
      return [[0, -0.68, 0.34]];
    case 'brazier':
      return [[0, -0.1, 0.5]];
    case 'shrineCandles':
      return [
        [-0.15, 0.0, 0.2],
        [0.03, -0.14, 0.24],
        [0.18, 0.05, 0.18],
      ];
  }
}

export const styleOf = (kind: LightKind) => LIGHT_STYLE[kind];

function stroke(color: ReturnType<typeof rgba>, width: number) {
  const p = fill(color);
  p.setStyle(PaintStyle.Stroke);
  p.setStrokeWidth(width);
  return p;
}
