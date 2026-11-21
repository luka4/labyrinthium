import type { ArchProfileId } from './architecture';
import type { Pyramid } from './game';
import type { FixtureKind, ItemKind } from './lights';

/**
 * A floor is a square tile grid built from an architectural plan (see generate.ts):
 * passages, chambers, pillared halls, galleries, storerooms and stairwells with thick
 * walls. Logic is grid based and deterministic; the renderer derives the look.
 */

/** Tile kinds. Extended by later tasks (water, roots, plates...); add flags in the tables below. */
export const TILE = {
  ROCK: 0,
  FLOOR: 1,
  DOOR: 2,
  PILLAR: 3,
  NICHE: 4,
  STAIRS_DOWN: 5,
  STAIRS_UP: 6,
  BENCH: 7,
  SARCOPHAGUS: 8,
  BRAZIER: 9,
} as const;
export type TileKind = (typeof TILE)[keyof typeof TILE];

/** Per-kind flags, indexed by TILE value. Grow the tables when adding kinds. */
export const TILE_SOLID = Uint8Array.of(1, 0, 0, 1, 0, 0, 1, 1, 1, 1); // blocks movement
export const TILE_OPAQUE = Uint8Array.of(1, 0, 0, 1, 0, 0, 0, 0, 0, 0); // blocks light

export type RoomKind =
  | 'passage'
  | 'chamber'
  | 'hall'
  | 'gallery'
  | 'magazines'
  | 'shrine'
  | 'antechamber'
  | 'stairsUp'
  | 'stairsDown'
  | 'burial';

export type Room = {
  id: number;
  kind: RoomKind;
  /** carved rectangle (bounding box for passages and storerooms) */
  x: number;
  y: number;
  w: number;
  h: number;
  /** lattice sites the room covers */
  sites: number[];
  /** door/port tiles on its boundary */
  doors: number[];
  leaf: boolean;
  /** touches the main path */
  main: boolean;
  /** BFS steps from the start to the nearest tile of the room */
  depth: number;
};

export type SpotKind = 'deadEnd' | 'store' | 'niche' | 'shrine';
/** A place where later systems (light sources, traps) may put things. */
export type Spot = { tile: number; kind: SpotKind; room: number; dist: number; main: boolean };

/** Something lying on the floor to pick up; `spot` says where the generator found the place. */
export type Item = { tile: number; kind: ItemKind; spot: SpotKind | 'wayside' };
/**
 * A fixed light. sconce: `tile` is the open tile in front of a wall face (`wall`: 3 = the wall to the north);
 * brazier: its own BRAZIER tile; shrineCandles: the shrine niche tile. eternal = pre-lit, never burns down.
 */
export type Fixture = { tile: number; kind: FixtureKind; wall: number | null; eternal: boolean };

export type Lattice = { n: number; colX: number[]; rowY: number[]; axisX: number[]; axisY: number[] };

export type Floor = {
  /** tiles per side */
  size: number;
  tiles: Uint8Array;
  /** movement mask (derived from tiles) */
  solid: Uint8Array;
  /** light mask (derived from tiles) */
  opaque: Uint8Array;
  /** room id per tile, -1 for rock */
  room: Int16Array;
  rooms: Room[];
  links: Array<{ a: number; b: number; door: number }>;
  /** arrival landing tile (next to STAIRS_UP) */
  start: number;
  /** goal: the STAIRS_DOWN tile, or the artifact tile in the basement */
  stairs: number;
  /** things to pick up (light sources, oil jars) */
  items: Item[];
  /** sconces, braziers, shrine candles */
  fixtures: Fixture[];
  spots: Spot[];
  /** tiles from start to stairs */
  mainPath: Int32Array;
  lattice: Lattice;
  profile: ArchProfileId;
  /** loop edges added on top of the spanning tree */
  loops: number;
  seed: number;
};

export const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function floorSeed(pyramid: Pyramid, floorIndex: number): number {
  return (pyramid.seed * 7919 + floorIndex * 104729) | 0;
}

export function distancesFrom(solid: Uint8Array, size: number, from: number): Int32Array {
  const dist = new Int32Array(size * size).fill(-1);
  const queue = [from];
  dist[from] = 0;
  for (let h = 0; h < queue.length; h++) {
    const p = queue[h];
    const px = p % size;
    const py = (p - px) / size;
    for (const [dx, dy] of DIRS) {
      const nx = px + dx;
      const ny = py + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const np = ny * size + nx;
      if (!solid[np] && dist[np] < 0) {
        dist[np] = dist[p] + 1;
        queue.push(np);
      }
    }
  }
  return dist;
}
