import type { Lattice, Room, RoomKind, Spot } from './floor';
import { EGYPT_FRAGMENT_FLOORS, EGYPT_ROWS, EGYPT_SECRETS, type EgyptRow, type GuardianRow } from './egypt';
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
  /** optional loop rate by floor index; absent = the linear ramp of `loops` */
  loopRate?: (floorIndex: number) => number;
  /** most wall sconces on a floor */
  sconceCap: (floorIndex: number) => number;
  /** pressure-plate trap targets by floor index (traps.ts); absent = none */
  traps?: (floorIndex: number) => EgyptRow['traps'];
  /** the collapse of the floor above (collapse.ts); absent or null = none */
  collapse?: (floorIndex: number) => EgyptRow['collapse'];
  /** the tomb guardian of a floor (plan 04); absent or null = none */
  guardian?: (floorIndex: number) => GuardianRow | null;
  /** sealed secret chambers on a floor (secrets.ts); absent = 1 */
  secrets?: (floorIndex: number) => number;
  /** the story fragment index held by the first secret of a floor, or -1 */
  fragment?: (floorIndex: number) => number;
  /** basement: the sand's cap % once the artifact is taken; absent or null = no escape sand */
  escapeCap?: (floorIndex: number) => number | null;
  /** the basement has a false door that opens onto the escape shaft */
  falseDoor: boolean;
  /** weights for dead-end rooms */
  leafRooms: Partial<Record<RoomKind, number>>;
  /** chance a site with 3+ ports becomes a chamber */
  junctionRoom: number;
  /** chance per eligible straight passage tile to get a niche */
  nicheRate: number;
  /** found light per open tile in seconds, by floor index (last value repeats) */
  lights: { secPerTile: readonly number[] };
  basementRoom: RoomKind;
  /** post-carve passes; each gets its own rng stream */
  hooks?: Array<(ctx: GenContext) => void>;
};

/** The linear loop ramp of plan 01 (floors 1-10 of Egypt, every floor of the other profiles). */
export function linearLoopRate(loops: ArchProfile['loops'], floorIndex: number): number {
  const { fromFloor, maxRate, atFloor } = loops;
  return floorIndex < fromFloor ? 0 : (maxRate * Math.min(floorIndex - fromFloor + 1, atFloor - fromFloor + 1)) / (atFloor - fromFloor + 1);
}

const EGYPT: ArchProfile = {
  id: 'egypt',
  sites: EGYPT_ROWS.map((r) => r.sites),
  span: [3, 5],
  straightness: 0.55,
  loops: { fromFloor: 3, maxRate: 0.12, atFloor: 9 },
  loopRate: (i) => EGYPT_ROWS[Math.min(i, EGYPT_ROWS.length - 1)].loops ?? linearLoopRate(EGYPT.loops, i),
  sconceCap: (i) => EGYPT_ROWS[Math.min(i, EGYPT_ROWS.length - 1)].sconceCap,
  traps: (i) => EGYPT_ROWS[Math.min(i, EGYPT_ROWS.length - 1)].traps,
  collapse: (i) => EGYPT_ROWS[Math.min(i, EGYPT_ROWS.length - 1)].collapse,
  guardian: (i) => EGYPT_ROWS[Math.min(i, EGYPT_ROWS.length - 1)].guardian,
  escapeCap: (i) => EGYPT_ROWS[Math.min(i, EGYPT_ROWS.length - 1)].escapeCap,
  secrets: EGYPT_SECRETS,
  fragment: (i) => (EGYPT_FRAGMENT_FLOORS as readonly number[]).indexOf(i),
  falseDoor: true,
  halls: (i) => EGYPT_ROWS[Math.min(i, EGYPT_ROWS.length - 1)].halls,
  galleries: (i) => EGYPT_ROWS[Math.min(i, EGYPT_ROWS.length - 1)].galleries,
  leafRooms: { chamber: 5, magazines: 3, shrine: 2 },
  junctionRoom: 0.3,
  nicheRate: 0.06,
  lights: { secPerTile: EGYPT_ROWS.map((r) => r.secPerTile) },
  basementRoom: 'burial',
};

const PROFILES: Record<ArchProfileId, ArchProfile> = {
  egypt: EGYPT,
  generic: {
    ...EGYPT,
    id: 'generic',
    sites: [3, 4, 5, 6, 7],
    loops: { fromFloor: 2, maxRate: 0.1, atFloor: 4 },
    halls: (i) => (i < 2 ? 0 : i < 6 ? 1 : 2),
    galleries: (i) => (i < 3 ? 0 : 1),
    lights: { secPerTile: [0.3, 0.28, 0.26, 0.24, 0.22, 0.2, 0.18, 0.16, 0.15, 0.14] },
    loopRate: undefined,
    sconceCap: () => 8,
    traps: undefined,
    collapse: undefined,
    guardian: undefined,
    escapeCap: undefined,
    secrets: () => 1,
    fragment: () => -1,
    falseDoor: false,
  },
  black: {
    ...EGYPT,
    id: 'black',
    sites: [4, 5, 6, 7, 8],
    loops: { fromFloor: 1, maxRate: 0.12, atFloor: 4 },
    halls: (i) => (i < 2 ? 0 : i < 6 ? 1 : 2),
    galleries: (i) => (i < 3 ? 0 : 1),
    lights: { secPerTile: [0.3, 0.28, 0.26, 0.24, 0.22, 0.2, 0.18, 0.16, 0.15, 0.14] },
    loopRate: undefined,
    sconceCap: () => 8,
    traps: undefined,
    collapse: undefined,
    guardian: undefined,
    escapeCap: undefined,
    secrets: () => 1,
    fragment: () => -1,
    falseDoor: false,
  },
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
  /** a camp floor: an eternal brazier burns beside the landing */
  camp?: boolean;
  /** the next floor is a camp: no trapdoor drops you there (traps.ts) */
  nextIsCamp?: boolean;
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
