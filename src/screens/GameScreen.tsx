import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  PixelRatio,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isCampFloor, lastCamp, startFloor, step, type Direction, type GameEvent, type GameState } from '../game/core/game';
import { KIND_NAME, STEP_SECONDS } from '../game/core/lights';
import type { PyramidInfo } from '../game/core/pyramids';
import { STRIP_H } from '../game/render/drawLightHud';
import { bakeFloor, bakeTilePx } from '../game/render/floorArt';
import { createLightMask } from '../game/render/lightMask';
import { themeFor } from '../game/render/themes';
import { useProgress } from '../state/progress';
import { useReducedMotion, useSettings } from '../state/settings';
import { Button, IconButton } from '../ui/Button';
import { haptic } from '../ui/haptics';
import { Panel, PanelActions, PanelText } from '../ui/Panel';
import { colors, fonts, space } from '../ui/theme';
import { Board, STRIP_GAP } from './play/Board';
import { FloorOverview, type OverviewKind } from './play/FloorOverview';
import { LightHud, type HudText } from './play/LightHud';
import { useKeyboard } from './play/useKeyboard';
import { createWalker } from './play/walker';

/** Redraws per second while the player stands still (flames and the clock still move). */
const IDLE_FPS = 30;
/** Tiles across the board; the camera follows the player on larger floors. */
const VIEW_TILES = 15;
/** The finger must move this far (dp) before a swipe counts, and the anchor trails at most this far behind. */
const SWIPE_START = 14;
const SWIPE_TRAIL = 36;
/** A flick: speed in dp per ms over the last 60 ms and total travel in dp. */
const FLICK_SPEED = 0.9;
const FLICK_TRAVEL = 48;
const CAPTION_SECONDS = 1.6;

const DIR: Record<'right' | 'left' | 'down' | 'up', Direction> = { right: 0, left: 1, down: 2, up: 3 };

/**
 * UI phases on top of the core status. The light only burns in `playing`;
 * every overlay freezes the game clock.
 */
type Phase =
  | { name: 'overview'; from: number; to: number; kind: OverviewKind }
  | { name: 'playing' }
  | { name: 'camp' }
  | { name: 'paused' }
  | { name: 'burntOut' };

const campLabel = (floorIndex: number) => (floorIndex === 0 ? 'the top' : `camp · floor ${floorIndex + 1}`);

const mmss = (sec: number) => {
  const n = Math.max(0, Math.ceil(sec));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
};

function captionFor(e: GameEvent): string | null {
  const name = KIND_NAME[e.kind as keyof typeof KIND_NAME];
  switch (e.type) {
    case 'pickup':
      return `+ ${name}`;
    case 'refill':
      return 'Oil refilled';
    case 'lit':
      return e.kind === 'sconce' ? 'Sconce lit' : e.kind === 'brazier' ? 'Brazier lit' : 'Candles lit';
    case 'bagFull':
      return 'Bag full';
    case 'autoLight':
      return `Spare lit: ${name}`;
    case 'lowLight':
      return 'Light running low';
    default:
      return null;
  }
}

function hudOf(g: GameState, caption: HudText['caption']): HudText {
  const burning = g.hand.left > 0;
  return {
    name: burning ? KIND_NAME[g.hand.kind] : 'Embers',
    time: burning ? mmss(g.hand.left) : `${Math.max(0, Math.ceil(6 - g.ember))} s`,
    low: !burning || g.hand.left < 10,
    spares: g.bag.map((b) => ({ label: `${KIND_NAME[b.kind]}, ${Math.ceil(b.left)} seconds` })),
    caption,
  };
}

const hudKey = (h: HudText) => `${h.name}|${h.time}|${h.low}|${h.spares.map((s) => s.label).join(',')}|${h.caption?.id ?? ''}`;

export function GameScreen({ pyramid, fromFloor }: { pyramid: PyramidInfo; fromFloor: number }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const controls = useSettings((s) => s.controls);
  const reducedMotion = useReducedMotion();
  const artifactTaken = useProgress((s) => !!s.artifacts[pyramid.id]);
  const { reachFloor, reachCamp, takeArtifact } = useProgress.getState();

  const padSpace = controls === 'swipe' ? 0 : 150;
  const boardSize = Math.max(200, Math.min(width - 32, 560, height - insets.top - insets.bottom - 90 - STRIP_H - STRIP_GAP - padSpace));

  const game = useRef<GameState>(startFloor(pyramid, fromFloor));
  const [version, setVersion] = useState(0);
  const [phase, setPhase] = useState<Phase>({
    name: 'overview',
    from: fromFloor,
    to: fromFloor,
    kind: fromFloor === 0 ? 'enter' : 'resume',
  });
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const cam = useRef({ x: 0, y: 0, floor: null as unknown });
  const leaving = useRef(false);
  const walker = useMemo(() => createWalker(() => haptic.bump()), []);
  const drawRef = useRef<((time: number) => void) | null>(null);
  const clock = useRef(0);
  const caption = useRef<{ id: number; text: string; until: number } | null>(null);
  const [hud, setHud] = useState<HudText>(() => hudOf(game.current, null));
  const hudShown = useRef('');
  const hudDirty = useRef(true);

  useEffect(() => {
    reachFloor(pyramid.id, fromFloor);
  }, [pyramid.id, fromFloor, reachFloor]);

  // game clock: the light burns by time, not by steps, and only while playing
  useEffect(() => {
    let raf = 0;
    let last: number | null = null;
    let sinceDraw = 0;
    let sinceHud = 0;
    let seenFloor: unknown = null;
    let seenStatus = 'playing';
    let lastSeq = 0;
    const loop = (t: number) => {
      const dt = last === null ? 0 : Math.min(0.1, (t - last) / 1000);
      last = t;
      if (phaseRef.current.name === 'playing') {
        clock.current += dt;
        let g = step(game.current, { type: 'tick', seconds: dt });
        g = walker.update(g);
        game.current = g;
        if (seenFloor !== g.floor) {
          seenFloor = g.floor;
          lastSeq = 0;
        }
        // what happened: haptics and a short caption
        for (const e of g.events) {
          if (e.seq <= lastSeq) continue;
          if (e.type === 'lowLight') haptic.warning();
          else if (e.type === 'lit' || e.type === 'autoLight') haptic.bump();
          else if (e.type === 'pickup' || e.type === 'refill') haptic.tap();
          const text = captionFor(e);
          if (text) caption.current = { id: e.seq + g.floorIndex * 1000, text, until: clock.current + CAPTION_SECONDS };
          hudDirty.current = true;
        }
        lastSeq = g.eventSeq;
        if (g.status !== seenStatus) {
          seenStatus = g.status;
          walker.reset();
          setVersion((v) => v + 1);
        }
        // the strip text: at most 4 times a second, or at once after an event
        sinceHud += dt;
        if (hudDirty.current || sinceHud >= 0.25) {
          sinceHud = 0;
          hudDirty.current = false;
          if (caption.current && clock.current > caption.current.until) caption.current = null;
          const next = hudOf(g, caption.current ? { id: caption.current.id, text: caption.current.text } : null);
          const key = hudKey(next);
          if (key !== hudShown.current) {
            hudShown.current = key;
            setHud(next);
          }
        }
        // the camera eases towards the player; redraw every frame while anything moves
        const tx = (g.pos % g.floor.size) + 0.5;
        const ty = Math.floor(g.pos / g.floor.size) + 0.5;
        const view = Math.min(g.floor.size, VIEW_TILES);
        const lo = view / 2;
        const hi = g.floor.size - view / 2;
        const k = 1 - Math.pow(0.0001, dt);
        const c = cam.current;
        const gx = Math.min(hi, Math.max(lo, tx));
        const gy = Math.min(hi, Math.max(lo, ty));
        c.x += (gx - c.x) * k;
        c.y += (gy - c.y) * k;
        const moving = Math.abs(c.x - gx) > 0.01 || Math.abs(c.y - gy) > 0.01 || g.cooldown > -STEP_SECONDS || walker.busy();
        sinceDraw += dt;
        if (moving || sinceDraw >= 1 / IDLE_FPS) {
          sinceDraw = 0;
          drawRef.current?.(clock.current);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [walker]);

  // overlays and focus changes stop any walking in progress
  useEffect(() => {
    walker.reset();
  }, [phase.name, walker]);

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
      hudDirty.current = true;
      setPhase({ name: 'overview', from, to: from + 1, kind: 'descend' });
      setVersion((v) => v + 1);
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
  const togglePause = useCallback(() => {
    const p = phaseRef.current.name;
    if (p === 'playing') setPhase({ name: 'paused' });
    else if (p === 'paused') setPhase({ name: 'playing' });
  }, []);

  useKeyboard(walker, phase.name === 'playing', togglePause);

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
      return () => {
        sub.remove();
        walker.reset();
      };
    }, [walker]),
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

  const press = (dir: Direction) => {
    if (phaseRef.current.name === 'playing') walker.press(dir);
  };

  // touch: a swipe moves at once and holding keeps walking; a flick runs on
  const touch = useRef({ ax: 0, ay: 0, gx: 0, gy: 0, dir: null as Direction | null, samples: [] as Array<{ t: number; x: number; y: number }> });
  const onGrant = (e: GestureResponderEvent) => {
    const { pageX, pageY } = e.nativeEvent;
    const tc = touch.current;
    tc.ax = tc.gx = pageX;
    tc.ay = tc.gy = pageY;
    tc.dir = null;
    tc.samples = [{ t: e.nativeEvent.timestamp, x: pageX, y: pageY }];
    walker.cancelRun();
  };
  const onMove = (e: GestureResponderEvent) => {
    const tc = touch.current;
    const { pageX, pageY, timestamp } = e.nativeEvent;
    tc.samples.push({ t: timestamp, x: pageX, y: pageY });
    while (tc.samples.length > 2 && timestamp - tc.samples[0].t > 80) tc.samples.shift();
    const dx = pageX - tc.ax;
    const dy = pageY - tc.ay;
    const dist = Math.hypot(dx, dy);
    if (dist < SWIPE_START) return;
    // the dominant axis, with hysteresis so a wobbling finger does not flip axes
    let horizontal = Math.abs(dx) >= Math.abs(dy);
    if (tc.dir !== null) {
      const curH = tc.dir < 2;
      horizontal = curH ? !(Math.abs(dy) > 1.3 * Math.abs(dx)) : Math.abs(dx) > 1.3 * Math.abs(dy);
    }
    const dir: Direction = horizontal ? (dx > 0 ? DIR.right : DIR.left) : dy > 0 ? DIR.down : DIR.up;
    if (dir !== tc.dir) {
      tc.dir = dir;
      press(dir);
    }
    if (dist > SWIPE_TRAIL) {
      tc.ax += (dx / dist) * (dist - SWIPE_TRAIL);
      tc.ay += (dy / dist) * (dist - SWIPE_TRAIL);
    }
  };
  const onEnd = (e: GestureResponderEvent) => {
    const tc = touch.current;
    const first = tc.samples[0];
    const { pageX, pageY, timestamp } = e.nativeEvent;
    if (first && tc.dir !== null && useSettings.getState().autoRun) {
      const span = Math.max(1, timestamp - first.t);
      const vx = (pageX - first.x) / span;
      const vy = (pageY - first.y) / span;
      const travel = Math.hypot(pageX - tc.gx, pageY - tc.gy);
      if (Math.hypot(vx, vy) >= FLICK_SPEED && travel >= FLICK_TRAVEL) {
        walker.flick(Math.abs(vx) >= Math.abs(vy) ? (vx > 0 ? DIR.right : DIR.left) : vy > 0 ? DIR.down : DIR.up);
      }
    }
    tc.dir = null;
    walker.release();
  };

  const swap = (slot: number) => {
    if (phaseRef.current.name !== 'playing') return;
    game.current = step(game.current, { type: 'swap', slot });
    haptic.tap();
    hudDirty.current = true;
  };

  const retry = () => {
    const from = game.current.floorIndex;
    game.current = step(game.current, { type: 'retry' });
    hudDirty.current = true;
    setPhase({ name: 'overview', from, to: game.current.floorIndex, kind: 'resume' });
    setVersion((v) => v + 1);
  };

  const leaveToMap = () => {
    leaving.current = true;
    router.dismissTo('/map');
  };

  const viewTiles = Math.min(s.floor.size, VIEW_TILES);
  const tilePx = boardSize / viewTiles;
  const info = pyramid.color;
  // the architecture is baked once per floor, hidden under the overview
  const art = useMemo(
    () => bakeFloor(s.floor, themeFor(pyramid.id, info), bakeTilePx(s.floor.size, tilePx, PixelRatio.get())),
    [s.floor, tilePx, pyramid.id, info],
  );
  const mask = useMemo(() => createLightMask(s.floor.size), [s.floor.size]);
  // free the previous floor's image once the new one is in place (the GC frees the rest)
  const prevArt = useRef<typeof art>(null);
  useEffect(() => {
    const old = prevArt.current;
    prevArt.current = art;
    if (old && old !== art) old.dispose();
  }, [art]);
  // snap the camera onto a new floor
  if (cam.current.floor !== s.floor) {
    const half = viewTiles / 2;
    cam.current = {
      x: Math.min(s.floor.size - half, Math.max(half, (s.pos % s.floor.size) + 0.5)),
      y: Math.min(s.floor.size - half, Math.max(half, Math.floor(s.pos / s.floor.size) + 0.5)),
      floor: s.floor,
    };
  }
  void version;

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
        <View style={styles.hudSpacer} />
      </View>

      <View style={{ width: boardSize, height: STRIP_H + STRIP_GAP + boardSize }}>
        <Board game={game} cam={cam} art={art} mask={mask} boardSize={boardSize} tilePx={tilePx} drawRef={drawRef} />
        <LightHud hud={hud} width={boardSize} onSwap={swap} />
        <View
          style={{ position: 'absolute', left: 0, top: STRIP_H + STRIP_GAP, width: boardSize, height: boardSize }}
          onStartShouldSetResponder={() => controls !== 'pad'}
          onResponderTerminationRequest={() => false}
          onResponderGrant={onGrant}
          onResponderMove={onMove}
          onResponderRelease={onEnd}
          onResponderTerminate={() => {
            touch.current.dir = null;
            walker.release();
          }}
          accessibilityLabel="Labyrinth. Swipe to move, hold to keep walking, flick to run."
        />
      </View>

      {controls !== 'swipe' && (
        <View style={styles.pad}>
          <PadButton label="↑" a11y="Up" dir={DIR.up} press={press} release={walker.release} style={styles.padUp} />
          <PadButton label="←" a11y="Left" dir={DIR.left} press={press} release={walker.release} style={styles.padLeft} />
          <PadButton label="↓" a11y="Down" dir={DIR.down} press={press} release={walker.release} style={styles.padDown} />
          <PadButton label="→" a11y="Right" dir={DIR.right} press={press} release={walker.release} style={styles.padRight} />
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
            Progress is saved and your light burns full again (a torch, or your better source). If it goes out further down, you come back to this camp.
          </PanelText>
          <PanelActions>
            <Button variant="primary" label="Continue the descent" onPress={() => setPhase({ name: 'playing' })} />
            <Button variant="ghost" label="Back to the map" onPress={leaveToMap} accessibilityHint="You can continue from this camp later" />
          </PanelActions>
        </Panel>
      )}

      {phase.name === 'paused' && (
        <Panel eyebrow={`${pyramid.name} · ${floorText}`} title="Paused" onDismiss={() => setPhase({ name: 'playing' })}>
          <PanelText>Your light does not burn while the game is paused.</PanelText>
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
        <Panel eyebrow={floorText} title="The light is out">
          <PanelText>
            Darkness. You feel your way back to {campLabel(checkpoint)}, where a torch is lit again.
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

function PadButton({
  label,
  a11y,
  dir,
  press,
  release,
  style,
}: {
  label: string;
  a11y: string;
  dir: Direction;
  press: (d: Direction) => void;
  release: () => void;
  style: object;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPressIn={() => press(dir)}
      onPressOut={release}
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
  hudSpacer: { width: 44 },
  hudTitle: { color: colors.ink, fontFamily: fonts.displayMedium, fontSize: 16 },
  hudText: { color: colors.muted, fontFamily: fonts.bodyMedium, fontSize: 14, fontVariant: ['tabular-nums'] },
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
