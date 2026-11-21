import { BlendMode, Skia, TileMode, type SkCanvas } from '@shopify/react-native-skia';

import type { GameState } from '../core/game';
import { power, scarabPath } from '../core/powers';
import { BREATH, SWIM, waterAt } from '../core/water';
import { fill, glow, hash01, rgba, stroke } from './art';

/**
 * What the powers look like on the board (plan 06). Render only: core decides; this reads `s.powers`,
 * `s.breath` and `s.water`.
 *  - Scarab: 24 gold motes flow from you along the real way down (`scarabPath`), emissive over the dark.
 *  - Mirror: a cool silver rim on the hand glow and a slow glint sweeping across the player.
 *  - Jade: a jade-green vignette and a light desaturation over the board.
 *  - Naga: a faint teal scale shimmer around the player; bubbles in a flooded tile.
 *  - Breath: a thin cyan arc around the player tile, red under `low`.
 */
const MOTES = 24;
const PATH_EVERY = 0.25;

let cache: { pos: number; floor: unknown; at: number; reach: number; path: Int32Array } = { pos: -1, floor: null, at: -99, reach: 0, path: new Int32Array(0) };

/** the Scarab's way, memoised per position and refreshed every 0.25 s while it is active */
function wayDown(s: GameState, reach: number, time: number): Int32Array {
  if (cache.pos !== s.pos || cache.floor !== s.floor || cache.reach !== reach || time - cache.at >= PATH_EVERY || time < cache.at) {
    cache = { pos: s.pos, floor: s.floor, at: time, reach, path: scarabPath(s, reach) };
  }
  return cache.path;
}

/** Catmull-Rom point through `pts` (x, y pairs) at distance parameter u in [0, 1] */
function along(pts: Float32Array, n: number, u: number, out: { x: number; y: number }) {
  const f = Math.max(0, Math.min(n - 1 - 1e-6, u * (n - 1)));
  const i = Math.floor(f);
  const k = f - i;
  const p = (j: number, c: number) => pts[2 * Math.max(0, Math.min(n - 1, j)) + c];
  for (let c = 0; c < 2; c++) {
    const p0 = p(i - 1, c);
    const p1 = p(i, c);
    const p2 = p(i + 1, c);
    const p3 = p(i + 2, c);
    const v = 0.5 * (2 * p1 + (-p0 + p2) * k + (2 * p0 - 5 * p1 + 4 * p2 - p3) * k * k + (-p0 + 3 * p1 - 3 * p2 + p3) * k * k * k);
    if (c === 0) out.x = v;
    else out.y = v;
  }
}

const pts = new Float32Array(2 * 1024);
const spot = { x: 0, y: 0 };

/** The scarab's motes: emissive, drawn over the dark after the light mask. `px`,`py`: the player in board px. */
export function drawScarabMotes(canvas: SkCanvas, s: GameState, px: number, py: number, t: number, time: number) {
  const p = s.powers.length ? power(s, 'scarab') : null;
  if (!p || p.left <= 0) return;
  const path = wayDown(s, p.strength, time);
  if (!path.length) return;
  const { size } = s.floor;
  const n = Math.min(path.length, 1023) + 1;
  pts[0] = px;
  pts[1] = py;
  for (let k = 1; k < n; k++) {
    pts[2 * k] = ((path[k - 1] % size) + 0.5) * t;
    pts[2 * k + 1] = (Math.floor(path[k - 1] / size) + 0.5) * t;
  }
  // fade in over 0.3 s, out over the last second
  const age = p.seconds - p.left;
  const env = Math.min(1, age / 0.3, p.left / 1);
  const flow = (time * 0.45) % 1;
  for (let m = 0; m < MOTES; m++) {
    const u = (m / MOTES + flow) % 1;
    along(pts, n, u, spot);
    // diving motes over flooded tiles
    const tile = Math.floor(spot.y / t) * size + Math.floor(spot.x / t);
    const dive = s.water && waterAt(s, tile) >= SWIM ? 0.45 : 1;
    const tw = 0.6 + 0.4 * Math.sin(time * 7 + m * 1.7);
    const a = env * dive * (1 - u * 0.5) * tw;
    if (a <= 0.02) continue;
    glow(canvas, spot.x, spot.y + (dive < 1 ? t * 0.1 : 0), t * 0.34, 0.7 * a, '#ffcf5a');
    canvas.drawCircle(spot.x, spot.y, Math.max(1, t * 0.06), fill(rgba('#fff2c0', a)));
  }
}

/** Mirror glint, naga shimmer and bubbles, breath arc: small effects around the player (over the dark). */
export function drawPowerAura(canvas: SkCanvas, s: GameState, px: number, py: number, t: number, time: number) {
  if (s.powers.length) {
    const mirror = power(s, 'mirror');
    if (mirror && mirror.left > 0) {
      const env = Math.min(1, (mirror.seconds - mirror.left) / 0.3, mirror.left / 0.8);
      glow(canvas, px, py - t * 0.15, t * 0.9, 0.25 * env, '#cfd3f0');
      const sweep = (time * 0.5) % 1;
      const gx = px - t * 0.5 + sweep * t;
      canvas.drawLine(gx - t * 0.08, py + t * 0.28, gx + t * 0.12, py - t * 0.3, stroke(rgba('#ffffff', 0.5 * env * Math.sin(sweep * Math.PI)), Math.max(1, t * 0.05)));
    }
    const naga = power(s, 'naga');
    if (naga && naga.left > 0) {
      const env = Math.min(1, (naga.seconds - naga.left) / 0.3, naga.left / 0.8);
      const r = t * 0.52;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + time * 0.8;
        canvas.drawArc({ x: px - r, y: py - r, width: r * 2, height: r * 2 }, (a * 180) / Math.PI, 22, false, stroke(rgba('#6fd0bf', 0.45 * env * (0.6 + 0.4 * Math.sin(time * 5 + k))), Math.max(1, t * 0.045)));
      }
      if (s.water && waterAt(s, s.pos) >= SWIM) {
        for (let b = 0; b < 5; b++) {
          const u = (time * 0.7 + hash01(b + 3)) % 1;
          canvas.drawCircle(px + (hash01(b) - 0.5) * t * 0.6 + Math.sin(time * 3 + b) * t * 0.05, py + t * 0.1 - u * t * 0.9, t * (0.03 + 0.03 * hash01(b + 9)), stroke(rgba('#cdf5ee', 0.55 * (1 - u)), 1));
        }
      }
    }
  }
  // the breath ring: clockwise, cyan, red under low
  if (s.water && s.breath < BREATH.max) {
    const r = t * 0.62;
    const frac = Math.max(0, s.breath / BREATH.max);
    const low = s.breath < BREATH.low;
    canvas.drawArc({ x: px - r, y: py - r, width: r * 2, height: r * 2 }, 0, 360, false, stroke(rgba('#000000', 0.35), Math.max(2, t * 0.07)));
    canvas.drawArc({ x: px - r, y: py - r, width: r * 2, height: r * 2 }, -90, 360 * frac, false, stroke(rgba(low ? '#e8503a' : '#7fe3f0', 0.9), Math.max(2, t * 0.07)));
  }
}

const jadePaint = Skia.Paint();
const jadeTint = Skia.Paint();

/**
 * While the Jade Seal holds: a jade-green vignette (18 % at the edges) and a 10 % desaturation, over the
 * whole board (board px, no camera transform).
 */
export function drawJadeOverlay(canvas: SkCanvas, s: GameState, board: number, time: number) {
  const p = s.powers.length ? power(s, 'jade') : null;
  if (!p || p.left <= 0) return;
  const env = Math.min(1, (p.seconds - p.left) / 0.25, p.left / 0.4);
  const c = board / 2;
  jadePaint.setShader(Skia.Shader.MakeRadialGradient({ x: c, y: c }, board * 0.78, [rgba('#7fe0a4', 0), rgba('#7fe0a4', 0), rgba('#4fbf86', 0.18 * env)], [0, 0.55, 1], TileMode.Clamp));
  canvas.drawRect({ x: 0, y: 0, width: board, height: board }, jadePaint);
  jadePaint.setShader(null);
  jadeTint.setColor(rgba('#9fb8a8', 0.1 * env));
  jadeTint.setBlendMode(BlendMode.Color);
  canvas.drawRect({ x: 0, y: 0, width: board, height: board }, jadeTint);
  // a thin shimmer line moving slowly, so held time reads as still, not as a pause
  const y = ((time * 0.08) % 1) * board;
  canvas.drawRect({ x: 0, y, width: board, height: 1 }, fill(rgba('#cfffe3', 0.05 * env)));
}

/** the frozen guardian's tint: a layer paint that pulls colours towards jade */
export const FROZEN_TINT = (() => {
  const p = Skia.Paint();
  p.setColorFilter(Skia.ColorFilter.MakeBlend(rgba('#9fe0b4', 0.4), BlendMode.SrcATop));
  return p;
})();
