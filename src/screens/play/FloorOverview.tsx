import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import type { PyramidInfo } from '../../game/core/pyramids';
import { easeOutCubic } from '../../game/render/art';
import { drawPyramidSide, sideLayout } from '../../game/render/drawPyramidSide';
import { uiSound } from '../../audio/ui';
import { ArtCanvas, useTicker } from '../../ui/ArtCanvas';
import { haptic } from '../../ui/haptics';
import { StarRow } from '../../ui/StarRow';
import { colors, fonts, space, type } from '../../ui/theme';
import { clock, starLabels, starStates, type OverviewResult } from './results';

export type OverviewKind = 'enter' | 'descend' | 'resume' | 'fall' | 'escape' | 'replay';

const easeInOut = (t: number) => {
  const q = Math.min(1, Math.max(0, t));
  return q * q * (3 - 2 * q);
};

const SLIDE_MS = 650;
const SHOW_MS = 2400;
/** the climb up the escape shaft takes longer than a floor change */
const ESCAPE_MS = 3200;
/** with a result: the stars pop one after the other, so the overview stays up longer (a tap still skips) */
const SHOW_RESULT_MS = 3000;
const ESCAPE_RESULT_MS = 3800;
const POP_AT = [800, 1050, 1300] as const;

/**
 * Between floors: the pyramid in profile, the torch sliding down one tier.
 * About two seconds; a tap skips it.
 */
export function FloorOverview({
  pyramid,
  from,
  to,
  kind,
  artifactTaken,
  reducedMotion,
  onDone,
  result,
}: {
  pyramid: PyramidInfo;
  from: number;
  to: number;
  kind: OverviewKind;
  artifactTaken: boolean;
  reducedMotion: boolean;
  onDone: () => void;
  /** stars and time of the floor just left (descend, fall, escape) */
  result?: OverviewResult;
}) {
  const { width: screenW } = useWindowDimensions();
  const width = Math.min(screenW - space.lg * 2, 440);
  const height = Math.round(width * (result ? 0.62 : 0.8));
  const time = useTicker(30);

  const states = result ? starStates(result) : null;
  useEffect(() => {
    const ms = kind === 'escape' ? (result ? ESCAPE_RESULT_MS : ESCAPE_MS) : result ? SHOW_RESULT_MS : SHOW_MS;
    const id = setTimeout(onDone, ms);
    return () => clearTimeout(id);
  }, [onDone, kind, result]);

  // the sound of the change, and the chimes with the stars won this run (all at once, one chime, with reduced motion)
  useEffect(() => {
    if (kind === 'descend') uiSound.descend();
    else if (kind === 'fall') uiSound.fall();
    else if (kind === 'escape') uiSound.escapeOut();
    if (!states) return;
    const ids: Array<ReturnType<typeof setTimeout>> = [];
    let first = true;
    states.forEach((st, i) => {
      if (st !== 'earned') return;
      const at = reducedMotion ? 0 : POP_AT[i];
      const chime = !reducedMotion || first;
      first = false;
      ids.push(
        setTimeout(() => {
          if (chime) uiSound.star(i as 0 | 1 | 2);
          haptic.play('star');
        }, at),
      );
    });
    if (result?.newBest) ids.push(setTimeout(() => uiSound.newBest(), reducedMotion ? 200 : 1600));
    return () => ids.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const N = pyramid.floorCount;
  const current = reducedMotion ? to : from + (to - from) * easeOutCubic(time / SLIDE_MS);
  const L = sideLayout(width, height, N);
  const m = L.marker(current);
  const left = N - 1 - to;
  const keep = artifactTaken ? 'was kept' : 'is kept';

  const climb = kind === 'escape' ? (reducedMotion ? 1 : easeInOut(time / (ESCAPE_MS - 500))) : undefined;
  const title =
    kind === 'escape'
      ? 'Out through the shaft'
      : kind === 'enter'
      ? 'You wake at the top'
      : kind === 'resume'
        ? to === 0
          ? 'Back at the top'
          : `Camp · floor ${to + 1}`
        : kind === 'fall'
          ? 'The floor gave way'
          : kind === 'replay'
            ? `Floor ${to + 1}`
            : `Floor ${to + 1} of ${N}`;
  const line =
    kind === 'escape'
      ? `Daylight. The ${pyramid.artifact} is yours.`
      : kind === 'replay'
        ? `Floor ${to + 1} again, with a fresh torch. Stars and secrets are kept.`
        : left === 0
      ? `The basement, where the ${pyramid.artifact} ${keep}. Find it.`
      : `Floor ${to + 1} of ${N}. ${left} ${left === 1 ? 'floor' : 'floors'} to the basement, where the ${pyramid.artifact} ${keep}.`;

  return (
    <Pressable
      style={styles.overlay}
      onPress={onDone}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${line} Tap to continue.`}
    >
      <Text style={type.label}>{pyramid.name}</Text>
      <Text style={[type.title, styles.title]}>{title}</Text>
      <View style={{ width, height }}>
        <ArtCanvas
          width={width}
          height={height}
          deps={[current, reducedMotion ? 0 : time, artifactTaken, climb]}
          draw={(c, w, h) => drawPyramidSide(c, w, h, { pyramid, current, artifactTaken: artifactTaken || kind === 'escape', time: reducedMotion ? 0 : time, escape: climb })}
        />
        {kind !== 'escape' && (
          <Text style={[styles.marker, { left: m.x + 18, top: m.y - 10 }]} numberOfLines={1}>
            Floor {Math.round(current) + 1}
          </Text>
        )}
        {kind !== 'escape' && (
          <Text
            style={[styles.chamber, { left: L.chamber.x + L.chamber.w + 10, top: L.chamber.y + L.chamber.h / 2 - 18 }]}
            numberOfLines={2}
          >
            Basement{'\n'}
            {pyramid.artifact}
          </Text>
        )}
      </View>
      {result && states && (
        <View style={styles.result}>
          <StarRow states={states} labels={starLabels(result)} time={reducedMotion ? 99999 : time} popAt={reducedMotion ? [0, 0, 0] : POP_AT} />
          <Text style={styles.times}>
            {result.cleared ? clock(result.time) : 'Not cleared'} · par {clock(result.par)}
            {result.best !== null ? ` · best ${clock(result.best)}` : ''}
            {result.newBest ? '  ' : ''}
            {result.newBest ? <Text style={styles.newBest}>New best</Text> : null}
          </Text>
        </View>
      )}
      <Text style={[type.body, styles.line]}>{line}</Text>
      <Text style={type.caption}>Tap to continue</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    padding: space.lg,
  },
  title: { textAlign: 'center' },
  marker: { position: 'absolute', color: colors.ink, fontFamily: fonts.bodySemi, fontSize: 15 },
  chamber: { position: 'absolute', color: '#d8c49a', fontFamily: fonts.body, fontSize: 13, lineHeight: 18 },
  line: { textAlign: 'center', color: colors.muted, maxWidth: 440 },
  result: { alignItems: 'center', gap: space.xs },
  times: { color: colors.ink, fontFamily: fonts.bodySemi, fontSize: 14, fontVariant: ['tabular-nums'] },
  newBest: { color: colors.gold, fontFamily: fonts.bodySemi },
});
