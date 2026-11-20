import type { Floor } from './floor';

/**
 * True when a straight line between two tile centers is not blocked by an opaque
 * tile (rock, pillar) and never squeezes diagonally between two such corners.
 */
function clearLine(floor: Floor, x0: number, y0: number, x1: number, y1: number): boolean {
  const { opaque, size } = floor;
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

/** Torch radius in tiles for a fuel level 0..1. */
export function torchRadius(fuel: number): number {
  return fuel > 0 ? 1.4 + 3.6 * fuel : 0.9;
}

/**
 * Light level 0..1 for every tile. Only see-through tiles in direct line of
 * sight are lit (benches yes, pillars and rock no); walls are never lit, so light never reveals what is behind them.
 */
export function computeLight(floor: Floor, pos: number, radius: number, out: Float32Array): Float32Array {
  const { opaque, size } = floor;
  out.fill(0);
  const px = pos % size;
  const py = (pos - px) / size;
  const reach = Math.ceil(radius) + 1;
  for (let y = Math.max(0, py - reach); y <= Math.min(size - 1, py + reach); y++) {
    for (let x = Math.max(0, px - reach); x <= Math.min(size - 1, px + reach); x++) {
      const i = y * size + x;
      if (opaque[i]) continue;
      const d = Math.hypot(x - px, y - py);
      if (d > radius + 0.5) continue;
      if (clearLine(floor, px, py, x, y)) out[i] = Math.max(0, 1 - Math.pow(d / (radius + 0.5), 1.6));
    }
  }
  return out;
}
