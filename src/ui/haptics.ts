import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

import { useSettings } from '../state/settings';

const enabled = () => Platform.OS !== 'web' && useSettings.getState().haptics;

/** Haptics that respect the setting; safe to call anywhere. */
export const haptic = {
  tap: () => enabled() && Haptics.selectionAsync(),
  bump: () => enabled() && Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  heavy: () => enabled() && Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
  success: () => enabled() && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  warning: () => enabled() && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
};
