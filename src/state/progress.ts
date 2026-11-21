import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { PYRAMIDS, SEALS, type PyramidId } from '../game/core/pyramids';
import { STAR, starCount, type FloorResult } from '../game/core/stars';
import { EMPTY, PROGRESS_VERSION, migrateProgress, ownedPowers, reconcileRevisions, type FloorRecord, type HintId, type ProgressData } from './migrateProgress';

export type { EscapeRecord, FloorRecord, HintId, ProgressData } from './migrateProgress';

/**
 * Saved progress through the world. A descent between camps is never saved:
 * leaving or losing the torch resumes from the last camp, as in the design doc.
 */

type ProgressActions = {
  /** a new descent from the top floor; keeps artifacts */
  startDescent: (id: PyramidId) => void;
  reachFloor: (id: PyramidId, floorIndex: number) => void;
  reachCamp: (id: PyramidId, floorIndex: number) => void;
  /** development only: pretend a camp floor was reached (any floor index is stored; the load sanitises it) */
  devReachCamp: (id: PyramidId, floorIndex: number) => void;
  /** the artifact was taken and you got out; `result` = seconds from the artifact to the door and guardian touches */
  takeArtifact: (id: PyramidId, result?: { escape: number; touches: number }) => void;
  /** replay of the basement: best escape time only, no side effects */
  recordEscape: (id: PyramidId, seconds: number) => void;
  /** a floor is being played: remember how many secrets it holds (the third star needs it) */
  noteFloor: (id: PyramidId, floorIndex: number, secrets: number) => void;
  /** the grave good of secret k was taken */
  markSecret: (id: PyramidId, floorIndex: number, k: number, secrets: number) => void;
  /** a floor was left: ORs the star bits, keeps the best time and the secrets found */
  recordFloor: (id: PyramidId, r: FloorResult) => void;
  /** the map card shown last */
  setFocus: (id: PyramidId) => void;
  markBlackUnlockSeen: () => void;
  markEndingSeen: () => void;
  markHint: (id: HintId) => void;
  resetProgress: () => void;
  /** development only: give the first n seal artifacts */
  devGrantArtifacts: (n: number) => void;
};

const blank = (): FloorRecord => ({ s: 0, t: null, f: 0, n: 0 });

function withFloor(s: ProgressData, id: PyramidId, i: number, patch: (r: FloorRecord) => FloorRecord): Pick<ProgressData, 'floors'> {
  const mine = s.floors[id] ?? {};
  return { floors: { ...s.floors, [id]: { ...mine, [i]: patch(mine[i] ?? blank()) } } };
}

export const useProgress = create<ProgressData & ProgressActions>()(
  persist(
    (set) => ({
      ...EMPTY,
      startDescent: (id) => set((s) => ({ camp: { ...s.camp, [id]: 0 } })),
      reachFloor: (id, floorIndex) =>
        set((s) => (floorIndex > (s.deepest[id] ?? -1) ? { deepest: { ...s.deepest, [id]: floorIndex } } : s)),
      reachCamp: (id, floorIndex) => set((s) => ({ camp: { ...s.camp, [id]: floorIndex } })),
      devReachCamp: (id, floorIndex) =>
        set((s) => ({
          camp: { ...s.camp, [id]: floorIndex },
          deepest: { ...s.deepest, [id]: Math.max(floorIndex, s.deepest[id] ?? 0) },
        })),
      takeArtifact: (id, result) =>
        set((s) => {
          const camp = { ...s.camp };
          delete camp[id];
          const prev = s.records[id];
          const records = result
            ? {
                ...s.records,
                [id]: {
                  escapes: (prev?.escapes ?? 0) + 1,
                  bestEscape: prev?.bestEscape == null ? result.escape : Math.min(prev.bestEscape, result.escape),
                  untouched: (prev?.untouched ?? 0) + (result.touches === 0 ? 1 : 0),
                },
              }
            : s.records;
          return {
            artifacts: { ...s.artifacts, [id]: true },
            completions: { ...s.completions, [id]: (s.completions[id] ?? 0) + 1 },
            camp,
            records,
          };
        }),
      recordEscape: (id, seconds) =>
        set((s) => {
          const prev = s.records[id];
          if (!prev || (prev.bestEscape != null && prev.bestEscape <= seconds)) return s;
          return { records: { ...s.records, [id]: { ...prev, bestEscape: seconds } } };
        }),
      noteFloor: (id, floorIndex, secrets) =>
        set((s) => ((s.floors[id]?.[floorIndex]?.n ?? 0) === secrets ? s : withFloor(s, id, floorIndex, (r) => ({ ...r, n: secrets })))),
      markSecret: (id, floorIndex, k, secrets) =>
        set((s) => {
          const rec = s.floors[id]?.[floorIndex];
          if (rec && rec.f & (1 << k) && rec.n === secrets) return s;
          return withFloor(s, id, floorIndex, (r) => ({ ...r, f: r.f | (1 << k), n: secrets }));
        }),
      recordFloor: (id, r) =>
        set((s) =>
          withFloor(s, id, r.floorIndex, (rec) => ({
            s: rec.s | (r.cleared ? STAR.CLEARED : 0) | (r.fast ? STAR.FAST : 0),
            // the best time counts cleared runs only (a trapdoor fall is not a clear)
            t: r.cleared ? (rec.t == null ? r.time : Math.min(rec.t, r.time)) : rec.t,
            f: rec.f,
            n: r.total,
          })),
        ),
      setFocus: (id) => set((s) => (s.focus === id ? s : { focus: id })),
      markBlackUnlockSeen: () => set({ blackUnlockSeen: true }),
      markEndingSeen: () => set({ endingSeen: true }),
      markHint: (id) => set((s) => (s.hints[id] ? s : { hints: { ...s.hints, [id]: true } })),
      resetProgress: () => set(EMPTY),
      devGrantArtifacts: (n) =>
        set((s) => {
          const artifacts: ProgressData['artifacts'] = s.artifacts.black ? { black: true } : {};
          SEALS.slice(0, n).forEach((id) => (artifacts[id] = true));
          return { artifacts, blackUnlockSeen: n >= SEALS.length ? s.blackUnlockSeen : false };
        }),
    }),
    {
      name: 'labyrinthium.progress',
      version: PROGRESS_VERSION,
      migrate: (persisted, version) => migrateProgress(persisted, version),
      // after migrate, on every load: a pyramid rebuilt by a later task resets only its own floors
      merge: (persisted, current) => ({ ...current, ...reconcileRevisions({ ...EMPTY, ...((persisted ?? {}) as Partial<ProgressData>) }, (id) => PYRAMIDS[id].rev) }),
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ artifacts, camp, deepest, completions, blackUnlockSeen, endingSeen, hints, records, floors, revs, focus }) => ({
        artifacts,
        camp,
        deepest,
        completions,
        blackUnlockSeen,
        endingSeen,
        hints,
        records,
        floors,
        revs,
        focus,
      }),
    },
  ),
);

export function sealsFilled(artifacts: ProgressData['artifacts']): number {
  return SEALS.filter((id) => artifacts[id]).length;
}

export function isUnlocked(id: PyramidId, artifacts: ProgressData['artifacts']): boolean {
  return id !== 'black' || sealsFilled(artifacts) === SEALS.length;
}

/** Anything worth a "Continue" on the title screen. */
export function hasProgress(s: ProgressData): boolean {
  return Object.keys(s.deepest).length > 0 || Object.keys(s.artifacts).length > 0;
}

/** Stars held in a pyramid and the most it can give (3 per floor). */
export function pyramidStars(floors: ProgressData['floors'], id: PyramidId): { stars: number; max: number } {
  let stars = 0;
  for (const rec of Object.values(floors[id] ?? {})) stars += starCount(rec);
  return { stars, max: 3 * PYRAMIDS[id].floorCount };
}

/** Story fragment indices read in a pyramid, ascending (secret 0 of a fragment floor holds one). */
export function fragmentsRead(floors: ProgressData['floors'], id: PyramidId, fragmentOf: (floorIndex: number) => number): number[] {
  const out: number[] = [];
  for (const [key, rec] of Object.entries(floors[id] ?? {})) {
    const frag = fragmentOf(Number(key));
    if (frag >= 0 && rec.f & 1) out.push(frag);
  }
  return out.sort((a, b) => a - b);
}

export { ownedPowers };
