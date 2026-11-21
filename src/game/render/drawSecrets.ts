import { ClipOp, PaintStyle, Skia, TileMode, type SkCanvas } from '@shopify/react-native-skia';

import type { GameState } from '../core/game';
import { BREAK_SECONDS, SEAL, type Secret, type TreasureKind } from '../core/secrets';
import { fill, glow, hash01, rgba, stroke } from './art';
import type { FloorTheme } from './themes';

/**
 * Secret chambers as art (plan 05). Baked (floorArt.ts): the plastered doorway on the south face of
 * the seal tile, the carved chamber with its rough-cut walls, unpaved bedrock and, on story floors,
 * the painted wall. Per frame (inside the masked board layer): the first push's crack, the break,
 * the grave good and the motes when you take it. Tidy vector art behind plain functions, ready for
 * the art phase to swap.
 */
const FACE = 0.55;
const CAP_H = 1 - FACE;

type Rect = { x: number; y: number; width: number; height: number };
const R = (x: number, y: number, w: number, h: number): Rect => ({ x, y, width: w, height: h });

/** The doorway panel on the south face of the seal tile: x, y in tiles; u = px per tile. */
function panelRect(x: number, y: number, u: number) {
  const fy = (y + CAP_H) * u;
  const fh = FACE * u;
  return { x: x * u + u * 0.13, y: fy + fh * 0.1, w: u * 0.74, h: fh * 0.9, fy, fh };
}

/** A hairline crack from (x0, y0) down to (x1, y1) with a deterministic zigzag. */
function crackPath(x0: number, y0: number, x1: number, y1: number, seed: number, jag: number, upTo = 1) {
  const p = Skia.PathBuilder.Make().moveTo(x0, y0);
  const n = 6;
  for (let k = 1; k <= n; k++) {
    const f = (k / n) * upTo;
    const side = (hash01(seed + k * 3.3) - 0.5) * 2 * jag;
    p.lineTo(x0 + (x1 - x0) * f + side, y0 + (y1 - y0) * f);
  }
  return p.build();
}

/**
 * Baked telltale: a doorway closed with smooth gypsum plaster, a little lighter than the masonry,
 * the joints stopping at its irregular edge, hairline cracks, and a loose row of stamped oval seal
 * impressions (abstract, no signs). Never a glow.
 */
export function drawSealedDoor(canvas: SkCanvas, seal: number, size: number, u: number, theme: FloorTheme) {
  const x = seal % size;
  const y = Math.floor(seal / size);
  const seed = x * 31 + y * 17;
  const P = panelRect(x, y, u);
  const line = Math.max(1, u * 0.045);
  // the irregular edge of the plaster, wider than the opening it fills
  const edge = Skia.PathBuilder.Make();
  const pts: Array<[number, number]> = [];
  const nx = 6;
  const ny = 5;
  for (let k = 0; k <= nx; k++) pts.push([P.x + (P.w * k) / nx, P.y + (k === 0 || k === nx ? P.h * 0.08 : 0) + u * 0.02 * hash01(seed + k)]);
  for (let k = 1; k <= ny; k++) pts.push([P.x + P.w + u * 0.015 * hash01(seed + 20 + k), P.y + (P.h * k) / ny]);
  for (let k = nx - 1; k >= 0; k--) pts.push([P.x + (P.w * k) / nx, P.y + P.h + u * 0.01]);
  for (let k = ny - 1; k >= 1; k--) pts.push([P.x - u * 0.015 * hash01(seed + 40 + k), P.y + (P.h * k) / ny]);
  pts.forEach(([px, py], k) => (k ? edge.lineTo(px, py) : edge.moveTo(px, py)));
  edge.close();
  const shape = edge.build();
  // plaster: a faint vertical shading, trowel marks
  const g = Skia.Shader.MakeLinearGradient({ x: 0, y: P.y }, { x: 0, y: P.y + P.h }, [rgba(theme.plaster, 1, 1.04), rgba(theme.plaster, 1, 0.84)], null, TileMode.Clamp);
  canvas.drawPath(shape, fill(rgba('#000000', 0.5)));
  const body = Skia.Paint();
  body.setAntiAlias(true);
  body.setShader(g);
  canvas.save();
  canvas.translate(0, 0);
  canvas.drawPath(shape, body);
  canvas.clipPath(shape, ClipOp.Intersect, true);
  const trowel = Skia.PathBuilder.Make();
  for (let k = 0; k < 4; k++) {
    const ty = P.y + P.h * (0.2 + 0.2 * k + 0.06 * hash01(seed + k));
    trowel.moveTo(P.x + P.w * (0.1 + 0.2 * hash01(seed + 9 + k)), ty).lineTo(P.x + P.w * (0.55 + 0.35 * hash01(seed + 5 + k)), ty + u * 0.01);
  }
  canvas.drawPath(trowel.build(), stroke(rgba('#ffffff', 0.1), line));
  // stamped oval seal impressions in a loose row: a darker bowl with a lit lip; a tiny mark inside
  const count = 3 + Math.floor(hash01(seed * 3) * 3);
  for (let k = 0; k < count; k++) {
    const cx = P.x + P.w * ((k + 0.5) / count) + u * 0.02 * (hash01(seed + 60 + k) - 0.5);
    const cy = P.y + P.h * (0.5 + 0.06 * (hash01(seed + 70 + k) - 0.5));
    const rx = Math.min(u * 0.085, (P.w / count) * 0.38);
    const ry = P.h * 0.15;
    canvas.drawOval(R(cx - rx, cy - ry, rx * 2, ry * 2), fill(rgba('#5a4a33', 0.32)));
    canvas.drawOval(R(cx - rx, cy - ry, rx * 2, ry * 2), stroke(rgba('#ffffff', 0.14), line * 0.8));
    canvas.drawOval(R(cx - rx * 0.78, cy - ry * 0.78 - line * 0.4, rx * 1.56, ry * 1.56), stroke(rgba('#3a2f20', 0.35), line * 0.7));
    canvas.drawRect(R(cx - line * 0.4, cy - ry * 0.4, line * 0.8, ry * 0.8), fill(rgba('#3a2f20', 0.3)));
  }
  // hairline cracks
  const cracks = Skia.PathBuilder.Make();
  for (let k = 0; k < 2 + Math.floor(hash01(seed * 5) * 2); k++) {
    const sx = P.x + P.w * (0.15 + 0.7 * hash01(seed + 80 + k));
    const fromTop = hash01(seed + 90 + k) > 0.4;
    const path = fromTop
      ? crackPath(sx, P.y, sx + u * 0.1 * (hash01(seed + k) - 0.5), P.y + P.h * (0.35 + 0.3 * hash01(seed + 100 + k)), seed + k, u * 0.03)
      : crackPath(sx, P.y + P.h, sx + u * 0.12 * (hash01(seed + k * 2) - 0.5), P.y + P.h * (0.55 - 0.2 * hash01(seed + 110 + k)), seed + k * 2, u * 0.03);
    cracks.addPath(path);
  }
  canvas.drawPath(cracks.build(), stroke(rgba('#2a2116', 0.7), line * 0.7));
  // the shadow of the lintel
  canvas.drawRect(R(P.x, P.y, P.w, line * 2.4), fill(rgba('#000000', 0.32)));
  canvas.restore();
  canvas.drawPath(shape, stroke(rgba('#2a2116', 0.55), line * 0.8));
}

/**
 * Baked, in the carved copy of the floor: unpaved bedrock in the chamber, rubble on the broken
 * sill, and the painted wall (ochre ground, a red ring with a line falling through it, small
 * abstract figures) on the chamber's north face when it holds a story fragment.
 */
export function drawCarvedChambers(canvas: SkCanvas, secrets: readonly Secret[], size: number, u: number, theme: FloorTheme) {
  const line = Math.max(1, u * 0.045);
  for (const sec of secrets) {
    for (const t of sec.tiles) {
      const x = t % size;
      const y = Math.floor(t / size);
      const seed = t * 7 + 3;
      const g = Skia.Shader.MakeLinearGradient({ x: 0, y: y * u }, { x: 0, y: (y + 1) * u }, [rgba(theme.bedrock, 1, 1.08), rgba(theme.bedrock, 1, 0.86)], null, TileMode.Clamp);
      const p = Skia.Paint();
      p.setShader(g);
      canvas.drawRect(R(x * u, y * u, u, u), p);
      // rough-cut: chisel marks and flakes
      const marks = Skia.PathBuilder.Make();
      for (let k = 0; k < 4; k++) {
        const mx = (x + 0.1 + 0.8 * hash01(seed + k)) * u;
        const my = (y + 0.1 + 0.8 * hash01(seed + k * 3 + 1)) * u;
        marks.moveTo(mx, my).lineTo(mx + u * 0.16 * (hash01(seed + k + 9) - 0.3), my + u * 0.05 * (hash01(seed + k + 11) - 0.5));
      }
      canvas.drawPath(marks.build(), stroke(rgba('#000000', 0.28), line * 0.8));
      for (let k = 0; k < 3; k++) canvas.drawCircle((x + hash01(seed + k * 5)) * u, (y + hash01(seed + k * 7 + 2)) * u, Math.max(0.6, u * 0.02), fill(rgba('#d9c9a0', 0.18)));
    }
    // the broken sill: plaster rubble on the doorway tile
    const sx = sec.seal % size;
    const sy = Math.floor(sec.seal / size);
    for (let k = 0; k < 7; k++) {
      const cx = (sx + 0.18 + 0.64 * hash01(sec.seal + k * 4)) * u;
      const cy = (sy + 0.5 + 0.45 * hash01(sec.seal + k * 9 + 1)) * u;
      const r = u * (0.03 + 0.045 * hash01(sec.seal + k * 13));
      const chip = Skia.PathBuilder.Make().moveTo(cx - r, cy + r * 0.5).lineTo(cx - r * 0.2, cy - r).lineTo(cx + r, cy - r * 0.1).lineTo(cx + r * 0.6, cy + r * 0.8).close().build();
      canvas.drawPath(chip, fill(rgba(theme.plaster, 1, 0.95)));
      canvas.drawPath(chip, stroke(rgba('#000000', 0.35), line * 0.6));
    }
    if (sec.fragment >= 0) drawPainting(canvas, sec, size, u, theme);
  }
}

/** The painted wall of a story fragment, on the south face of the rock row above the chamber. */
function drawPainting(canvas: SkCanvas, sec: Secret, size: number, u: number, theme: FloorTheme) {
  void size;
  const { x, y, w } = sec.rect;
  const wallY = y - 1;
  const fy = (wallY + CAP_H) * u;
  const fh = FACE * u;
  const line = Math.max(1, u * 0.045);
  const X = x * u + u * 0.1;
  const W = w * u - u * 0.2;
  const Y = fy + fh * 0.08;
  const H = fh * 0.84;
  const g = Skia.Shader.MakeLinearGradient({ x: 0, y: Y }, { x: 0, y: Y + H }, [rgba(theme.ochre, 1, 1.05), rgba(theme.ochre, 1, 0.78)], null, TileMode.Clamp);
  const p = Skia.Paint();
  p.setShader(g);
  canvas.drawRect(R(X, Y, W, H), p);
  canvas.drawRect(R(X, Y, W, H), stroke(rgba('#2a1c10', 0.6), line));
  // painted border bands
  canvas.drawRect(R(X, Y, W, H * 0.07), fill(rgba('#2f5f7a', 0.75)));
  canvas.drawRect(R(X, Y + H * 0.93, W, H * 0.07), fill(rgba('#2f5f7a', 0.75)));
  // the builders' mark: a red ring with a line falling through it
  const cx = X + W * 0.28;
  const cy = Y + H * 0.46;
  const r = Math.min(H * 0.26, W * 0.16);
  canvas.drawCircle(cx, cy, r, stroke(rgba('#8f2f22', 0.95), line * 2.2));
  const fall = Skia.PathBuilder.Make().moveTo(cx, cy - r * 1.5).lineTo(cx, cy + r * 1.65).build();
  canvas.drawPath(fall, stroke(rgba('#8f2f22', 0.95), line * 1.8));
  // small abstract figures walking towards it: a head, a body, a staff
  for (let k = 0; k < Math.max(2, Math.round(w * 1.6)); k++) {
    const fx = X + W * (0.52 + 0.4 * (k / Math.max(2, Math.round(w * 1.6) - 1 || 1)));
    const fy2 = Y + H * 0.72;
    canvas.drawCircle(fx, fy2 - H * 0.3, H * 0.055, fill(rgba('#1c1209', 0.85)));
    canvas.drawRect(R(fx - H * 0.04, fy2 - H * 0.24, H * 0.08, H * 0.25), fill(rgba('#1c1209', 0.8)));
    canvas.drawRect(R(fx + H * 0.07, fy2 - H * 0.3, line, H * 0.36), fill(rgba('#1c1209', 0.7)));
  }
  canvas.drawRect(R(X, Y + H * 0.88, W, line), fill(rgba('#1c1209', 0.5)));
}

// ---- per frame ----------------------------------------------------------------------------------------

/** Render-only effect clocks the Board keeps: when a secret was knocked and when its good was taken. */
export type SecretFx = { knock: Array<{ k: number; t0: number }>; taken: Array<{ k: number; t0: number }> };

export const KNOCK_FX_SECONDS = 0.4;
export const TAKE_FX_SECONDS = 0.6;

export function drawSecrets(canvas: SkCanvas, s: GameState, theme: FloorTheme, t: number, time: number, win: { x0: number; y0: number; x1: number; y1: number }, fx: SecretFx) {
  const { size, secrets } = s.floor;
  for (let k = 0; k < secrets.length; k++) {
    const sec = secrets[k];
    const phase = s.secretPhase[k];
    const sx = sec.seal % size;
    const sy = Math.floor(sec.seal / size);
    if (sx < win.x0 - 2 || sx > win.x1 + 2 || sy < win.y0 - 3 || sy > win.y1 + 2) continue;
    const P = panelRect(sx, sy, t);
    const line = Math.max(1, t * 0.045);
    if (phase === SEAL.KNOCKED) {
      const e = fx.knock.find((f) => f.k === k);
      const age = e ? time - e.t0 : 99;
      // the push left a fresh crack across the plaster
      const jag = t * 0.04;
      const crack = crackPath(P.x + P.w * 0.55, P.y, P.x + P.w * 0.42, P.y + P.h * 0.75, sec.seal, jag);
      canvas.drawPath(crack, stroke(rgba('#1d160e', 0.85), line));
      if (age < KNOCK_FX_SECONDS) dust(canvas, P.x + P.w * 0.5, P.y + P.h * 0.2, t, age / KNOCK_FX_SECONDS, 6, sec.seal, 1);
    } else if (phase === SEAL.BREAKING) {
      const u = Math.min(1, Math.max(0, 1 - s.secretTimer[k] / BREAK_SECONDS));
      for (let c = 0; c < 4; c++) {
        const x0 = P.x + P.w * (0.2 + 0.6 * hash01(sec.seal + c));
        const path = crackPath(x0, P.y, x0 + (hash01(sec.seal + c * 3) - 0.5) * t * 0.25, P.y + P.h, sec.seal + c, t * 0.05, Math.max(0.15, u));
        canvas.drawPath(path, stroke(rgba('#1d160e', 0.85), line * (1 + u)));
      }
      // plaster chunks drop and tumble
      for (let c = 0; c < 8; c++) {
        const cx = P.x + P.w * (0.1 + 0.8 * hash01(sec.seal + c * 5));
        const delay = 0.25 * hash01(sec.seal + c * 11);
        const a = Math.max(0, (u - delay) / (1 - delay));
        if (a <= 0) continue;
        const cy = P.y + P.h * (0.15 + 0.5 * hash01(sec.seal + c * 7)) + a * a * t * 0.55;
        const r = t * (0.035 + 0.05 * hash01(sec.seal + c * 13));
        canvas.save();
        canvas.translate(cx, cy);
        canvas.rotate(a * 240 * (hash01(sec.seal + c) - 0.5), 0, 0);
        canvas.drawRect(R(-r, -r * 0.7, r * 2, r * 1.4), fill(rgba(theme.plaster, Math.min(1, 1.6 - a), 0.95)));
        canvas.restore();
      }
      dust(canvas, P.x + P.w * 0.5, P.y + P.h * 0.55, t, u, 10, sec.seal + 5, 1.8);
    } else if (phase === SEAL.OPEN) {
      const sx2 = sec.spot % size;
      const sy2 = Math.floor(sec.spot / size);
      const cx = (sx2 + 0.5) * t;
      const cy = (sy2 + 0.5) * t;
      const got = s.secretsFound & (1 << k);
      if (!got && s.light[sec.spot] > 0.02) {
        graveGood(canvas, sec.treasure, cx, cy, t);
        // a soft specular glint that drifts across the object
        const ph = (time * 0.45 + hash01(sec.spot)) % 1;
        if (ph < 0.35) glow(canvas, cx + (ph / 0.35 - 0.5) * t * 0.22, cy - t * 0.08, t * 0.12, 0.55 * Math.sin((ph / 0.35) * Math.PI), '#fff4c8');
      }
      const e = fx.taken.find((f) => f.k === k);
      if (e && time - e.t0 < TAKE_FX_SECONDS) {
        const a = (time - e.t0) / TAKE_FX_SECONDS;
        for (let m = 0; m < 9; m++) {
          const ang = hash01(sec.spot + m) * Math.PI * 2;
          const d = t * (0.1 + 0.5 * a) * (0.5 + hash01(sec.spot + m * 3));
          canvas.drawCircle(cx + Math.cos(ang) * d, cy - a * t * 0.35 + Math.sin(ang) * d * 0.6, Math.max(1, t * 0.025), fill(rgba('#f4cf6a', 1 - a)));
        }
      }
    }
  }
}

/** A puff of plaster dust: soft grey-cream blobs that rise and fade. `a` runs 0..1. */
function dust(canvas: SkCanvas, x: number, y: number, t: number, a: number, n: number, seed: number, spread: number) {
  for (let m = 0; m < n; m++) {
    const ang = hash01(seed + m * 3) * Math.PI * 2;
    const d = t * 0.22 * spread * a * (0.4 + hash01(seed + m * 5));
    const r = t * (0.04 + 0.06 * hash01(seed + m * 7)) * (0.6 + a);
    canvas.drawCircle(x + Math.cos(ang) * d, y + a * t * 0.18 + Math.sin(ang) * d * 0.5, r, fill(rgba('#d8cdb2', 0.4 * (1 - a))));
  }
}

const sprite = Skia.Paint();
sprite.setAntiAlias(true);

/** The grave goods: small, readable at tile size, lying on the bedrock. */
export function graveGood(canvas: SkCanvas, kind: TreasureKind, x: number, y: number, t: number) {
  canvas.drawOval(R(x - t * 0.22, y + t * 0.1, t * 0.44, t * 0.14), fill(rgba('#000000', 0.4)));
  if (kind === 'amulet') {
    // a faience pendant on its cord
    const cord = Skia.PathBuilder.Make().moveTo(x - t * 0.2, y + t * 0.12).lineTo(x - t * 0.08, y - t * 0.02).lineTo(x, y - t * 0.06).lineTo(x + t * 0.08, y - t * 0.02).lineTo(x + t * 0.2, y + t * 0.12).build();
    canvas.drawPath(cord, stroke(rgba('#7a5a34', 0.9), Math.max(1, t * 0.025)));
    canvas.drawOval(R(x - t * 0.09, y - t * 0.08, t * 0.18, t * 0.22), fill(rgba('#2f6f66')));
    canvas.drawOval(R(x - t * 0.075, y - t * 0.065, t * 0.15, t * 0.18), fill(rgba('#4cc2ae')));
    canvas.drawRect(R(x - t * 0.012, y - t * 0.03, t * 0.024, t * 0.11), fill(rgba('#1d4a44', 0.8)));
  } else if (kind === 'jar') {
    // a white alabaster jar with a lid and two bands
    canvas.drawOval(R(x - t * 0.13, y - t * 0.02, t * 0.26, t * 0.2), fill(rgba('#a79d86')));
    canvas.drawOval(R(x - t * 0.12, y - t * 0.06, t * 0.24, t * 0.22), fill(rgba('#ece6d4')));
    canvas.drawRect(R(x - t * 0.09, y - t * 0.12, t * 0.18, t * 0.08), fill(rgba('#d8d0bb')));
    canvas.drawOval(R(x - t * 0.1, y - t * 0.17, t * 0.2, t * 0.09), fill(rgba('#f6f1e2')));
    canvas.drawRect(R(x - t * 0.115, y + t * 0.02, t * 0.23, t * 0.022), fill(rgba('#b89c6a', 0.9)));
    canvas.drawRect(R(x - t * 0.1, y + t * 0.08, t * 0.2, t * 0.022), fill(rgba('#b89c6a', 0.9)));
  } else if (kind === 'collar') {
    // a broad collar: concentric arcs of gold and faience beads
    const colors = ['#e3b449', '#2f6fb0', '#4cc2ae', '#e3b449'];
    colors.forEach((c, i) => {
      const r = t * (0.1 + 0.045 * i);
      const arc = Skia.PathBuilder.Make().addArc(R(x - r, y - r * 0.2, r * 2, r * 1.5), 190, 160).build();
      sprite.setStyle(PaintStyle.Stroke);
      sprite.setStrokeWidth(Math.max(1.5, t * 0.034));
      sprite.setPathEffect(Skia.PathEffect.MakeDash([Math.max(1.5, t * 0.03), Math.max(1, t * 0.012)], 0));
      sprite.setColor(rgba(c));
      canvas.drawPath(arc, sprite);
      sprite.setPathEffect(null);
    });
  } else {
    // a shabti: a small mummiform figure in blue faience with a gold face line
    canvas.drawOval(R(x - t * 0.075, y - t * 0.14, t * 0.15, t * 0.34), fill(rgba('#1f4d86')));
    canvas.drawOval(R(x - t * 0.065, y - t * 0.15, t * 0.13, t * 0.32), fill(rgba('#3a86c8')));
    canvas.drawCircle(x, y - t * 0.1, t * 0.05, fill(rgba('#4d9ad6')));
    canvas.drawRect(R(x - t * 0.045, y - t * 0.115, t * 0.09, t * 0.016), fill(rgba('#e3b449')));
    canvas.drawRect(R(x - t * 0.05, y + t * 0.02, t * 0.1, t * 0.014), fill(rgba('#e3b449', 0.9)));
    canvas.drawRect(R(x - t * 0.05, y + t * 0.07, t * 0.1, t * 0.014), fill(rgba('#e3b449', 0.9)));
  }
}

// ---- stars for UI canvases --------------------------------------------------------------------------

/**
 * A faceted five-point star centred on (cx, cy) with outer radius r. `state`: 1 filled (faceted gold,
 * dark rim), 2 held before (gold outline), 0 missing (dim hairline outline). Used by the overview and the pyramid page canvases.
 */
export function drawStar(canvas: SkCanvas, cx: number, cy: number, r: number, state: 0 | 1 | 2, scale = 1) {
  const R0 = r * scale;
  const inner = R0 * 0.46;
  const pts: Array<[number, number]> = [];
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const rr = k % 2 ? inner : R0;
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  const outline = Skia.PathBuilder.Make();
  pts.forEach(([x, y], k) => (k ? outline.lineTo(x, y) : outline.moveTo(x, y)));
  outline.close();
  if (state !== 1) {
    canvas.drawPath(outline.build(), stroke(rgba('#d3a94c', state === 2 ? 0.95 : 0.32), Math.max(1, r * 0.08)));
    return;
  }
  canvas.drawPath(outline.build(), fill(rgba('#6b4a14')));
  // facets: each tip is a lit and a shaded triangle around the centre
  for (let k = 0; k < 5; k++) {
    const tip = pts[k * 2];
    const l = pts[(k * 2 + 9) % 10];
    const rt = pts[(k * 2 + 1) % 10];
    const lit = Skia.PathBuilder.Make().moveTo(cx, cy).lineTo(l[0], l[1]).lineTo(tip[0], tip[1]).close().build();
    const shade = Skia.PathBuilder.Make().moveTo(cx, cy).lineTo(tip[0], tip[1]).lineTo(rt[0], rt[1]).close().build();
    canvas.drawPath(lit, fill(rgba('#f7d878', 1, 1)));
    canvas.drawPath(shade, fill(rgba('#d6a43a', 1, 1)));
  }
  canvas.drawPath(outline.build(), stroke(rgba('#5a3d0d'), Math.max(1, r * 0.09)));
  glow(canvas, cx, cy, r * 1.5, 0.25, '#ffd870');
}
