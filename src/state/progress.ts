import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { SEALS, type PyramidId } from '../game/core/pyramids';

/**
 * Saved progress through the world. A descent between camps is never saved:
 * leaving or losing the torch resumes from the last camp, as in the design doc.
 */
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
};

type ProgressActions = {
  /** a new descent from the top floor; keeps artifacts */
  startDescent: (id: PyramidId) => void;
  reachFloor: (id: PyramidId, floorIndex: number) => void;
  reachCamp: (id: PyramidId, floorIndex: number) => void;
  takeArtifact: (id: PyramidId) => void;
  markBlackUnlockSeen: () => void;
  markEndingSeen: () => void;
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
};

export const useProgress = create<ProgressData & ProgressActions>()(
  persist(
    (set) => ({
      ...EMPTY,
      startDescent: (id) => set((s) => ({ camp: { ...s.camp, [id]: 0 } })),
      reachFloor: (id, floorIndex) =>
        set((s) => (floorIndex > (s.deepest[id] ?? -1) ? { deepest: { ...s.deepest, [id]: floorIndex } } : s)),
      reachCamp: (id, floorIndex) => set((s) => ({ camp: { ...s.camp, [id]: floorIndex } })),
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
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ artifacts, camp, deepest, completions, blackUnlockSeen, endingSeen }) => ({
        artifacts,
        camp,
        deepest,
        completions,
        blackUnlockSeen,
        endingSeen,
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
