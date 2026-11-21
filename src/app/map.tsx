import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from 'react-native';

import { POWERS } from '../game/core/powers';
import { PYRAMIDS, SEALS, isPyramidId, type PyramidId } from '../game/core/pyramids';
import { SITE_ORDER } from '../game/world/geo';
import { Globe } from '../screens/map/Globe';
import { SiteCard, type CardData } from '../screens/map/SiteCard';
import { isUnlocked, ownedPowers, pyramidStars, sealsFilled, useProgress } from '../state/progress';
import { useReducedMotion } from '../state/settings';
import { useTicker } from '../ui/ArtCanvas';
import { uiSound } from '../audio/ui';
import { Button, IconButton } from '../ui/Button';
import { haptic } from '../ui/haptics';
import { Panel, PanelActions, PanelText } from '../ui/Panel';
import { Screen, TopBar } from '../ui/Screen';
import { colors, fonts, space } from '../ui/theme';

/** The seal animation (plan 06): a hold on the pyramid, the spark along the arc, the socket, then the door. */
const HOLD_MS = 400;
const TRAVEL_MS = 1600;
const SOCKET_MS = 600;
const UNLOCK_DELAY_MS = 300;
const UNLOCK_MS = 1800;
const GAP = 12;

type Anim = { id: PyramidId | null; t0: number };

/**
 * The world map: a globe you can turn, and a pager of five site cards (west to east, the Black Pyramid
 * last) under it. Choosing on one turns the other. The Black Pyramid stays sealed until all four artifacts are home.
 */
export default function MapScreen() {
  const params = useLocalSearchParams<{ filled?: string }>();
  const artifacts = useProgress((s) => s.artifacts);
  const camp = useProgress((s) => s.camp);
  const deepest = useProgress((s) => s.deepest);
  const floors = useProgress((s) => s.floors);
  const blackUnlockSeen = useProgress((s) => s.blackUnlockSeen);
  const focus = useProgress((s) => s.focus);
  const reduced = useReducedMotion();
  const time = useTicker(30);
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const [sealedOpen, setSealedOpen] = useState(false);
  const [selected, setSelected] = useState<PyramidId>(focus ?? 'egypt');
  const pager = useRef<ScrollViewInstance>(null);

  const allSeals = sealsFilled(artifacts) === SEALS.length;
  const owned = useMemo(() => ownedPowers(artifacts), [artifacts]);

  // ---- the seal animation: once, on arrival from a basement (?filled=<id>), or the door alone ------------------
  const [anim, setAnim] = useState<Anim | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    const id = params.filled;
    if (isPyramidId(id) && id !== 'black' && artifacts[id] && !reduced) {
      started.current = true;
      setAnim({ id, t0: time });
      router.setParams({ filled: undefined });
    } else if (allSeals && !blackUnlockSeen && !reduced) {
      started.current = true;
      setAnim({ id: null, t0: time });
    } else if (isPyramidId(id)) {
      // reduced motion: the final state at once, one sound
      started.current = true;
      router.setParams({ filled: undefined });
      if (artifacts[id]) {
        uiSound.seal();
        setSelected('black');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.filled, allSeals, blackUnlockSeen, reduced]);

  const elapsed = anim ? time - anim.t0 : 0;
  const hasFill = !!anim?.id;
  const travelStart = HOLD_MS;
  const socketStart = travelStart + TRAVEL_MS;
  const afterFill = hasFill ? socketStart + SOCKET_MS : 0;
  const unlockStart = afterFill + (allSeals && !blackUnlockSeen ? UNLOCK_DELAY_MS : 0);
  const needsUnlock = !!anim && allSeals && !blackUnlockSeen;
  const unlockU = !anim ? (allSeals ? 1 : 0) : needsUnlock ? Math.min(1, Math.max(0, (elapsed - unlockStart) / UNLOCK_MS)) : allSeals ? 1 : 0;
  const animEnd = needsUnlock ? unlockStart + UNLOCK_MS : afterFill;
  const travelU = anim && hasFill ? Math.min(1, Math.max(0, (elapsed - travelStart) / TRAVEL_MS)) : 1;
  const socketT = anim && hasFill ? Math.min(1, Math.max(0, (elapsed - socketStart) / SOCKET_MS)) : 1;
  const animating = !!anim && elapsed < animEnd;

  // the pager follows the spark to the Black card, once
  const scrolled = useRef(false);
  useEffect(() => {
    if (anim?.id && elapsed >= travelStart && !scrolled.current) {
      scrolled.current = true;
      setSelected('black');
      scrollTo('black', true);
    }
  });
  useEffect(() => {
    if (anim && !animating && elapsed > 0) setAnim(null);
  }, [anim, animating, elapsed]);

  // sounds and haptics at the beats
  const felt = useRef({ fill: false, door: false });
  useEffect(() => {
    if (anim?.id && socketT > 0 && !felt.current.fill) {
      felt.current.fill = true;
      uiSound.seal();
      haptic.bump();
    }
    if (needsUnlock && unlockU > 0.3 && !felt.current.door) {
      felt.current.door = true;
      uiSound.seal();
      haptic.heavy();
    }
    if (anim && needsUnlock && unlockU >= 1) useProgress.getState().markBlackUnlockSeen();
  }, [anim, socketT, unlockU, needsUnlock]);

  // ---- layout ---------------------------------------------------------------------------------------------------
  const cardW = Math.max(220, layout.width - 24);
  const globeSize = Math.max(180, Math.min(layout.width, Math.round(layout.height * 0.52)));
  const idx = (id: PyramidId) => SITE_ORDER.indexOf(id);
  function scrollTo(id: PyramidId, animated: boolean) {
    pager.current?.scrollTo({ x: idx(id) * (cardW + GAP), animated: animated && !reduced });
  }
  const select = useCallback((id: PyramidId, fromPager = false) => {
    setSelected(id);
    useProgress.getState().setFocus(id);
    if (!fromPager) scrollTo(id, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardW, reduced]);

  // restore the remembered card once the width is known
  const restored = useRef(false);
  useEffect(() => {
    if (layout.width > 0 && !restored.current) {
      restored.current = true;
      scrollTo(selected, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.width]);

  // ---- cards ----------------------------------------------------------------------------------------------------
  const filled = sealsFilled(artifacts);
  const cardOf = (id: PyramidId): CardData => {
    const p = PYRAMIDS[id];
    let status = `${p.floorCount} floors`;
    let done = false;
    if (artifacts[id]) {
      status = `${p.artifact} ✓`;
      done = true;
    } else if (id === 'black') status = isUnlocked('black', artifacts) ? 'Open' : `Sealed · ${filled} of 4`;
    else if ((camp[id] ?? 0) > 0) status = `Camp · floor ${(camp[id] ?? 0) + 1}`;
    else if (deepest[id] !== undefined) status = `Reached floor ${(deepest[id] ?? 0) + 1}`;
    return {
      id,
      status,
      done,
      taken: !!artifacts[id],
      stars: pyramidStars(floors, id),
      camp: (camp[id] ?? 0) > 0 ? (camp[id] ?? 0) : null,
      attuned: owned.find((pw) => POWERS[pw].attuned === id) ?? null,
      sealed: id === 'black' && !isUnlocked('black', artifacts),
      filled,
    };
  };

  // what the door and the globe show while the animation runs: the socket of the filling pyramid is empty until its beat
  const shownCollected = useMemo(() => {
    if (!anim?.id || socketT > 0) return artifacts;
    const c = { ...artifacts };
    delete c[anim.id];
    return c;
  }, [artifacts, anim?.id, socketT]);
  const filling = anim?.id ? { id: anim.id, t: travelU } : null;
  const follow = anim?.id && travelU < 1 ? { from: anim.id, to: 'black' as const, t: elapsed < travelStart ? 0 : travelU } : null;
  const doorFilling = anim?.id && socketT > 0 && socketT < 1 ? { id: anim.id, t: socketT } : null;
  const door = { collected: shownCollected, unlock: unlockU, filling: doorFilling, time: reduced ? 0 : time / 1000 };

  const open = (id: PyramidId) => {
    if (animating) return;
    if (!isUnlocked(id, artifacts)) {
      haptic.bump();
      setSealedOpen(true);
      return;
    }
    router.push({ pathname: '/pyramid/[id]', params: { id } });
  };
  const resume = (id: PyramidId) => {
    if (animating) return;
    router.push({ pathname: '/play/[id]', params: { id, from: 'camp' } });
  };

  return (
    <Screen>
      <TopBar
        title="The World"
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        right={<IconButton glyph="⚙" label="Settings" onPress={() => router.push('/settings')} />}
      />
      <View style={styles.body} onLayout={(e) => setLayout(e.nativeEvent.layout)}>
        {layout.width > 0 && (
          <>
            <View style={{ alignItems: 'center', height: globeSize }}>
              <Globe
                size={globeSize}
                selected={selected}
                collected={shownCollected}
                filling={filling}
                follow={follow}
                unlock={unlockU}
                reducedMotion={reduced}
                onSelect={(id) => !animating && select(id)}
              />
            </View>
            <ScrollView
              ref={pager}
              horizontal
              showsHorizontalScrollIndicator={false}
              snapToInterval={cardW + GAP}
              decelerationRate="fast"
              scrollEnabled={!animating}
              contentContainerStyle={{ gap: GAP, paddingRight: layout.width - cardW }}
              onMomentumScrollEnd={(e) => {
                const i = Math.max(0, Math.min(SITE_ORDER.length - 1, Math.round(e.nativeEvent.contentOffset.x / (cardW + GAP))));
                if (SITE_ORDER[i] !== selected) select(SITE_ORDER[i], true);
              }}
              style={styles.pager}
            >
              {SITE_ORDER.map((id) => (
                <SiteCard
                  key={id}
                  card={cardOf(id)}
                  width={cardW}
                  door={id === 'black' ? door : undefined}
                  onEnter={() => open(id)}
                  onContinue={() => resume(id)}
                  onDoor={() => setSealedOpen(true)}
                />
              ))}
            </ScrollView>
          </>
        )}
      </View>

      {sealedOpen && (
        <Panel eyebrow={`Sealed · ${filled} of 4`} title="The Black Pyramid" onDismiss={() => setSealedOpen(false)}>
          <PanelText>Its door has four empty sockets. Each is filled by the artifact kept in the basement of one pyramid.</PanelText>
          <View style={styles.sealList}>
            {SEALS.map((id) => (
              <Text key={id} style={[styles.sealRow, artifacts[id] && { color: colors.gold }]}>
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
  body: { flex: 1, marginHorizontal: -space.lg, marginTop: space.sm, gap: space.md },
  pager: { flexGrow: 0, paddingLeft: space.md },
  sealList: { gap: space.xs },
  sealRow: { color: colors.muted, fontFamily: fonts.body, fontSize: 15 },
});

