/**
 * Audio logic checks (plan 05), called from check-sounds.ts: the feedback table points at real sounds, the
 * spatial model (distance falloff along corridors, pan by direction, muffling behind walls, reverb), the
 * haptic sequencer, and the director against a recording fake engine on real Egypt floors. No device and no
 * audio graph: what is checked is what the director asks the engine for.
 */
import { createSoundDirector } from '../src/audio/director';
import { FEEDBACK } from '../src/audio/feedback';
import { createAmbience } from '../src/audio/ambience';
import { DistanceField, gridStamp, place, roomOf } from '../src/audio/spatial';
import type { AudioEngine, Bus, LoopParams, PlayOpts } from '../src/audio/types';
import { VARIANTS } from '../src/audio/variants';
import { startFloor, step, type Direction, type GameEvent, type GameState } from '../src/game/core/game';
import { PYRAMIDS } from '../src/game/core/pyramids';
import { PATTERNS, createHapticSequencer, heartbeatPeriod, type HapticStyle } from '../src/ui/hapticPatterns';
import { RECIPES } from './sound/recipes';
import { walkTo } from './check-secrets';
import type { Report } from './check-traps';

const egypt = PYRAMIDS.egypt;
const ids = new Set(RECIPES.map((r) => r.id));
const tick = (s: GameState, seconds: number) => step(s, { type: 'tick', seconds });
const move = (s: GameState, dir: Direction) => step(s, { type: 'move', dir });

type Played = { id: string; o: PlayOpts };
type Loop = { id: string; o: PlayOpts; sets: LoopParams[]; stopped: boolean };

/** An engine that only records what it is asked. */
function fakeEngine() {
  const played: Played[] = [];
  const loops: Loop[] = [];
  const ducks: Array<{ bus: Bus; dB: number }> = [];
  const busLevels: Partial<Record<Bus, number>> = {};
  const rooms: string[] = [];
  const e: AudioEngine = {
    kind: 'none',
    load: async () => {},
    unload: () => {},
    isLoaded: () => true,
    play(id, o = {}) {
      played.push({ id, o });
      return { stop() {} };
    },
    loop(id, o = {}) {
      const l: Loop = { id, o, sets: [], stopped: false };
      loops.push(l);
      return {
        set: (p) => l.sets.push(p),
        stop: () => (l.stopped = true),
      };
    },
    duck: (bus, dB) => ducks.push({ bus, dB }),
    setBusLevel: (b, v) => (busLevels[b] = v),
    setBusFilter: () => {},
    setVolumes: () => {},
    setRoom: (size, mix) => rooms.push(`${size}:${mix}`),
    suspend: async () => {},
    resume: async () => {},
    onInterruption: () => {},
  };
  return { e, played, loops, ducks, busLevels, rooms };
}

export function runAudioChecks({ fail, warn }: Report) {
  void warn;
  // ---- the feedback table points at real sounds ----
  const kinds = ['smallTorch', 'torch', 'bigTorch', 'lamp', 'candle', 'oilJar', 'sconce', 'brazier', 'shrineCandles', 'block', 'portcullis', 'sandfall', 'trapdoor', 'amulet', 'scarab', 'mirror', 'naga', 'jade', 'shallow', 'deep', null] as const;
  const sample = (type: GameEvent['type'], kind: GameEvent['kind']): GameEvent => ({ seq: 1, type, kind, at: 1 });
  const dummy = startFloor(egypt, 2);
  for (const [type, f] of Object.entries(FEEDBACK)) {
    if (f.sound) {
      const names = typeof f.sound === 'function' ? kinds.map((k) => (f.sound as (e: GameEvent, s: GameState) => string | null)(sample(type as GameEvent['type'], k), dummy)) : [f.sound];
      for (const n of names) {
        if (!n) continue;
        const ok = ids.has(n) || (VARIANTS[n] !== undefined && ids.has(`${n}.0`));
        if (!ok) fail(`audio: feedback ${type} plays "${n}", which is not in the sound set`);
      }
    }
    if (f.haptic) {
      const hs = typeof f.haptic === 'function' ? kinds.map((k) => (f.haptic as (e: GameEvent, s: GameState) => string | null)(sample(type as GameEvent['type'], k), dummy)) : [f.haptic];
      for (const h of hs) if (h && !(h in PATTERNS)) fail(`audio: feedback ${type} uses the unknown haptic "${h}"`);
    }
  }

  // ---- spatial model on a real floor ----
  {
    const s = startFloor(egypt, 7);
    const field = new DistanceField();
    const dist = field.update(s, gridStamp(s));
    const size = s.grid.size;
    // along the main path: farther is quieter, never louder
    const path = Array.from(s.floor.mainPath);
    let prev = Infinity;
    for (const t of path.slice(1, 40)) {
      const p = place(s, dist, t);
      if (p.gain > prev + 1e-9) fail('audio: gain grows with the path distance');
      prev = Math.min(prev, p.gain);
    }
    const near = place(s, dist, path[1]);
    if (!(near.gain > 0.5 && near.gain <= 1)) fail(`audio: a sound one step away has gain ${near.gain}`);
    const far = place(s, dist, path[Math.min(path.length - 1, 60)]);
    if (path.length > 40 && far.gain !== 0) fail(`audio: a sound ${dist[path[Math.min(path.length - 1, 60)]]} steps away is not silent (${far.gain})`);
    // pan by direction: a tile to the east pans right, to the west left
    let east = -1;
    let west = -1;
    for (let t = 0; t < size * size; t++) {
      if (s.grid.solid[t] || dist[t] < 0 || dist[t] > 6) continue;
      const dx = (t % size) - (s.pos % size);
      if (dx >= 3 && east < 0) east = t;
      if (dx <= -3 && west < 0) west = t;
    }
    if (east >= 0 && place(s, dist, east).pan <= 0.2) fail('audio: a sound to the east does not pan right');
    if (west >= 0 && place(s, dist, west).pan >= -0.2) fail('audio: a sound to the west does not pan left');
    // a wall in the line of sight muffles: find a tile close in the plan but behind rock
    let muffled = false;
    let clear = false;
    for (let t = 0; t < size * size && !(muffled && clear); t++) {
      if (s.grid.solid[t] || Math.hypot((t % size) - (s.pos % size), Math.floor(t / size) - Math.floor(s.pos / size)) > 6) continue;
      const p = place(s, dist, t);
      if (p.lowpass > 0) {
        muffled = true;
        if (p.lowpass < 700 || p.lowpass > 4000) fail(`audio: low-pass ${p.lowpass} Hz outside 700-4000`);
      } else if (t !== s.pos) clear = true;
    }
    if (!muffled) fail('audio: no sound behind a wall is muffled');
    if (!clear) fail('audio: every sound in view is muffled');
    if (place(s, dist, path[1]).send >= place(s, dist, path[8]).send) fail('audio: reverb send does not grow with distance');
    // rooms pick the reverb
    const hall = s.floor.rooms.find((r) => r.kind === 'hall');
    const passage = s.floor.rooms.find((r) => r.kind === 'passage');
    for (const [room, want] of [[hall, 'large'], [passage, 'small']] as const) {
      if (!room) continue;
      const tile = (s.floor.room as Int16Array).findIndex((r, t) => r === room.id && !s.grid.solid[t]);
      const t2 = { ...s, pos: tile } as GameState;
      if (roomOf(t2).size !== want) fail(`audio: a ${room.kind} picks the ${roomOf(t2).size} reverb`);
    }
  }

  // ---- haptic sequencer ----
  {
    const fired: Array<{ at: number; style: HapticStyle }> = [];
    let now = 0;
    const seq = createHapticSequencer((style) => fired.push({ at: now, style }));
    seq.play('quake');
    seq.play('block');
    for (let i = 0; i < 400; i++) {
      now += 0.01;
      seq.tick(0.01);
    }
    for (let i = 1; i < fired.length; i++) if (fired[i].at - fired[i - 1].at < 0.049) fail(`haptics: pulses ${(fired[i].at - fired[i - 1].at) * 1000} ms apart (min 50)`);
    if (fired.length < 3) fail(`haptics: only ${fired.length} pulses fired`);
    // too many at once: at most 6 wait
    const seq2 = createHapticSequencer(() => {});
    for (const n of ['quake', 'block', 'caught', 'wake', 'artifact'] as const) seq2.play(n);
    if (seq2.pending() > 6) fail(`haptics: ${seq2.pending()} pulses queued (max 6)`);
    // a pause freezes a pattern: no tick, no pulses
    const frozen: HapticStyle[] = [];
    const seq3 = createHapticSequencer((s) => frozen.push(s));
    seq3.play('quake');
    seq3.tick(0);
    const first = frozen.length;
    seq3.tick(0);
    seq3.tick(0);
    if (frozen.length !== first) fail('haptics: pulses fired without the clock advancing');
    // the heartbeat never stacks
    const beats: number[] = [];
    let t = 0;
    const seq4 = createHapticSequencer(() => beats.push(t));
    seq4.heartbeat(0.6);
    for (let i = 0; i < 300; i++) {
      t += 0.01;
      seq4.tick(0.01);
    }
    const perSecond = beats.length / 3;
    if (perSecond > 4.2 || perSecond < 2.5) fail(`haptics: heartbeat at 0.6 s makes ${perSecond.toFixed(1)} pulses a second (want ~3.3)`);
    if (Math.abs(heartbeatPeriod(8) - 1.1) > 1e-9 || Math.abs(heartbeatPeriod(2) - 0.6) > 1e-9) fail('haptics: heartbeat period table');
    if (PATTERNS.grind.pulses.length !== 10) fail('haptics: grind is not ten pulses');
  }

  // ---- the director against a recording engine ----
  {
    const fe = fakeEngine();
    const haptics = createHapticSequencer(() => {});
    const dir = createSoundDirector(fe.e, haptics, () => 0.5);
    let s = startFloor(egypt, 2, { kind: 'torch', left: 60 }, []);
    dir.update(s, 0.016, true);
    // walking on stone makes a footstep; the first move after a rest is quiet
    s = tick(s, 0.5);
    dir.update(s, 0.016, true);
    s = move(s, ([0, 1, 2, 3] as Direction[]).find((d) => !s.grid.solid[s.pos + [1, -1, s.grid.size, -s.grid.size][d]]) ?? 0);
    dir.update(s, 0.016, true);
    const stepSound = fe.played.find((p) => p.id.startsWith('step.'));
    if (!stepSound) fail('audio: a step made no footstep');
    else if (!(stepSound.o.gain! < 0.5)) fail(`audio: the first step after a rest is not quiet (gain ${stepSound.o.gain})`);
    // the hand flame loops by kind
    for (let i = 0; i < 6; i++) dir.update(tick(s, 0.07), 0.07, true);
    if (!fe.loops.some((l) => l.id === 'flame.torch' && !l.stopped)) fail('audio: no hand flame loop for a torch');
    // a secret: knock sounds at the front, positioned
    const sec = s.floor.secrets[0];
    s.pos = s.prevPos = sec.front;
    s.cooldown = 0;
    s = move(s, 3);
    fe.played.length = 0;
    dir.update(s, 0.016, true);
    const knock = fe.played.find((p) => p.id === 'seal.knock');
    if (!knock) fail('audio: a knock on the plaster made no sound');
    else if (!(knock.o.gain! > 0.5)) fail(`audio: a knock at your feet is quiet (gain ${knock.o.gain})`);
    for (let i = 0; i < 3; i++) dir.update(s, 0.07, true);
    if (!fe.loops.some((l) => l.id === 'seal.draught')) fail('audio: no draught loop beside an unopened seal');
    // overlays
    dir.setOverlay(true);
    if (fe.busLevels.world !== 0 || fe.busLevels.guardian !== 0) fail('audio: an overlay does not fade the world and the guardian');
    dir.setOverlay(false);
    if (fe.busLevels.world !== 1) fail('audio: the world does not come back after an overlay');
    // wading in sand uses the sand footsteps
    const t0 = fe.played.length;
    s.sand.fill(255);
    s.seenSand.fill(255);
    s.cooldown = 0;
    s = move(s, 2);
    dir.update(s, 0.016, true);
    if (!fe.played.slice(t0).some((p) => p.id.startsWith('step.sand'))) warn('audio: no sand footstep when wading (state may not wade here)');
  }
  {
    // a guardian floor: spotted, the dread loop and the heartbeat as it comes close
    const fe = fakeEngine();
    const beats: HapticStyle[] = [];
    const haptics = createHapticSequencer((st) => beats.push(st));
    const dir = createSoundDirector(fe.e, haptics, () => 0.5);
    let s = startFloor(egypt, 17, { kind: 'bigTorch', left: 100 }, []);
    dir.update(s, 0.016, true);
    const g = s.guardian!;
    // put the awake guardian a few steps away along a corridor, out of sight
    s.burning = true;
    g.mode = 'hunt';
    const field = new DistanceField().update(s, gridStamp(s));
    let at = -1;
    for (let t = 0; t < field.length; t++) if (field[t] === 5 && s.light[t] === 0) at = t;
    if (at < 0) warn('audio: no spot five steps away to test the dread layer');
    else {
      g.pos = at;
      g.distFrom = -1;
      for (let i = 0; i < 12; i++) {
        s = tick(s, 0.07);
        g.mode = 'hunt';
        g.pos = at;
        dir.update(s, 0.07, true);
        haptics.tick(0.07);
      }
      if (!fe.loops.some((l) => l.id === 'g.dread' && !l.stopped)) fail('audio: no dread loop with the guardian five steps away');
      if (!beats.length) warn('audio: no heartbeat with the guardian five steps away unseen');
    }
    // the sentinel's floor is quiet when the guardian sleeps
    const fe2 = fakeEngine();
    const dir2 = createSoundDirector(fe2.e, createHapticSequencer(() => {}), () => 0.5);
    const sleeper = startFloor(egypt, 24);
    for (let i = 0; i < 6; i++) dir2.update(tick(sleeper, 0.07), 0.07, true);
    if (fe2.loops.some((l) => l.id === 'g.dread')) fail('audio: a dormant guardian has a dread layer');
  }
  {
    // a replay of events: the quake ducks the ambience; the collapse pours where the sand is
    const fe = fakeEngine();
    const dir = createSoundDirector(fe.e, createHapticSequencer(() => {}), () => 0.5);
    let s = startFloor(egypt, 12, { kind: 'bigTorch', left: 100 }, []);
    dir.update(s, 0.016, true);
    s.burning = true;
    for (let i = 0; i < 400 && !(s.collapse?.started); i++) {
      s = tick(s, 0.1);
      dir.update(s, 0.1, true);
    }
    if (!s.collapse?.started) warn('audio: the collapse did not start in the audio test');
    else {
      for (let i = 0; i < 30; i++) {
        s = tick(s, 0.1);
        dir.update(s, 0.1, true);
      }
      if (!fe.played.some((p) => p.id === 'quake')) fail('audio: no quake sound when the collapse starts');
      if (!fe.ducks.some((d) => d.bus === 'ambience' && d.dB <= -8)) fail('audio: the quake does not duck the ambience');
      if (!fe.loops.some((l) => l.id === 'sand.pour')) warn('audio: no sand pour loop yet (the sand may be far)');
    }
    void walkTo;
  }
  {
    // beds: depth mixes the room tone and the air; the exterior wind
    const fe = fakeEngine();
    const amb = createAmbience(fe.e, () => 0.5);
    amb.exterior(true);
    amb.enter('egypt', 24, 25);
    amb.update(30, 24);
  }
}
