import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { router } from 'expo-router';

import { campFloorNumbers, PYRAMIDS, SEALS } from '../game/core/pyramids';
import { sealsFilled, useProgress } from '../state/progress';
import { useSettings, type Controls, type MotionSetting } from '../state/settings';
import { Button } from '../ui/Button';
import { haptic } from '../ui/haptics';
import { Panel, PanelActions, PanelText } from '../ui/Panel';
import { Screen, TopBar } from '../ui/Screen';
import { colors, fonts, radius, space, type } from '../ui/theme';

export default function SettingsScreen() {
  const settings = useSettings();
  const artifacts = useProgress((s) => s.artifacts);
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <Screen>
      <TopBar title="Settings" />
      <ScrollView contentContainerStyle={styles.content}>
        <Section title="Feel">
          <ToggleRow label="Vibration" value={settings.haptics} onChange={(haptics) => settings.set({ haptics })} />
          <ToggleRow
            label="Sound"
            note="The game has no sound yet."
            value={settings.sound}
            onChange={(sound) => settings.set({ sound })}
          />
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
            <Text style={type.caption}>Start Egypt at a camp (saves the camp, then opens the pyramid):</Text>
            <View style={styles.devRow}>
              {campFloorNumbers(PYRAMIDS.egypt).map((floor) => (
                <Button
                  key={floor}
                  label={`Egypt: camp at floor ${floor}`}
                  style={styles.devButton}
                  onPress={() => {
                    useProgress.getState().devReachCamp('egypt', floor - 1);
                    router.push({ pathname: '/pyramid/[id]', params: { id: 'egypt' } });
                  }}
                />
              ))}
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
        onValueChange={onChange}
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
}: {
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segmented} accessibilityRole="radiogroup">
      {options.map(([key, label]) => {
        const selected = key === value;
        return (
          <Pressable
            key={key}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => {
              haptic.tap();
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
  devButton: { flex: 1, alignSelf: 'auto', paddingHorizontal: 0 },
});
