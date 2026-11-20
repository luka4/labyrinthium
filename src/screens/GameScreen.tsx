import { Canvas, Picture, createPicture } from '@shopify/react-native-skia';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TORCH_SECONDS, isCampFloor, lastCamp, startFloor, step, type Direction, type GameState } from '../game/core/game';
import type { PyramidInfo } from '../game/core/pyramids';
import { drawGame } from '../game/render/drawGame';
import { useProgress } from '../state/progress';
import { useReducedMotion, useSettings } from '../state/settings';
import { Button, IconButton } from '../ui/Button';
import { haptic } from '../ui/haptics';
import { Panel, PanelActions, PanelText } from '../ui/Panel';
import { colors, fonts, space } from '../ui/theme';
import { FloorOverview, type OverviewKind } from './play/FloorOverview';

/** Redraws per second while nothing moves (torch burn and flicker). */
const IDLE_FPS = 20;
const SWIPE_MIN_PX = 18;

const DIR: Record<'right' | 'left' | 'down' | 'up', Direction> = { right: 0, left: 1, down: 2, up: 3 };

/**
 * UI phases on top of the core status. The torch only burns in `playing`;
 * every overlay freezes the game clock.
 */
type Phase =
  | { name: 'overview'; from: number; to: number; kind: OverviewKind }
  | { name: 'playing' }
  | { name: 'camp' }
  | { name: 'paused' }
  | { name: 'burntOut' };

const campLabel = (floorIndex: number) => (floorIndex === 0 ? 'the top' : `camp · floor ${floorIndex + 1}`);

export function GameScreen({ pyramid, fromFloor }: { pyramid: PyramidInfo; fromFloor: number }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const controls = useSettings((s) => s.controls);
  const reducedMotion = useReducedMotion();
  const artifactTaken = useProgress((s) => !!s.artifacts[pyramid.id]);
  const { reachFloor, reachCamp, takeArtifact } = useProgress.getState();

  const padSpace = controls === 'swipe' ? 0 : 150;
  const boardSize = Math.max(200, Math.min(width - 32, 560, height - insets.top - insets.bottom - 120 - padSpace));

  const game = useRef<GameState>(startFloor(pyramid, fromFloor, 1));
  const [frame, setFrame] = useState(0);
  const [phase, setPhase] = useState<Phase>({
    name: 'overview',
    from: fromFloor,
    to: fromFloor,
    kind: fromFloor === 0 ? 'enter' : 'resume',
  });
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const flicker = useRef(1);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const leaving = useRef(false);

  useEffect(() => {
    reachFloor(pyramid.id, fromFloor);
  }, [pyramid.id, fromFloor, reachFloor]);

  // game clock: the torch burns by time, not by steps, and only while playing
  useEffect(() => {
    let raf = 0;
    let last: number | null = null;
    let sinceDraw = 0;
    const loop = (t: number) => {
      const dt = last === null ? 0 : Math.min(0.1, (t - last) / 1000);
      last = t;
      if (phaseRef.current.name === 'playing') {
        game.current = step(game.current, { type: 'tick', seconds: dt });
        flicker.current = 0.92 + 0.08 * Math.sin(t / 90) + 0.04 * Math.sin(t / 37);
        sinceDraw += dt;
        if (sinceDraw >= 1 / IDLE_FPS) {
          sinceDraw = 0;
          setFrame((f) => f + 1);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // react to the core status: stairs, basement, burnt out
  const s = game.current;
  const status = s.status;
  useEffect(() => {
    if (status === 'descending') {
      if (game.current.status !== 'descending') return; // already handled (effects can run twice)
      const from = game.current.floorIndex;
      game.current = step(game.current, { type: 'continue' });
      reachFloor(pyramid.id, from + 1);
      haptic.bump();
      setPhase({ name: 'overview', from, to: from + 1, kind: 'descend' });
      setFrame((f) => f + 1);
    } else if (status === 'burntOut') {
      haptic.warning();
      setPhase({ name: 'burntOut' });
    } else if (status === 'escaped' && !leaving.current) {
      leaving.current = true;
      haptic.success();
      takeArtifact(pyramid.id);
      router.replace({ pathname: '/artifact/[id]', params: { id: pyramid.id } });
    }
  }, [status, pyramid.id, reachFloor, takeArtifact]);

  const pause = useCallback(() => {
    if (phaseRef.current.name === 'playing') setPhase({ name: 'paused' });
  }, []);

  // the app going to the background pauses the run
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => next !== 'active' && pause());
    return () => sub.remove();
  }, [pause]);

  // Android back: pause, or resume from the pause menu; never drop the run by accident
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        const p = phaseRef.current.name;
        if (p === 'playing') setPhase({ name: 'paused' });
        else if (p === 'paused') setPhase({ name: 'playing' });
        return true;
      });
      return () => sub.remove();
    }, []),
  );

  const overviewDone = useCallback(() => {
    const p = phaseRef.current;
    if (p.name !== 'overview') return;
    if (p.kind === 'descend' && isCampFloor(pyramid, p.to)) {
      reachCamp(pyramid.id, p.to);
      setPhase({ name: 'camp' });
    } else {
      setPhase({ name: 'playing' });
    }
  }, [pyramid, reachCamp]);

  const move = (dir: Direction) => {
    if (phaseRef.current.name !== 'playing') return;
    const before = game.current.pos;
    game.current = step(game.current, { type: 'move', dir });
    if (game.current.pos === before) haptic.bump();
    setFrame((f) => f + 1);
  };

  const onTouchEnd = (e: GestureResponderEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start || controls === 'pad') return;
    const dx = e.nativeEvent.pageX - start.x;
    const dy = e.nativeEvent.pageY - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN_PX) return;
    if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? DIR.right : DIR.left);
    else move(dy > 0 ? DIR.down : DIR.up);
  };

  const retry = () => {
    const from = game.current.floorIndex;
    game.current = step(game.current, { type: 'retry' });
    setPhase({ name: 'overview', from, to: game.current.floorIndex, kind: 'resume' });
    setFrame((f) => f + 1);
  };

  const leaveToMap = () => {
    leaving.current = true;
    router.dismissTo('/map');
  };

  const tile = boardSize / s.floor.size;
  const picture = useMemo(
    () => createPicture((canvas) => drawGame(canvas, s, tile, flicker.current), { width: boardSize, height: boardSize }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [frame, s, tile, boardSize],
  );

  const checkpoint = lastCamp(pyramid, s.floorIndex);
  const floorText = `Floor ${s.floorIndex + 1} of ${pyramid.floorCount}`;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space.sm, paddingBottom: insets.bottom + space.md }]}>
      <View style={styles.hud}>
        <IconButton glyph="II" label="Pause" onPress={pause} />
        <View style={styles.hudMiddle}>
          <Text style={styles.hudTitle} numberOfLines={1}>
            {pyramid.name}
          </Text>
          <Text style={styles.hudText}>{floorText}</Text>
        </View>
        <Text style={[styles.hudText, styles.hudTorch]} accessibilityLabel={s.fuel > 0 ? `Torch: ${Math.ceil(s.fuel * TORCH_SECONDS)} seconds` : 'Embers'}>
          {s.fuel > 0 ? `${Math.ceil(s.fuel * TORCH_SECONDS)} s` : 'embers'}
        </Text>
      </View>
      <View style={styles.fuelTrack} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(s.fuel * 100) }}>
        <View style={[styles.fuelBar, { width: `${s.fuel * 100}%` }, s.fuel < 0.25 && styles.fuelLow]} />
      </View>

      <View
        style={{ width: boardSize, height: boardSize }}
        onStartShouldSetResponder={() => true}
        onResponderGrant={(e) => {
          touchStart.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
        }}
        onResponderRelease={onTouchEnd}
        accessibilityLabel="Labyrinth. Swipe to move."
      >
        <Canvas style={{ width: boardSize, height: boardSize }}>
          <Picture picture={picture} />
        </Canvas>
      </View>

      {controls !== 'swipe' && (
        <View style={styles.pad}>
          <PadButton label="↑" a11y="Up" onPress={() => move(DIR.up)} style={styles.padUp} />
          <PadButton label="←" a11y="Left" onPress={() => move(DIR.left)} style={styles.padLeft} />
          <PadButton label="↓" a11y="Down" onPress={() => move(DIR.down)} style={styles.padDown} />
          <PadButton label="→" a11y="Right" onPress={() => move(DIR.right)} style={styles.padRight} />
        </View>
      )}

      {phase.name === 'overview' && (
        <FloorOverview
          key={`${phase.kind}-${phase.to}`}
          pyramid={pyramid}
          from={phase.from}
          to={phase.to}
          kind={phase.kind}
          artifactTaken={artifactTaken}
          reducedMotion={reducedMotion}
          onDone={overviewDone}
        />
      )}

      {phase.name === 'camp' && (
        <Panel eyebrow={`Camp · ${floorText}`} title="A place to rest">
          <PanelText>
            Progress is saved and your torch burns full again. If it goes out further down, you come back to this camp.
          </PanelText>
          <PanelActions>
            <Button variant="primary" label="Continue the descent" onPress={() => setPhase({ name: 'playing' })} />
            <Button variant="ghost" label="Back to the map" onPress={leaveToMap} accessibilityHint="You can continue from this camp later" />
          </PanelActions>
        </Panel>
      )}

      {phase.name === 'paused' && (
        <Panel eyebrow={`${pyramid.name} · ${floorText}`} title="Paused" onDismiss={() => setPhase({ name: 'playing' })}>
          <PanelText>The torch does not burn while the game is paused.</PanelText>
          <PanelActions>
            <Button variant="primary" label="Resume" onPress={() => setPhase({ name: 'playing' })} />
            <Button label="Settings" onPress={() => router.push('/settings')} />
            <Button
              variant="ghost"
              label="Leave to the map"
              onPress={leaveToMap}
              accessibilityHint={`Next time you start from ${campLabel(checkpoint)}`}
            />
          </PanelActions>
          <Text style={styles.note}>Leaving now, you start again from {campLabel(checkpoint)}.</Text>
        </Panel>
      )}

      {phase.name === 'burntOut' && (
        <Panel eyebrow={floorText} title="The torch is out">
          <PanelText>
            Darkness. You feel your way back to {campLabel(checkpoint)}, where the torch is relit.
          </PanelText>
          <PanelActions>
            <Button variant="primary" label={checkpoint === 0 ? 'Back to the top' : `Back to camp · floor ${checkpoint + 1}`} onPress={retry} />
            <Button variant="ghost" label="Leave to the map" onPress={leaveToMap} />
          </PanelActions>
        </Panel>
      )}
    </View>
  );
}

function PadButton({ label, a11y, onPress, style }: { label: string; a11y: string; onPress: () => void; style: object }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={onPress}
      style={({ pressed }) => [styles.padButton, style, pressed && styles.padPressed]}
    >
      <Text style={styles.padText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', gap: space.md },
  hud: { width: '100%', paddingHorizontal: space.lg, flexDirection: 'row', alignItems: 'center', gap: space.md },
  hudMiddle: { flex: 1, alignItems: 'center' },
  hudTitle: { color: colors.ink, fontFamily: fonts.displayMedium, fontSize: 16 },
  hudText: { color: colors.muted, fontFamily: fonts.bodyMedium, fontSize: 14, fontVariant: ['tabular-nums'] },
  hudTorch: { width: 56, textAlign: 'right', color: colors.ink },
  fuelTrack: { width: '90%', height: 8, borderRadius: 4, backgroundColor: '#2a241a', overflow: 'hidden' },
  fuelBar: { height: '100%', backgroundColor: '#f0b54a' },
  fuelLow: { backgroundColor: '#d9652b' },
  note: { color: colors.dim, fontFamily: fonts.body, fontSize: 13, textAlign: 'center' },
  pad: { width: 180, height: 124 },
  padButton: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  padPressed: { backgroundColor: colors.surfacePressed },
  padText: { color: colors.ink, fontSize: 22 },
  padUp: { left: 62, top: 0 },
  padLeft: { left: 0, top: 64 },
  padDown: { left: 62, top: 64 },
  padRight: { left: 124, top: 64 },
});
