import type { SkCanvas } from '@shopify/react-native-skia';

import type { PyramidInfo } from '../core/pyramids';
import { isCampFloor } from '../core/game';
import { diamond, fill, flame, glow, rgba, stroke, triangle } from './art';

/**
 * The between-floors view: the pyramid in profile, one tier per floor, the
 * basement chamber with the artifact, and a torch marker on the current floor.
 * Text is laid out by the caller with `sideLayout`, in React Native.
 */
export type SideView = {
  pyramid: PyramidInfo;
  /** floor index of the torch marker; fractional while it slides */
  current: number;
  /** the artifact has already been taken from this pyramid */
  artifactTaken: boolean;
  /** time in ms, for flicker and pulse; constant when motion is reduced */
  time: number;
};

export function sideLayout(width: number, height: number, floors: number) {
  const top = height * 0.16;
  // a tall pyramid (Egypt, 25 floors) gets more of the height: its tiers become fine courses
  const fine = floors > 10;
  const ground = height * (fine ? 0.72 : 0.66);
  const th = (ground - top) / floors;
  const cx = width * 0.38;
  const maxW = width * 0.6;
  const minW = maxW * 0.2;
  const tierWidth = (k: number) => minW + (maxW - minW) * (floors <= 1 ? 1 : k / (floors - 1));
  const tierY = (k: number) => top + k * th;
  const bw = maxW * 0.44;
  const bh = height * (fine ? 0.16 : 0.2);
  const by = ground + height * (fine ? 0.07 : 0.08);
  return {
    top,
    ground,
    th,
    cx,
    maxW,
    minW,
    tierWidth,
    tierY,
    chamber: { x: cx - bw / 2, y: by, w: bw, h: bh },
    /** where the torch marker sits for a (fractional) floor */
    marker: (k: number) => ({ x: cx + tierWidth(k) / 2 + 20, y: tierY(k) + th / 2 }),
  };
}

export function drawPyramidSide(canvas: SkCanvas, width: number, height: number, v: SideView) {
  const p = v.pyramid;
  const N = p.floorCount;
  const L = sideLayout(width, height, N);
  const { top, ground, th, cx, minW } = L;
  const cur = Math.round(v.current);

  canvas.drawColor(rgba('#0b0a08'));
  canvas.drawRect({ x: 0, y: ground, width, height: height - ground }, fill(rgba('#17120c')));
  canvas.drawRect({ x: 0, y: ground, width, height: 2 }, fill(rgba('#2c2418')));

  // crown
  const crown = rgba(p.color, 1, 0.55);
  const ch = Math.max(th * 0.8, 12);
  if (p.top === 'temple') canvas.drawRect({ x: cx - minW * 0.32, y: top - ch, width: minW * 0.64, height: ch }, fill(crown));
  else if (p.top === 'towers')
    for (let k = -1; k <= 1; k++) {
      const tx = cx + k * minW * 0.32;
      const hh = ch * (k === 0 ? 1.5 : 1);
      triangle(canvas, tx - minW * 0.11, top, tx, top - hh, tx + minW * 0.11, top, crown);
    }
  else if (p.top === 'capstone') triangle(canvas, cx - minW / 2, top, cx, top - ch * 1.2, cx + minW / 2, top, crown);
  else canvas.drawRect({ x: cx - minW * 0.55, y: top - 4, width: minW * 1.1, height: 4 }, fill(crown));

  // tiers: cleared, current, still ahead
  const flick = 0.9 + 0.1 * Math.sin(v.time / 80);
  for (let k = 0; k < N; k++) {
    const w = L.tierWidth(k);
    const y = L.tierY(k);
    const rect = { x: cx - w / 2, y: y + 1, width: w, height: th - 2 };
    if (k < cur) canvas.drawRect(rect, fill(rgba(p.color, 1, 0.5)));
    else if (k === cur) {
      canvas.drawRect(rect, fill(rgba('#f3c55a')));
    } else {
      canvas.drawRect(rect, fill(rgba('#201b14')));
      canvas.drawRect({ x: rect.x + 0.5, y: rect.y + 0.5, width: rect.width - 1, height: rect.height - 1 }, stroke(rgba(p.color, 1, 0.3), 1));
    }
    // fine courses: a thin joint on every other one, like ashlar
    if (th < 14 && k % 2 === 1) canvas.drawRect({ x: rect.x, y: rect.y, width: rect.width, height: 1 }, fill(rgba('#000000', 0.35)));
    if (isCampFloor(p, k)) flame(canvas, cx - w / 2 - 14, y + th * 0.72, th < 14 ? Math.max(3.5, th * 0.5) : Math.min(9, th * 0.3), flick);
  }

  // shaft and basement chamber with the sacred artifact
  const c = L.chamber;
  canvas.drawLine(cx, ground, cx, c.y, stroke(rgba(p.color, 1, 0.45), 2, [4, 5]));
  canvas.drawRect({ x: c.x, y: c.y, width: c.w, height: c.h }, fill(rgba('#120e09')));
  canvas.drawRect({ x: c.x, y: c.y, width: c.w, height: c.h }, stroke(rgba(p.color, 1, 0.45), 2));
  const ax = cx;
  const ay = c.y + c.h / 2;
  if (v.artifactTaken) {
    diamond(canvas, ax, ay, c.h * 0.14, c.h * 0.22, rgba(p.color, 0.35, 0.5));
  } else {
    const pulse = 0.85 + 0.15 * Math.sin(v.time / 320);
    glow(canvas, ax, ay, c.h * 0.8 * pulse, 0.75);
    diamond(canvas, ax, ay, c.h * 0.14, c.h * 0.22, rgba('#ffe7a3'));
  }

  // torch marker
  const m = L.marker(Math.max(0, Math.min(N - 1, v.current)));
  glow(canvas, m.x, m.y, 22 * flick, 0.9, '#ffb446');
  canvas.drawCircle(m.x, m.y, 6, fill(rgba('#fff1c4')));
}
