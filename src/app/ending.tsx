import { router } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { drawRelic } from '../game/render/drawRelic';
import { useProgress } from '../state/progress';
import { useReducedMotion } from '../state/settings';
import { ArtCanvas, useTicker } from '../ui/ArtCanvas';
import { Button } from '../ui/Button';
import { Screen } from '../ui/Screen';
import { colors, space, type } from '../ui/theme';

const STORY = [
  'Five pyramids, built by one hand, older than the names we gave them.',
  "The four artifacts were never treasure. They were seals. The Builder's Heart was the lock.",
  'Now it beats in your hand, and below the Black Pyramid the stone has cracked. Cold water breathes up through the gap.',
];

/** After the Black Pyramid: the end of the story, and the first sign of the Drowned City. */
export default function EndingScreen() {
  const { width, height } = useWindowDimensions();
  const reduced = useReducedMotion();
  const time = useTicker(30, !reduced);

  useEffect(() => {
    useProgress.getState().markEndingSeen();
  }, []);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={type.label}>The end of the first descent</Text>
        <Text style={[type.title, styles.center]} accessibilityRole="header">
          The Builder's Heart
        </Text>
        <ArtCanvas
          width={width}
          height={Math.min(height * 0.32, 300)}
          deps={[time]}
          draw={(c, w, h) => drawRelic(c, w, h, { color: '#c0392b', time, reveal: 1, heart: true })}
          style={styles.art}
        />
        <View style={styles.story}>
          {STORY.map((line) => (
            <Text key={line} style={[type.body, styles.center]}>
              {line}
            </Text>
          ))}
          <Text style={[type.caption, styles.center, { color: colors.gold }]}>
            Something below has been waiting. The Drowned City comes in a later version.
          </Text>
        </View>
      </ScrollView>
      <Button variant="primary" label="Back to the map" onPress={() => router.dismissTo('/map')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { alignItems: 'center', gap: space.md, paddingVertical: space.xl },
  center: { textAlign: 'center' },
  art: { marginHorizontal: -space.lg },
  story: { gap: space.md, maxWidth: 440 },
});
