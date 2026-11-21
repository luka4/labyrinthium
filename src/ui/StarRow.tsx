import { StyleSheet, Text, View } from 'react-native';

import { drawStar } from '../game/render/drawSecrets';
import { ArtCanvas } from './ArtCanvas';
import { colors, fonts, space } from './theme';

/** How a star stands: won this run, held from before, or not yet. */
export type StarState = 'earned' | 'held' | 'missing';

const POP_MS = 180;

/** Scale of a star popping in: 0.6 -> 1.08 -> 1 over POP_MS. */
function pop(age: number): number {
  if (age >= POP_MS) return 1;
  const u = age / POP_MS;
  return u < 0.6 ? 0.6 + (1.08 - 0.6) * (u / 0.6) : 1.08 - 0.08 * ((u - 0.6) / 0.4);
}

/**
 * Three stars in one small canvas with a label under each. `time` (ms) and `popAt` (ms per star)
 * animate the stars won this run; without them everything is drawn at rest.
 */
export function StarRow({
  states,
  labels,
  size = 22,
  time,
  popAt,
}: {
  states: readonly [StarState, StarState, StarState];
  labels?: readonly [string, string, string];
  size?: number;
  time?: number;
  popAt?: readonly [number, number, number];
}) {
  const cell = Math.max(size * 3.2, 92);
  const width = cell * 3;
  const height = size * 2 + 6;
  return (
    <View style={styles.wrap} accessible accessibilityLabel={`${labels ? labels.map((l, i) => `${l}: ${states[i] === 'missing' ? 'not yet' : 'earned'}`).join(', ') : ''}`}>
      <ArtCanvas
        width={width}
        height={height}
        deps={[time === undefined ? 0 : time, states.join()]}
        draw={(c) => {
          states.forEach((st, i) => {
            const cx = cell * (i + 0.5);
            const cy = height / 2;
            if (st === 'held') drawStar(c, cx, cy, size, 2);
            else if (st === 'missing') drawStar(c, cx, cy, size, 0);
            else if (time === undefined || !popAt) drawStar(c, cx, cy, size, 1);
            else if (time < popAt[i]) drawStar(c, cx, cy, size, 0);
            else drawStar(c, cx, cy, size, 1, pop(time - popAt[i]));
          });
        }}
      />
      {labels && (
        <View style={[styles.labels, { width }]}>
          {labels.map((l, i) => (
            <Text key={i} style={[styles.label, { width: cell }, states[i] === 'missing' && styles.dim]} numberOfLines={2}>
              {l}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

/** A tiny three-pip star count (floor grid cells): `n` of 3 pips lit. */
export function Pips({ states }: { states: readonly boolean[] }) {
  return (
    <View style={styles.pips}>
      {states.map((on, i) => (
        <View key={i} style={[styles.pip, on && styles.pipOn]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  labels: { flexDirection: 'row' },
  label: { textAlign: 'center', color: colors.muted, fontFamily: fonts.bodyMedium, fontSize: 12, lineHeight: 16 },
  dim: { color: colors.dim },
  pips: { flexDirection: 'row', gap: 3 },
  pip: { width: 7, height: 7, borderRadius: 3.5, borderWidth: 1, borderColor: '#6b5a33', backgroundColor: 'transparent' },
  pipOn: { backgroundColor: colors.gold, borderColor: '#8f6c1c' },
});
void space;
