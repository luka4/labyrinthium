import type { ArchProfile } from './architecture';
import { DIRS, TILE, TILE_SOLID, type Fixture, type Item, type Room, type Spot } from './floor';
import { CARRY, type ItemKind } from './lights';
import { shuffle, type Rng } from './rng';

/**
 * Light placement (plan 02). Two steps of the floor generator:
 *  - placeBraziers runs before the masks are derived (a brazier is a solid tile) and
 *    reverts any brazier that would cut the floor in two;
 *  - placeLights runs after the main path is known: found light (a budget of seconds per
 *    open tile), the oil jars, the wall sconces and the shrine candles.
 * Integer math and the items rng stream only: same seed, same lights on every device.
 */

const OIL_VALUE = 60;
const ITEM_GAP = 5;
const SCONCE_GAP = 7;

const manhattan = (size: number, a: number, b: number) => Math.abs((a % size) - (b % size)) + Math.abs(Math.floor(a / size) - Math.floor(b / size));

function reachableCount(tiles: Uint8Array, size: number, from: number): number {
  const seen = new Uint8Array(tiles.length);
  const queue = [from];
  seen[from] = 1;
  for (let h = 0; h < queue.length; h++) {
    const p = queue[h];
    const px = p % size;
    const py = (p - px) / size;
    for (const [dx, dy] of DIRS) {
      if (px + dx < 0 || px + dx >= size || py + dy < 0 || py + dy >= size) continue;
      const q = (py + dy) * size + px + dx;
      if (!seen[q] && !TILE_SOLID[tiles[q]]) {
        seen[q] = 1;
        queue.push(q);
      }
    }
  }
  return queue.length;
}

/** Turns one floor tile into a brazier if every other open tile stays reachable. */
function tryBrazier(tiles: Uint8Array, size: number, start: number, tile: number): boolean {
  if (tile < 0 || tiles[tile] !== TILE.FLOOR || tile === start) return false;
  const before = reachableCount(tiles, size, start);
  tiles[tile] = TILE.BRAZIER;
  if (reachableCount(tiles, size, start) === before - 1) return true;
  tiles[tile] = TILE.FLOOR;
  return false;
}

export function placeBraziers(args: {
  tiles: Uint8Array;
  roomOf: Int16Array;
  rooms: Room[];
  size: number;
  start: number;
  stairs: number;
  floorIndex: number;
  camp: boolean;
}): Fixture[] {
  const { tiles, roomOf, rooms, size, start, stairs, floorIndex, camp } = args;
  const out: Fixture[] = [];
  const add = (tile: number, eternal: boolean) => out.push({ tile, kind: 'brazier', wall: null, eternal });

  // pillared halls from floor 5: one brazier on the hall axis, on an even-offset tile
  if (floorIndex >= 4) {
    for (const room of rooms) {
      if (room.kind !== 'hall') continue;
      const cx = room.x + (room.w >> 1);
      const cy = room.y + (room.h >> 1);
      const cands: number[] = [];
      for (let y = room.y + 2; y < room.y + room.h - 2; y += 2)
        for (let x = room.x + 2; x < room.x + room.w - 2; x += 2) {
          const i = y * size + x;
          // four open orthogonal neighbours, none of them a pillar
          if (tiles[i] === TILE.FLOOR && roomOf[i] === room.id && DIRS.every(([dx, dy]) => tiles[i + dy * size + dx] === TILE.FLOOR)) cands.push(i);
        }
      const d = (i: number) => Math.abs((i % size) - cx) + Math.abs(Math.floor(i / size) - cy);
      cands.sort((a, b) => d(a) - d(b) || a - b);
      for (const c of cands) {
        if (tryBrazier(tiles, size, start, c)) {
          add(c, false);
          break;
        }
      }
    }
  }

  // camp landing: an eternal brazier beside the arrival
  if (camp) {
    const sx = start % size;
    const sy = Math.floor(start / size);
    for (const [dx, dy] of DIRS) {
      const i = (sy + dy) * size + sx + dx;
      if (tryBrazier(tiles, size, start, i)) {
        add(i, true);
        break;
      }
    }
  }

  // burial chamber: two eternal braziers flank the sarcophagus
  const sarc: number[] = [];
  for (let i = 0; i < tiles.length; i++) if (tiles[i] === TILE.SARCOPHAGUS) sarc.push(i);
  if (sarc.length === 2 && stairs >= 0) {
    const horizontal = Math.abs(sarc[0] - sarc[1]) === 1;
    const side = horizontal ? size : 1;
    // the far tile is the one farther from the artifact
    const far = manhattan(size, sarc[0], stairs) > manhattan(size, sarc[1], stairs) ? sarc[0] : sarc[1];
    const near = far === sarc[0] ? sarc[1] : sarc[0];
    let placed = 0;
    for (const base of [far, near])
      for (const sgn of [-1, 1]) {
        if (placed >= 2) break;
        if (tryBrazier(tiles, size, start, base + sgn * side)) {
          add(base + sgn * side, true);
          placed++;
        }
      }
  }
  return out;
}

type Weights = Array<[ItemKind, number, number]>;
/** [kind, weight, minFloor (1-based)] per spot */
const WEIGHTS: Record<Spot['kind'] | 'wayside', Weights> = {
  niche: [['candle', 3, 1], ['lamp', 2, 3], ['oilJar', 1, 1]],
  store: [['oilJar', 3, 1], ['torch', 2, 2], ['smallTorch', 2, 1], ['bigTorch', 1, 5]],
  deadEnd: [['torch', 2, 2], ['bigTorch', 2, 5], ['oilJar', 2, 1], ['lamp', 1, 3], ['smallTorch', 1, 1]],
  shrine: [['lamp', 1, 1], ['candle', 1, 1]],
  wayside: [['smallTorch', 3, 1], ['candle', 2, 1]],
};

function pickKind(table: Weights, floor: number, rng: Rng): ItemKind {
  const ok = table.filter(([, , min]) => floor >= min);
  let total = 0;
  for (const [, w] of ok) total += w;
  let r = rng() * total;
  for (const [k, w] of ok) {
    r -= w;
    if (r < 0) return k;
  }
  return ok[ok.length - 1][0];
}

/** Seconds of light an item is worth for the budget. */
export const itemSeconds = (kind: ItemKind) => (kind === 'oilJar' ? OIL_VALUE : CARRY[kind].seconds);

export function placeLights(a: {
  profile: ArchProfile;
  size: number;
  tiles: Uint8Array;
  solid: Uint8Array;
  roomOf: Int16Array;
  rooms: Room[];
  spots: Spot[];
  dist: Int32Array;
  onPath: Uint8Array;
  mainPath: Int32Array;
  arrivalRoom: number;
  stairsRoom: number;
  start: number;
  stairs: number;
  floorIndex: number;
  rng: Rng;
}): { items: Item[]; sconces: Fixture[]; shrines: Fixture[]; budget: number } {
  const { profile, size, tiles, solid, roomOf, rooms, spots, dist, onPath, mainPath, arrivalRoom, stairsRoom, start, stairs, floorIndex, rng } = a;
  const floor = floorIndex + 1;
  let open = 0;
  for (let i = 0; i < solid.length; i++) if (!solid[i] && tiles[i] !== TILE.ROCK) open++;
  const table = profile.lights.secPerTile;
  const budget = Math.round(open * table[Math.min(floorIndex, table.length - 1)]);
  const maxItems = Math.ceil(budget / 60) + 1;

  const items: Item[] = [];
  const taken = new Set<number>();
  const spaced = (t: number) => items.every((it) => manhattan(size, it.tile, t) >= ITEM_GAP);
  const isOpen = (x: number, y: number) => x >= 0 && y >= 0 && x < size && y < size && !solid[y * size + x] && tiles[y * size + x] !== TILE.ROCK;
  const quiet = (tile: number) => roomOf[tile] !== arrivalRoom && roomOf[tile] !== stairsRoom && tile !== start && tile !== stairs && dist[tile] >= 0;

  /** a straight passage tile with exactly two open neighbours in a line, away from doors */
  const straight = (i: number): boolean => {
    if (tiles[i] !== TILE.FLOOR || roomOf[i] < 0 || rooms[roomOf[i]].kind !== 'passage' || !quiet(i) || dist[i] < 8) return false;
    const x = i % size;
    const y = (i - x) / size;
    const w = isOpen(x - 1, y);
    const e = isOpen(x + 1, y);
    const n = isOpen(x, y - 1);
    const s = isOpen(x, y + 1);
    if (!((w && e && !n && !s) || (n && s && !w && !e))) return false;
    return !DIRS.some(([dx, dy]) => tiles[(y + dy) * size + x + dx] === TILE.DOOR);
  };
  const wayside: number[] = [];
  for (let i = 0; i < tiles.length; i++) if (straight(i)) wayside.push(i);

  // the teaching item on floors 1-2, on the main path at 30-50 %
  if (floorIndex < 2) {
    let pick = -1;
    for (let k = Math.floor(mainPath.length * 0.3); k <= Math.floor(mainPath.length * 0.5) && pick < 0; k++) if (straight(mainPath[k])) pick = mainPath[k];
    for (let k = Math.floor(mainPath.length * 0.15); k < mainPath.length * 0.8 && pick < 0; k++) if (straight(mainPath[k])) pick = mainPath[k];
    if (pick >= 0) {
      items.push({ tile: pick, kind: floorIndex === 0 ? 'smallTorch' : 'candle', spot: 'wayside' });
      taken.add(pick);
    }
  }

  // candidates off the main path
  const hasShrineFixture = floor >= 3;
  type Cand = { tile: number; spot: Spot['kind'] | 'wayside' };
  const cands: Cand[] = [];
  for (const sp of spots) {
    if (!quiet(sp.tile) || onPath[sp.tile]) continue;
    if (sp.kind === 'shrine' && hasShrineFixture) continue;
    cands.push({ tile: sp.tile, spot: sp.kind });
  }
  for (const w of wayside) if (!onPath[w]) cands.push({ tile: w, spot: 'wayside' });
  shuffle(cands, rng);

  // the guaranteed oil jar first (a real spot if there is one), then carried light up to the budget
  const jarAt =
    cands.find((c) => c.spot !== 'wayside' && spaced(c.tile)) ??
    cands.find((c) => spaced(c.tile)) ??
    ((): Cand => {
      const f: Cand[] = [];
      for (let i = 0; i < tiles.length; i++) if (!solid[i] && tiles[i] === TILE.FLOOR && !onPath[i] && quiet(i) && dist[i] > 0 && spaced(i)) f.push({ tile: i, spot: 'store' });
      return f.length ? shuffle(f, rng)[0] : { tile: start, spot: 'store' };
    })();
  items.push({ tile: jarAt.tile, kind: 'oilJar', spot: jarAt.spot });
  taken.add(jarAt.tile);

  const found = () => items.reduce((sum, it) => sum + itemSeconds(it.kind), 0);
  for (const c of cands) {
    if (found() >= budget || items.length >= maxItems) break;
    if (taken.has(c.tile) || !spaced(c.tile)) continue;
    items.push({ tile: c.tile, kind: pickKind(WEIGHTS[c.spot], floor, rng), spot: c.spot });
    taken.add(c.tile);
  }

  // sconces: on the north wall face, middle of long passages or just inside doors of rooms
  const sconces: Fixture[] = [];
  const nSconce = floor < 2 ? 0 : Math.min(profile.sconceCap(floorIndex), Math.floor(open / 90));
  if (nSconce > 0) {
    const cs: number[] = [];
    const wallRun = (x: number, y: number, step: number) => {
      let n = 0;
      while (tiles[y * size + x + step * (n + 1)] === TILE.FLOOR && tiles[(y - 1) * size + x + step * (n + 1)] === TILE.ROCK) n++;
      return n;
    };
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i] !== TILE.FLOOR || !quiet(i) || taken.has(i)) continue;
      const x = i % size;
      const y = (i - x) / size;
      if (y < 1 || tiles[(y - 1) * size + x] !== TILE.ROCK) continue;
      const room = rooms[roomOf[i]];
      if (!room || room.kind === 'stairsUp' || room.kind === 'stairsDown' || room.kind === 'burial') continue;
      if (room.kind === 'passage') {
        const l = wallRun(x, y, -1);
        const r = wallRun(x, y, 1);
        if (l + r + 1 < 6 || Math.abs(l - r) > 1) continue;
      } else if (!DIRS.some(([dx, dy]) => tiles[(y + dy) * size + x + dx] === TILE.DOOR)) continue;
      cs.push(i);
    }
    shuffle(cs, rng);
    for (const i of cs) {
      if (sconces.length >= nSconce) break;
      if (sconces.every((f) => manhattan(size, f.tile, i) >= SCONCE_GAP) && items.every((it) => manhattan(size, it.tile, i) >= 2)) {
        sconces.push({ tile: i, kind: 'sconce', wall: 3, eternal: false });
      }
    }
  }

  // shrine candles on every shrine niche from floor 3
  const shrines: Fixture[] = [];
  if (hasShrineFixture) for (const sp of spots) if (sp.kind === 'shrine') shrines.push({ tile: sp.tile, kind: 'shrineCandles', wall: null, eternal: false });

  return { items, sconces, shrines, budget };
}
