import { router } from 'expo-router';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { drawTorch } from '../game/render/drawRelic';
import { hasProgress, sealsFilled, useProgress } from '../state/progress';
import { useReducedMotion } from '../state/settings';
import { ArtCanvas, useTicker } from '../ui/ArtCanvas';
import { Button } from '../ui/Button';
import { Screen } from '../ui/Screen';
import { colors, space, type } from '../ui/theme';

/** Title: the name, a torch in the dark, and the way in. */
export default function TitleScreen() {
  const { width, height } = useWindowDimensions();
  const reduced = useReducedMotion();
  const time = useTicker(30, !reduced);
  const progress = useProgress();
  const started = hasProgress(progress);
  const seals = sealsFilled(progress.artifacts);
  const artH = Math.min(height * 0.42, 380);

  return (
    <Screen style={styles.screen}>
      <View style={styles.head}>
        <Text style={type.hero} accessibilityRole="header">
          Labyrinthium
        </Text>
        <Text style={[type.body, styles.sub]}>Descend by torchlight. Bring the artifacts home.</Text>
      </View>

      <ArtCanvas width={width} height={artH} deps={[time]} draw={(c, w, h) => drawTorch(c, w, h, time)} style={styles.art} />

      <View style={styles.actions}>
        <Button variant="primary" label={started ? 'Continue' : 'Begin'} onPress={() => router.push('/map')} />
        <Button label="Settings" onPress={() => router.push('/settings')} />
        {started && (
          <Text style={[type.caption, styles.status]}>
            {seals} of 4 seals on the Black Pyramid's door
            {progress.artifacts.black ? " · the Builder's Heart is yours" : ''}
          </Text>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { justifyContent: 'space-between' },
  head: { alignItems: 'center', gap: space.sm, marginTop: space.xxl },
  sub: { color: colors.muted, textAlign: 'center' },
  art: { marginHorizontal: -space.lg },
  actions: { gap: space.sm, width: '100%', maxWidth: 420, alignSelf: 'center' },
  status: { textAlign: 'center', marginTop: space.sm },
});
