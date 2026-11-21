import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { MEDALLION, SLOT, STRIP_H, slotX, slotY } from '../../game/render/drawLightHud';
import { colors, fonts } from '../../ui/theme';

/** What the strip says; computed at most 4 times a second from the game state. */
export type HudText = {
  name: string;
  /** m:ss of the source in hand, or "embers" */
  time: string;
  low: boolean;
  spares: Array<{ label: string }>;
  caption: { id: number; text: string } | null;
};

/**
 * Text and touch targets over the light strip drawn in the canvas (drawLightHud.ts):
 * the source name and time, a short caption for events, and one pressable per bag slot.
 */
export const LightHud = memo(function LightHud({ hud, width, onSwap }: { hud: HudText; width: number; onSwap: (slot: number) => void }) {
  const left = 8 + MEDALLION + 10;
  const textWidth = Math.max(40, slotX(0, width) - left - 8);
  return (
    <View style={[styles.strip, { width }]} pointerEvents="box-none">
      <View
        style={{ position: 'absolute', left: 8, top: (STRIP_H - MEDALLION) / 2, width: MEDALLION, height: MEDALLION }}
        accessible
        accessibilityLabel={`${hud.name}, ${hud.time}${hud.spares.length ? `, ${hud.spares.length} spare` : ', no spares'}`}
      />
      <View style={{ position: 'absolute', left, top: 12, width: textWidth }} pointerEvents="none">
        <Text style={styles.name} numberOfLines={1}>
          {hud.name}
        </Text>
        <Text style={[styles.time, hud.low && styles.low]}>{hud.time}</Text>
        {hud.caption && (
          <Animated.Text key={hud.caption.id} entering={FadeIn.duration(120)} exiting={FadeOut.duration(300)} style={styles.caption} numberOfLines={1}>
            {hud.caption.text}
          </Animated.Text>
        )}
      </View>
      {hud.spares.map((sp, i) => (
        <Pressable
          key={i}
          onPress={() => onSwap(i)}
          accessibilityRole="button"
          accessibilityLabel={`Spare ${i + 1}: ${sp.label}`}
          accessibilityHint="Double tap to light it"
          hitSlop={4}
          style={{ position: 'absolute', left: slotX(i, width), top: slotY, width: SLOT, height: SLOT }}
        />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  strip: { position: 'absolute', left: 0, top: 0, height: STRIP_H },
  name: { color: colors.ink, fontFamily: fonts.displayMedium, fontSize: 15, letterSpacing: 0.3 },
  time: { color: colors.muted, fontFamily: fonts.bodyMedium, fontSize: 13, fontVariant: ['tabular-nums'], marginTop: 1 },
  low: { color: '#e8704a' },
  caption: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    paddingVertical: 1,
    color: colors.gold,
    fontFamily: fonts.bodySemi,
    fontSize: 14,
    backgroundColor: '#15110a',
  },
});
