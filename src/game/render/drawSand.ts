import { AlphaType, BlendMode, ColorType, FilterMode, MipmapMode, PaintStyle, Skia, TileMode, type SkCanvas, type SkImage, type SkShader } from '@shopify/react-native-skia';

import { TILE, type Floor } from '../core/floor';
import type { GameState } from '../core/game';
import { fill, hash01, rgba } from './art';
import type { FloorTheme } from './themes';

/**
 * Sand (plan 03): the collapse and the sandfall traps. One layer inside the masked board layer, so
 * sand is only seen in torchlight or as remembered:
 *  - a repeating sand pattern (ripples, grains) shows through a small per-frame level image
 *    (2 px per tile over the window, alpha = how deep the sand lies there);
 *  - tiles filled to the ceiling are drawn like walls: a lit crest and a darker south face;
 *  - while the collapse runs: a falling column over the stairwell and a haze of dust.
 * Task 10's sand material shader replaces the pattern; the rest stays.
 */

const FACE = 0.55;
const CAP_H = 1 - FACE;
const PATTERN = 128;

const patterns = new WeakMap<FloorTheme, SkImage>();
const upTiles = new WeakMap<Floor, number[]>();

/** A seamless sand tile: dune ripples and a speckle of grains. */
function patternFor(theme: FloorTheme): SkImage | null {
  const hit = patterns.get(theme);
  if (hit) return hit;
  const surface = Skia.Surface.Make(PATTERN, PATTERN);
  if (!surface) return null;
  const c = surface.getCanvas();
  c.drawColor(rgba(theme.sand));
  const p = Skia.Paint();
  p.setAntiAlias(true);
  // ripples: sine lines that wrap at the edges (drawn three times, shifted) so the tile is seamless
  p.setStyle(PaintStyle.Stroke);
  for (let row = 0; row < 8; row++) {
    const y0 = (row + 0.5) * (PATTERN / 8);
    const phase = hash01(row * 3.7) * 6.28;
    const path = Skia.PathBuilder.Make().moveTo(0, y0);
    for (let x = 0; x <= PATTERN; x += 4) path.lineTo(x, y0 + Math.sin((x / PATTERN) * 6.28 * 2 + phase) * 3.2);
    p.setStrokeWidth(2.2);
    p.setColor(rgba(theme.sandDark, 0.32));
    c.drawPath(path.build(), p);
    p.setStrokeWidth(1);
    p.setColor(rgba('#ffffff', 0.18));
    c.save();
    c.translate(0, -2);
    c.drawPath(path.build(), p);
    c.restore();
  }
  p.setStyle(PaintStyle.Fill);
  for (let k = 0; k < 360; k++) {
    const gx = hash01(k * 1.31) * PATTERN;
    const gy = hash01(k * 2.17 + 9) * PATTERN;
    p.setColor(rgba(k % 3 ? theme.sandDark : '#fff2cf', k % 3 ? 0.22 : 0.3));
    c.drawCircle(gx, gy, 0.5 + hash01(k * 5.1) * 0.9, p);
  }
  surface.flush();
  const image = surface.makeImageSnapshot();
  patterns.set(theme, image);
  return image;
}

export type SandRenderer = {
  /** draws the sand of the window inside the board layer (world units * t) */
  draw: (canvas: SkCanvas, s: GameState, win: { x0: number; y0: number; w: number; h: number }, t: number, time: number) => void;
  dispose: () => void;
};

export function createSandRenderer(theme: FloorTheme): SandRenderer {
  const ring: SkImage[] = [];
  let data = new Uint8Array(0);
  let shader: SkShader | null = null;
  let shaderScale = -1;
  const layer = Skia.Paint();
  const levelPaint = Skia.Paint();
  levelPaint.setBlendMode(BlendMode.DstIn);
  const shaderPaint = Skia.Paint();

  const draw: SandRenderer['draw'] = (canvas, s, win, t, time) => {
    const { size } = s.grid;
    const c = s.collapse;
    let any = !!c && c.covered > 0;
    if (!any) for (let k = 0; k < s.trapPhase.length; k++) if (s.trapPhase[k] === 2 && s.floor.traps[k].kind === 'sandfall') any = true;
    const started = !!c?.started;
    if (!any && !started) return;

    const x0 = Math.max(0, win.x0);
    const y0 = Math.max(0, win.y0);
    const x1 = Math.min(size, win.x0 + win.w);
    const y1 = Math.min(size, win.y0 + win.h);
    const w = x1 - x0;
    const h = y1 - y0;
    if (w <= 0 || h <= 0) return;

    // ---- sand on the floor: pattern through a level image -------------------------------
    if (any) {
      const px = w * 2;
      const need = px * h * 2 * 4;
      if (data.length < need) data = new Uint8Array(need);
      let drawn = 0;
      const crest = Skia.PathBuilder.Make();
      const face = Skia.PathBuilder.Make();
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const i = y * size + x;
          const blocked = s.sand[i] === 255 && s.grid.solid[i] && !s.floor.solid[i];
          let level = 0;
          if (!blocked) {
            const live = Math.max(s.sand[i], s.localSand[i]);
            level = s.light[i] > 0 ? live : s.seenSand[i];
          } else {
            // like a wall: the top is the whole tile unless the tile south of it is open (then a face shows)
            const open = y + 1 < size && !s.grid.solid[i + size];
            crest.addRect({ x: x * t, y: y * t, width: t, height: open ? t * CAP_H : t });
            if (open) face.addRect({ x: x * t, y: (y + CAP_H) * t, width: t, height: t * FACE });
          }
          const a = Math.round(level * 255);
          if (a) drawn++;
          const lx = x - x0;
          const ly = y - y0;
          for (const [ox, oy] of [
            [0, 0],
            [1, 0],
            [0, 1],
            [1, 1],
          ]) {
            const at = ((2 * ly + oy) * px + 2 * lx + ox) * 4;
            data[at] = a;
            data[at + 1] = a;
            data[at + 2] = a;
            data[at + 3] = a;
          }
        }
      if (drawn) {
        const pattern = patternFor(theme);
        if (pattern) {
          const period = t * 2.5; // one pattern tile = 2.5 tiles of floor
          if (!shader || shaderScale !== period) {
            shader = pattern.makeShaderOptions(TileMode.Repeat, TileMode.Repeat, FilterMode.Linear, MipmapMode.None, Skia.Matrix().scale(period / PATTERN, period / PATTERN));
            shaderScale = period;
          }
          const info = { width: px, height: h * 2, alphaType: AlphaType.Premul, colorType: ColorType.RGBA_8888 };
          const level = Skia.Image.MakeImage(info, Skia.Data.fromBytes(data.subarray(0, px * h * 2 * 4)), px * 4);
          if (level) {
            ring.push(level);
            while (ring.length > 4) ring.shift()?.dispose();
            canvas.saveLayer(layer);
            shaderPaint.setShader(shader);
            canvas.drawRect({ x: x0 * t, y: y0 * t, width: w * t, height: h * t }, shaderPaint);
            shaderPaint.setShader(null);
            canvas.drawImageRectOptions(level, { x: 0, y: 0, width: px, height: h * 2 }, { x: x0 * t, y: y0 * t, width: w * t, height: h * t }, FilterMode.Linear, MipmapMode.None, levelPaint);
            canvas.restore();
          }
        }
      }
      // tiles filled to the ceiling: wall-like
      canvas.drawPath(face.build(), fill(rgba(theme.sandDark, 1, 0.82)));
      canvas.drawPath(crest.build(), fill(rgba(theme.sand, 1, 1.02)));
    }

    // ---- the pour and the dust --------------------------------------------------------
    if (started) {
      let ups = upTiles.get(s.floor);
      if (!ups) {
        ups = [];
        for (let i = 0; i < s.floor.tiles.length; i++) if (s.floor.tiles[i] === TILE.STAIRS_UP) ups.push(i);
        upTiles.set(s.floor, ups);
      }
      for (const i of ups) {
        const x = i % size;
        const y = Math.floor(i / size);
        if (x < x0 - 2 || x > x1 + 2 || y < y0 - 2 || y > y1 + 2) continue;
        const cx = (x + 0.5) * t;
        const cy = (y + 0.5) * t;
        // a column of falling sand from the broken ceiling
        const colW = t * 0.46;
        const top = cy - t * 1.1;
        const g = Skia.Shader.MakeLinearGradient({ x: 0, y: top }, { x: 0, y: cy + t * 0.3 }, [rgba(theme.sand, 0), rgba(theme.sand, 0.95)], null, TileMode.Clamp);
        const gp = Skia.Paint();
        gp.setShader(g);
        canvas.drawRect({ x: cx - colW / 2, y: top, width: colW, height: t * 1.4 }, gp);
        for (let k = 0; k < 5; k++) {
          const u = (time * 1.6 + k / 5) % 1;
          canvas.drawRect({ x: cx - colW / 2 + hash01(k * 4.1) * colW * 0.8, y: top + u * t * 1.3, width: Math.max(1.2, t * 0.04), height: t * 0.26 }, fill(rgba('#fff2cf', 0.55 * (1 - u))));
        }
        // dust haze, slowly breathing
        const pulse = 0.85 + 0.15 * Math.sin(time * 1.3);
        const haze = Skia.Shader.MakeRadialGradient({ x: cx, y: cy }, t * 2.6 * pulse, [rgba(theme.sand, 0.25), rgba(theme.sand, 0)], null, TileMode.Clamp);
        const hp = Skia.Paint();
        hp.setShader(haze);
        canvas.drawCircle(cx, cy, t * 2.6 * pulse, hp);
      }
    }
  };

  return {
    draw,
    dispose: () => {
      while (ring.length) ring.shift()?.dispose();
      shader = null;
    },
  };
}
