import AsyncStorage from '@react-native-async-storage/async-storage';
import { useReducedMotion as useSystemReducedMotion } from 'react-native-reanimated';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type Controls = 'both' | 'swipe' | 'pad';
export type MotionSetting = 'system' | 'reduced' | 'full';

type SettingsData = {
  haptics: boolean;
  /** stored now, used once the game has sound */
  sound: boolean;
  controls: Controls;
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
      controls: 'both',
      motion: 'system',
      set: (patch) => set(patch),
    }),
    {
      name: 'labyrinthium.settings',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ haptics, sound, controls, motion }) => ({ haptics, sound, controls, motion }),
    },
  ),
);

/** True when animations should jump instead of slide: the in-game setting, or the system setting. */
export function useReducedMotion(): boolean {
  const system = useSystemReducedMotion();
  const motion = useSettings((s) => s.motion);
  return motion === 'system' ? system : motion === 'reduced';
}
