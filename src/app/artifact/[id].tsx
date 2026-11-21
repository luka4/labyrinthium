import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { PYRAMIDS, isPyramidId } from '../../game/core/pyramids';
import { powerCopy } from '../../screens/powerCopy';
import { drawRelic } from '../../game/render/drawRelic';
import { pyramidStars, sealsFilled, useProgress } from '../../state/progress';
import { useReducedMotion } from '../../state/settings';
import { ArtCanvas, useTicker } from '../../ui/ArtCanvas';
import { Button } from '../../ui/Button';
import { Screen } from '../../ui/Screen';
import { colors, space, type } from '../../ui/theme';

const REVEAL_MS = 1400;

const mmss = (sec: number) => {
  const n = Math.max(0, Math.round(sec));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
};

/** The basement: the artifact rises out of the dark. */
export default function ArtifactScreen() {
  const { id, out } = useLocalSearchParams<{ id: string; out?: string }>();
  const { width, height } = useWindowDimensions();
  const reduced = useReducedMotion();
  const time = useTicker(30);
  const artifacts = useProgress((s) => s.artifacts);
  const record = useProgress((s) => (isPyramidId(id) ? s.records[id] : undefined));
  const floors = useProgress((s) => s.floors);
  const completions = useProgress((s) => (isPyramidId(id) ? s.completions[id] : undefined));

  if (!isPyramidId(id)) return <Redirect href="/map" />;
  const p = PYRAMIDS[id];
  const heart = id === 'black';
  const seals = sealsFilled(artifacts);
  const stars = pyramidStars(floors, id);
  const reveal = reduced ? 1 : Math.min(1, time / REVEAL_MS);
  const artH = Math.min(height * 0.4, 360);
  const power = p.powerId ? powerCopy(p.powerId, id) : null;

  const line = heart
    ? 'The last artifact. Under your feet, the basement floor begins to crack.'
    : seals === 4
      ? 'All four seals are filled. The Black Pyramid is waiting.'
      : `${seals} of 4 seals on the Black Pyramid's door ${seals === 1 ? 'is' : 'are'} filled.`;

  const next = () =>
    heart ? router.replace('/ending') : router.dismissTo({ pathname: '/map', params: { filled: id } });

  return (
    <Screen style={styles.screen}>
      <View style={styles.head}>
        <Text style={type.label}>{p.name} · basement</Text>
        <Text style={[type.title, styles.center]} accessibilityRole="header">
          {p.artifact}
        </Text>
      </View>
      <ArtCanvas
        width={width}
        height={artH}
        deps={[time]}
        draw={(c, w, h) => drawRelic(c, w, h, { color: heart ? '#c0392b' : p.color, time: reduced ? 0 : time, reveal, heart, emblem: p.powerId ?? 'heart' })}
        style={styles.art}
      />
      <View style={[styles.body, { opacity: reveal }]}>
        <Text style={[type.body, styles.center]}>You took it from the dark and found the way out.</Text>
        {power ? (
          <View style={styles.power}>
            <Text style={type.label}>{completions === 1 ? 'New power' : 'Power'}</Text>
            <Text style={[type.heading, { color: power.color }]}>{power.verb}</Text>
            <Text style={[type.caption, styles.center]}>{power.text}</Text>
            <Text style={[type.caption, styles.center, { color: colors.gold }]}>{power.strongest}</Text>
            {completions === 1 && <Text style={[type.caption, styles.center]}>Uses refill at every camp. Tap it under the board.</Text>}
          </View>
        ) : (
          <Text style={[type.body, styles.center, { color: colors.muted }]}>{p.power}</Text>
        )}
        <Text style={[type.caption, styles.center, { color: colors.gold }]}>{line}</Text>
        {id !== 'black' || stars.stars > 0 ? (
          <Text style={[type.caption, styles.center, { color: colors.muted }]}>
            Stars in {p.name}: {stars.stars} of {stars.max}
          </Text>
        ) : null}
        {record?.bestEscape != null && (
          <Text style={[type.caption, styles.center, { color: colors.muted }]}>
            Out in {mmss(Number.isFinite(Number(out)) && out ? Number(out) : record.bestEscape)} · best {mmss(record.bestEscape)}
          </Text>
        )}
      </View>
      <View style={styles.actions}>
        <Button variant="primary" label={heart ? 'Go on' : 'Back to the map'} onPress={next} disabled={reveal < 1} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { justifyContent: 'space-between' },
  head: { alignItems: 'center', gap: space.sm, marginTop: space.xl },
  center: { textAlign: 'center' },
  art: { marginHorizontal: -space.lg },
  body: { gap: space.sm, paddingHorizontal: space.md },
  power: { alignItems: 'center', gap: 4 },
  actions: { width: '100%', maxWidth: 420, alignSelf: 'center' },
});
