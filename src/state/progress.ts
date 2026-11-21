import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { lastCamp } from '../game/core/game';
import { PYRAMIDS, SEALS, isPyramidId, type PyramidId } from '../game/core/pyramids';

/**
 * Saved progress through the world. A descent between camps is never saved:
 * leaving or losing the torch resumes from the last camp, as in the design doc.
 */
/** One-time teaching captions (plan 03): shown the first time a trap kind is lit. */
export type HintId = 'plate' | 'block' | 'portcullis' | 'sandfall' | 'trapdoor' | 'collapse';

type ProgressData = {
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
};

type ProgressActions = {
  /** a new descent from the top floor; keeps artifacts */
  startDescent: (id: PyramidId) => void;
  reachFloor: (id: PyramidId, floorIndex: number) => void;
  reachCamp: (id: PyramidId, floorIndex: number) => void;
  /** development only: pretend a camp floor was reached (any floor index is stored; the load sanitises it) */
  devReachCamp: (id: PyramidId, floorIndex: number) => void;
  takeArtifact: (id: PyramidId) => void;
  markBlackUnlockSeen: () => void;
  markEndingSeen: () => void;
  markHint: (id: HintId) => void;
  resetProgress: () => void;
  /** development only: give the first n seal artifacts */
  devGrantArtifacts: (n: number) => void;
};

const EMPTY: ProgressData = {
  artifacts: {},
  camp: {},
  deepest: {},
  completions: {},
  blackUnlockSeen: false,
  endingSeen: false,
  hints: {},
};

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
      takeArtifact: (id) =>
        set((s) => {
          const camp = { ...s.camp };
          delete camp[id];
          return {
            artifacts: { ...s.artifacts, [id]: true },
            completions: { ...s.completions, [id]: (s.completions[id] ?? 0) + 1 },
            camp,
          };
        }),
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
      version: 3,
      /**
       * v2: Egypt has 10 floors and camps follow the floor number (every 5th), so saved camp
       * indices no longer match: camps reset (artifacts and records stay), `deepest` is clamped.
       */
      migrate: (persisted, version) => {
        const data = (persisted ?? {}) as Partial<ProgressData>;
        if (version < 2) {
          data.camp = {};
          const deepest: ProgressData['deepest'] = {};
          for (const [id, floor] of Object.entries(data.deepest ?? {})) {
            if (isPyramidId(id) && typeof floor === 'number') deepest[id] = Math.min(floor, PYRAMIDS[id].floorCount - 1);
          }
          data.deepest = deepest;
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
          const deepest: ProgressData['deepest'] = {};
          for (const [id, floor] of Object.entries(data.deepest ?? {})) {
            if (isPyramidId(id) && typeof floor === 'number') deepest[id] = Math.min(floor, PYRAMIDS[id].floorCount - 1);
          }
          data.deepest = deepest;
          data.hints = {};
        }
        return { ...EMPTY, ...data };
      },
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ artifacts, camp, deepest, completions, blackUnlockSeen, endingSeen, hints }) => ({
        artifacts,
        camp,
        deepest,
        completions,
        blackUnlockSeen,
        endingSeen,
        hints,
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
