import { Skia, TileMode, type SkCanvas } from '@shopify/react-native-skia';

import type { GameState } from '../core/game';
import { fill, hash01, rgba, stroke } from './art';
import type { FloorTheme } from './themes';

/**
 * Trap sprites that change while you play (plan 03), drawn inside the masked board layer for the
 * traps in view only. The armed look (granite plate, chips, grooves, seams) is baked into the floor
 * art; this draws over it: a sunk plate, the fallen block, the sealed portcullis, the pour of a
 * sandfall and its trickle, seam dust on a trapdoor, and the slab that tilts open under a fall.
 */
const FACE = 0.55;
const CAP_H = 1 - FACE;

export type TrapFrame = {
  /** seconds, counts only running time */
  time: number;
  /** 0..1 while the trapdoor you stand on tilts open and you drop (status `falling`) */
  fall: number;
};

export function drawTraps(canvas: SkCanvas, s: GameState, theme: FloorTheme, t: number, win: { x0: number; y0: number; x1: number; y1: number }, f: TrapFrame) {
  const { size } = s.floor;
  const traps = s.floor.traps;
  for (let k = 0; k < traps.length; k++) {
    const trap = traps[k];
    const phase = s.trapPhase[k];
    const x = trap.tile % size;
    const y = Math.floor(trap.tile / size);
    const tx = trap.kind === 'portcullis' ? trap.target % size : x;
    const ty = trap.kind === 'portcullis' ? Math.floor(trap.target / size) : y;
    if (x < win.x0 - 1 || x > win.x1 + 1 || y < win.y0 - 1 || y > win.y1 + 1) continue;
    const X = x * t;
    const Y = y * t;
    const lit = s.light[trap.tile] > 0.05;

    if (phase === 0 || phase === 3) {
      // armed: tiny live details of the telltale
      if (phase === 0 && lit && trap.kind === 'sandfall') trickle(canvas, theme, X, Y, t, f.time, trap.tile);
      if (phase === 0 && lit && trap.kind === 'trapdoor') seamDust(canvas, theme, X, Y, t, f.time, trap.tile);
      continue;
    }

    if (phase === 1 || (phase === 2 && trap.kind === 'trapdoor' && s.status !== 'falling')) {
      if (trap.kind === 'trapdoor') {
        if (phase === 1) sunkPlate(canvas, theme, X, Y, t, true);
      } else sunkPlate(canvas, theme, X, Y, t, false);
    }

    if (phase === 2 || phase === 1) {
      if (trap.kind === 'block' && phase === 2) granite(canvas, theme, X, Y, t, trap.tile, false);
      else if (trap.kind === 'portcullis' && phase === 2) {
        // the plate stays sunk, the slab fills the port
        sunkPlate(canvas, theme, X, Y, t, false);
        granite(canvas, theme, tx * t, ty * t, t, trap.target, true);
      } else if (trap.kind === 'sandfall' && phase === 2) pour(canvas, theme, X, Y, t, f.time, s.trapTimer[k], trap.tile);
      else if (trap.kind === 'trapdoor' && phase === 2 && s.status === 'falling') openedSlab(canvas, theme, X, Y, t, f.fall);
    }
  }
}

/** A plate pressed down: darker, a wider gap around it. */
function sunkPlate(canvas: SkCanvas, theme: FloorTheme, X: number, Y: number, t: number, door: boolean) {
  const i = t * (door ? 0.07 : 0.12);
  const rect = { x: X + i, y: Y + i, width: t - i * 2, height: t - i * 2 };
  canvas.drawRect({ x: rect.x - t * 0.025, y: rect.y - t * 0.025, width: rect.width + t * 0.05, height: rect.height + t * 0.05 }, fill(rgba('#000000', 0.7)));
  canvas.drawRect(rect, fill(rgba(door ? theme.cap : theme.granite, 1, 0.62)));
  canvas.drawRect(rect, stroke(rgba('#000000', 0.5), Math.max(1, t * 0.03)));
}

/** A granite block seen like a wall: a lit top, a darker south face, chips and a contact shadow. */
function granite(canvas: SkCanvas, theme: FloorTheme, X: number, Y: number, t: number, seed: number, slab: boolean) {
  const line = Math.max(1, t * 0.045);
  canvas.drawRect({ x: X - t * 0.03, y: Y + t * 0.9, width: t * 1.06, height: t * 0.14 }, fill(rgba('#000000', 0.38)));
  canvas.drawRect({ x: X, y: Y, width: t, height: t * CAP_H }, fill(rgba(theme.graniteEdge, 1, 1.05)));
  const g = Skia.Shader.MakeLinearGradient({ x: 0, y: Y + t * CAP_H }, { x: 0, y: Y + t }, [rgba(theme.granite, 1, 1.15), rgba(theme.granite, 1, 0.6)], null, TileMode.Clamp);
  const p = Skia.Paint();
  p.setShader(g);
  canvas.drawRect({ x: X, y: Y + t * CAP_H, width: t, height: t * FACE }, p);
  const joints = Skia.PathBuilder.Make();
  joints.moveTo(X, Y + t * CAP_H).lineTo(X + t, Y + t * CAP_H);
  if (slab) {
    // a portcullis: the slab's lifting boss and the grooves it runs in
    joints.moveTo(X + t * 0.5, Y + t * 0.1).lineTo(X + t * 0.5, Y + t * 0.9);
    canvas.drawCircle(X + t * 0.5, Y + t * 0.5, t * 0.07, fill(rgba(theme.graniteEdge)));
  } else {
    joints.moveTo(X + t * (0.35 + 0.3 * hash01(seed)), Y + t * CAP_H).lineTo(X + t * (0.35 + 0.3 * hash01(seed)), Y + t);
    for (let k = 0; k < 4; k++) {
      const cx = X + t * (0.1 + 0.8 * hash01(seed * 3 + k));
      const cy = Y + t * (0.88 + 0.1 * hash01(seed * 5 + k));
      canvas.drawCircle(cx, cy, t * (0.02 + 0.03 * hash01(seed * 7 + k)), fill(rgba(theme.cap, 1, 0.9)));
    }
  }
  canvas.drawPath(joints.build(), stroke(rgba('#000000', 0.45), line));
  canvas.drawRect({ x: X, y: Y, width: t, height: t }, stroke(rgba(theme.capEdge, 0.4), line * 0.7));
}

/** A thin trickle of sand from the cracked ceiling over a sandfall plate. */
function trickle(canvas: SkCanvas, theme: FloorTheme, X: number, Y: number, t: number, time: number, seed: number) {
  const cx = X + t * 0.5;
  for (let k = 0; k < 3; k++) {
    const u = (time * 1.1 + hash01(seed + k * 3) + k / 3) % 1;
    canvas.drawRect({ x: cx + (k - 1) * t * 0.06 - 0.5, y: Y + t * 0.05 + u * t * 0.45, width: Math.max(1, t * 0.02), height: t * 0.1 }, fill(rgba(theme.sand, 0.9 * (1 - u))));
  }
}

/** Fine dust drifting out of the seam of a trapdoor. */
function seamDust(canvas: SkCanvas, theme: FloorTheme, X: number, Y: number, t: number, time: number, seed: number) {
  for (let k = 0; k < 3; k++) {
    const u = (time * 0.35 + hash01(seed * 2 + k)) % 1;
    const gx = X + t * (0.2 + 0.6 * hash01(seed * 3 + k)) + Math.sin(time * 1.7 + k) * t * 0.04;
    const gy = Y + t * (0.85 - 0.5 * u);
    canvas.drawCircle(gx, gy, Math.max(0.8, t * 0.015), fill(rgba(theme.sand, 0.7 * (1 - u))));
  }
}

/** The pour of a fired sandfall: a column of sand for about 3 s over the plate. */
function pour(canvas: SkCanvas, theme: FloorTheme, X: number, Y: number, t: number, time: number, since: number, seed: number) {
  if (since > 3.2) return;
  const fade = since < 2.6 ? 1 : Math.max(0, (3.2 - since) / 0.6);
  const cx = X + t * 0.5;
  const w = t * 0.3;
  const g = Skia.Shader.MakeLinearGradient({ x: 0, y: Y - t * 0.6 }, { x: 0, y: Y + t * 0.5 }, [rgba(theme.sand, 0), rgba(theme.sand, 0.95 * fade)], null, TileMode.Clamp);
  const p = Skia.Paint();
  p.setShader(g);
  canvas.drawRect({ x: cx - w / 2, y: Y - t * 0.6, width: w, height: t * 1.1 }, p);
  for (let k = 0; k < 4; k++) {
    const u = (time * 1.8 + hash01(seed + k) + k / 4) % 1;
    canvas.drawRect({ x: cx - w / 2 + hash01(seed * 3 + k) * w * 0.9, y: Y - t * 0.5 + u * t * 0.9, width: Math.max(1, t * 0.035), height: t * 0.22 }, fill(rgba('#fff2cf', 0.6 * fade * (1 - u))));
  }
}

/** The trapdoor slab swinging down into the dark: seen from above it narrows and the pit opens. */
function openedSlab(canvas: SkCanvas, theme: FloorTheme, X: number, Y: number, t: number, u: number) {
  const i = t * 0.07;
  canvas.drawRect({ x: X + i, y: Y + i, width: t - i * 2, height: t - i * 2 }, fill(rgba('#000000', 0.9)));
  const h = (t - i * 2) * (1 - 0.8 * u);
  canvas.drawRect({ x: X + i, y: Y + i, width: t - i * 2, height: h }, fill(rgba(theme.cap, 1, 0.7 - 0.3 * u)));
  canvas.drawRect({ x: X + i, y: Y + i + h - Math.max(1, t * 0.04), width: t - i * 2, height: Math.max(1, t * 0.04) }, fill(rgba('#000000', 0.6)));
}
