import { useEffect, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { uiSound } from '../audio/ui';
import { colors, radius, space, type } from './theme';

/**
 * A dimmed overlay with a card, used inside a screen (pause, camp, burnt out),
 * so the game canvas under it never unmounts.
 */
export function Panel({
  eyebrow,
  title,
  children,
  onDismiss,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
  /** tap on the scrim; omit to make the panel blocking */
  onDismiss?: () => void;
}) {
  useEffect(() => uiSound.panel(), []);
  return (
    <View style={styles.overlay} accessibilityViewIsModal>
      <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} accessible={false} />
      <View style={styles.card}>
        {eyebrow ? <Text style={type.label}>{eyebrow}</Text> : null}
        <Text style={type.title} accessibilityRole="header">
          {title}
        </Text>
        {children}
      </View>
    </View>
  );
}

export function PanelText({ children }: { children: ReactNode }) {
  return <Text style={[type.body, { color: colors.muted }]}>{children}</Text>;
}

export function PanelActions({ children }: { children: ReactNode }) {
  return <View style={styles.actions}>{children}</View>;
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.bg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.xl,
    gap: space.md,
  },
  actions: { gap: space.sm, marginTop: space.sm },
});
