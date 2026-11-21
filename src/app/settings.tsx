import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { router } from 'expo-router';

import { uiSound } from '../audio/ui';
import { PYRAMIDS, SEALS } from '../game/core/pyramids';
import { sealsFilled, useProgress } from '../state/progress';
import { useSettings, type Controls, type MotionSetting } from '../state/settings';
import { Button } from '../ui/Button';
import { haptic } from '../ui/haptics';
import { Panel, PanelActions, PanelText } from '../ui/Panel';
import { Screen, TopBar } from '../ui/Screen';
import { colors, fonts, radius, space, type } from '../ui/theme';

type VolumeKey = 'low' | 'medium' | 'high';
const VOLUMES = [
  ['low', 'Low'],
  ['medium', 'Medium'],
  ['high', 'High'],
] as const;
const VOLUME_VALUE: Record<VolumeKey, number> = { low: 0.35, medium: 0.65, high: 1 };
/** the step nearest to a stored volume (an old or hand-edited value snaps to Low / Medium / High) */
function snapVolume(v: number): VolumeKey {
  let best: VolumeKey = 'medium';
  let d = Infinity;
  for (const [k] of VOLUMES) {
    const e = Math.abs(VOLUME_VALUE[k] - v);
    if (e < d) {
      d = e;
      best = k;
    }
  }
  return best;
}

export default function SettingsScreen() {
  const settings = useSettings();
  const artifacts = useProgress((s) => s.artifacts);
  const [confirmReset, setConfirmReset] = useState(false);
  const [devFloor, setDevFloor] = useState(1);

  return (
    <Screen>
      <TopBar title="Settings" />
      <ScrollView contentContainerStyle={styles.content}>
        <Section title="Feel">
          <ToggleRow
            label="Vibration"
            note="Heartbeat of the guardian, traps, pickups."
            value={settings.haptics}
            onChange={(haptics) => settings.set({ haptics })}
          />
        </Section>

        <Section title="Sound">
          <ToggleRow label="Sound" value={settings.sound} onChange={(sound) => settings.set({ sound })} />
          <Text style={type.label}>Effects</Text>
          <Segmented<VolumeKey>
            value={snapVolume(settings.sfx)}
            disabled={!settings.sound}
            options={VOLUMES}
            onChange={(k) => settings.set({ sfx: VOLUME_VALUE[k] })}
          />
          <Text style={type.label}>Ambience</Text>
          <Segmented<VolumeKey>
            value={snapVolume(settings.ambience)}
            disabled={!settings.sound}
            options={VOLUMES}
            onChange={(k) => settings.set({ ambience: VOLUME_VALUE[k] })}
          />
          <Text style={type.caption}>Footsteps, flames and the guardian are heard from where they are: walls muffle them, rooms echo.</Text>
        </Section>

        <Section title="Controls">
          <Segmented<Controls>
            value={settings.controls}
            options={[
              ['both', 'Swipe + pad'],
              ['swipe', 'Swipe'],
              ['pad', 'Pad'],
            ]}
            onChange={(controls) => settings.set({ controls })}
          />
          <ToggleRow
            label="Flick to run"
            note="A quick flick runs to the next junction. Holding a swipe or the keyboard (arrows, WASD, Shift to run) walks on."
            value={settings.autoRun}
            onChange={(autoRun) => settings.set({ autoRun })}
          />
        </Section>

        <Section title="Motion">
          <Segmented<MotionSetting>
            value={settings.motion}
            options={[
              ['system', 'System'],
              ['reduced', 'Reduced'],
              ['full', 'Full'],
            ]}
            onChange={(motion) => settings.set({ motion })}
          />
          <Text style={type.caption}>Reduced motion skips slides and pulses between floors and on the map.</Text>
        </Section>

        <Section title="Progress">
          <Button variant="danger" label="Reset progress" onPress={() => setConfirmReset(true)} />
        </Section>

        {__DEV__ && (
          <Section title="Developer">
            <Text style={type.caption}>Artifacts collected: {sealsFilled(artifacts)} of 4</Text>
            <View style={styles.devRow}>
              {Array.from({ length: SEALS.length + 1 }, (_, n) => (
                <Button key={n} label={`${n}`} style={styles.devButton} onPress={() => useProgress.getState().devGrantArtifacts(n)} />
              ))}
            </View>
            <Text style={type.caption}>Start Egypt at a floor (saves it as the checkpoint, then opens the pyramid):</Text>
            <View style={styles.devRow}>
              <Button label="−" style={styles.devButton} onPress={() => setDevFloor((n) => Math.max(1, n - 1))} />
              <Text style={[type.heading, styles.devFloor]}>{devFloor}</Text>
              <Button label="+" style={styles.devButton} onPress={() => setDevFloor((n) => Math.min(PYRAMIDS.egypt.floorCount, n + 1))} />
              <Button
                variant="primary"
                label="Go"
                style={styles.devButton}
                onPress={() => {
                  useProgress.getState().devReachCamp('egypt', devFloor - 1);
                  router.push({ pathname: '/pyramid/[id]', params: { id: 'egypt' } });
                }}
              />
            </View>
          </Section>
        )}
      </ScrollView>

      {confirmReset && (
        <Panel title="Reset progress?" onDismiss={() => setConfirmReset(false)}>
          <PanelText>All artifacts, camps and records are lost. Settings stay. This can't be undone.</PanelText>
          <PanelActions>
            <Button
              variant="danger"
              label="Reset everything"
              onPress={() => {
                useProgress.getState().resetProgress();
                haptic.warning();
                setConfirmReset(false);
              }}
            />
            <Button variant="ghost" label="Cancel" onPress={() => setConfirmReset(false)} />
          </PanelActions>
        </Panel>
      )}
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={type.label} accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

function ToggleRow({ label, note, value, onChange }: { label: string; note?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={type.body}>{label}</Text>
        {note ? <Text style={type.caption}>{note}</Text> : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={(v) => {
          uiSound.toggle();
          onChange(v);
        }}
        trackColor={{ false: colors.surfacePressed, true: '#a9852f' }}
        thumbColor={value ? colors.gold : colors.muted}
      />
    </View>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.segmented, disabled && { opacity: 0.4 }]} accessibilityRole="radiogroup">
      {options.map(([key, label]) => {
        const selected = key === value;
        return (
          <Pressable
            key={key}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled }}
            disabled={disabled}
            onPress={() => {
              haptic.tap();
              uiSound.toggle();
              onChange(key);
            }}
            style={[styles.segment, selected && styles.segmentOn]}
          >
            <Text style={[styles.segmentText, selected && styles.segmentTextOn]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.xl, paddingVertical: space.lg },
  section: { gap: space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  segmented: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.md, padding: 4, gap: 4 },
  segment: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  segmentOn: { backgroundColor: colors.gold },
  segmentText: { color: colors.muted, fontFamily: fonts.bodyMedium, fontSize: 14 },
  segmentTextOn: { color: colors.onGold },
  devRow: { flexDirection: 'row', gap: space.sm },
  devFloor: { flex: 1, textAlign: 'center', alignSelf: 'center' },
  devButton: { flex: 1, alignSelf: 'auto', paddingHorizontal: 0 },
});
