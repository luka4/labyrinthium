import type { Grid } from './floor';

/**
 * True when a straight line between two tile centers is not blocked by an opaque
 * tile (rock, pillar) and never squeezes diagonally between two such corners.
 */
export function clearLine(grid: Pick<Grid, 'size' | 'opaque'>, x0: number, y0: number, x1: number, y1: number): boolean {
  const { opaque, size } = grid;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 6));
  let cx = x0;
  let cy = y0;
  for (let s = 1; s <= steps; s++) {
    const tx = Math.round(x0 + (dx * s) / steps);
    const ty = Math.round(y0 + (dy * s) / steps);
    if (tx !== cx && ty !== cy && (opaque[cy * size + tx] || opaque[ty * size + cx])) return false;
    if (opaque[ty * size + tx]) return false;
    cx = tx;
    cy = ty;
  }
  return true;
}

/**
 * Light level 0..1 for every tile around `origin`. Only see-through tiles in direct line of
 * sight are lit (benches yes, pillars and rock no); walls are never lit, so light never reveals
 * what is behind them. The lit/unlit decision is an exact comparison of squares (radius is
 * quantised by the caller), so engines cannot disagree; only the brightness uses Math.pow.
 * `accumulate` keeps what `out` already holds and takes the maximum.
 */
export function computeLight(grid: Pick<Grid, 'size' | 'opaque'>, origin: number, radius: number, falloff: number, out: Float32Array, accumulate = false): Float32Array {
  const { opaque, size } = grid;
  if (!accumulate) out.fill(0);
  if (radius <= 0) return out;
  const px = origin % size;
  const py = (origin - px) / size;
  const reach = Math.ceil(radius) + 1;
  const limit = (radius + 0.5) * (radius + 0.5);
  for (let y = Math.max(0, py - reach); y <= Math.min(size - 1, py + reach); y++) {
    for (let x = Math.max(0, px - reach); x <= Math.min(size - 1, px + reach); x++) {
      const i = y * size + x;
      if (opaque[i]) continue;
      const d2 = (x - px) * (x - px) + (y - py) * (y - py);
      if (d2 > limit) continue;
      if (!clearLine(grid, px, py, x, y)) continue;
      const v = Math.max(0, 1 - Math.pow(Math.sqrt(d2 / limit), falloff));
      if (v > out[i]) out[i] = v;
    }
  }
  return out;
}
