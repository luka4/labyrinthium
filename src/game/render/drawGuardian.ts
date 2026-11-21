import { ClipOp, PaintStyle, Skia, StrokeCap, TileMode, type SkCanvas, type SkPath, type SkShader } from '@shopify/react-native-skia';

import { DIRS } from '../core/floor';
import type { GameState } from '../core/game';
import { RISE, SENTINEL_RISE } from '../core/guardian';
import { MEMORY_STEPS } from '../core/memory';
import { hash01, rgba } from './art';
import type { FloorTheme } from './themes';

/**
 * The Keeper (plan 04): a fictional mummified priest-guardian in resin-dark linen and a gilded
 * cartonnage mask under a striped wig. Tidy layered vector art in tile units (feet at the origin, about
 * 1.15 tiles tall and 0.5 wide) behind `drawGuardian`; tasks 10-13 swap it for the real art. It is drawn
 * inside the masked board layer, only when its tile is lit now, so it is seen by light alone. It carries no
 * light and no glowing eyes. Paths and gradients are cached; nothing is allocated per frame beyond that.
 */

const paint = Skia.Paint();
paint.setAntiAlias(true);

let bodyPath: SkPath | null = null;
let wigPath: SkPath | null = null;
let bandPath: SkPath | null = null;
let bandLight: SkPath | null = null;
const shaders = new WeakMap<FloorTheme, { body: SkShader; face: SkShader }>();

const BODY_TOP = -0.7;

function body(): SkPath {
  bodyPath ??= Skia.PathBuilder.Make()
    .moveTo(-0.17, 0)
    .cubicTo(-0.21, -0.2, -0.25, -0.42, -0.2, -0.6)
    .quadTo(-0.18, BODY_TOP - 0.02, 0, BODY_TOP - 0.04)
    .quadTo(0.18, BODY_TOP - 0.02, 0.2, -0.6)
    .cubicTo(0.25, -0.42, 0.21, -0.2, 0.17, 0)
    .close()
    .build();
  return bodyPath;
}

/** The striped wig: a crown and two lappets that frame the face. */
function wig(): SkPath {
  wigPath ??= Skia.PathBuilder.Make()
    .moveTo(-0.17, -0.7)
    .lineTo(-0.155, -0.95)
    .cubicTo(-0.15, -1.14, 0.15, -1.14, 0.155, -0.95)
    .lineTo(0.17, -0.7)
    .lineTo(0.095, -0.7)
    .lineTo(0.09, -0.84)
    .lineTo(-0.09, -0.84)
    .lineTo(-0.095, -0.7)
    .close()
    .build();
  return wigPath;
}

/** Wrapping bands across the body at alternating slopes. */
function bands(): { dark: SkPath; light: SkPath } {
  if (!bandPath || !bandLight) {
    const dark = Skia.PathBuilder.Make();
    const light = Skia.PathBuilder.Make();
    const n = 9;
    for (let k = 0; k < n; k++) {
      const y = -0.62 + (k * 0.58) / (n - 1);
      const half = 0.155 + 0.05 * (1 - (k / (n - 1)) * 0.7) * (k < 2 ? 0.6 : 1);
      const s = k % 2 ? 1 : -1;
      dark.moveTo(-half, y + s * 0.035).lineTo(half, y - s * 0.035);
      light.moveTo(-half, y + s * 0.035 + 0.014).lineTo(half, y - s * 0.035 + 0.014);
    }
    bandPath = dark.build();
    bandLight = light.build();
  }
  return { dark: bandPath, light: bandLight };
}

function shadersFor(theme: FloorTheme) {
  let sh = shaders.get(theme);
  if (!sh) {
    sh = {
      body: Skia.Shader.MakeLinearGradient({ x: -0.22, y: 0 }, { x: 0.22, y: 0 }, [rgba(theme.linenDark), rgba(theme.linen), rgba(theme.linenLight)], [0, 0.55, 1], TileMode.Clamp),
      face: Skia.Shader.MakeLinearGradient({ x: 0, y: -1 }, { x: 0, y: -0.78 }, [rgba(theme.maskLight), rgba(theme.mask)], null, TileMode.Clamp),
    };
    shaders.set(theme, sh);
  }
  return sh;
}

function fillPath(canvas: SkCanvas, path: SkPath, color: Float32Array, shader: SkShader | null = null) {
  paint.setStyle(PaintStyle.Fill);
  paint.setShader(shader);
  paint.setColor(color);
  canvas.drawPath(path, paint);
  paint.setShader(null);
}

function line(canvas: SkCanvas, x0: number, y0: number, x1: number, y1: number, w: number, color: Float32Array) {
  paint.setStyle(PaintStyle.Stroke);
  paint.setStrokeCap(StrokeCap.Round);
  paint.setStrokeWidth(w);
  paint.setShader(null);
  paint.setColor(color);
  canvas.drawLine(x0, y0, x1, y1, paint);
}

/** Interpolated position of the guardian in tile units (the centre of its tile at rest). */
function place(s: GameState): { x: number; y: number } {
  const g = s.guardian!;
  const { size } = s.floor;
  const walks = g.mode === 'patrol' || g.mode === 'investigate' || g.mode === 'hunt' || g.mode === 'recoil';
  const u = walks && g.stepDur > 0 && g.prev !== g.pos ? Math.min(1, Math.max(0, 1 - g.cooldown / g.stepDur)) : 1;
  const px = g.prev % size;
  const py = Math.floor(g.prev / size);
  const tx = g.pos % size;
  const ty = Math.floor(g.pos / size);
  return { x: px + (tx - px) * u + 0.5, y: py + (ty - py) * u + 0.5 };
}

/**
 * The guardian, when it is on a tile you see now (call inside the masked layer, after the sand).
 * `t` = px per tile; the canvas is in world px.
 */
export function drawGuardian(canvas: SkCanvas, s: GameState, theme: FloorTheme, t: number, time: number) {
  const g = s.guardian;
  if (!g || g.pos < 0 || g.mode === 'arriving' || g.mode === 'gone' || s.light[g.pos] <= 0) return;
  const plan = s.floor.guardian;
  const { x, y } = place(s);
  const sh = shadersFor(theme);
  const [fx, fy] = DIRS[g.facing];
  const dormant = g.mode === 'dormant';
  const rise = plan?.sentinel ? SENTINEL_RISE : RISE;
  const wakeP = g.mode === 'waking' ? 1 - Math.max(0, g.timer) / rise : dormant ? 0 : 1;
  const hunting = g.mode === 'hunt';
  const recoil = g.mode === 'recoil';
  const walking = g.mode === 'patrol' || g.mode === 'investigate' || hunting || recoil;
  const phase = walking ? (1 - Math.min(1, Math.max(0, g.cooldown / Math.max(0.01, g.stepDur)))) * Math.PI : 0;
  const bob = walking ? -0.03 * Math.sin(phase) : 0;
  const sway = walking ? Math.sin(time * 6 + g.pos) * 0.05 : dormant ? 0 : Math.sin(time * 1.6) * 0.012;
  const lean = hunting ? 0.1 : recoil ? -0.14 : 0;

  canvas.save();
  canvas.translate(x * t, (y + 0.2) * t);
  canvas.scale(t * (1 + 0.03 * wakeP), t * (1 + 0.03 * wakeP));
  // contact shadow
  paint.setStyle(PaintStyle.Fill);
  paint.setShader(null);
  paint.setColor(rgba('#000000', 0.45));
  canvas.drawOval({ x: -0.23, y: -0.05, width: 0.46, height: 0.14 }, paint);
  // lean towards (or away from) the direction it faces
  canvas.translate(0, bob);
  canvas.rotate((lean * fx + sway) * (180 / Math.PI), 0, 0);
  if (fy !== 0) canvas.scale(1, 1 + lean * fy * 0.2);

  // loose strips of linen at the hem and the elbows
  const flutter = dormant ? 0 : Math.sin(time * 3.1 + g.pos * 0.7);
  line(canvas, -0.1, -0.02, -0.14 + flutter * 0.03, 0.09, 0.025, rgba(theme.linenLight, 0.85));
  line(canvas, 0.08, -0.02, 0.13 - flutter * 0.03, 0.08, 0.022, rgba(theme.linenLight, 0.8));

  // wrapped body
  fillPath(canvas, body(), rgba('#ffffff'), sh.body);
  const b = bands();
  paint.setStyle(PaintStyle.Stroke);
  paint.setStrokeWidth(0.016);
  paint.setColor(rgba(theme.linenDark, 0.6));
  canvas.drawPath(b.dark, paint);
  paint.setStrokeWidth(0.01);
  paint.setColor(rgba(theme.linenLight, 0.28));
  canvas.drawPath(b.light, paint);

  // arms: crossed on the chest while dormant, uncrossing as it wakes, low when walking, forward when hunting
  const sx = (side: number) => side * 0.19;
  const reach = hunting ? 0.24 : walking ? 0.05 : 0;
  for (const side of [-1, 1]) {
    const crossX = -side * 0.1;
    const crossY = -0.45;
    const lowX = sx(side) + side * 0.035 + fx * reach * 0.6;
    const lowY = -0.3 + fy * reach * 0.5 - (hunting ? 0.2 : 0) + (walking ? Math.sin(phase + side) * 0.02 : 0);
    const e = 1 - wakeP;
    const ex = crossX * e + lowX * (1 - e);
    const ey = crossY * e + lowY * (1 - e);
    line(canvas, sx(side), -0.62, ex, ey, 0.075, rgba(theme.linen));
    line(canvas, sx(side), -0.62, ex, ey, 0.03, rgba(theme.linenLight, 0.35));
    line(canvas, (sx(side) + ex) / 2 - 0.02, (-0.62 + ey) / 2, (sx(side) + ex) / 2 + 0.02, (-0.62 + ey) / 2, 0.02, rgba(theme.linenDark, 0.7));
  }

  // head: wig behind, mask in front (the back of the wig when it faces north, a profile east or west)
  fillPath(canvas, wig(), rgba(theme.lapis ?? '#2b4a8a'));
  canvas.save();
  canvas.clipPath(wig(), ClipOp.Intersect, true);
  for (let k = 0; k < 8; k++) {
    paint.setStyle(PaintStyle.Fill);
    paint.setColor(rgba('#d8b45a', 0.9));
    canvas.drawRect({ x: -0.18, y: -1.13 + k * 0.058, width: 0.36, height: 0.014 }, paint);
  }
  canvas.restore();
  if (g.facing !== 3) {
    const off = fx * 0.03;
    const face = Skia.PathBuilder.Make().addOval({ x: -0.088 + off, y: -1.0, width: 0.176, height: 0.23 }).build();
    fillPath(canvas, face, rgba('#ffffff'), sh.face);
    paint.setStyle(PaintStyle.Stroke);
    paint.setStrokeWidth(0.008);
    paint.setColor(rgba('#4a3412', 0.7));
    canvas.drawPath(face, paint);
    // almond eyes and brows (no glow), a small mouth
    const eyes = fx === 0 ? [-0.036, 0.036] : [fx * 0.05];
    for (const ex of eyes) {
      line(canvas, ex - 0.022 + off, -0.905, ex + 0.022 + off, -0.905, 0.016, rgba('#1c140a', 0.95));
      line(canvas, ex - 0.026 + off, -0.935, ex + 0.026 + off, -0.945, 0.008, rgba('#3b2a10', 0.8));
    }
    line(canvas, -0.016 + off, -0.82, 0.016 + off, -0.82, 0.008, rgba('#3b2a10', 0.7));
  }
  if (g.facing === 3) {
    paint.setStyle(PaintStyle.Stroke);
    paint.setStrokeWidth(0.01);
    paint.setColor(rgba('#d8b45a', 0.5));
    canvas.drawLine(0, -1.12, 0, -0.72, paint);
  }

  // dust film while it is a statue, falling dust as it wakes
  if (wakeP < 1) {
    paint.setStyle(PaintStyle.Fill);
    paint.setColor(rgba('#cdbf9d', 0.3 * (1 - wakeP)));
    canvas.drawPath(body(), paint);
    canvas.drawOval({ x: -0.15, y: -1.1, width: 0.3, height: 0.4 }, paint);
    if (g.mode === 'waking') {
      for (let k = 0; k < 9; k++) {
        const u = (time * 0.9 + hash01(k * 3.3)) % 1;
        paint.setColor(rgba('#d8cba6', 0.55 * (1 - u)));
        canvas.drawCircle((hash01(k) - 0.5) * 0.4, -1.0 + u * 1.05, 0.012 + 0.012 * hash01(k + 9), paint);
      }
    }
  }
  canvas.restore();
}

/** A flat silhouette where you last saw it (the memory of a guardian: it never shows where it is now). */
export function drawGuardianGhost(canvas: SkCanvas, s: GameState, t: number) {
  const g = s.guardian;
  if (!g || g.seenPos < 0 || s.trail - g.seenTrail >= MEMORY_STEPS || s.light[g.seenPos] > 0) return;
  const { size } = s.floor;
  const x = (g.seenPos % size) + 0.5;
  const y = Math.floor(g.seenPos / size) + 0.5;
  canvas.save();
  canvas.translate(x * t, (y + 0.2) * t);
  canvas.scale(t, t);
  paint.setStyle(PaintStyle.Fill);
  paint.setShader(null);
  paint.setColor(rgba('#8b8170', 0.7));
  canvas.drawPath(body(), paint);
  canvas.drawCircle(0, -0.9, 0.13, paint);
  canvas.restore();
}
