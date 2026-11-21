import { PaintStyle, Skia, StrokeCap, TileMode, type SkCanvas, type SkPath, type SkShader } from '@shopify/react-native-skia';

import { EXIT_OPEN } from '../core/escape';
import type { GameState } from '../core/game';
import { hash01, rgba } from './art';
import { softGlow } from './drawItems';
import { LIGHT_STYLE, flicker } from './lightStyle';
import type { FloorTheme } from './themes';

/**
 * The escape (plan 04), drawn per frame: the Golden Scarab on its alabaster plinth (and the empty
 * plinth after you take it), the false door grinding open with dust and the shaft mouth behind it,
 * the Scarab's brief pointer (gold motes drifting towards the door), and the smoke of a snuffed
 * flame. The closed door itself is baked into the floor art. Tidy vector art; tasks 10-13 swap it.
 */

const paint = Skia.Paint();
paint.setAntiAlias(true);

/** Seconds the Scarab points the way after you lift it. */
export const POINTER_SECONDS = 5;
export const WISP_SECONDS = 1.5;

let wingPath: SkPath | null = null;
let headPath: SkPath | null = null;
let wingShader: SkShader | null = null;
let exitShader: SkShader | null = null;

function wings(): SkPath {
  wingPath ??= Skia.PathBuilder.Make()
    .moveTo(0, -0.12)
    .cubicTo(0.2, -0.12, 0.22, 0.1, 0, 0.14)
    .cubicTo(-0.22, 0.1, -0.2, -0.12, 0, -0.12)
    .close()
    .build();
  return wingPath;
}
function head(): SkPath {
  headPath ??= Skia.PathBuilder.Make()
    .moveTo(-0.1, -0.12)
    .quadTo(-0.1, -0.22, 0, -0.23)
    .quadTo(0.1, -0.22, 0.1, -0.12)
    .close()
    .build();
  return headPath;
}

function stroke(canvas: SkCanvas, x0: number, y0: number, x1: number, y1: number, w: number, color: Float32Array) {
  paint.setStyle(PaintStyle.Stroke);
  paint.setStrokeCap(StrokeCap.Round);
  paint.setStrokeWidth(w);
  paint.setShader(null);
  paint.setColor(color);
  canvas.drawLine(x0, y0, x1, y1, paint);
}

/**
 * The plinth in the burial chamber with the Scarab on it. `taken`: the empty plinth with a faint ring
 * of dust where it lay. (x, y) is the tile centre in px, `t` px per tile.
 */
export function drawScarab(canvas: SkCanvas, x: number, y: number, t: number, taken: boolean, time: number) {
  canvas.save();
  canvas.translate(x, y + 0.08 * t);
  canvas.scale(t, t);
  // contact shadow and the low plinth: a rounded block of alabaster
  paint.setStyle(PaintStyle.Fill);
  paint.setShader(null);
  paint.setColor(rgba('#000000', 0.4));
  canvas.drawOval({ x: -0.36, y: 0.1, width: 0.72, height: 0.2 }, paint);
  paint.setColor(rgba('#b8ad96'));
  canvas.drawRRect({ rect: { x: -0.3, y: 0.02, width: 0.6, height: 0.2 }, rx: 0.05, ry: 0.05 }, paint);
  paint.setColor(rgba('#e6dec9'));
  canvas.drawOval({ x: -0.3, y: -0.07, width: 0.6, height: 0.2 }, paint);
  paint.setColor(rgba('#cfc5ad'));
  canvas.drawOval({ x: -0.25, y: -0.04, width: 0.5, height: 0.14 }, paint);
  if (taken) {
    paint.setStyle(PaintStyle.Stroke);
    paint.setStrokeWidth(0.012);
    paint.setColor(rgba('#8c8268', 0.55));
    canvas.drawOval({ x: -0.14, y: -0.02, width: 0.28, height: 0.1 }, paint);
    canvas.restore();
    return;
  }
  // the scarab: domed wing cases with a centre seam, a head shield, six fine legs, a lapis inlay line
  canvas.translate(0, -0.03);
  canvas.scale(1.3, 1.15);
  for (const side of [-1, 1])
    for (let k = 0; k < 3; k++) {
      const ly = -0.06 + k * 0.07;
      stroke(canvas, side * 0.16, ly, side * 0.27, ly + (k - 1) * 0.04 + 0.03, 0.014, rgba('#8a6420'));
    }
  wingShader ??= Skia.Shader.MakeLinearGradient({ x: -0.2, y: -0.15 }, { x: 0.2, y: 0.15 }, [rgba('#fff0b0'), rgba('#e1ad3a'), rgba('#9a6c1c')], [0, 0.45, 1], TileMode.Clamp);
  paint.setStyle(PaintStyle.Fill);
  paint.setShader(wingShader);
  paint.setColor(rgba('#ffffff'));
  canvas.drawPath(wings(), paint);
  paint.setShader(null);
  paint.setColor(rgba('#d9a233'));
  canvas.drawPath(head(), paint);
  stroke(canvas, 0, -0.12, 0, 0.14, 0.012, rgba('#6e4a10', 0.8));
  stroke(canvas, -0.15, -0.0, 0.15, -0.0, 0.02, rgba('#2f5fa8', 0.85));
  stroke(canvas, -0.06, -0.19, 0.06, -0.19, 0.01, rgba('#6e4a10', 0.6));
  // a slow glint
  const g = Math.max(0, Math.sin(time * 1.7));
  if (g > 0.01) softGlow(canvas, -0.07, -0.07, 0.1 + 0.08 * g, 0.55 * g, '#fff6cf');
  canvas.restore();
}

/** A small gold glint in the free hand while you carry the Scarab. */
export function drawCarriedScarab(canvas: SkCanvas, x: number, y: number, t: number, time: number) {
  softGlow(canvas, x, y, t * 0.13 * (1 + 0.15 * Math.sin(time * 4)), 0.7, '#ffd36a');
  paint.setStyle(PaintStyle.Fill);
  paint.setShader(null);
  paint.setColor(rgba('#f0bd48'));
  canvas.drawOval({ x: x - t * 0.045, y: y - t * 0.06, width: t * 0.09, height: t * 0.12 }, paint);
}

/**
 * The false door opening: from the moment the Scarab is lifted the slab sinks for EXIT_OPEN seconds with
 * dust; once open, a black shaft mouth with a cool draught of daylight. Inside the masked layer, so it
 * shows only where the door is lit.
 */
export function drawExit(canvas: SkCanvas, s: GameState, theme: FloorTheme, t: number, time: number) {
  const e = s.escape;
  if (!e || !e.taken || s.floor.exit < 0) return;
  const { size } = s.floor;
  const x = (s.floor.exit % size) * t;
  const y = Math.floor(s.floor.exit / size) * t;
  const capH = 0.45;
  if (!e.open) {
    const p = Math.min(1, Math.max(0, 1 - e.openIn / EXIT_OPEN));
    // the slab sinks into the floor: the dark of the recess grows from the top of the slab
    const sx = x + t * 0.31;
    const sw = t * 0.38;
    const top = y + t * (capH + 0.55 * 0.27);
    const h = t * 0.55 * 0.73;
    paint.setStyle(PaintStyle.Fill);
    paint.setShader(null);
    paint.setColor(rgba('#070605', 0.95));
    canvas.drawRect({ x: sx, y: top, width: sw, height: h * p }, paint);
    // dust: grey puffs spilling out along the foot of the door
    for (let k = 0; k < 7; k++) {
      const u = (p * 1.2 + hash01(k * 2.9)) % 1;
      paint.setColor(rgba('#bfb293', 0.5 * (1 - u) * Math.min(1, p * 4)));
      canvas.drawCircle(x + t * (0.25 + 0.5 * hash01(k)) + (hash01(k + 4) - 0.5) * t * 0.2 * u, y + t * (0.98 - 0.25 * u), t * (0.04 + 0.05 * u), paint);
    }
    return;
  }
  const age = Math.max(0, e.t - EXIT_OPEN);
  // the shaft mouth: full tile, dark at the foot, cool light further up the shaft
  exitShader ??= Skia.Shader.MakeLinearGradient({ x: 0, y: 0 }, { x: 0, y: 1 }, [rgba('#dfe7f2', 0.5), rgba('#2a2f38', 0.9), rgba('#050505')], [0, 0.45, 1], TileMode.Clamp);
  paint.setStyle(PaintStyle.Fill);
  paint.setShader(exitShader);
  paint.setColor(rgba('#ffffff'));
  canvas.save();
  canvas.translate(x, y);
  canvas.scale(t, t);
  canvas.drawRect({ x: 0.06, y: 0, width: 0.88, height: 1 }, paint);
  canvas.restore();
  paint.setShader(null);
  // jambs of stone either side
  paint.setColor(rgba(theme.faceTop, 1, 0.8));
  canvas.drawRect({ x, y, width: t * 0.07, height: t }, paint);
  paint.setColor(rgba(theme.faceBottom, 1, 0.9));
  canvas.drawRect({ x: x + t * 0.93, y, width: t * 0.07, height: t }, paint);
  // a draught: drifting haze of daylight and dust motes
  const st = LIGHT_STYLE.daylight;
  softGlow(canvas, x + t * 0.5, y + t * 0.35, t * 1.4 * flicker(st, time), 0.5 * Math.min(1, age * 2 + 0.3), st.color);
  for (let k = 0; k < 6; k++) {
    const u = (time * 0.35 + hash01(k * 5.1)) % 1;
    paint.setColor(rgba('#f2f5fa', 0.5 * Math.sin(u * Math.PI)));
    canvas.drawCircle(x + t * (0.25 + 0.5 * hash01(k)) + Math.sin(time * 1.3 + k) * t * 0.04, y + t * (0.9 - 0.8 * u), t * 0.018, paint);
  }
}

/** The Scarab's power: gold motes drift from you towards the false door for a few seconds. Emissive: over the dark. */
export function drawPointer(canvas: SkCanvas, s: GameState, px: number, py: number, t: number, time: number) {
  const e = s.escape;
  if (!e || !e.taken || e.t > POINTER_SECONDS || s.floor.exit < 0) return;
  const { size } = s.floor;
  const ex = ((s.floor.exit % size) + 0.5) * t;
  const ey = (Math.floor(s.floor.exit / size) + 0.5) * t;
  const dx = ex - px;
  const dy = ey - py;
  const len = Math.hypot(dx, dy);
  if (len < t * 1.2) return;
  const ux = dx / len;
  const uy = dy / len;
  const fade = Math.min(1, e.t / 0.4) * Math.min(1, (POINTER_SECONDS - e.t) / 1.2);
  const reach = Math.min(len - t * 0.5, t * 5.5);
  paint.setStyle(PaintStyle.Fill);
  paint.setShader(null);
  for (let k = 0; k < 16; k++) {
    const u = (time * 0.5 + k / 16) % 1;
    const d = t * 0.7 + u * reach;
    const wob = Math.sin(time * 2.4 + k * 1.9) * t * 0.12;
    const mx = px + ux * d - uy * wob;
    const my = py + uy * d + ux * wob;
    const a = fade * Math.sin(u * Math.PI);
    softGlow(canvas, mx, my, t * 0.12, 0.55 * a, '#ffcf5a');
    paint.setColor(rgba('#fff3c4', 0.9 * a));
    canvas.drawCircle(mx, my, t * 0.018, paint);
  }
}

/** Smoke from a flame the guardian put out: two grey curves drifting up for WISP_SECONDS. */
export function drawWisp(canvas: SkCanvas, x: number, y: number, t: number, age: number, seed: number) {
  if (age < 0 || age > WISP_SECONDS) return;
  const u = age / WISP_SECONDS;
  paint.setStyle(PaintStyle.Stroke);
  paint.setStrokeCap(StrokeCap.Round);
  paint.setStrokeWidth(t * 0.035 * (1 - u * 0.5));
  paint.setShader(null);
  for (let k = 0; k < 2; k++) {
    const sway = (k ? 1 : -1) * (0.05 + 0.1 * u);
    const path = Skia.PathBuilder.Make()
      .moveTo(x + (k - 0.5) * t * 0.04, y)
      .cubicTo(x + sway * t, y - t * 0.2 * u - t * 0.05, x - sway * t, y - t * 0.4 * u - t * 0.1, x + Math.sin(seed + k) * t * 0.1 * u, y - t * (0.15 + 0.5 * u))
      .build();
    paint.setColor(rgba('#9a958c', 0.55 * (1 - u)));
    canvas.drawPath(path, paint);
  }
}
