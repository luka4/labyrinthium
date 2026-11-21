import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { floorFor, warmLayouts } from '../../game/core/generate';
import { EGYPT_FRAGMENT_FLOORS, EGYPT_ROWS } from '../../game/core/egypt';
import { PYRAMIDS, campFloorNumbers, isPyramidId, type PyramidId } from '../../game/core/pyramids';
import { popcount } from '../../game/core/secrets';
import { STAR, parTime, starCount } from '../../game/core/stars';
import { storyOf } from '../../game/story';
import { drawPyramidSide, sideLayout } from '../../game/render/drawPyramidSide';
import { clock } from '../../screens/play/results';
import { fragmentsRead, isUnlocked, pyramidStars, useProgress, type FloorRecord } from '../../state/progress';
import { useReducedMotion } from '../../state/settings';
import { ArtCanvas, useTicker } from '../../ui/ArtCanvas';
import { Button } from '../../ui/Button';
import { Panel, PanelActions, PanelText } from '../../ui/Panel';
import { Pips, StarRow, type StarState } from '../../ui/StarRow';
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
  const floors = useProgress((s) => s.floors);
  const records = useProgress((s) => (isPyramidId(id) ? s.records[id] : undefined));
  const [openFloor, setOpenFloor] = useState<number | null>(null);
  const [storyOpen, setStoryOpen] = useState(false);

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
  const stars = pyramidStars(floors, id);
  const story = storyOf(id);
  const read = fragmentsRead(floors, id, (i) => p.architecture === 'egypt' ? (EGYPT_FRAGMENT_FLOORS as readonly number[]).indexOf(i) : -1);
  const gridW = width;
  const cell = Math.floor((gridW - 4 * space.sm) / 5);
  const canReplay = (i: number) => i <= (deepest ?? 0) && (i < p.floorCount - 1 || taken);
  // the first floor with a roaming guardian (Egypt only for now), from the rows
  const guardianFrom = p.architecture === 'egypt' ? EGYPT_ROWS.findIndex((r) => r.guardian && !r.guardian.sentinel) : -1;

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
          <Fact label="Stars" value={`${stars.stars} / ${stars.max}`} />
          {guardianFrom >= 0 && <Fact label="Guardian" value={`from floor ${guardianFrom + 1}`} />}
        </View>

        <View style={styles.card}>
          <Text style={type.label}>{taken ? 'Artifact taken' : 'Kept in the basement'}</Text>
          <Text style={[type.heading, taken && { color: colors.gold }]}>{p.artifact}</Text>
          <Text style={[type.body, { color: colors.muted }]}>{p.power}</Text>
          <Text style={type.caption}>Artifact powers arrive in a later version.</Text>
        </View>

        <View style={styles.section}>
          <Text style={type.label} accessibilityRole="header">
            Floors
          </Text>
          <View style={styles.grid}>
            {Array.from({ length: p.floorCount }, (_, i) => {
              const rec = floors[id]?.[i];
              const reached = i <= (deepest ?? -1);
              const isCamp = i > 0 && p.camps.includes(i);
              const st = floorStars(rec);
              return (
                <Pressable
                  key={i}
                  accessibilityRole="button"
                  accessibilityLabel={`Floor ${i + 1}, ${starCount(rec)} of 3 stars${isCamp ? ', camp' : ''}${reached ? '' : ', not reached yet'}`}
                  onPress={() => setOpenFloor(i)}
                  style={({ pressed }) => [styles.cell, { width: cell, minHeight: Math.max(56, cell) }, !reached && styles.cellDim, pressed && { backgroundColor: colors.surfacePressed }]}
                >
                  <Text style={[styles.cellNumber, !reached && { color: colors.dim }]}>{i + 1}</Text>
                  <Pips states={st} />
                  {isCamp && <View style={styles.camp} />}
                </Pressable>
              );
            })}
          </View>
        </View>

        {records && records.escapes > 0 ? (
          <View style={styles.card}>
            <Text style={type.label}>Records</Text>
            <Text style={type.body}>
              Best escape {records.bestEscape != null ? clock(records.bestEscape) : '—'} · untouched {records.untouched} of {records.escapes}
            </Text>
          </View>
        ) : null}

        {story.length > 0 ? (
          <View style={styles.card}>
            <Text style={type.label}>Story</Text>
            <Text style={type.heading}>
              {read.length} of {story.length} found
            </Text>
            <Text style={type.caption}>Painted walls in sealed chambers tell what the builders did.</Text>
            {read.length > 0 && <Button label="Read" onPress={() => setStoryOpen(true)} />}
          </View>
        ) : null}

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

      {openFloor !== null && (
        <FloorPanel
          id={id}
          index={openFloor}
          rec={floors[id]?.[openFloor]}
          canReplay={canReplay(openFloor)}
          onClose={() => setOpenFloor(null)}
          onReplay={() => {
            const n = openFloor + 1;
            setOpenFloor(null);
            router.push({ pathname: '/play/[id]', params: { id, from: 'floor', floor: String(n) } });
          }}
        />
      )}

      {storyOpen && (
        <Panel eyebrow={`${p.name} · story`} title={`${read.length} of ${story.length}`} onDismiss={() => setStoryOpen(false)}>
          <ScrollView style={styles.storyScroll} contentContainerStyle={{ gap: space.md }}>
            {read.map((k) => (
              <View key={k} style={{ gap: 4 }}>
                <Text style={type.heading}>{story[k].title}</Text>
                <PanelText>{story[k].text}</PanelText>
              </View>
            ))}
          </ScrollView>
          <PanelActions>
            <Button variant="primary" label="Close" onPress={() => setStoryOpen(false)} />
          </PanelActions>
        </Panel>
      )}
    </Screen>
  );
}

/** the three star states of a floor record, for the pips: cleared, fast, every secret */
function floorStars(rec: FloorRecord | undefined): [boolean, boolean, boolean] {
  return [!!rec && !!(rec.s & STAR.CLEARED), !!rec && !!(rec.s & STAR.FAST), !!rec && rec.n > 0 && rec.f === (1 << rec.n) - 1];
}

/** One floor: its stars with their meaning, the best time against par, the secrets found, and the way to play it again. */
function FloorPanel({ id, index, rec, canReplay, onClose, onReplay }: { id: PyramidId; index: number; rec: FloorRecord | undefined; canReplay: boolean; onClose: () => void; onReplay: () => void }) {
  const p = PYRAMIDS[id];
  // par needs the floor itself (its layout chain): worked out when the panel opens, then kept by the generator's memo
  const [par, setPar] = useState<number | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setPar(parTime(floorFor(p, index))), 0);
    return () => clearTimeout(t);
  }, [p, index]);
  const st = floorStars(rec);
  const states = useMemo(() => st.map((on): StarState => (on ? 'earned' : 'missing')) as [StarState, StarState, StarState], [st[0], st[1], st[2]]); // eslint-disable-line react-hooks/exhaustive-deps
  const secrets = rec && rec.n > 0 ? `${popcount(rec.f)} of ${rec.n}` : rec ? '—' : 'not seen yet';
  return (
    <Panel eyebrow={p.name} title={`Floor ${index + 1}`} onDismiss={onClose}>
      <View style={{ alignItems: 'center' }}>
        <StarRow states={states} labels={['Cleared', par !== null ? `Under ${clock(par)}` : 'Fast', `Every secret`]} />
      </View>
      <PanelText>
        {rec?.t != null ? `Best ${clock(rec.t)}` : 'No time yet'}
        {par !== null ? ` · par ${clock(par)}` : ''}
      </PanelText>
      <PanelText>Secrets {secrets}</PanelText>
      <PanelActions>
        {canReplay && <Button variant="primary" label={`Replay floor ${index + 1}`} onPress={onReplay} />}
        <Button variant="ghost" label="Close" onPress={onClose} />
      </PanelActions>
    </Panel>
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
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  fact: { flex: 1, minWidth: 96, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, gap: 4 },
  factValue: { color: colors.ink, fontFamily: fonts.bodySemi, fontSize: 15 },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.lg, gap: space.sm },
  center: { textAlign: 'center' },
  section: { gap: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  cell: { backgroundColor: colors.surface, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: colors.border, paddingVertical: space.sm },
  cellDim: { opacity: 0.5, borderColor: 'transparent' },
  cellNumber: { color: colors.ink, fontFamily: fonts.bodySemi, fontSize: 16, fontVariant: ['tabular-nums'] },
  camp: { position: 'absolute', top: 5, right: 5, width: 8, height: 8, backgroundColor: colors.gold, transform: [{ rotate: '45deg' }] },
  storyScroll: { maxHeight: 360 },
  actions: { gap: space.sm, paddingTop: space.md },
});
