import { COVER, sandLevel } from '../game/core/collapse';
import type { GameEvent, GameState } from '../game/core/game';
import { QUIET_GAP } from '../game/core/guardian';
import { isFrozen } from '../game/core/powers';
import { BREATH, SWIM, WET, waterAt } from '../game/core/water';
import { hunterCues } from '../game/core/hunters';
import { kitFor } from '../kits';
import { CARRY } from '../game/core/lights';
import { secretAtSeal } from '../game/core/secrets';
import { heartbeatPeriod, type HapticSequencer } from '../ui/hapticPatterns';
import { FEEDBACK } from './feedback';
import type { SoundId } from './manifest';
import { VARIANTS } from './variants';
import { DistanceField, gridStamp, nearest, place, roomOf, type Placement } from './spatial';
import type { AudioEngine, Bus, LoopParams, LoopVoice, PlayOpts } from './types';

/**
 * The sound director (plan 05, section 13): reads the game state and its events, never writes core.
 * It turns events into positioned sounds and haptic patterns through the FEEDBACK table, plays footsteps
 * by surface, keeps the continuous loops (hand flame, fixtures, the sand's pour, the false door's air,
 * the draught of a seal, the guardian's dread) in step with the state at 15 Hz, and ducks the ambience
 * when something loud happens. Math.random is fine here (variant choice); core stays deterministic.
 */
export type SoundDirector = {
  /** call every frame while the game runs (`playing` false = an overlay is up: the world goes quiet) */
  update: (s: GameState, dt: number, playing: boolean) => void;
  /** a new floor or run: stops the continuous loops, forgets the event cursor */
  reset: (s?: GameState) => void;
  /** overlays (pause, camp, panels) fade the world to nothing; ambience dips 10 dB */
  setOverlay: (on: boolean) => void;
  dispose: () => void;
};

const CONTINUOUS_EVERY = 1 / 15;
const LOOP_REACH = 6;
const DB = (d: number) => Math.pow(10, d / 20);
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const HAND_LOOP: Record<string, SoundId> = {
  smallTorch: 'flame.smallTorch',
  torch: 'flame.torch',
  bigTorch: 'flame.bigTorch',
  lamp: 'flame.lamp',
  candle: 'flame.candle',
};

type Slot = { voice: LoopVoice; id: string; sent: LoopParams };

export function createSoundDirector(engine: AudioEngine, haptics: HapticSequencer, random: () => number = Math.random): SoundDirector {
  const field = new DistanceField();
  const slots = new Map<string, Slot>();
  let floor: unknown = null;
  let lastSeq = 0;
  let lastTrail = 0;
  let prevIdle = 1;
  let wading = false;
  let acc = 0;
  let overlay = false;
  let huntDuckAt = 0;
  let roomKey = '';
  let jade = false;
  let breathAt = 0;

  /** starts, retunes or stops one continuous loop; a parameter is sent only when it moved enough */
  const loopTo = (key: string, id: SoundId | null, p: LoopParams & { bus?: Bus; ramp?: number }) => {
    const cur = slots.get(key);
    if (cur && (id === null || cur.id !== id)) {
      cur.voice.stop(0.25);
      slots.delete(key);
    }
    if (id === null) return;
    let slot = slots.get(key);
    if (!slot) {
      const voice = engine.loop(id, { bus: p.bus ?? 'world', gain: p.gain ?? 0, pan: p.pan ?? 0, lowpass: p.lowpass ?? 0, send: p.send ?? 0 });
      if (!voice) return;
      slot = { voice, id, sent: { gain: p.gain ?? 0, pan: p.pan ?? 0, lowpass: p.lowpass ?? 0, send: p.send ?? 0 } };
      slots.set(key, slot);
      return;
    }
    const sent = slot.sent;
    const next: LoopParams = {};
    if (p.gain !== undefined && (Math.abs(p.gain - (sent.gain ?? 0)) > Math.max(0.004, 0.06 * (sent.gain ?? 0)))) next.gain = p.gain;
    if (p.pan !== undefined && Math.abs(p.pan - (sent.pan ?? 0)) > 0.02) next.pan = p.pan;
    if (p.lowpass !== undefined && Math.abs(p.lowpass - (sent.lowpass ?? 0)) > 0.08 * Math.max(300, sent.lowpass ?? 0)) next.lowpass = p.lowpass;
    if (p.send !== undefined && Math.abs(p.send - (sent.send ?? 0)) > 0.04) next.send = p.send;
    if (Object.keys(next).length) {
      slot.voice.set(next, p.ramp ?? 0.1);
      slot.sent = { ...sent, ...next };
    }
  };

  const stopAllLoops = () => {
    for (const slot of slots.values()) slot.voice.stop(0.2);
    slots.clear();
  };

  const resolve = (base: string): SoundId => {
    const n = VARIANTS[base];
    return (n ? `${base}.${Math.floor(random() * n)}` : base) as SoundId;
  };

  const tileOf = (s: GameState, e: GameEvent): number => {
    if (e.at < 0) return -1;
    if (e.type === 'secretKnock' || e.type === 'secretBreak' || e.type === 'secretOpen') {
      const k = secretAtSeal(s.floor, e.at);
      return k >= 0 ? s.floor.secrets[k].front : e.at;
    }
    return e.at;
  };

  /** play one sound at a placement with +-4 % rate and +-1.5 dB of variation */
  const playAt = (id: string, p: Placement | null, o: PlayOpts) => {
    if (p && p.gain < 0.01) return;
    engine.play(resolve(id), {
      ...o,
      gain: (o.gain ?? 1) * (p ? p.gain : 1) * DB((random() * 2 - 1) * 1.5),
      pan: p?.pan ?? 0,
      lowpass: p?.lowpass ?? 0,
      send: p?.send ?? 0,
      rate: 1 + (random() * 2 - 1) * 0.04,
    });
  };

  const handleEvent = (s: GameState, e: GameEvent) => {
    const f = kitFor(s.pyramid.id).feedback?.[e.type] ?? FEEDBACK[e.type];
    if (!f) return;
    if (f.sound) {
      const base = typeof f.sound === 'function' ? f.sound(e, s) : f.sound;
      if (base) {
        const tile = f.spatial ? tileOf(s, e) : -1;
        const p = tile >= 0 ? place(s, field.dist, tile) : null;
        playAt(base, p, { bus: f.bus ?? 'world', gain: f.gain, priority: f.priority });
      }
    }
    const h = typeof f.haptic === 'function' ? f.haptic(e, s) : f.haptic;
    if (h) haptics.play(h);
    if (f.duck) engine.duck(f.duck.bus, f.duck.dB, f.duck.attack, f.duck.hold, f.duck.release);
  };

  const footstep = (s: GameState) => {
    const sand = sandLevel(s, s.pos);
    const kind = s.floor.room[s.pos] >= 0 ? s.floor.rooms[s.floor.room[s.pos]].kind : 'passage';
    const lv = waterAt(s, s.pos);
    const base = lv >= SWIM ? 'water.swim' : lv >= WET ? 'water.wade' : sand >= COVER ? 'step.sand' : sand > 0.05 ? 'step.grit' : kind === 'burial' || kind === 'antechamber' ? 'step.granite' : 'step.stone';
    const quiet = prevIdle >= QUIET_GAP;
    playAt(base, null, { bus: 'world', gain: quiet ? DB(-8) : 1, priority: 1, send: 0.2 });
    // the first wading step after dry ground
    const wet = sand >= COVER;
    if (wet && !wading) haptics.play('stepSand');
    wading = wet;
  };

  /** the world and guardian buses: silent under an overlay, 10 dB down (and muffled) while the Jade Seal holds */
  const applyWorld = (ramp: number) => {
    const level = overlay ? 0 : jade ? DB(-10) : 1;
    engine.setBusLevel('world', level, ramp);
    engine.setBusLevel('guardian', level, ramp);
    engine.setBusFilter('world', jade && !overlay ? 1200 : 0, ramp);
  };

  const continuous = (s: GameState) => {
    const { floor: fl } = s;
    // the room around you picks the reverb
    const room = roomOf(s);
    const key = `${room.size}${room.mix}`;
    if (key !== roomKey) {
      roomKey = key;
      engine.setRoom(room.size, room.mix);
    }

    // the flame in your hand: its kind, its strength by remaining radius; a crossfade on a change
    const burning = s.hand.left > 0;
    const spec = CARRY[s.hand.kind];
    const frac = burning ? Math.max(0, Math.min(1, s.handR / spec.rMax)) : 0.3;
    loopTo('hand', burning ? HAND_LOOP[s.hand.kind] : 'flame.embers', { bus: 'world', gain: 0.35 + 0.65 * frac, ramp: 0.25 });

    // the two nearest lit fixtures within 6 steps (shrine candles are silent)
    const lit: number[] = [];
    const tiles: number[] = [];
    fl.fixtures.forEach((f, i) => {
      if (f.kind === 'shrineCandles' || s.fixtureLeft[i] <= 0) return;
      lit.push(i);
      tiles.push(f.tile);
    });
    const near = nearest(field.dist, tiles, LOOP_REACH, 2);
    const wanted = new Set<number>(near.map((t) => lit[tiles.indexOf(t)]));
    for (const key of [...slots.keys()]) {
      if (key.startsWith('fix') && !wanted.has(Number(key.slice(3)))) loopTo(key, null, {});
    }
    for (const i of wanted) {
      const f = fl.fixtures[i];
      const p = place(s, field.dist, f.tile);
      loopTo(`fix${i}`, f.kind === 'brazier' ? 'fire.brazier' : 'fire.sconce', { bus: 'world', gain: p.gain, pan: p.pan, lowpass: p.lowpass, send: p.send });
    }

    // the sand pouring where it is
    const c = s.collapse;
    if (c && c.started && c.fill < c.limit && c.order.length) {
      const at = c.order[Math.min(Math.floor(c.fill), c.limit - 1, c.order.length - 1)];
      const p = place(s, field.dist, at);
      loopTo('pour', 'sand.pour', { bus: 'world', gain: p.gain, pan: p.pan, lowpass: p.lowpass, send: p.send });
    } else loopTo('pour', null, {});

    // air down the false door once it is open
    if (s.escape?.open && fl.exit >= 0) {
      const p = place(s, field.dist, fl.exitFront >= 0 ? fl.exitFront : fl.exit);
      loopTo('exit', 'exit.air', { bus: 'world', gain: p.gain, pan: p.pan, lowpass: p.lowpass, send: p.send });
    } else loopTo('exit', null, {});

    // a whistle at the nearest unopened seal
    const seals = fl.secrets.filter((sec, k) => s.secretPhase[k] < 3).map((sec) => sec.front);
    const sealNear = nearest(field.dist, seals, LOOP_REACH, 1);
    if (sealNear.length) {
      const p = place(s, field.dist, sealNear[0]);
      loopTo('draught', 'seal.draught', { bus: 'world', gain: p.gain * 0.8, pan: p.pan, lowpass: 0, send: p.send });
    } else loopTo('draught', null, {});

    // the guardian: a low dread by proximity, a heartbeat in the hand, the tomb going quiet when it hunts in view
    // the nearest hunter drives the dread and the heartbeat; a frozen one is silent
    let cue: ReturnType<typeof hunterCues>[number] | null = null;
    for (const c of hunterCues(s)) if (!c.frozen && c.mode !== 'dormant' && c.path >= 0 && (!cue || c.path < cue.path)) cue = c;
    if (cue) {
      const hunting = cue.mode === 'hunt';
      const g = smoothstep(16, 3, cue.path) * (hunting ? 1 : 0.5);
      const e = Math.hypot(cue.dx, cue.dy);
      loopTo('dread', g > 0.02 ? 'g.dread' : null, { bus: 'guardian', gain: g, pan: Math.max(-1, Math.min(1, cue.dx / Math.max(3, e))) * 0.8, lowpass: cue.visible ? 0 : 900, send: 0.25 });
      haptics.heartbeat(!cue.visible && cue.path <= 8 && cue.mode !== 'recoil' ? heartbeatPeriod(cue.path) : null);
      if (hunting && cue.visible && s.guardian && cue.id === 'guardian' && s.light[s.guardian.pos] > 0) {
        huntDuckAt -= CONTINUOUS_EVERY;
        if (huntDuckAt <= 0) {
          engine.duck('ambience', -6, 0.3, 0.6, 0.8);
          huntDuckAt = 0.5;
        }
      }
    } else {
      loopTo('dread', null, {});
      haptics.heartbeat(null);
    }
  };

  return {
    update(s, dt, playing) {
      if (s.floor !== floor) {
        this.reset(s);
        floor = s.floor;
      }
      if (!playing) {
        prevIdle = s.idle;
        return;
      }
      const stamp = gridStamp(s) + (s.collapse?.blocked ?? 0) * 7919;
      field.update(s, stamp);
      for (const e of s.events) {
        if (e.seq <= lastSeq) continue;
        handleEvent(s, e);
      }
      lastSeq = s.eventSeq;
      if (s.trail > lastTrail) footstep(s);
      lastTrail = s.trail;
      prevIdle = s.idle;
      // the Jade Seal: the world goes quiet and dull while time is held, and comes back over 0.4 s
      const held = s.powers.length > 0 && isFrozen(s);
      if (held !== jade) {
        jade = held;
        applyWorld(held ? 0.2 : 0.4);
      }
      // the thumps repeat every 0.9 s while the breath is low
      if (s.water && s.breath < BREATH.low && s.status === 'playing') {
        breathAt -= dt;
        if (breathAt <= 0) {
          breathAt = 0.9;
          haptics.play('breathLow');
        }
      } else breathAt = 0.9;
      acc += dt;
      if (acc >= CONTINUOUS_EVERY) {
        acc = 0;
        continuous(s);
      }
    },

    reset(s) {
      stopAllLoops();
      haptics.heartbeat(null);
      lastSeq = s ? s.eventSeq : 0;
      lastTrail = s ? s.trail : 0;
      prevIdle = s ? s.idle : 1;
      wading = false;
      acc = CONTINUOUS_EVERY;
      huntDuckAt = 0;
      roomKey = '';
      if (s) floor = s.floor;
      if (jade) {
        jade = false;
        applyWorld(0.2);
      }
    },

    setOverlay(on) {
      if (on === overlay) return;
      overlay = on;
      applyWorld(0.25);
      engine.setBusLevel('ambience', on ? DB(-10) : 1, 0.4);
    },

    dispose() {
      stopAllLoops();
      haptics.heartbeat(null);
    },
  };
}
