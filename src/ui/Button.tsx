import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { haptic } from './haptics';
import { colors, fonts, radius, space } from './theme';

type Props = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
};

export function Button({ label, onPress, variant = 'secondary', disabled, style, accessibilityHint }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        pressed && pressedStyles[variant],
        disabled && styles.disabled,
        style,
      ]}
    >
      <Text style={[styles.text, variant === 'primary' ? styles.textPrimary : variant === 'danger' && styles.textDanger]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 50,
    paddingHorizontal: space.xl,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  primary: { backgroundColor: colors.gold },
  secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  ghost: { backgroundColor: 'transparent' },
  danger: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.danger },
  disabled: { opacity: 0.4 },
  text: { fontFamily: fonts.bodySemi, fontSize: 16, color: colors.ink },
  textPrimary: { color: colors.onGold },
  textDanger: { color: colors.danger },
});

const pressedStyles = StyleSheet.create({
  primary: { backgroundColor: '#d9ab45' },
  secondary: { backgroundColor: colors.surfacePressed },
  ghost: { backgroundColor: colors.surface },
  danger: { backgroundColor: 'rgba(224,120,95,0.12)' },
});

/** A small square icon button (pause, settings, back). */
export function IconButton({ glyph, label, onPress }: { glyph: string; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      style={({ pressed }) => [iconStyles.button, pressed && { backgroundColor: colors.surfacePressed }]}
    >
      <Text style={iconStyles.glyph}>{glyph}</Text>
    </Pressable>
  );
}

const iconStyles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: { color: colors.ink, fontSize: 18, fontFamily: fonts.bodySemi },
});
