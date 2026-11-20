import type { Lattice, Room, RoomKind, Spot } from './floor';
import type { Rng } from './rng';

/**
 * Architecture profiles: what a pyramid's floors are built from. One profile per
 * culture; later tasks add profiles ('maya', 'khmer', 'china'), room carvers and
 * post-carve hooks (traps, light sources, culture features) without touching the
 * base layout code.
 */
export type ArchProfileId = 'egypt' | 'generic' | 'black';

export type ArchProfile = {
  id: ArchProfileId;
  /** sites per side for floor index 0..k (explicit table) */
  sites: readonly number[];
  /** interior tiles of one site band [min, max] */
  span: readonly [number, number];
  /** chance 0..1 that the tree walk keeps its direction */
  straightness: number;
  /** linear ramp of loop edges / possible edges */
  loops: { fromFloor: number; maxRate: number; atFloor: number };
  /** quota of merged pillared halls */
  halls: (floorIndex: number) => number;
  /** quota of 1x3 galleries on the tree */
  galleries: (floorIndex: number) => number;
  /** weights for dead-end rooms */
  leafRooms: Partial<Record<RoomKind, number>>;
  /** chance a site with 3+ ports becomes a chamber */
  junctionRoom: number;
  /** chance per eligible straight passage tile to get a niche */
  nicheRate: number;
  /** one oil jar per N open tiles (min 1) */
  oilPerTiles: number;
  basementRoom: RoomKind;
  /** post-carve passes; each gets its own rng stream */
  hooks?: Array<(ctx: GenContext) => void>;
};

const EGYPT: ArchProfile = {
  id: 'egypt',
  sites: [3, 4, 5, 5, 6, 6, 7, 7, 8, 8],
  span: [3, 5],
  straightness: 0.55,
  loops: { fromFloor: 3, maxRate: 0.12, atFloor: 9 },
  halls: (i) => (i < 2 ? 0 : i < 6 ? 1 : 2),
  galleries: (i) => (i < 3 ? 0 : 1),
  leafRooms: { chamber: 5, magazines: 3, shrine: 2 },
  junctionRoom: 0.3,
  nicheRate: 0.06,
  oilPerTiles: 70,
  basementRoom: 'burial',
};

const PROFILES: Record<ArchProfileId, ArchProfile> = {
  egypt: EGYPT,
  generic: { ...EGYPT, id: 'generic', sites: [3, 4, 5, 6, 7], loops: { fromFloor: 2, maxRate: 0.1, atFloor: 4 } },
  black: { ...EGYPT, id: 'black', sites: [4, 5, 6, 7, 8], loops: { fromFloor: 1, maxRate: 0.12, atFloor: 4 } },
};

export function profileFor(id: ArchProfileId): ArchProfile {
  return PROFILES[id];
}

export type Dir = 0 | 1 | 2 | 3; // index into DIRS: east, west, south, north

/** A doorway between two rooms, on a lattice boundary line. */
export type Port = { site: number; dir: Dir; x: number; y: number; to: number };

export type RoomDraft = Room & { ports: Port[] };

export type GenSpec = {
  seed: number;
  floorIndex: number;
  basement: boolean;
  profile: ArchProfileId;
  /** the previous floor's stairs in world coordinates (floor centre = 0,0); null on the top floor */
  arrivalWorld: { x: number; y: number } | null;
};

/** What carvers and hooks may read and write. Hooks must not break connectivity. */
export type GenContext = {
  spec: GenSpec;
  profile: ArchProfile;
  size: number;
  lattice: Lattice;
  tiles: Uint8Array;
  /** room id per tile, -1 for rock */
  roomOf: Int16Array;
  rooms: RoomDraft[];
  spots: Spot[];
  /** the rng stream of the current stage (rooms stream for carvers, a private one for hooks) */
  rng: Rng;
  /** tiles that carvers report: arrival landing and goal */
  marks: { start: number; stairs: number };
};

export type Carver = (ctx: GenContext, room: RoomDraft) => void;

/** Registry of room carvers by kind; carvers.ts fills it, culture tasks add kinds. */
export const ROOM_CARVERS: Record<string, Carver> = {};
