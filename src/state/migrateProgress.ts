import { lastCamp } from '../game/core/game';
import { POWER_ORDER, type PowerId } from '../game/core/powers';
import { POWER_INFO, PYRAMIDS, isPyramidId, type PyramidId } from '../game/core/pyramids';
import { STAR } from '../game/core/stars';

/**
 * The saved shape of progress and its migrations. Pure (no AsyncStorage, no zustand), so
 * scripts/check-stars.ts can test v1-v4 saves against it.
 */
/** One-time teaching captions (plan 03): shown the first time a trap kind is lit; `secret` (plan 05) the first time a seal is seen. */
/** Culture hints are namespaced ('maya:wheel'); the common ones are `power`, `water`, `flooded`. */
export type HintId = string;

/** What one pyramid's escapes add up to (plan 04): the count, the fastest, and how many were clean. */
export type EscapeRecord = {
  escapes: number;
  /** seconds from lifting the artifact to the door, best run; null if never recorded */
  bestEscape: number | null;
  /** escapes in which the guardian never touched you */
  untouched: number;
};

/**
 * One floor's record (plan 05). s: star bits ever earned (cleared 1, fast 2); t: best cleared time
 * not by a fall; f: secrets found ever (bitmask); n: secrets on the floor (written whenever it is played).
 */
export type FloorRecord = { s: number; t: number | null; f: number; n: number };

export type ProgressData = {
  /** artifacts taken */
  artifacts: Partial<Record<PyramidId, true>>;
  /** checkpoint of the current descent (floor index of the last camp reached) */
  camp: Partial<Record<PyramidId, number>>;
  /** deepest floor index ever reached */
  deepest: Partial<Record<PyramidId, number>>;
  /** times the basement was reached */
  completions: Partial<Record<PyramidId, number>>;
  /** the Black Pyramid's door-opening animation has been shown */
  blackUnlockSeen: boolean;
  endingSeen: boolean;
  /** captions already shown */
  hints: Partial<Record<HintId, true>>;
  /** escapes per pyramid (plan 04) */
  records: Partial<Record<PyramidId, EscapeRecord>>;
  /** stars, best times and secrets per floor (plan 05); key = 0-based floor index */
  floors: Partial<Record<PyramidId, Record<number, FloorRecord>>>;
  /** the data revision each pyramid's floors were played at (plan 06) */
  revs: Partial<Record<PyramidId, number>>;
  /** the map card shown last */
  focus: PyramidId | null;
};

export const PROGRESS_VERSION = 6;

export const EMPTY: ProgressData = {
  artifacts: {},
  camp: {},
  deepest: {},
  completions: {},
  blackUnlockSeen: false,
  endingSeen: false,
  hints: {},
  records: {},
  floors: {},
  revs: {},
  focus: null,
};

const clampDeepest = (data: Partial<ProgressData>) => {
  const deepest: ProgressData['deepest'] = {};
  for (const [id, floor] of Object.entries(data.deepest ?? {})) {
    if (isPyramidId(id) && typeof floor === 'number') deepest[id] = Math.min(floor, PYRAMIDS[id].floorCount - 1);
  }
  data.deepest = deepest;
};

export function migrateProgress(persisted: unknown, version: number): ProgressData {
  const data = (persisted ?? {}) as Partial<ProgressData>;
  if (version < 2) {
    // v2: Egypt has 10 floors and camps follow the floor number (every 5th): camps reset, `deepest` is clamped
    data.camp = {};
    clampDeepest(data);
  }
  if (version < 3) {
    // v3: Egypt has 25 floors and its own camp list; keep a camp that is still valid, else fall back to the last one
    const camp: ProgressData['camp'] = {};
    for (const [id, floor] of Object.entries(data.camp ?? {})) {
      if (!isPyramidId(id) || typeof floor !== 'number') continue;
      const p = PYRAMIDS[id];
      const f = Math.max(0, Math.min(floor, p.floorCount - 1));
      camp[id] = f === 0 || p.camps.includes(f) ? f : lastCamp(p, f);
    }
    data.camp = camp;
    clampDeepest(data);
    data.hints = {};
  }
  if (version < 4) {
    // v4: escape records per pyramid
    data.records = {};
  }
  if (version < 5) {
    // v5: stars. Every floor above the deepest reached was left by its stairs (or a trapdoor): cleared; a taken artifact clears the basement.
    const floors: ProgressData['floors'] = {};
    for (const [id, deep] of Object.entries(data.deepest ?? {})) {
      if (!isPyramidId(id) || typeof deep !== 'number') continue;
      const rec: Record<number, FloorRecord> = {};
      for (let i = 0; i < Math.min(deep, PYRAMIDS[id].floorCount - 1); i++) rec[i] = { s: STAR.CLEARED, t: null, f: 0, n: 0 };
      floors[id] = rec;
    }
    for (const id of Object.keys(data.artifacts ?? {})) {
      if (!isPyramidId(id)) continue;
      (floors[id] ??= {})[PYRAMIDS[id].floorCount - 1] = { s: STAR.CLEARED, t: null, f: 0, n: 0 };
    }
    data.floors = floors;
  }
  if (version < 6) {
    // v6: every pyramid is at its current data revision (nothing is cleared), no map focus yet
    const revs: ProgressData['revs'] = {};
    for (const id of Object.keys(PYRAMIDS) as PyramidId[]) revs[id] = PYRAMIDS[id].rev;
    data.revs = revs;
    data.focus = null;
  }
  return { ...EMPTY, ...data };
}

/**
 * A pyramid whose floors were rebuilt (07-09 bump its `rev`) loses only what points at the old floors:
 * its camp, deepest floor and floor records. Artifact, records and completions stay. Runs on every load,
 * pure and idempotent; a pyramid with no stored revision is left alone and stamped.
 */
export function reconcileRevisions(data: ProgressData, revOf: (id: PyramidId) => number): ProgressData {
  const revs: ProgressData['revs'] = { ...(data.revs ?? {}) };
  let { camp, deepest, floors } = data;
  for (const id of Object.keys(PYRAMIDS) as PyramidId[]) {
    const want = revOf(id);
    const have = revs[id];
    if (have !== undefined && have !== want) {
      camp = { ...camp };
      deepest = { ...deepest };
      floors = { ...floors };
      delete camp[id];
      delete deepest[id];
      delete floors[id];
    }
    revs[id] = want;
  }
  return { ...data, camp, deepest, floors, revs };
}

/** The artifact powers you carry, in POWER_ORDER: each taken artifact gives its power. */
export function ownedPowers(artifacts: ProgressData['artifacts']): PowerId[] {
  return POWER_ORDER.filter((id) => artifacts[POWER_INFO[id].artifact as PyramidId]);
}
