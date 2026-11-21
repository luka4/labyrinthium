import AsyncStorage from '@react-native-async-storage/async-storage';
import { useReducedMotion as useSystemReducedMotion } from 'react-native-reanimated';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type Controls = 'both' | 'swipe' | 'pad';
export type MotionSetting = 'system' | 'reduced' | 'full';

type SettingsData = {
  haptics: boolean;
  /** mute switch for all sound */
  sound: boolean;
  /** effects volume 0..1 (world, guardian and interface buses) */
  sfx: number;
  /** ambience volume 0..1 */
  ambience: number;
  controls: Controls;
  /** a flick runs on to the next junction */
  autoRun: boolean;
  motion: MotionSetting;
};

type SettingsActions = {
  set: (patch: Partial<SettingsData>) => void;
};

export const useSettings = create<SettingsData & SettingsActions>()(
  persist(
    (set) => ({
      haptics: true,
      sound: true,
      sfx: 0.8,
      ambience: 0.7,
      controls: 'both',
      autoRun: true,
      motion: 'system',
      set: (patch) => set(patch),
    }),
    {
      name: 'labyrinthium.settings',
      version: 2,
      /** v2: volume settings (sfx, ambience) */
      migrate: (persisted) => ({ sfx: 0.8, ambience: 0.7, ...(persisted as object) }) as SettingsData & SettingsActions,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ haptics, sound, sfx, ambience, controls, autoRun, motion }) => ({ haptics, sound, sfx, ambience, controls, autoRun, motion }),
    },
  ),
);

/** True when animations should jump instead of slide: the in-game setting, or the system setting. */
export function useReducedMotion(): boolean {
  const system = useSystemReducedMotion();
  const motion = useSettings((s) => s.motion);
  return motion === 'system' ? system : motion === 'reduced';
}
