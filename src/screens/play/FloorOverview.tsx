import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import type { PyramidInfo } from '../../game/core/pyramids';
import { easeOutCubic } from '../../game/render/art';
import { drawPyramidSide, sideLayout } from '../../game/render/drawPyramidSide';
import { ArtCanvas, useTicker } from '../../ui/ArtCanvas';
import { colors, fonts, space, type } from '../../ui/theme';

export type OverviewKind = 'enter' | 'descend' | 'resume';

const SLIDE_MS = 650;
const SHOW_MS = 2400;

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
}: {
  pyramid: PyramidInfo;
  from: number;
  to: number;
  kind: OverviewKind;
  artifactTaken: boolean;
  reducedMotion: boolean;
  onDone: () => void;
}) {
  const { width: screenW } = useWindowDimensions();
  const width = Math.min(screenW - space.lg * 2, 440);
  const height = Math.round(width * 0.8);
  const time = useTicker(30);

  useEffect(() => {
    const id = setTimeout(onDone, SHOW_MS);
    return () => clearTimeout(id);
  }, [onDone]);

  const N = pyramid.floorCount;
  const current = reducedMotion ? to : from + (to - from) * easeOutCubic(time / SLIDE_MS);
  const L = sideLayout(width, height, N);
  const m = L.marker(current);
  const left = N - 1 - to;
  const keep = artifactTaken ? 'was kept' : 'is kept';

  const title =
    kind === 'enter' ? 'You wake at the top' : kind === 'resume' ? (to === 0 ? 'Back at the top' : `Camp · floor ${to + 1}`) : `Floor ${to + 1} of ${N}`;
  const line =
    left === 0
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
          deps={[current, reducedMotion ? 0 : time, artifactTaken]}
          draw={(c, w, h) => drawPyramidSide(c, w, h, { pyramid, current, artifactTaken, time: reducedMotion ? 0 : time })}
        />
        <Text style={[styles.marker, { left: m.x + 18, top: m.y - 10 }]} numberOfLines={1}>
          Floor {Math.round(current) + 1}
        </Text>
        <Text
          style={[styles.chamber, { left: L.chamber.x + L.chamber.w + 10, top: L.chamber.y + L.chamber.h / 2 - 18 }]}
          numberOfLines={2}
        >
          Basement{'\n'}
          {pyramid.artifact}
        </Text>
      </View>
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
});
