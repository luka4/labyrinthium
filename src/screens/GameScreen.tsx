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

import { isBasement, isCampFloor, lastCamp, startFloor, startOn, step, type Direction, type GameState, type StartOptions } from '../game/core/game';
import type { TrapKind } from '../game/core/floor';
import { floorFor } from '../game/core/generate';
import { KIND_NAME, STEP_SECONDS } from '../game/core/lights';
import { POWER_ORDER, freshPowers, type PowerId } from '../game/core/powers';
import { waterSandbox } from '../game/core/sandbox';
import { BREATH, WET, waterAt } from '../game/core/water';
import { popcount, secretAtSeal } from '../game/core/secrets';
import { PYRAMIDS, type PyramidInfo } from '../game/core/pyramids';
import { floorResult, parTime } from '../game/core/stars';
import { STRIP_H } from '../game/render/drawLightHud';
import { createFloorArt, type FloorArt } from '../game/render/floorArt';
import { createLightMask } from '../game/render/lightMask';
import { captionFor, hintText, storyOf } from '../kits';
import { renderKitFor } from '../kits/render';
import { getAmbience, getEngine } from '../audio';
import { createSoundDirector } from '../audio/director';
import { ownedPowers, useProgress, type HintId } from '../state/progress';
import { useReducedMotion, useSettings } from '../state/settings';
import { Button, IconButton } from '../ui/Button';
import { createHapticSequencer, fire, haptic } from '../ui/haptics';
import { clock as mmss2, starLabels, starStates, type OverviewResult } from './play/results';
import { StarRow } from '../ui/StarRow';
import { Panel, PanelActions, PanelText } from '../ui/Panel';
import { colors, fonts, space } from '../ui/theme';
import { Board, STRIP_GAP, powerBarHeight } from './play/Board';
import { PowerBar, powerTextOf, type PowerText } from './play/PowerBar';
import { BAR_GAP } from '../game/render/drawPowerBar';
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
/** The trapdoor slab tilts open for this long before the next floor starts. */
const FALL_SECONDS = 0.25;
/** Seconds a first-encounter hint stays up. */
const HINT_SECONDS = 3;
/** After the step into the false door, before the climb up the shaft. */
const ESCAPE_STEP_SECONDS = 0.3;
/** Floor-art chunk budgets: ms of rasterising per frame while walking, and under the overview. */
const ART_BUDGET_PLAYING = 6;
const ART_BUDGET_OVERVIEW = 8;

/** One-time teaching captions (what a trap looks like, powers, water) live in the kits: `hintText`. */

/** What a run is: a descent saved to the progress, a replay of one floor, or the dev water sandbox (no saves at all). */
export type RunMode = 'descent' | 'replay' | 'sandbox';

const noop = (..._args: unknown[]) => {};
const NO_POWERS: PowerText = [];

const DIR: Record<'right' | 'left' | 'down' | 'up', Direction> = { right: 0, left: 1, down: 2, up: 3 };

/**
 * UI phases on top of the core status. The light only burns in `playing`;
 * every overlay freezes the game clock.
 */
type Phase =
  | { name: 'overview'; from: number; to: number; kind: OverviewKind; result?: OverviewResult }
  | { name: 'result'; result: OverviewResult; kind: 'descend' | 'fall' | 'escape' }
  | { name: 'fragment'; floorIndex: number; fragment: number }
  | { name: 'playing' }
  | { name: 'camp' }
  | { name: 'paused' }
  | { name: 'burntOut' }
  | { name: 'buried' }
  | { name: 'caught' }
  | { name: 'drowned' };

const campLabel = (floorIndex: number) => (floorIndex === 0 ? 'the top' : `camp · floor ${floorIndex + 1}`);

const mmss = (sec: number) => {
  const n = Math.max(0, Math.ceil(sec));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
};

function hudOf(g: GameState, caption: HudText['caption']): HudText {
  const burning = g.hand.left > 0;
  return {
    name: burning ? KIND_NAME[g.hand.kind] : 'Embers',
    time: burning ? mmss(g.hand.left) : `${Math.max(0, Math.ceil(6 - g.ember))} s`,
    low: !burning || g.hand.left < 10,
    spares: g.bag.map((b) => ({ label: `${KIND_NAME[b.kind]}, ${Math.ceil(b.left)} seconds` })),
    caption,
    breath: g.water && g.breath < BREATH.max ? `${Math.max(0, Math.ceil(g.breath))} seconds of breath` : undefined,
    powers: powerTextOf(g.powers),
  };
}

const hudKey = (h: HudText) =>
  `${h.name}|${h.time}|${h.low}|${h.spares.map((s) => s.label).join(',')}|${h.caption?.id ?? ''}|${h.breath ?? ''}|${h.powers?.map((p) => p.label).join(',') ?? ''}`;

/** the water sandbox floor (dev): Egypt floor 3 with shallow, deep and flooded water */
const SANDBOX_FLOOR = 2;

export function GameScreen({ pyramid, fromFloor, mode = 'descent' }: { pyramid: PyramidInfo; fromFloor: number; mode?: RunMode }) {
  const sandbox = mode === 'sandbox';
  // a replay and the sandbox end with a result panel and never touch the descent
  const replay = mode !== 'descent';
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const controls = useSettings((s) => s.controls);
  const reducedMotion = useReducedMotion();
  const artifactTaken = useProgress((s) => !!s.artifacts[pyramid.id]);
  /** the powers you carry (the sandbox gives all four); owned artifacts never change during a run */
  const [owned] = useState<PowerId[]>(() => (sandbox ? [...POWER_ORDER] : ownedPowers(useProgress.getState().artifacts)));
  const hasPowers = owned.length > 0;
  /** the numbers of the powers of a run on this pyramid (attuned where it matches) */
  const runOpts = useCallback((): StartOptions => ({ powers: freshPowers(sandbox ? 'sandbox' : pyramid.id, owned) }), [sandbox, pyramid.id, owned]);
  /** a run of this screen: the sandbox floor or a real one */
  const begin = useCallback(
    (floorIndex: number): GameState =>
      sandbox
        ? startOn(waterSandbox(floorFor(PYRAMIDS.egypt, SANDBOX_FLOOR)), PYRAMIDS.egypt, SANDBOX_FLOOR, undefined, undefined, 0, 0, runOpts())
        : startFloor(pyramid, floorIndex, undefined, undefined, 0, 0, runOpts()),
    [sandbox, pyramid, runOpts],
  );
  const { reachFloor: reachFloorSaved, reachCamp: reachCampSaved, takeArtifact: takeArtifactSaved } = useProgress.getState();
  // a replayed floor never touches the descent: no checkpoint, no deepest floor, no artifact
  const reachFloor = replay ? noop : reachFloorSaved;
  const reachCamp = replay ? noop : reachCampSaved;
  const takeArtifact = replay ? noop : takeArtifactSaved;

  const padSpace = controls === 'swipe' ? 0 : 150;
  const boardSize = Math.max(200, Math.min(width - 32, 560, height - insets.top - insets.bottom - 90 - STRIP_H - STRIP_GAP - padSpace - powerBarHeight(hasPowers)));

  const [initialRun] = useState(() => begin(fromFloor));
  const game = useRef<GameState>(initialRun);
  const [version, setVersion] = useState(0);
  const [phase, setPhase] = useState<Phase>({
    name: 'overview',
    from: fromFloor,
    to: fromFloor,
    kind: replay ? 'replay' : fromFloor === 0 ? 'enter' : 'resume',
  });
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const cam = useRef({ x: 0, y: 0, floor: null as unknown });
  const leaving = useRef(false);
  const walker = useMemo(() => createWalker(() => haptic.play('wall')), []);
  // sound and haptics (plan 05): one director reads the state and events; its haptic patterns run on the game clock
  const seq = useMemo(() => createHapticSequencer(fire), []);
  const director = useMemo(() => createSoundDirector(getEngine(), seq), [seq]);
  /** the star bits and secrets the save held when this run's floor began (the result compares against them) */
  const startHeld = useRef({ s: 0, f: 0, t: null as number | null });
  const drawRef = useRef<((time: number) => void) | null>(null);
  const artRef = useRef<FloorArt | null>(null);
  /** the first sightings captioned so far on this floor; the plate hint comes before the kind hint */
  const hintSeen = useRef<Set<string>>(new Set());
  const clock = useRef(0);
  const caption = useRef<{ id: number; text: string; until: number } | null>(null);
  const [hud, setHud] = useState<HudText>(() => hudOf(game.current, null));
  const hudShown = useRef('');
  const hudDirty = useRef(true);
  /** clock time at which the escape hint is due (3 s after the artifact is taken), or -1 */
  const escapeHintAt = useRef(-1);
  const fragmentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    reachFloor(pyramid.id, fromFloor);
  }, [pyramid.id, fromFloor, reachFloor]);

  /** a hint caption: once per save per kind (`progress.hints`), up for HINT_SECONDS */
  const showHint = useCallback((id: HintId, captionId: number) => {
    if (useProgress.getState().hints[id]) return false;
    const text = hintText(pyramid.id, id);
    if (!text) return false;
    caption.current = { id: captionId, text, until: clock.current + HINT_SECONDS };
    useProgress.getState().markHint(id);
    hudDirty.current = true;
    return true;
  }, [pyramid.id]);

  /** the first time a trap of a new kind is lit: the plate hint first, the kind hint on the next sighting */
  const checkHints = useCallback(
    (g: GameState) => {
      if (caption.current && caption.current.until > clock.current) return;
      if (escapeHintAt.current >= 0 && clock.current >= escapeHintAt.current) {
        escapeHintAt.current = -1;
        if (showHint('escape', g.floorIndex * 1000 + 700)) return;
      }
      // the first frames with an artifact power in the bar
      if (g.powers.length && showHint('power', g.floorIndex * 1000 + 900)) return;
      // the first water tile you see
      if (g.water && !useProgress.getState().hints.water) {
        for (let i = 0; i < g.water.length; i++) {
          if (g.water[i] >= WET && g.light[i] >= 0.3 && showHint('water', g.floorIndex * 1000 + 901)) return;
        }
      }
      const gd = g.guardian;
      if (gd && gd.pos >= 0 && gd.mode !== 'arriving' && gd.mode !== 'gone' && g.light[gd.pos] >= 0.3 && !useProgress.getState().hints.guardian) {
        if (showHint('guardian', g.floorIndex * 1000 + 600)) return;
      }
      const { traps, size } = g.floor;
      for (let k = 0; k < traps.length; k++) {
        const t = traps[k];
        if (g.trapPhase[k] !== 0 || g.light[t.tile] < 0.3) continue;
        const kind: TrapKind = t.kind;
        const hints = useProgress.getState().hints;
        const id: HintId = !hints.plate && kind !== 'trapdoor' ? 'plate' : kind;
        if (hints[id]) continue;
        if (showHint(id, g.floorIndex * 1000 + 500 + k + size)) return;
      }
      // the plaster of a sealed doorway, lit and in view
      for (let k = 0; k < g.floor.secrets.length; k++) {
        if (g.secretPhase[k] === 0 && g.light[g.floor.secrets[k].front] >= 0.3 && showHint('secret', g.floorIndex * 1000 + 800 + k)) return;
      }
    },
    [showHint],
  );

  // game clock: the light burns by time, not by steps, and only while playing
  useEffect(() => {
    let raf = 0;
    let last: number | null = null;
    let sinceDraw = 0;
    let sinceHud = 0;
    let seenFloor: unknown = null;
    let seenRun: unknown = null;
    let seenStatus = 'playing';
    let lastSeq = 0;
    const loop = (t: number) => {
      const dt = last === null ? 0 : Math.min(0.1, (t - last) / 1000);
      last = t;
      if (phaseRef.current.name === 'overview') {
        // the overview is JS-animated, so leave it frame time: warm the chunks around the start tile
        const g = game.current;
        const x = g.pos % g.floor.size;
        const y = Math.floor(g.pos / g.floor.size);
        artRef.current?.ensure({ x0: x - VIEW_TILES / 2 - 1, y0: y - VIEW_TILES / 2 - 1, x1: x + VIEW_TILES / 2 + 1, y1: y + VIEW_TILES / 2 + 1 }, ART_BUDGET_OVERVIEW);
      }
      if (phaseRef.current.name === 'playing') {
        clock.current += dt;
        let g = step(game.current, { type: 'tick', seconds: dt });
        g = walker.update(g);
        game.current = g;
        if (seenFloor !== g.floor) {
          seenFloor = g.floor;
          lastSeq = 0;
        }
        if (seenRun !== g) {
          // a new run: this floor from the top of its stairs (or a retry): the plaster is whole again, the save's numbers are noted
          seenRun = g;
          artRef.current?.reset();
          const rec = sandbox ? undefined : useProgress.getState().floors[pyramid.id]?.[g.floorIndex];
          startHeld.current = { s: rec?.s ?? 0, f: rec?.f ?? 0, t: rec?.t ?? null };
          if (!sandbox) useProgress.getState().noteFloor(pyramid.id, g.floorIndex, g.floor.secrets.length);
          getAmbience().enter(pyramid.id, g.floorIndex, pyramid.floorCount);
          const wanted = new Set<string>();
          if (owned.length) wanted.add('powers');
          if (g.water) wanted.add('water');
          for (const group of wanted) void getEngine().load(group as 'powers' | 'water');
        }
        // sound and haptic patterns (the same events feed the captions below)
        director.update(g, dt, true);
        seq.tick(dt);
        getAmbience().update(dt, g.floorIndex);
        // what happened: art, the save and a short caption
        for (const e of g.events) {
          if (e.seq <= lastSeq) continue;
          if (e.type === 'secretBreak') artRef.current?.prepareOpened();
          else if (e.type === 'secretOpen') {
            const k = secretAtSeal(g.floor, e.at);
            if (k >= 0) artRef.current?.open(k);
          } else if (e.type === 'treasure') {
            const k = g.floor.secrets.findIndex((x) => x.spot === e.at);
            if (k >= 0 && !sandbox) useProgress.getState().markSecret(pyramid.id, g.floorIndex, k, g.floor.secrets.length);
          } else if (e.type === 'fragment') {
            const k = g.floor.secrets.findIndex((x) => x.spot === e.at);
            const fragment = k >= 0 ? g.floor.secrets[k].fragment : -1;
            if (fragment >= 0) {
              const floorIndex = g.floorIndex;
              // a beat to see the grave good go, then the painted wall
              fragmentTimer.current = setTimeout(() => {
                if (phaseRef.current.name === 'playing') setPhase({ name: 'fragment', floorIndex, fragment });
              }, 400);
            }
          }
          if (e.type === 'guardianStep') continue;
          const text = captionFor(e, g);
          if (text) caption.current = { id: e.seq + g.floorIndex * 1000, text, until: clock.current + CAPTION_SECONDS };
          if (e.type === 'quake') showHint('collapse', g.floorIndex * 1000 + e.seq);
          if (e.type === 'guardianWake') showHint('guardianWake', g.floorIndex * 1000 + e.seq);
          if (e.type === 'flooded') showHint(owned.includes('naga') ? 'floodedNaga' : 'flooded', g.floorIndex * 1000 + e.seq);
          if (e.type === 'artifactTaken') escapeHintAt.current = clock.current + HINT_SECONDS;
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
          if (sinceHud >= 0.25) checkHints(g);
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
  }, [walker, showHint, checkHints, director, seq, pyramid.id, pyramid.floorCount, sandbox, owned]);

  // overlays and focus changes stop any walking in progress
  useEffect(() => {
    walker.reset();
  }, [phase.name, walker]);

  /** the result of the floor just left: recorded in the save, compared with what it held when the run began */
  const finishFloor = useCallback(
    (g: GameState): OverviewResult => {
      const r = floorResult(g);
      const held = startHeld.current;
      if (!sandbox) useProgress.getState().recordFloor(pyramid.id, r);
      if (mode === 'replay' && r.cleared && g.escape) useProgress.getState().recordEscape(pyramid.id, g.escape.t);
      const best = r.cleared ? (held.t === null ? r.time : Math.min(held.t, r.time)) : held.t;
      return { ...r, best, newBest: r.cleared && held.t !== null && r.time < held.t, heldS: held.s, heldF: held.f, foundMask: g.secretsFound };
    },
    [pyramid.id, mode, sandbox],
  );

  // react to the core status: stairs, basement, burnt out
  const s = game.current;
  const status = s.status;
  useEffect(() => {
    if (status === 'descending') {
      if (game.current.status !== 'descending') return; // already handled (effects can run twice)
      const g0 = game.current;
      const from = g0.floorIndex;
      const result = finishFloor(g0);
      if (replay) {
        setPhase({ name: 'result', result, kind: 'descend' });
        return;
      }
      game.current = step(g0, { type: 'continue' });
      reachFloor(pyramid.id, from + 1);
      haptic.play('tap');
      hudDirty.current = true;
      setPhase({ name: 'overview', from, to: from + 1, kind: 'descend', result });
      setVersion((v) => v + 1);
    } else if (status === 'falling') {
      // the slab tilts open (0.25 s), then the next floor starts where the shaft lets you out
      const id = setTimeout(() => {
        const g = game.current;
        if (g.status !== 'falling') return;
        const from = g.floorIndex;
        const result = finishFloor(g);
        haptic.play('land');
        if (replay) {
          setPhase({ name: 'result', result, kind: 'fall' });
          return;
        }
        game.current = step(g, { type: 'continue' });
        reachFloor(pyramid.id, from + 1);
        hudDirty.current = true;
        setPhase({ name: 'overview', from, to: from + 1, kind: 'fall', result });
        setVersion((v) => v + 1);
      }, reducedMotion ? 0 : FALL_SECONDS * 1000);
      return () => clearTimeout(id);
    } else if (status === 'burntOut') {
      haptic.play('touch');
      setPhase({ name: 'burntOut' });
    } else if (status === 'buried') {
      haptic.play('block');
      setPhase({ name: 'buried' });
    } else if (status === 'caught') {
      setPhase({ name: 'caught' });
    } else if (status === 'drowned') {
      haptic.play('touch');
      setPhase({ name: 'drowned' });
    } else if (status === 'escaped' && !leaving.current) {
      if (game.current.floor.exit >= 0) {
        // the step into the doorway plays for a moment, then the climb up the shaft
        const id = setTimeout(() => {
          const g = game.current;
          haptic.play('found');
          const result = finishFloor(g);
          if (replay) setPhase({ name: 'result', result, kind: 'escape' });
          else setPhase({ name: 'overview', from: g.floorIndex, to: g.floorIndex, kind: 'escape', result });
        }, reducedMotion ? 0 : ESCAPE_STEP_SECONDS * 1000);
        return () => clearTimeout(id);
      }
      leaving.current = true;
      haptic.play('found');
      finishFloor(game.current);
      takeArtifact(pyramid.id);
      if (replay) router.back();
      else router.replace({ pathname: '/artifact/[id]', params: { id: pyramid.id } });
    }
  }, [status, pyramid.id, reachFloor, takeArtifact, reducedMotion, finishFloor, replay]);

  // overlays fade the world out of the mix; a long stop lets the audio device sleep
  useEffect(() => {
    director.setOverlay(phase.name !== 'playing');
    if (phase.name === 'playing') {
      void getEngine().resume();
      return;
    }
    seq.clear();
    const id = setTimeout(() => void getEngine().suspend(), 30000);
    return () => clearTimeout(id);
  }, [phase.name, director, seq]);

  // the game's own sound: its group loads under the first overview; leaving stops everything
  useEffect(() => {
    void getEngine().load('game');
    return () => {
      director.dispose();
      getAmbience().leave();
      if (fragmentTimer.current) clearTimeout(fragmentTimer.current);
    };
  }, [director]);

  const pause = useCallback(() => {
    if (phaseRef.current.name === 'playing') setPhase({ name: 'paused' });
  }, []);
  const togglePause = useCallback(() => {
    const p = phaseRef.current.name;
    if (p === 'playing') setPhase({ name: 'paused' });
    else if (p === 'paused') setPhase({ name: 'playing' });
  }, []);

  const usePowerTap = useCallback((id: PowerId) => {
    if (phaseRef.current.name !== 'playing') return;
    game.current = step(game.current, { type: 'power', power: id });
    hudDirty.current = true;
  }, []);
  const onPowerKey = useCallback((k: number) => {
    // the keys are the sockets of the bar in order; a power you do not own does nothing
    usePowerTap(POWER_ORDER[k]);
  }, [usePowerTap]);
  useKeyboard(walker, phase.name === 'playing', togglePause, onPowerKey);

  // a call or another app taking the audio pauses the run
  useEffect(() => {
    getEngine().onInterruption(() => pause());
  }, [pause]);

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
    if (p.kind === 'escape') {
      if (leaving.current) return;
      leaving.current = true;
      const g = game.current;
      const out = g.escape?.t ?? 0;
      takeArtifact(pyramid.id, { escape: out, touches: g.guardian?.touches ?? 0 });
      router.replace({ pathname: '/artifact/[id]', params: { id: pyramid.id, out: String(out) } });
      return;
    }
    if (p.kind === 'descend' && isCampFloor(pyramid, p.to) && !replay) {
      reachCamp(pyramid.id, p.to);
      setPhase({ name: 'camp' });
    } else {
      setPhase({ name: 'playing' });
    }
  }, [pyramid, reachCamp, replay, takeArtifact]);

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
    hudDirty.current = true;
  };

  const retry = () => {
    const from = game.current.floorIndex;
    game.current = step(game.current, { type: 'retry' });
    hudDirty.current = true;
    setPhase({ name: 'overview', from, to: game.current.floorIndex, kind: 'resume' });
    setVersion((v) => v + 1);
  };

  /** replay: the same floor again with a fresh torch, or the next one */
  const playFloor = (floorIndex: number) => {
    game.current = begin(floorIndex);
    hudDirty.current = true;
    setPhase({ name: 'overview', from: floorIndex, to: floorIndex, kind: 'replay' });
    setVersion((v) => v + 1);
  };

  const leaveToMap = () => {
    leaving.current = true;
    router.dismissTo('/map');
  };

  const viewTiles = Math.min(s.floor.size, VIEW_TILES);
  const tilePx = boardSize / viewTiles;
  const info = pyramid.color;
  const kit = useMemo(() => renderKitFor(pyramid.id), [pyramid.id]);
  const theme = useMemo(() => kit.theme(info), [kit, info]);
  const px = Math.round(tilePx * Math.min(PixelRatio.get(), 2));
  // the architecture is recorded once per floor (hidden under the overview) and rasterised in chunks as you walk
  const art = useMemo(() => createFloorArt(s.floor, theme, px), [s.floor, theme, px]);
  artRef.current = art;
  const mask = useMemo(() => createLightMask(s.floor.size), [s.floor.size]);
  // free the previous floor's chunks once the new art is in place (the GC frees the rest)
  const prevArt = useRef<FloorArt | null>(null);
  useEffect(() => {
    const old = prevArt.current;
    prevArt.current = art;
    if (old && old !== art) old.dispose();
  }, [art]);
  useEffect(() => () => prevArt.current?.dispose(), []);
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
  // the pause panel's line: par and the secrets of this floor (found ever, this run included)
  const savedFound = useProgress.getState().floors[pyramid.id]?.[s.floorIndex]?.f ?? 0;
  const floorLine =
    phase.name === 'paused'
      ? `Floor ${s.floorIndex + 1} · par ${mmss2(parTime(s.floor))} · secrets ${popcount(savedFound | s.secretsFound)} of ${s.floor.secrets.length} found here`
      : '';
  const nextReplay = !sandbox && s.floorIndex + 1 <= (useProgress.getState().deepest[pyramid.id] ?? 0) && !isBasement(pyramid, s.floorIndex);
  const tryAgain = () => playFloor(game.current.floorIndex);
  const out = replay ? () => router.back() : leaveToMap;

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

      <View style={{ width: boardSize, height: STRIP_H + STRIP_GAP + boardSize + powerBarHeight(hasPowers) }}>
        <Board game={game} cam={cam} art={art} theme={theme} kit={kit} hasPowers={hasPowers} mask={mask} reducedMotion={reducedMotion} boardSize={boardSize} tilePx={tilePx} drawRef={drawRef} />
        <LightHud hud={hud} width={boardSize} onSwap={swap} />
        {hasPowers && <PowerBar text={hud.powers ?? NO_POWERS} width={boardSize} top={STRIP_H + STRIP_GAP + boardSize + BAR_GAP} onUse={usePowerTap} />}
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
          result={phase.result}
        />
      )}

      {phase.name === 'camp' && (
        <Panel eyebrow={`Camp · ${floorText}`} title="A place to rest">
          <PanelText>Progress is saved. Your light burns full again and your artifacts' uses are restored.</PanelText>
          <PanelActions>
            <Button variant="primary" label="Continue the descent" onPress={() => setPhase({ name: 'playing' })} />
            <Button variant="ghost" label="Back to the map" onPress={leaveToMap} accessibilityHint="You can continue from this camp later" />
          </PanelActions>
        </Panel>
      )}

      {phase.name === 'paused' && (
        <Panel eyebrow={`${pyramid.name} · ${floorText}`} title="Paused" onDismiss={() => setPhase({ name: 'playing' })}>
          <PanelText>Your light does not burn while the game is paused.</PanelText>
          <Text style={styles.note}>{floorLine}</Text>
          <PanelActions>
            <Button variant="primary" label="Resume" onPress={() => setPhase({ name: 'playing' })} />
            <Button label="Settings" onPress={() => router.push('/settings')} />
            <Button
              variant="ghost"
              label={replay ? 'Back' : 'Leave to the map'}
              onPress={out}
              accessibilityHint={replay ? undefined : `Next time you start from ${campLabel(checkpoint)}`}
            />
          </PanelActions>
          {!replay && <Text style={styles.note}>Leaving now, you start again from {campLabel(checkpoint)}.</Text>}
        </Panel>
      )}

      {phase.name === 'buried' && (
        <Panel eyebrow={floorText} title="Sealed in by sand">
          <PanelText>{replay ? 'The sand has closed every way down.' : `The sand has closed every way down. You dig back to ${campLabel(checkpoint)}.`}</PanelText>
          <PanelActions>
            <Button variant="primary" label={replay ? 'Try again' : checkpoint === 0 ? 'Back to the top' : `Back to camp · floor ${checkpoint + 1}`} onPress={replay ? tryAgain : retry} />
            <Button variant="ghost" label={replay ? 'Back' : 'Leave to the map'} onPress={out} />
          </PanelActions>
        </Panel>
      )}

      {phase.name === 'caught' && (
        <Panel eyebrow={floorText} title="Taken in the dark">
          <PanelText>{replay ? 'With your light gone, the guardian found you.' : `With your light gone, the guardian found you. You come to at ${campLabel(checkpoint)}.`}</PanelText>
          <PanelActions>
            <Button variant="primary" label={replay ? 'Try again' : checkpoint === 0 ? 'Back to the top' : `Back to camp · floor ${checkpoint + 1}`} onPress={replay ? tryAgain : retry} />
            <Button variant="ghost" label={replay ? 'Back' : 'Leave to the map'} onPress={out} />
          </PanelActions>
        </Panel>
      )}

      {phase.name === 'drowned' && (
        <Panel eyebrow={floorText} title="Out of breath">
          <PanelText>{replay ? 'The water was deeper than your breath.' : `The water was deeper than your breath. You come round at ${campLabel(checkpoint)}.`}</PanelText>
          <PanelActions>
            <Button variant="primary" label={replay ? 'Try again' : checkpoint === 0 ? 'Back to the top' : `Back to ${campLabel(checkpoint)}`} onPress={replay ? tryAgain : retry} />
            <Button variant="ghost" label={replay ? 'Back' : 'Back to the map'} onPress={out} />
          </PanelActions>
        </Panel>
      )}

      {phase.name === 'burntOut' && (
        <Panel eyebrow={floorText} title="The light is out">
          <PanelText>{replay ? 'Darkness. You feel your way back to the stairs, where a torch is lit again.' : `Darkness. You feel your way back to ${campLabel(checkpoint)}, where a torch is lit again.`}</PanelText>
          <PanelActions>
            <Button variant="primary" label={replay ? 'Try again' : checkpoint === 0 ? 'Back to the top' : `Back to camp · floor ${checkpoint + 1}`} onPress={replay ? tryAgain : retry} />
            <Button variant="ghost" label={replay ? 'Back' : 'Leave to the map'} onPress={out} />
          </PanelActions>
        </Panel>
      )}

      {phase.name === 'result' && (
        <Panel eyebrow={`Floor ${phase.result.floorIndex + 1}`} title={phase.kind === 'fall' ? 'Through the trapdoor' : phase.result.cleared ? 'Cleared' : 'Out'}>
          <View style={styles.resultStars}>
            <StarRow states={starStates(phase.result)} labels={starLabels(phase.result)} />
          </View>
          <Text style={styles.resultTimes}>
            {phase.result.cleared ? mmss2(phase.result.time) : 'Not cleared'} · par {mmss2(phase.result.par)}
            {phase.result.best !== null ? ` · best ${mmss2(phase.result.best)}` : ''}
            {phase.result.newBest ? ' · New best' : ''}
          </Text>
          <PanelText>
            Secrets {popcount(phase.result.heldF | phase.result.foundMask)} of {phase.result.total}
          </PanelText>
          <PanelActions>
            <Button variant="primary" label="Play again" onPress={() => playFloor(phase.result.floorIndex)} />
            {nextReplay && phase.result.floorIndex === game.current.floorIndex && <Button label="Next floor" onPress={() => playFloor(phase.result.floorIndex + 1)} />}
            <Button variant="ghost" label="Back" onPress={out} />
          </PanelActions>
        </Panel>
      )}

      {phase.name === 'fragment' && (
        <Panel
          eyebrow={`A painted wall · Floor ${phase.floorIndex + 1}`}
          title={storyOf(pyramid.id)[phase.fragment]?.title ?? 'A painted wall'}
        >
          <PanelText>{storyOf(pyramid.id)[phase.fragment]?.text ?? ''}</PanelText>
          <Text style={styles.note}>
            Story {phase.fragment + 1} of {storyOf(pyramid.id).length}
          </Text>
          <PanelActions>
            <Button variant="primary" label="Continue" onPress={() => setPhase({ name: 'playing' })} />
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
  resultStars: { alignItems: 'center', marginVertical: space.sm },
  resultTimes: { color: colors.ink, fontFamily: fonts.bodySemi, fontSize: 15, textAlign: 'center', fontVariant: ['tabular-nums'] },
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
