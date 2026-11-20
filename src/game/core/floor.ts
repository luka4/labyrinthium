import { createRng, shuffle } from './rng';

/**
 * A floor is a square tile grid of (2n+1)×(2n+1) tiles for n×n cells:
 * odd/odd tiles are cells, tiles between them are walls or passages.
 */
export type Floor = {
  /** cells per side */
  n: number;
  /** tiles per side */
  size: number;
  /** 1 = wall, 0 = open */
  walls: Uint8Array;
  /** tile index of the arrival point (center) */
  start: number;
  /** tile index of the stairs down (farthest cell from the start) */
  stairs: number;
  /** tile indices with an oil jar */
  oil: number[];
};

export const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export type FloorSpec = { cells: number; seed: number; loopRate: number };

/** Floor size curve for a pyramid: fast growth at first, then slower. */
export function floorCells(floorIndex: number, floorCount: number, first = 5, last = 25): number {
  const t = floorCount <= 1 ? 1 : floorIndex / (floorCount - 1);
  const cells = Math.round(first + (last - first) * Math.pow(t, 0.7));
  return cells | 1; // odd, so the start sits exactly in the middle
}

export function generateFloor({ cells: n, seed, loopRate }: FloorSpec): Floor {
  const rng = createRng(seed);
  const size = 2 * n + 1;
  const walls = new Uint8Array(size * size).fill(1);
  const visited = new Uint8Array(n * n);
  const tile = (cx: number, cy: number) => (2 * cy + 1) * size + 2 * cx + 1;

  // 1. recursive backtracker from the center cell
  const c = Math.floor(n / 2);
  const stack: Array<[number, number]> = [[c, c]];
  visited[c * n + c] = 1;
  walls[tile(c, c)] = 0;
  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const options: Array<[number, number, number]> = [];
    DIRS.forEach(([dx, dy], k) => {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < n && ny < n && !visited[ny * n + nx]) options.push([nx, ny, k]);
    });
    if (!options.length) {
      stack.pop();
      continue;
    }
    const [nx, ny, k] = options[Math.floor(rng() * options.length)];
    walls[(2 * y + 1 + DIRS[k][1]) * size + 2 * x + 1 + DIRS[k][0]] = 0;
    walls[tile(nx, ny)] = 0;
    visited[ny * n + nx] = 1;
    stack.push([nx, ny]);
  }

  // 2. loops: open some walls that separate two open cells
  const candidates: number[] = [];
  for (let ty = 1; ty < size - 1; ty++) {
    for (let tx = 1; tx < size - 1; tx++) {
      const i = ty * size + tx;
      if (!walls[i]) continue;
      if (tx % 2 === 0 && ty % 2 === 1 && !walls[i - 1] && !walls[i + 1]) candidates.push(i);
      if (tx % 2 === 1 && ty % 2 === 0 && !walls[i - size] && !walls[i + size]) candidates.push(i);
    }
  }
  shuffle(candidates, rng)
    .slice(0, Math.round(n * n * loopRate))
    .forEach((i) => (walls[i] = 0));

  // 3. stairs on the farthest cell from the start
  const start = tile(c, c);
  const dist = distancesFrom(walls, size, start);
  let stairs = start;
  for (let i = 0; i < dist.length; i++) {
    const x = i % size;
    const y = (i - x) / size;
    if (x % 2 === 1 && y % 2 === 1 && dist[i] > dist[stairs]) stairs = i;
  }

  // 4. oil jars in dead ends
  const deadEnds: number[] = [];
  for (let i = 0; i < walls.length; i++) {
    const x = i % size;
    const y = (i - x) / size;
    if (x % 2 !== 1 || y % 2 !== 1 || i === start || i === stairs) continue;
    const open = DIRS.filter(([dx, dy]) => !walls[(y + dy) * size + x + dx]).length;
    if (open === 1) deadEnds.push(i);
  }
  const oil = shuffle(deadEnds, rng).slice(0, Math.max(1, Math.round((n * n) / 14)));

  return { n, size, walls, start, stairs, oil };
}

export function distancesFrom(walls: Uint8Array, size: number, from: number): Int32Array {
  const dist = new Int32Array(size * size).fill(-1);
  const queue = [from];
  dist[from] = 0;
  for (let h = 0; h < queue.length; h++) {
    const p = queue[h];
    const px = p % size;
    const py = (p - px) / size;
    for (const [dx, dy] of DIRS) {
      const np = (py + dy) * size + px + dx;
      if (!walls[np] && dist[np] < 0) {
        dist[np] = dist[p] + 1;
        queue.push(np);
      }
    }
  }
  return dist;
}
