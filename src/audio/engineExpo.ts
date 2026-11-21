import { SOUNDS, type SoundGroup, type SoundId } from './manifest';
import { BUSES, type AudioEngine, type Bus, type LoopVoice, type PlayOpts, type Volumes } from './types';

/**
 * The thin fallback (plan 05, Q39): chosen at startup only when react-native-audio-api's native module is
 * missing (a dev build made before it was added, or a failed native build), so the game degrades to
 * plain, unpanned sound instead of silence. Players from expo-audio: a pool of 4 per one-shot, volume
 * by distance only; no pan, no filter, no reverb; loops use the file as is (its 100 ms padding repeats).
 * Remove it once the audio-api build is confirmed on a device.
 */
type Player = { volume: number; loop: boolean; playing: boolean; playbackRate: number; play(): void; pause(): void; seekTo(s: number): Promise<void>; remove(): void };
type ExpoAudio = { createAudioPlayer: (src: number) => Player; setAudioModeAsync?: (m: object) => Promise<void> };

const POOL = 4;

export function createExpoEngine(audio: ExpoAudio): AudioEngine {
  const pools = new Map<SoundId, Player[]>();
  const loaded = new Set<SoundGroup>();
  let vol: Volumes = { master: 1, sfx: 0.8, ambience: 0.7, muted: false };
  const overlay: Record<Bus, number> = { ambience: 1, world: 1, guardian: 1, ui: 1 };
  const ducked: Record<Bus, number> = { ambience: 1, world: 1, guardian: 1, ui: 1 };
  const level = (b: Bus) => (vol.muted ? 0 : vol.master * (b === 'ambience' ? vol.ambience : vol.sfx) * overlay[b] * ducked[b]);
  const loops = new Set<{ player: Player; bus: Bus; gain: number }>();
  try {
    void audio.setAudioModeAsync?.({ playsInSilentMode: false, interruptionMode: 'mixWithOthers', shouldPlayInBackground: false });
  } catch {
    // best effort
  }
  const refresh = () => loops.forEach((l) => (l.player.volume = Math.min(1, l.gain * level(l.bus))));

  return {
    kind: 'expo-audio',
    async load(group) {
      for (const id of Object.keys(SOUNDS) as SoundId[]) {
        const e = SOUNDS[id];
        if (e.group !== group || pools.has(id) || id.startsWith('ir.')) continue;
        try {
          const n = e.loop ? 1 : POOL;
          pools.set(id, Array.from({ length: n }, () => audio.createAudioPlayer(e.src)));
        } catch {
          // silent
        }
      }
      loaded.add(group);
    },
    unload(group) {
      for (const id of Object.keys(SOUNDS) as SoundId[]) {
        if (SOUNDS[id].group !== group) continue;
        pools.get(id)?.forEach((p) => p.remove());
        pools.delete(id);
      }
      loaded.delete(group);
    },
    isLoaded: (g) => loaded.has(g),
    play(id, o: PlayOpts = {}) {
      const pool = pools.get(id);
      if (!pool) return null;
      const b = o.bus ?? 'world';
      const gain = SOUNDS[id].gain * (o.gain ?? 1) * level(b);
      if (gain < 0.002) return null;
      const p = pool.find((q) => !q.playing) ?? pool[0];
      p.volume = Math.min(1, gain);
      p.playbackRate = o.rate ?? 1;
      void p.seekTo(0);
      p.play();
      return { stop: () => p.pause() };
    },
    loop(id, o: PlayOpts = {}) {
      const pool = pools.get(id);
      if (!pool) return null;
      const player = pool[0];
      const rec = { player, bus: o.bus ?? ('ambience' as Bus), gain: SOUNDS[id].gain * (o.gain ?? 1) };
      loops.add(rec);
      player.loop = true;
      player.volume = Math.min(1, rec.gain * level(rec.bus));
      void player.seekTo(0);
      player.play();
      const v: LoopVoice = {
        set(p) {
          if (p.gain !== undefined) rec.gain = SOUNDS[id].gain * p.gain;
          player.volume = Math.min(1, rec.gain * level(rec.bus));
        },
        stop() {
          loops.delete(rec);
          player.pause();
        },
      };
      return v;
    },
    duck(b, dB, attack, hold, release) {
      ducked[b] = Math.pow(10, dB / 20);
      refresh();
      setTimeout(
        () => {
          ducked[b] = 1;
          refresh();
        },
        (attack + hold + release * 0.5) * 1000,
      );
    },
    setBusLevel(b, l) {
      overlay[b] = l;
      refresh();
    },
    setBusFilter() {},
    setVolumes(v) {
      vol = v;
      refresh();
    },
    setRoom() {},
    async suspend() {
      loops.forEach((l) => l.player.pause());
    },
    async resume() {
      loops.forEach((l) => l.player.play());
    },
    onInterruption() {},
  };
}

void BUSES;
