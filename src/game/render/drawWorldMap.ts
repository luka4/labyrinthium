import { Skia, type SkCanvas } from '@shopify/react-native-skia';

import { PYRAMIDS, SEALS, type PyramidId } from '../core/pyramids';
import { diamond, easeOutCubic, fill, glow, rgba, stroke } from './art';

/**
 * The world map (portrait): four pyramids around the sealed Black Pyramid,
 * with the four seals of its door. Labels and touch targets are laid out by the
 * caller with `mapLayout`.
 */
export type MapView = {
  collected: Partial<Record<PyramidId, true>>;
  /** a seal filling in right now, after returning from a basement */
  filling?: PyramidId;
  /** 0..1 progress of that fill */
  fill: number;
  /** 0..1 progress of the door opening (1 once it has been seen) */
  unlock: number;
  time: number;
};

const SITES: Record<PyramidId, { x: number; y: number }> = {
  egypt: { x: 0.27, y: 0.22 },
  china: { x: 0.73, y: 0.22 },
  maya: { x: 0.2, y: 0.5 },
  cambodia: { x: 0.8, y: 0.5 },
  black: { x: 0.5, y: 0.8 },
};

export function mapLayout(width: number, height: number) {
  const small = Math.min(width * 0.22, height * 0.17);
  const big = small * 1.6;
  const site = (id: PyramidId) => {
    const s = SITES[id];
    const size = id === 'black' ? big : small;
    // (x, y) is the middle of the base
    return { x: s.x * width, y: s.y * height, size };
  };
  const black = site('black');
  const sealSize = Math.max(14, big * 0.13);
  const seal = (i: number) => ({
    x: black.x + (i - 1.5) * sealSize * 1.6,
    y: black.y + sealSize * 0.9,
    size: sealSize,
  });
  return { site, seal, sealSize };
}

function steppedPyramid(canvas: SkCanvas, x: number, base: number, size: number, hex: string, steps: number, bright: boolean) {
  const h = (size * 0.72) / steps;
  for (let i = 0; i < steps; i++) {
    const w = size * (0.2 + (0.8 * (i + 1)) / steps);
    const y = base - size * 0.72 + i * h;
    canvas.drawRect({ x: x - w / 2, y, width: w, height: h - 1 }, fill(rgba(hex, 1, bright ? 0.95 - (0.3 * i) / steps : 0.3)));
  }
}

function pathTo(from: { x: number; y: number }, to: { x: number; y: number }) {
  const mx = (from.x + to.x) / 2;
  const my = Math.max(from.y, to.y) - 30;
  return {
    path: Skia.PathBuilder.Make().moveTo(from.x, from.y).quadTo(mx, my, to.x, to.y).build(),
    at: (t: number) => {
      const u = 1 - t;
      return { x: u * u * from.x + 2 * u * t * mx + t * t * to.x, y: u * u * from.y + 2 * u * t * my + t * t * to.y };
    },
  };
}

export function drawWorldMap(canvas: SkCanvas, width: number, height: number, v: MapView) {
  const L = mapLayout(width, height);
  const pulse = 0.8 + 0.2 * Math.sin(v.time / 300);
  canvas.drawColor(rgba('#0b0a08'));

  // a faint dot grid: old map paper in the dark
  const dot = fill(rgba('#1c1710'));
  for (let gx = 16; gx < width; gx += 28) for (let gy = 16; gy < height; gy += 28) canvas.drawRect({ x: gx, y: gy, width: 2, height: 2 }, dot);

  const black = L.site('black');
  const door = { x: black.x, y: black.y - black.size * 0.36 };

  // paths from each pyramid to the Black Pyramid; lit once its artifact is taken
  const fillT = v.filling ? v.fill : 1;
  for (const id of SEALS) {
    const s = L.site(id);
    // start below the name and status labels
    const p = pathTo({ x: s.x, y: s.y + 46 }, door);
    const got = !!v.collected[id] && !(v.filling === id && fillT < 0.6);
    canvas.drawPath(p.path, stroke(got ? rgba('#f3c55a', 0.75) : rgba('#3a3226'), 2, [6, 7]));
    if (v.filling === id && fillT < 0.6) {
      // a spark travels from the pyramid to its seal
      const q = p.at(easeOutCubic(fillT / 0.6));
      glow(canvas, q.x, q.y, 18, 0.9);
      canvas.drawCircle(q.x, q.y, 3.5, fill(rgba('#fff3c8')));
    }
  }

  // the four pyramids, an artifact glowing over each one already taken
  for (const id of SEALS) {
    const s = L.site(id);
    steppedPyramid(canvas, s.x, s.y, s.size, PYRAMIDS[id].color, 6, true);
    if (v.collected[id]) {
      const ay = s.y - s.size * 0.95;
      glow(canvas, s.x, ay, 20 * pulse, 0.85);
      diamond(canvas, s.x, ay, 6, 9, rgba('#ffe7a3'));
    }
  }

  // the Black Pyramid
  const filled = SEALS.filter((id) => v.collected[id] && !(id === v.filling && fillT < 0.6)).length;
  const open = filled === SEALS.length;
  const u = open ? v.unlock : 0;
  if (open) glow(canvas, black.x, black.y - black.size * 0.4, black.size * 0.9 * (0.6 + 0.4 * easeOutCubic(u)) * pulse, 0.35 * u);
  steppedPyramid(canvas, black.x, black.y, black.size, PYRAMIDS.black.color, 8, open && u > 0.6);
  // the door: dark while sealed, opening into light
  const dw = black.size * 0.13;
  const dh = black.size * 0.2;
  const openness = open ? easeOutCubic((u - 0.6) / 0.4) : 0;
  canvas.drawRect({ x: black.x - dw / 2, y: black.y - dh, width: dw, height: dh }, fill(rgba('#1a1610')));
  if (openness > 0) {
    canvas.drawRect({ x: black.x - dw / 2, y: black.y - dh * openness, width: dw, height: dh * openness }, fill(rgba('#f3c55a')));
    glow(canvas, black.x, black.y - dh / 2, dw * 2.5, 0.6 * openness);
  }
  if (v.collected.black) {
    const ay = black.y - black.size * 0.9;
    glow(canvas, black.x, ay, 26 * pulse, 0.9, '#ff6a5a');
    diamond(canvas, black.x, ay, 8, 12, rgba('#ffc9b8'));
  }

  // seals on the door: fill as artifacts arrive; light up one by one as the door opens
  SEALS.forEach((id, i) => {
    const s = L.seal(i);
    const half = s.size / 2;
    canvas.drawRect({ x: s.x - half, y: s.y - half, width: s.size, height: s.size }, stroke(rgba('#6b5a3c'), 2));
    let amount = v.collected[id] ? 1 : 0;
    if (id === v.filling) amount = fillT < 0.6 ? 0 : easeOutCubic((fillT - 0.6) / 0.4);
    if (amount > 0) {
      const inner = (s.size - 6) * amount;
      canvas.drawRect({ x: s.x - inner / 2, y: s.y - inner / 2, width: inner, height: inner }, fill(rgba('#f3c55a')));
    }
    const lit = open ? Math.min(1, Math.max(0, (u - i * 0.12) / 0.2)) : id === v.filling ? 1 - Math.abs(fillT - 0.8) * 4 : 0;
    if (lit > 0) glow(canvas, s.x, s.y, s.size * 1.6, 0.7 * lit);
  });
}
