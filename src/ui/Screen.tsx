import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from './Button';
import { colors, space, type } from './theme';

/** A full screen with safe-area padding and the dark background. */
export function Screen({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.screen,
        { paddingTop: insets.top + space.md, paddingBottom: insets.bottom + space.lg },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Top bar with a back button, a title, and an optional right-side action. */
export function TopBar({ title, onBack, right }: { title?: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <View style={styles.bar}>
      <IconButton glyph="←" label="Back" onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/map')))} />
      <Text style={[type.heading, styles.title]} numberOfLines={1} accessibilityRole="header">
        {title}
      </Text>
      <View style={styles.right}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: space.lg },
  bar: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48 },
  title: { flex: 1, textAlign: 'center' },
  right: { width: 44, alignItems: 'flex-end' },
});
