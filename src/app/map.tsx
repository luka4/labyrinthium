import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PYRAMIDS, SEALS, isPyramidId, type PyramidId } from '../game/core/pyramids';
import { drawWorldMap, mapLayout } from '../game/render/drawWorldMap';
import { isUnlocked, sealsFilled, useProgress } from '../state/progress';
import { useReducedMotion } from '../state/settings';
import { ArtCanvas, useTicker } from '../ui/ArtCanvas';
import { Button, IconButton } from '../ui/Button';
import { uiSound } from '../audio/ui';
import { haptic } from '../ui/haptics';
import { Panel, PanelActions, PanelText } from '../ui/Panel';
import { Screen, TopBar } from '../ui/Screen';
import { colors, fonts, space, type } from '../ui/theme';

const FILL_MS = 1600;
const UNLOCK_DELAY_MS = 300;
const UNLOCK_MS = 1800;

/** The world map: pick a pyramid. The Black Pyramid stays sealed until all four artifacts are home. */
export default function MapScreen() {
  const params = useLocalSearchParams<{ filled?: string }>();
  const progress = useProgress();
  const { artifacts, camp, deepest, blackUnlockSeen } = progress;
  const reduced = useReducedMotion();
  const time = useTicker(30);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [sealedOpen, setSealedOpen] = useState(false);

  // The map may already be mounted under other screens, so each animation is
  // timed from the moment it starts, not from mount.
  // A seal filling in: once, on arrival from a basement (?filled=<id>).
  const [filling, setFilling] = useState<{ id: PyramidId; t0: number } | null>(null);
  useEffect(() => {
    const id = params.filled;
    if (!isPyramidId(id) || id === 'black' || !artifacts[id]) return;
    if (!reduced) setFilling({ id, t0: time });
    router.setParams({ filled: undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.filled]);
  const fill = filling ? Math.min(1, (time - filling.t0) / FILL_MS) : 1;

  // The door opening: once, after the fourth seal is filled.
  const allSeals = sealsFilled(artifacts) === SEALS.length;
  const [unlockT0, setUnlockT0] = useState<number | null>(null);
  const unlockPending = allSeals && !blackUnlockSeen && !reduced;
  useEffect(() => {
    if (unlockPending && unlockT0 === null && fill >= 1) setUnlockT0(time + UNLOCK_DELAY_MS);
  }, [unlockPending, unlockT0, fill, time]);
  const unlock = !allSeals
    ? 0
    : !unlockPending
      ? 1
      : unlockT0 === null
        ? 0
        : Math.min(1, Math.max(0, (time - unlockT0) / UNLOCK_MS));

  const fillFelt = useRef(false);
  const doorFelt = useRef(false);
  useEffect(() => {
    if (filling && fill >= 1 && !fillFelt.current) {
      fillFelt.current = true;
      uiSound.seal();
      haptic.bump();
    }
    if (unlockPending && unlock > 0.6 && !doorFelt.current) {
      doorFelt.current = true;
      uiSound.seal();
      haptic.heavy();
    }
    if (allSeals && !blackUnlockSeen && unlock >= 1) useProgress.getState().markBlackUnlockSeen();
  }, [fill, unlock, allSeals, blackUnlockSeen, unlockPending, filling]);

  const L = mapLayout(size.width, size.height);
  const filled = sealsFilled(artifacts);
  const animating = fill < 1 || (allSeals && unlock < 1);

  const statusOf = (id: PyramidId): { text: string; done: boolean } => {
    const p = PYRAMIDS[id];
    if (artifacts[id]) return { text: `${p.artifact} ✓`, done: true };
    if (id === 'black') return isUnlocked('black', artifacts) ? { text: 'Open', done: false } : { text: `Sealed · ${filled} of 4`, done: false };
    if ((camp[id] ?? 0) > 0) return { text: `Camp · floor ${(camp[id] ?? 0) + 1}`, done: false };
    if (deepest[id] !== undefined) return { text: `Reached floor ${(deepest[id] ?? 0) + 1}`, done: false };
    return { text: `${p.floorCount} floors`, done: false };
  };

  const open = (id: PyramidId) => {
    if (animating) return;
    if (!isUnlocked(id, artifacts)) {
      haptic.bump();
      setSealedOpen(true);
      return;
    }
    router.push({ pathname: '/pyramid/[id]', params: { id } });
  };

  const hint = progress.artifacts.black
    ? "The Builder's Heart is yours. Below the Black Pyramid, something has been waiting."
    : allSeals
      ? 'All four seals are filled. The Black Pyramid is open.'
      : filled === 0
        ? 'Choose any pyramid. Each starts on its top floor and keeps a sacred artifact in its basement.'
        : `${filled} of 4 seals on the Black Pyramid's door are filled.`;

  return (
    <Screen>
      <TopBar
        title="The World"
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        right={<IconButton glyph="⚙" label="Settings" onPress={() => router.push('/settings')} />}
      />
      <View style={styles.map} onLayout={(e) => setSize(e.nativeEvent.layout)}>
        {size.width > 0 && (
          <>
            <ArtCanvas
              width={size.width}
              height={size.height}
              deps={[time, artifacts, filling?.id, fill, unlock]}
              draw={(c, w, h) => drawWorldMap(c, w, h, { collected: artifacts, filling: filling?.id, fill, unlock, time: reduced ? 0 : time })}
              style={StyleSheet.absoluteFill}
            />
            {(Object.keys(PYRAMIDS) as PyramidId[]).map((id) => {
              const s = L.site(id);
              const status = statusOf(id);
              const below = id === 'black' ? L.sealSize * 2 : 6;
              const boxW = Math.max(s.size * 1.3, 120);
              return (
                <Pressable
                  key={id}
                  accessibilityRole="button"
                  accessibilityLabel={`${PYRAMIDS[id].name}. ${status.text}`}
                  onPress={() => open(id)}
                  style={({ pressed }) => [
                    styles.site,
                    { left: s.x - boxW / 2, top: s.y - s.size * 1.05, width: boxW, paddingTop: s.size * 1.05 + below },
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.name, id === 'black' && styles.nameBig]} numberOfLines={1}>
                    {PYRAMIDS[id].name}
                  </Text>
                  <Text style={[styles.status, status.done && styles.statusDone]} numberOfLines={1}>
                    {status.text}
                  </Text>
                </Pressable>
              );
            })}
          </>
        )}
      </View>
      <Text style={[type.caption, styles.hint]}>{hint}</Text>

      {sealedOpen && (
        <Panel eyebrow={`Sealed · ${filled} of 4`} title="The Black Pyramid" onDismiss={() => setSealedOpen(false)}>
          <PanelText>
            Its door has four empty seals. Each is filled by the artifact kept in the basement of one pyramid.
          </PanelText>
          <View style={styles.sealList}>
            {SEALS.map((id) => (
              <Text key={id} style={[styles.sealRow, artifacts[id] && styles.statusDone]}>
                {artifacts[id] ? '◆' : '◇'}  {PYRAMIDS[id].artifact} · {PYRAMIDS[id].name}
              </Text>
            ))}
          </View>
          <PanelActions>
            <Button label="Close" onPress={() => setSealedOpen(false)} />
          </PanelActions>
        </Panel>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1, marginHorizontal: -space.lg, marginVertical: space.sm },
  site: { position: 'absolute', alignItems: 'center', borderRadius: 12, paddingBottom: space.sm },
  pressed: { backgroundColor: 'rgba(243,197,90,0.08)' },
  name: { color: colors.ink, fontFamily: fonts.bodySemi, fontSize: 15 },
  nameBig: { fontFamily: fonts.display, fontSize: 17 },
  status: { color: colors.dim, fontFamily: fonts.body, fontSize: 12, marginTop: 2 },
  statusDone: { color: colors.gold },
  hint: { textAlign: 'center', paddingHorizontal: space.md },
  sealList: { gap: space.xs },
  sealRow: { color: colors.muted, fontFamily: fonts.body, fontSize: 15 },
});
