import { DIRS } from './floor';

/** Graph helpers over a solid mask (4-connected open tiles). Integer only, deterministic. */

/** BFS from `from` over non-solid tiles; fills `out` with steps (-1 unreached) and returns the visit order. */
export function bfsFrom(solid: Uint8Array, size: number, from: number, out: Int32Array): number[] {
  out.fill(-1);
  const queue = [from];
  out[from] = 0;
  for (let h = 0; h < queue.length; h++) {
    const p = queue[h];
    const px = p % size;
    const py = (p - px) / size;
    for (const [dx, dy] of DIRS) {
      const nx = px + dx;
      const ny = py + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const np = ny * size + nx;
      if (!solid[np] && out[np] < 0) {
        out[np] = out[p] + 1;
        queue.push(np);
      }
    }
  }
  return queue;
}

/** Number of open tiles reachable from `from` (including it). */
export function reachable(solid: Uint8Array, size: number, from: number): number {
  return bfsFrom(solid, size, from, new Int32Array(size * size)).length;
}

/**
 * Articulation points of the open-tile graph (iterative Tarjan): `out[i] = 1` when removing
 * tile i would split its component. Handles every component.
 */
export function articulationPoints(solid: Uint8Array, size: number, out: Uint8Array): void {
  const n = size * size;
  out.fill(0);
  const disc = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const parent = new Int32Array(n).fill(-1);
  const next = new Uint8Array(n);
  const stack: number[] = [];
  let time = 0;
  for (let root = 0; root < n; root++) {
    if (solid[root] || disc[root] >= 0) continue;
    let rootChildren = 0;
    disc[root] = low[root] = time++;
    stack.push(root);
    while (stack.length) {
      const u = stack[stack.length - 1];
      if (next[u] < 4) {
        const [dx, dy] = DIRS[next[u]++];
        const ux = u % size;
        const uy = (u - ux) / size;
        const vx = ux + dx;
        const vy = uy + dy;
        if (vx < 0 || vy < 0 || vx >= size || vy >= size) continue;
        const v = vy * size + vx;
        if (solid[v]) continue;
        if (disc[v] < 0) {
          parent[v] = u;
          disc[v] = low[v] = time++;
          if (u === root) rootChildren++;
          stack.push(v);
        } else if (v !== parent[u] && disc[v] < low[u]) {
          low[u] = disc[v];
        }
      } else {
        stack.pop();
        const p = parent[u];
        if (p >= 0) {
          if (low[u] < low[p]) low[p] = low[u];
          if (p !== root && low[u] >= disc[p]) out[p] = 1;
        }
      }
    }
    if (rootChildren > 1) out[root] = 1;
  }
}

/**
 * The open tile nearest (Manhattan, ties lowest index) to the point (x, y) that `reject` does not
 * refuse. Walls do not matter: this is "straight down", not a walking distance.
 */
export function nearestOpen(solid: Uint8Array, size: number, x: number, y: number, reject: (tile: number) => boolean): number {
  let best = -1;
  let bestD = 1 << 30;
  for (let i = 0; i < solid.length; i++) {
    if (solid[i] || reject(i)) continue;
    const d = Math.abs((i % size) - x) + Math.abs(Math.floor(i / size) - y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
