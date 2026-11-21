import type { SoundGroup, SoundId } from './manifest';

/** The four buses: ambience, in-game effects, the guardian's own sounds, interface. All end in master. */
export type Bus = 'ambience' | 'world' | 'guardian' | 'ui';

export type PlayOpts = {
  /** linear gain on top of the sound's design level */
  gain?: number;
  /** -1 left .. 1 right */
  pan?: number;
  /** playback rate (variants use +-4 %) */
  rate?: number;
  /** low-pass cutoff in Hz (muffled by walls); omit or 0 for none */
  lowpass?: number;
  /** reverb send 0..1 */
  send?: number;
  bus?: Bus;
  /** higher survives voice stealing longer */
  priority?: number;
};

export type LoopParams = { gain?: number; pan?: number; lowpass?: number; send?: number };

export interface LoopVoice {
  /** moves the loop's parameters; ramp = seconds of smoothing (default 0.1) */
  set(p: LoopParams, ramp?: number): void;
  stop(fade?: number): void;
}

export type Volumes = { master: number; sfx: number; ambience: number; muted: boolean };

/** Which sound stack is in use: the full audio graph, the thin expo-audio fallback, or silence. */
export type EngineKind = 'audio-api' | 'expo-audio' | 'none';

export interface AudioEngine {
  readonly kind: EngineKind;
  load(group: SoundGroup): Promise<void>;
  unload(group: SoundGroup): void;
  /** true when every sound of the group is decoded */
  isLoaded(group: SoundGroup): boolean;
  play(id: SoundId, o?: PlayOpts): { stop(): void } | null;
  loop(id: SoundId, o?: PlayOpts): LoopVoice | null;
  /** lower a bus by `dB` for a while: attack and release in seconds, `hold` seconds between */
  duck(bus: Bus, dB: number, attack: number, hold: number, release: number): void;
  /** a bus level 0..1 (overlays fade the world to nothing) */
  setBusLevel(bus: Bus, level: number, ramp?: number): void;
  /** a low-pass on a whole bus in Hz (the Jade Seal muffles the world); 0 = open */
  setBusFilter(bus: Bus, hz: number, ramp?: number): void;
  setVolumes(v: Volumes): void;
  /** which reverb the room around the listener uses, and how much of the large one (0..1) */
  setRoom(size: 'small' | 'large', mix: number): void;
  suspend(): Promise<void>;
  resume(): Promise<void>;
  /** called when the system interrupts audio (a call, another app) */
  onInterruption(cb: () => void): void;
}

export const BUSES: readonly Bus[] = ['ambience', 'world', 'guardian', 'ui'];
