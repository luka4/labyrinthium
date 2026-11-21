import { Skia, type SkCanvas, type SkPath } from '@shopify/react-native-skia';

import type { GameState } from '../core/game';
import { FLOODED, SWIM, WET } from '../core/water';
import { fill, hash01, rgba, stroke } from './art';
import type { FloorTheme } from './themes';

/**
 * Water (plan 06), drawn with the floor under the light mask: one path of tile rects per band (shallow,
 * deep, flooded), a wet-edge line along every shore, a few ripple strokes over lit water and a warm
 * reflection of your flame within two tiles. Vector for now; task 10 swaps it for a shader. The
 * layer is an overlay on the floor art: water never changes what is solid or opaque.
 */
export type WaterColors = { shallow: string; deep: string; flooded: string; edge: string };
export const WATER_COLORS: WaterColors = { shallow: '#2b5a5e', deep: '#173e48', flooded: '#0b252c', edge: '#9fc7c2' };
const ALPHA = { shallow: 0.35, deep: 0.65, flooded: 0.88 } as const;

/** the most ripple strokes per frame */
const MAX_RIPPLES = 40;

export type WaterRenderer = {
  draw: (canvas: SkCanvas, s: GameState, win: { x0: number; y0: number; x1: number; y1: number }, t: number, time: number, theme: FloorTheme) => void;
};

export function createWaterRenderer(): WaterRenderer {
  let key = '';
  let shallow: SkPath | null = null;
  let deep: SkPath | null = null;
  let flooded: SkPath | null = null;
  let edge: SkPath | null = null;
  let tiles: number[] = [];

  const rebuild = (s: GameState, win: { x0: number; y0: number; x1: number; y1: number }, t: number) => {
    const { size } = s.floor;
    const water = s.water!;
    const seen = s.seenWater!;
    const level = (i: number) => (s.light[i] > 0 ? water[i] : seen[i]);
    const a = Skia.PathBuilder.Make();
    const b = Skia.PathBuilder.Make();
    const c = Skia.PathBuilder.Make();
    const e = Skia.PathBuilder.Make();
    tiles = [];
    for (let y = Math.max(0, win.y0); y <= Math.min(size - 1, win.y1); y++) {
      for (let x = Math.max(0, win.x0); x <= Math.min(size - 1, win.x1); x++) {
        const i = y * size + x;
        const lv = level(i);
        if (lv < WET) continue;
        const r = { x: x * t, y: y * t, width: t, height: t };
        (lv >= FLOODED ? c : lv >= SWIM ? b : a).addRect(r);
        if (lv < FLOODED) tiles.push(i);
        // the wet edge along every shore
        const edgeTo = (nx: number, ny: number, x0: number, y0: number, x1: number, y1: number) => {
          if (nx < 0 || ny < 0 || nx >= size || ny >= size || level(ny * size + nx) < WET) e.moveTo(x0, y0).lineTo(x1, y1);
        };
        edgeTo(x, y - 1, x * t, y * t, (x + 1) * t, y * t);
        edgeTo(x, y + 1, x * t, (y + 1) * t, (x + 1) * t, (y + 1) * t);
        edgeTo(x - 1, y, x * t, y * t, x * t, (y + 1) * t);
        edgeTo(x + 1, y, (x + 1) * t, y * t, (x + 1) * t, (y + 1) * t);
      }
    }
    shallow = a.build();
    deep = b.build();
    flooded = c.build();
    edge = e.build();
  };

  return {
    draw(canvas, s, win, t, time, theme) {
      if (!s.water || !s.seenWater) return;
      const colors = theme.water ?? WATER_COLORS;
      const k = `${s.floor.seed}|${s.waterRev}|${s.trail}|${s.handR}|${win.x0},${win.y0},${win.x1},${win.y1}|${t}`;
      if (k !== key) {
        key = k;
        rebuild(s, win, t);
      }
      canvas.drawPath(shallow!, fill(rgba(colors.shallow, ALPHA.shallow)));
      canvas.drawPath(deep!, fill(rgba(colors.deep, ALPHA.deep)));
      canvas.drawPath(flooded!, fill(rgba(colors.flooded, ALPHA.flooded)));
      canvas.drawPath(edge!, stroke(rgba(colors.edge, 0.3), Math.max(1, t * 0.05)));

      // ripples over lit shallow and deep water: hash-placed, 2-3 s periods
      const { size } = s.floor;
      let n = 0;
      for (const i of tiles) {
        if (n >= MAX_RIPPLES) break;
        if (s.light[i] <= 0 || hash01(i * 3.1 + 7) < 0.55) continue;
        n++;
        const x = (i % size) * t;
        const y = Math.floor(i / size) * t;
        const period = 2 + hash01(i + 11);
        const u = ((time + hash01(i) * period) % period) / period;
        const w = t * (0.18 + 0.3 * u);
        const cx = x + t * (0.25 + 0.5 * hash01(i + 3));
        const cy = y + t * (0.25 + 0.5 * hash01(i + 5));
        canvas.drawArc({ x: cx - w, y: cy - w * 0.35, width: w * 2, height: w * 0.7 }, 200, 140, false, stroke(rgba(colors.edge, 0.35 * (1 - u)), Math.max(0.8, t * 0.03)));
      }

      // a warm reflection of your flame on the water within two tiles
      const px = s.pos % size;
      const py = Math.floor(s.pos / size);
      if (s.hand.left > 0) {
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const x = px + dx;
            const y = py + dy;
            if (x < 0 || y < 0 || x >= size || y >= size) continue;
            const i = y * size + x;
            if (s.water[i] < WET || s.light[i] <= 0) continue;
            const a = 0.22 * s.light[i] * (1 - (Math.abs(dx) + Math.abs(dy)) * 0.18);
            const sh = Math.sin(time * 3 + i) * t * 0.04;
            canvas.drawOval({ x: x * t + t * 0.38 + sh, y: y * t + t * 0.2, width: t * 0.24, height: t * 0.6 }, fill(rgba('#ffb45a', Math.max(0, a))));
          }
        }
      }
    },
  };
}
