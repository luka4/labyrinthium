import { Asset } from 'expo-asset';
import { Platform } from 'react-native';
import type * as AA from 'react-native-audio-api';

import { SOUNDS, type SoundGroup, type SoundId } from './manifest';
import { BUSES, type AudioEngine, type Bus, type LoopParams, type LoopVoice, type PlayOpts, type Volumes } from './types';

/**
 * The real-time audio graph (plan 05, section 10), on react-native-audio-api (Web Audio API on Oboe /
 * AVAudioEngine; the browser's own Web Audio on web):
 *
 *   source -> [voice gain] -> [low-pass, when muffled] -> [stereo panner] -+-> bus
 *                                                                          +-> send -> reverb (small | large convolver)
 *   buses ambience / world / guardian / ui -> duck -> master -> soft clip -> destination
 *
 * One-shots are single-use source nodes on cached buffers (24 voices, lowest priority and oldest stolen);
 * every parameter change goes through setTargetAtTime (a direct set would click).
 */
type API = typeof AA;

const MAX_VOICES = 24;
/** time constant (s) of parameter smoothing: ~95 % of a step in 3 tau */
const TC = 0.03;

type Voice = { priority: number; at: number; stop: () => void };

export function createAudioApiEngine(api: API): AudioEngine {
  const ctx = new api.AudioContext({ latencyHint: 'interactive' });
  try {
    // never take the player's music away, respect the silent switch (iOS); no-ops elsewhere
    api.AudioManager?.setSystemOptions?.({ ios: { category: 'ambient', options: ['mixWithOthers'] } });
  } catch {
    // web has no session management
  }

  const buffers = new Map<SoundId, AA.AudioBuffer>();
  const loaded = new Set<SoundGroup>();
  const loading = new Map<SoundGroup, Promise<void>>();
  const voices = new Set<Voice>();
  let interruption: (() => void) | null = null;

  // ---- master chain -----------------------------------------------------------------------------
  const master = ctx.createGain();
  const clip = ctx.createWaveShaper();
  {
    // linear below -3 dBFS, tanh above: nothing ever clips hard
    const knee = Math.pow(10, -3 / 20);
    const n = 2048;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      const a = Math.abs(x);
      curve[i] = a <= knee ? x : Math.sign(x) * (knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee)));
    }
    clip.curve = curve;
  }
  master.connect(clip);
  clip.connect(ctx.destination);

  // ---- buses --------------------------------------------------------------------------------------
  const bus = {} as Record<Bus, { level: AA.GainNode; duck: AA.GainNode; filter: AA.BiquadFilterNode }>;
  for (const b of BUSES) {
    const level = ctx.createGain();
    const duck = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 20000;
    level.connect(filter);
    filter.connect(duck);
    duck.connect(master);
    bus[b] = { level, duck, filter };
  }
  let vol: Volumes = { master: 1, sfx: 0.8, ambience: 0.7, muted: false };
  const overlay: Record<Bus, number> = { ambience: 1, world: 1, guardian: 1, ui: 1 };
  const userOf = (b: Bus) => (b === 'ambience' ? vol.ambience : vol.sfx);
  const smooth = (p: AA.AudioParam, v: number, tc = TC) => p.setTargetAtTime(v, ctx.currentTime, tc);
  const applyBus = (b: Bus, tc = TC) => smooth(bus[b].level.gain, userOf(b) * overlay[b], tc);

  // ---- reverb: two convolvers, crossfaded by the room the listener stands in -----------------------
  const reverbIn = ctx.createGain();
  const reverbOut = ctx.createGain();
  const sendSmall = ctx.createGain();
  const sendLarge = ctx.createGain();
  reverbIn.connect(sendSmall);
  reverbIn.connect(sendLarge);
  reverbOut.connect(master);
  sendSmall.gain.value = 1;
  sendLarge.gain.value = 0;
  let convolvers: AA.ConvolverNode[] = [];
  const attachReverb = () => {
    const small = buffers.get('ir.small');
    const large = buffers.get('ir.large');
    if (!small || !large || convolvers.length) return;
    for (const [send, buf] of [
      [sendSmall, small],
      [sendLarge, large],
    ] as const) {
      const c = ctx.createConvolver();
      c.buffer = buf;
      send.connect(c);
      c.connect(reverbOut);
      convolvers.push(c);
    }
  };

  // ---- loading --------------------------------------------------------------------------------------
  const decode = async (src: number): Promise<AA.AudioBuffer> => {
    if (Platform.OS === 'web') {
      const uri = Asset.fromModule(src).uri;
      const bytes = await (await fetch(uri)).arrayBuffer();
      return (ctx as unknown as { decodeAudioData: (b: ArrayBuffer) => Promise<AA.AudioBuffer> }).decodeAudioData(bytes);
    }
    return (ctx as unknown as { decodeAudioData: (s: number) => Promise<AA.AudioBuffer> }).decodeAudioData(src);
  };

  const engine: AudioEngine = {
    kind: 'audio-api',

    load(group) {
      if (loaded.has(group)) return Promise.resolve();
      const pending = loading.get(group);
      if (pending) return pending;
      const ids = (Object.keys(SOUNDS) as SoundId[]).filter((id) => SOUNDS[id].group === group && !buffers.has(id));
      const job = (async () => {
        // a few at a time: decoding runs off the JS thread, the queue keeps memory spikes small
        for (let i = 0; i < ids.length; i += 4) {
          await Promise.all(
            ids.slice(i, i + 4).map(async (id) => {
              try {
                buffers.set(id, await decode(SOUNDS[id].src));
              } catch {
                // a sound that fails to decode stays silent; the rest of the group still loads
              }
            }),
          );
        }
        loaded.add(group);
        loading.delete(group);
        if (group === 'core') attachReverb();
      })();
      loading.set(group, job);
      return job;
    },

    unload(group) {
      for (const id of Object.keys(SOUNDS) as SoundId[]) if (SOUNDS[id].group === group) buffers.delete(id);
      loaded.delete(group);
    },

    isLoaded: (group) => loaded.has(group),

    play(id, o: PlayOpts = {}) {
      const buf = buffers.get(id);
      if (!buf) return null;
      const entry = SOUNDS[id];
      if (voices.size >= MAX_VOICES) {
        let victim: Voice | null = null;
        for (const v of voices) if (!victim || v.priority < victim.priority || (v.priority === victim.priority && v.at < victim.at)) victim = v;
        if (victim && victim.priority <= (o.priority ?? 0)) victim.stop();
        else return null;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      if (o.rate && o.rate !== 1) src.playbackRate.value = o.rate;
      const g = ctx.createGain();
      g.gain.value = entry.gain * (o.gain ?? 1);
      src.connect(g);
      const chain: AA.AudioNode[] = [src, g];
      let last: AA.AudioNode = g;
      if (o.lowpass) {
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = o.lowpass;
        last.connect(f);
        chain.push(f);
        last = f;
      }
      const pan = ctx.createStereoPanner();
      pan.pan.value = o.pan ?? 0;
      last.connect(pan);
      pan.connect(bus[o.bus ?? 'world'].level);
      chain.push(pan);
      if (o.send && o.send > 0.01) {
        const s = ctx.createGain();
        s.gain.value = o.send;
        pan.connect(s);
        s.connect(reverbIn);
        chain.push(s);
      }
      const voice: Voice = {
        priority: o.priority ?? 0,
        at: ctx.currentTime,
        stop: () => {
          try {
            src.stop();
          } catch {
            // already ended
          }
          cleanup();
        },
      };
      const cleanup = () => {
        if (!voices.delete(voice)) return;
        for (const n of chain) {
          try {
            n.disconnect();
          } catch {
            // already gone
          }
        }
      };
      src.onended = cleanup;
      voices.add(voice);
      src.start();
      return { stop: voice.stop };
    },

    loop(id, o: PlayOpts = {}) {
      const buf = buffers.get(id);
      if (!buf) return null;
      const entry = SOUNDS[id];
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      if (entry.loop) {
        src.loopStart = entry.loop[0];
        src.loopEnd = entry.loop[1];
      }
      const g = ctx.createGain();
      g.gain.value = 0;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.lowpass || 20000;
      const pan = ctx.createStereoPanner();
      pan.pan.value = o.pan ?? 0;
      const s = ctx.createGain();
      s.gain.value = o.send ?? 0;
      src.connect(g);
      g.connect(f);
      f.connect(pan);
      pan.connect(bus[o.bus ?? 'ambience'].level);
      pan.connect(s);
      s.connect(reverbIn);
      const chain = [src, g, f, pan, s];
      // start from the offset into the cycle so two beds never line up
      src.start(0, entry.loop ? entry.loop[0] : 0);
      const base = entry.gain;
      smooth(g.gain, base * (o.gain ?? 1), 0.1);
      let stopped = false;
      const voice: LoopVoice = {
        set(p: LoopParams, ramp = 0.1) {
          if (stopped) return;
          const tc = Math.max(0.005, ramp / 3);
          if (p.gain !== undefined) smooth(g.gain, base * p.gain, tc);
          if (p.pan !== undefined) smooth(pan.pan, p.pan, tc);
          if (p.lowpass !== undefined) smooth(f.frequency, p.lowpass > 0 ? p.lowpass : 20000, tc);
          if (p.send !== undefined) smooth(s.gain, p.send, tc);
        },
        stop(fade = 0.3) {
          if (stopped) return;
          stopped = true;
          smooth(g.gain, 0, Math.max(0.01, fade / 3));
          setTimeout(() => {
            try {
              src.stop();
            } catch {
              // already ended
            }
            for (const n of chain) {
              try {
                n.disconnect();
              } catch {
                // already gone
              }
            }
          }, fade * 1000 + 120);
        },
      };
      return voice;
    },

    duck(b, dB, attack, hold, release) {
      const now = ctx.currentTime;
      const p = bus[b].duck.gain;
      p.cancelScheduledValues(now);
      p.setTargetAtTime(Math.pow(10, dB / 20), now, Math.max(0.005, attack / 3));
      p.setTargetAtTime(1, now + attack + hold, Math.max(0.01, release / 3));
    },

    setBusLevel(b, level, ramp = 0.25) {
      overlay[b] = level;
      applyBus(b, Math.max(0.005, ramp / 3));
    },

    setBusFilter(b, hz, ramp = 0.3) {
      smooth(bus[b].filter.frequency, hz > 0 ? hz : 20000, Math.max(0.005, ramp / 3));
    },

    setVolumes(v) {
      vol = v;
      smooth(master.gain, v.muted ? 0 : v.master, 0.05);
      for (const b of BUSES) applyBus(b);
      smooth(reverbOut.gain, 1, 0.05);
    },

    setRoom(size, mix) {
      const large = size === 'large' ? Math.max(0, Math.min(1, mix)) : 0;
      smooth(sendLarge.gain, large, 0.13);
      smooth(sendSmall.gain, size === 'small' ? 1 : (1 - large) * 0.7, 0.13);
    },

    async suspend() {
      try {
        await ctx.suspend();
      } catch {
        // already suspended or closed
      }
    },
    async resume() {
      try {
        if (ctx.state !== 'running') await ctx.resume();
      } catch {
        // closed: nothing to do
      }
    },
    onInterruption(cb) {
      interruption = cb;
    },
  };

  // the first audible thing is the room tone of the title: start from a clean, running graph
  try {
    ctx.onerror = () => setTimeout(() => void engine.resume(), 2000);
  } catch {
    // web contexts have no onerror
  }
  try {
    api.AudioManager?.observeAudioInterruptions?.(true);
    api.AudioManager?.addSystemEventListener?.('interruption', (e: { type: string }) => {
      if (e.type === 'began') interruption?.();
    });
  } catch {
    // no system events on web
  }
  engine.setVolumes(vol);
  void convolvers;
  return engine;
}
