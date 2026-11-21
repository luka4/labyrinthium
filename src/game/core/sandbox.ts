import { DIRS, TILE, type Floor } from './floor';
import { MAX_DEEP_RUN, SWIM } from './water';

/**
 * The water sandbox (plan 06): a deterministic copy of a floor (Egypt floor 3 in use) with water, for
 * the checks and the dev-only power sandbox, until the cenotes (07) and moats (08) exist. Not memoised.
 *
 *  - the longest straight stretch of the main path away from start and stairs gets 2 tiles of shallow
 *    water then 4-6 tiles of deep water (inside MAX_DEEP_RUN): the Naga swims it faster;
 *  - the doorway of the deepest leaf side room off the path is flooded to the ceiling (the door and up
 *    to 2 passage tiles before it); the room behind stays dry and holds an oil jar (the reward for diving).
 * It passes `waterFairness`: the route to the stairs needs no power.
 */
export const SANDBOX_SHALLOW = 80;
export const SANDBOX_DEEP = 170;
export const SANDBOX_FLOODED = 240;

export function waterSandbox(base: Floor): Floor {
  const { size } = base;
  const water = new Uint8Array(size * size);
  const path = base.mainPath;
  const onPath = new Uint8Array(size * size);
  for (const p of path) onPath[p] = 1;

  // 1. the longest straight run of the main path, 3 tiles clear of both ends
  let best = { from: 0, len: 0 };
  let runFrom = 3;
  for (let i = 4; i <= path.length - 4; i++) {
    const straight = i < path.length - 3 && path[i] - path[i - 1] === path[i - 1] - path[i - 2];
    if (!straight) {
      if (i - runFrom > best.len) best = { from: runFrom, len: i - runFrom };
      runFrom = i - 1;
    }
  }
  if (best.len >= 6) {
    const deep = Math.min(6, best.len - 2, MAX_DEEP_RUN);
    for (let k = 0; k < 2; k++) water[path[best.from + k]] = SANDBOX_SHALLOW;
    for (let k = 0; k < deep; k++) water[path[best.from + 2 + k]] = SANDBOX_DEEP;
  }

  // 2. the deepest leaf side room off the path: its doorway floods, the room stays dry
  const extra: Floor['items'] = [];
  const leaf = base.rooms
    .filter((r) => r.leaf && !r.main && r.doors.length === 1 && r.kind !== 'passage' && r.kind !== 'stairsUp' && r.kind !== 'stairsDown')
    .sort((a, b) => b.depth - a.depth || a.id - b.id)[0];
  if (leaf) {
    const door = leaf.doors[0];
    water[door] = SANDBOX_FLOODED;
    // up to 2 passage tiles before it, away from the room
    let frontier = [door];
    for (let d = 0; d < 2; d++) {
      const nextTiles: number[] = [];
      for (const t of frontier) {
        const x = t % size;
        const y = (t - x) / size;
        for (const [dx, dy] of DIRS) {
          const q = (y + dy) * size + (x + dx);
          if (base.solid[q] || base.room[q] === leaf.id || onPath[q] || water[q]) continue;
          water[q] = SANDBOX_FLOODED;
          nextTiles.push(q);
        }
      }
      frontier = nextTiles;
    }
    // an oil jar inside, on an open floor tile with nothing on it
    const taken = new Set<number>([...base.items.map((i) => i.tile), ...base.fixtures.map((f) => f.tile)]);
    for (let q = 0; q < size * size; q++) {
      if (base.room[q] === leaf.id && base.tiles[q] === TILE.FLOOR && !taken.has(q) && !water[q]) {
        extra.push({ tile: q, kind: 'oilJar', spot: 'deadEnd' });
        break;
      }
    }
  }

  // 3. keep the fixed things dry (lower anything that would break the fairness rules)
  const clear = (t: number, to: number) => {
    if (t >= 0 && water[t] > to) water[t] = to;
  };
  for (const it of base.items) clear(it.tile, SWIM - 1);
  for (const f of base.fixtures) clear(f.tile, SWIM - 1);
  clear(base.start, 0);
  clear(base.stairs, 0);
  clear(base.exitFront, 0);
  for (const t of base.traps) clear(t.tile, 0);
  for (const k of base.secrets) clear(k.front, 0);
  if (base.guardian) clear(base.guardian.lair, 0);
  return { ...base, water, items: [...base.items, ...extra] };
}
