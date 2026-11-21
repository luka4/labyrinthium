import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { warmLayouts } from '../../game/core/generate';
import { PYRAMIDS, campFloorNumbers, isPyramidId } from '../../game/core/pyramids';
import { drawPyramidSide, sideLayout } from '../../game/render/drawPyramidSide';
import { isUnlocked, useProgress } from '../../state/progress';
import { useReducedMotion } from '../../state/settings';
import { ArtCanvas, useTicker } from '../../ui/ArtCanvas';
import { Button } from '../../ui/Button';
import { Screen, TopBar } from '../../ui/Screen';
import { colors, fonts, radius, space, type } from '../../ui/theme';

/** One pyramid: where you stand in it, what its basement keeps, and the way in. */
export default function PyramidScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width: screenW } = useWindowDimensions();
  const reduced = useReducedMotion();
  const time = useTicker(20, !reduced);
  const artifacts = useProgress((s) => s.artifacts);
  const campFloor = useProgress((s) => (isPyramidId(id) ? s.camp[id] : undefined));
  const deepest = useProgress((s) => (isPyramidId(id) ? s.deepest[id] : undefined));
  const completions = useProgress((s) => (isPyramidId(id) ? s.completions[id] : undefined));

  const valid = isPyramidId(id) && isUnlocked(id, artifacts);
  const warmTo = campFloor ?? 0;
  // generate the floor chain down to the checkpoint in the background, so resuming is instant
  useEffect(() => {
    if (!valid) return;
    const abort = new AbortController();
    warmLayouts(PYRAMIDS[id], warmTo, abort.signal);
    return () => abort.abort();
  }, [valid, id, warmTo]);

  if (!isPyramidId(id) || !valid) return <Redirect href="/map" />;
  const p = PYRAMIDS[id];
  const taken = !!artifacts[id];
  const checkpoint = campFloor ?? 0;
  const width = Math.min(screenW - space.lg * 2, 440);
  const height = Math.round(width * 0.72);
  const L = sideLayout(width, height, p.floorCount);
  const camps = campFloorNumbers(p);

  const play = (from: 'top' | 'camp') => {
    if (from === 'top') useProgress.getState().startDescent(id);
    router.push({ pathname: '/play/[id]', params: { id, from } });
  };

  return (
    <Screen>
      <TopBar title={p.name} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={{ width, height, alignSelf: 'center' }}>
          <ArtCanvas
            width={width}
            height={height}
            deps={[time, checkpoint, taken]}
            draw={(c, w, h) => drawPyramidSide(c, w, h, { pyramid: p, current: checkpoint, artifactTaken: taken, time: reduced ? 0 : time })}
          />
          <Text
            style={[styles.chamber, { left: L.chamber.x + L.chamber.w + 10, top: L.chamber.y + L.chamber.h / 2 - 18 }]}
            numberOfLines={2}
          >
            Basement{'\n'}
            {taken ? 'taken ✓' : p.artifact}
          </Text>
        </View>

        <View style={styles.facts}>
          <Fact label="Floors" value={`${p.floorCount}`} />
          <Fact label="Camp floors" value={listNumbers(camps)} />
          <Fact label="Deepest" value={deepest === undefined ? '—' : `floor ${deepest + 1}`} />
        </View>

        <View style={styles.card}>
          <Text style={type.label}>{taken ? 'Artifact taken' : 'Kept in the basement'}</Text>
          <Text style={[type.heading, taken && { color: colors.gold }]}>{p.artifact}</Text>
          <Text style={[type.body, { color: colors.muted }]}>{p.power}</Text>
          <Text style={type.caption}>Artifact powers arrive in a later version.</Text>
        </View>

        {taken && completions ? (
          <Text style={[type.caption, styles.center]}>
            Basement reached {completions} {completions === 1 ? 'time' : 'times'}.
          </Text>
        ) : null}
      </ScrollView>

      <View style={styles.actions}>
        {checkpoint > 0 && (
          <Button variant="primary" label={`Continue from camp · floor ${checkpoint + 1}`} onPress={() => play('camp')} />
        )}
        <Button
          variant={checkpoint > 0 ? 'secondary' : 'primary'}
          label={taken ? 'Descend again from the top' : checkpoint > 0 ? 'Start again from the top' : 'Enter at the top'}
          onPress={() => play('top')}
        />
      </View>
    </Screen>
  );
}

/** "5, 10, 14 & 25" */
function listNumbers(n: number[]): string {
  if (!n.length) return 'none';
  return n.length === 1 ? `${n[0]}` : `${n.slice(0, -1).join(', ')} & ${n[n.length - 1]}`;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={type.label}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.lg, paddingVertical: space.md },
  chamber: { position: 'absolute', color: '#d8c49a', fontFamily: fonts.body, fontSize: 13, lineHeight: 18 },
  facts: { flexDirection: 'row', gap: space.sm },
  fact: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, gap: 4 },
  factValue: { color: colors.ink, fontFamily: fonts.bodySemi, fontSize: 15 },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.lg, gap: space.sm },
  center: { textAlign: 'center' },
  actions: { gap: space.sm, paddingTop: space.md },
});
