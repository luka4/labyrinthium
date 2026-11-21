import { linearLoopRate, type ArchProfile } from './architecture';
import type { EgyptRow } from './egypt';
import type { RuleRows } from './plugins';

/** One floor of a pyramid's table: Egypt's row (size, rooms, light, traps, collapse, guardian) plus plug-in parameters. */
export type FloorRow = EgyptRow & { rules?: Partial<RuleRows> };

/** A pyramid's floors as data, like egypt.ts. */
export type PyramidTable = {
  rows: readonly FloorRow[];
  /** 0-based camp floors */
  camps: readonly number[];
  secrets: (i: number) => number;
  /** 0-based floors whose first secret holds a story fragment */
  fragmentFloors: readonly number[];
};

type Shape = Pick<ArchProfile, 'span' | 'straightness' | 'loops' | 'leafRooms' | 'junctionRoom' | 'nicheRate' | 'basementRoom' | 'falseDoor'> & Partial<ArchProfile>;

/** An ArchProfile whose numbers come from a table. Maps rows exactly like the EGYPT profile literal does. */
export function profileFromTable(id: string, table: PyramidTable, shape: Shape): ArchProfile {
  const { rows } = table;
  const at = (i: number) => rows[Math.min(i, rows.length - 1)];
  const profile: ArchProfile = {
    sites: rows.map((r) => r.sites),
    loopRate: (i) => at(i).loops ?? linearLoopRate(profile.loops, i),
    sconceCap: (i) => at(i).sconceCap,
    traps: (i) => at(i).traps,
    collapse: (i) => at(i).collapse,
    guardian: (i) => at(i).guardian,
    escapeCap: (i) => at(i).escapeCap,
    secrets: table.secrets,
    fragment: (i) => (table.fragmentFloors as readonly number[]).indexOf(i),
    halls: (i) => at(i).halls,
    galleries: (i) => at(i).galleries,
    lights: { secPerTile: rows.map((r) => r.secPerTile) },
    row: at,
    ...shape,
    id,
  } as ArchProfile;
  return profile;
}
