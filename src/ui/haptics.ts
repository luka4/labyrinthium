import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

import { useSettings } from '../state/settings';
import { createHapticSequencer, type HapticName, type HapticSequencer, type HapticStyle } from './hapticPatterns';

export { PATTERNS, createHapticSequencer, heartbeatPeriod, type HapticName, type HapticSequencer, type HapticStyle } from './hapticPatterns';

/**
 * Patterned haptics (plan 05, section 14). A pattern is a list of pulses [ms offset, style]; a sequencer
 * plays them on a clock it is given, so a pause freezes a pattern in the middle. Budget ERM motors blur
 * pulses closer than ~50 ms, so the sequencer spaces them out, keeps at most 6 queued (dropping the
 * least important) and never stacks the heartbeat. Respects the "Vibration" setting; no-op on web.
 */
const enabled = () => Platform.OS !== 'web' && useSettings.getState().haptics;

/** Fires one pulse on the device. */
export function fire(style: HapticStyle) {
  if (!enabled()) return;
  try {
    switch (style) {
      case 'selection':
        if (Platform.OS === 'android') void Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Context_Click);
        else void Haptics.selectionAsync();
        break;
      case 'light':
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        break;
      case 'medium':
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        break;
      case 'heavy':
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        break;
      case 'soft':
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
        break;
      case 'rigid':
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
        break;
      case 'success':
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        break;
      case 'warning':
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        break;
      case 'error':
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        break;
    }
  } catch {
    // no haptic engine
  }
}

// ---- the app-wide one (menus, overview, walker bumps): drives itself while it has something to play ----

let shared: HapticSequencer | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let last = 0;
function sharedSeq(): HapticSequencer {
  shared ??= createHapticSequencer(fire);
  return shared;
}
function run() {
  if (timer) return;
  last = Date.now();
  timer = setInterval(() => {
    const t = Date.now();
    const seq = sharedSeq();
    seq.tick((t - last) / 1000);
    last = t;
    if (!seq.pending() && timer) {
      clearInterval(timer);
      timer = null;
    }
  }, 16);
}

/** Haptics that respect the setting; safe to call anywhere. The old names stay as aliases. */
export const haptic = {
  play(name: HapticName) {
    if (!enabled()) return;
    sharedSeq().play(name);
    // the first pulse is due now: fire it without waiting for the interval
    sharedSeq().tick(0);
    if (sharedSeq().pending()) run();
  },
  tap: () => haptic.play('tap'),
  bump: () => haptic.play('wall'),
  heavy: () => haptic.play('land'),
  success: () => haptic.play('found'),
  warning: () => haptic.play('touch'),
};
