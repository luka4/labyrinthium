/**
 * Egypt's 25 floors as data (plan 03): size, rooms, light, traps, collapse and the play time each
 * floor aims at. Pure data with no imports, so architecture.ts and pyramids.ts can both read it.
 * Rows 1-9 are frozen (their floors are bit-identical to plan 01); row 10 keeps its numbers but is
 * a normal floor now. Rows 11-25 and all trap/collapse numbers may be tuned.
 */
import type { PyramidTable } from './tables';

export type GuardianRow = {
  /** which sprite and sounds the kit uses (src/kits); default 'keeper' */
  kind?: string;
  /** seconds of burning time before it wakes by itself (the sentinel: Infinity, only the Scarab wakes it) */
  wake: number;
  /** seconds per tile: walking its rounds, searching a noise, hunting you */
  patrol: number;
  search: number;
  hunt: number;
  /** a guardian hunting you on the floor above comes down after you */
  follow: boolean;
  /** the basement: stands beside the burial chamber's door until the Scarab is lifted */
  sentinel: boolean;
};

export type EgyptRow = {
  sites: number;
  halls: number;
  galleries: number;
  /** loop rate (loop edges / possible edges); null = the linear ramp of floors 1-10 */
  loops: number | null;
  /** seconds of found light per open tile */
  secPerTile: number;
  sconceCap: number;
  /** trap counts are targets; portcullis is limited by the loops of the floor */
  traps: { block: number; portcullis: number; sandfall: number; trapdoor: number };
  /** the collapse: delay s after the first move, rate tiles/s, cap % of open tiles; null = none */
  collapse: { delay: number; rate: number; cap: number } | null;
  /** play time aimed at, seconds */
  target: number;
  /** the tomb guardian of this floor (plan 04), or null */
  guardian: GuardianRow | null;
  /** basement: % of open tiles the sand may reach once the Scarab is taken (plan 04), else null */
  escapeCap: number | null;
};

/** Seconds from taking the Scarab to stepping into the false door that the bot report aims at. */
export const ESCAPE_TARGET = 30;

const T = (block: number, portcullis: number, sandfall: number, trapdoor: number) => ({ block, portcullis, sandfall, trapdoor });
const C = (delay: number, rate: number, cap: number) => ({ delay, rate, cap });
const R = (
  sites: number,
  halls: number,
  galleries: number,
  loops: number | null,
  secPerTile: number,
  sconceCap: number,
  traps: EgyptRow['traps'],
  collapse: EgyptRow['collapse'],
  target: number,
  guardian: GuardianRow | null = null,
  escapeCap: number | null = null,
): EgyptRow => ({ sites, halls, galleries, loops, secPerTile, sconceCap, traps, collapse, target, guardian, escapeCap });

const G = (wake: number, patrol: number, search: number, hunt: number, follow = false, sentinel = false): GuardianRow => ({ wake, patrol, search, hunt, follow, sentinel });

const none = T(0, 0, 0, 0);

export const EGYPT_ROWS: readonly EgyptRow[] = [
  R(3, 0, 0, null, 0.3, 8, none, null, 15),
  R(4, 0, 0, null, 0.28, 8, none, null, 25),
  R(5, 1, 0, null, 0.26, 8, none, null, 30),
  R(5, 1, 1, null, 0.24, 8, T(1, 0, 0, 0), null, 35),
  R(6, 1, 1, null, 0.22, 8, T(1, 0, 0, 0), null, 45),
  R(6, 1, 1, null, 0.2, 8, T(1, 1, 0, 0), null, 55),
  R(7, 2, 1, null, 0.18, 8, T(2, 1, 0, 1), null, 60),
  R(7, 2, 1, null, 0.16, 8, T(2, 1, 1, 1), null, 70),
  R(8, 2, 1, null, 0.15, 8, T(2, 1, 1, 0), null, 80),
  R(8, 2, 1, null, 0.14, 8, T(2, 1, 1, 1), null, 90),
  R(9, 2, 1, 0.124, 0.135, 12, T(2, 1, 1, 1), C(26, 1.8, 30), 95),
  R(9, 2, 1, 0.129, 0.13, 12, T(3, 1, 1, 1), C(22, 2.1, 36), 100),
  R(9, 3, 2, 0.133, 0.13, 12, T(3, 2, 0, 0), C(21, 2.1, 36), 110),
  R(9, 3, 2, 0.137, 0.125, 12, T(3, 2, 1, 1), C(20, 2.2, 37), 115),
  R(10, 3, 2, 0.141, 0.125, 12, T(3, 2, 1, 1), C(22, 2.0, 35), 120),
  R(10, 3, 2, 0.146, 0.12, 12, T(4, 2, 2, 0), C(22, 2.0, 36), 130),
  R(10, 3, 2, 0.15, 0.12, 12, T(4, 2, 2, 1), C(18, 2.3, 42), 145),
  R(11, 4, 2, 0.154, 0.115, 12, T(4, 3, 1, 1), C(22, 2.0, 38), 165, G(45, 0.65, 0.45, 0.28)),
  R(11, 4, 2, 0.159, 0.115, 12, T(4, 3, 2, 0), C(20, 2.1, 40), 180, G(40, 0.62, 0.44, 0.28)),
  R(11, 4, 2, 0.163, 0.11, 12, T(5, 3, 1, 1), C(18, 2.2, 42), 190, G(35, 0.62, 0.42, 0.27)),
  R(12, 4, 3, 0.167, 0.11, 12, T(5, 3, 1, 0), C(17, 2.3, 44), 200, G(30, 0.6, 0.42, 0.27)),
  R(12, 4, 3, 0.171, 0.105, 12, T(5, 3, 2, 1), C(16, 2.4, 46), 215, G(28, 0.6, 0.4, 0.26, true)),
  R(12, 5, 3, 0.176, 0.105, 12, T(5, 4, 2, 0), C(15, 2.5, 48), 225, G(25, 0.58, 0.4, 0.26, true)),
  R(13, 5, 3, 0.18, 0.1, 12, T(6, 4, 2, 0), C(14, 2.6, 50), 240, G(22, 0.58, 0.38, 0.25, true)),
  // basement: smaller than floor 24; the escape (task 04) adds to its play time
  R(12, 3, 1, 0.15, 0.11, 12, T(4, 3, 2, 0), C(14, 2.4, 42), 240, G(Infinity, 0.55, 0.36, 0.23, false, true), 60),
];

/** 0-based camp floors (1-based 5, 10, 14, 17, 20, 22, 24, 25), placed by play time. */
export const EGYPT_CAMPS = [4, 9, 13, 16, 19, 21, 23, 24] as const;

/** Sealed chambers per floor (plan 05): 1 on floors 1-6, 2 on 7-16, 3 on 17-24, 2 in the basement = 50. */
export const EGYPT_SECRETS = (i: number) => (i === 24 ? 2 : i < 6 ? 1 : i < 16 ? 2 : 3);

/** 0-based floors whose first secret holds a painted story fragment (floors 3, 6, ... 21 and the basement). */
export const EGYPT_FRAGMENT_FLOORS = [2, 5, 8, 11, 14, 17, 20, 24] as const;

export const EGYPT_TABLE: PyramidTable = { rows: EGYPT_ROWS, camps: EGYPT_CAMPS, secrets: EGYPT_SECRETS, fragmentFloors: EGYPT_FRAGMENT_FLOORS };
