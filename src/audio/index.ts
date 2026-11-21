import { AppState, Platform } from 'react-native';

import { useSettings } from '../state/settings';
import { createAmbience, type Ambience } from './ambience';
import { createAudioApiEngine } from './engine';
import { createExpoEngine } from './engineExpo';
import type { AudioEngine } from './types';

/**
 * Audio entry point. The engine is chosen once, at the first use: react-native-audio-api's graph (pan,
 * muffling, reverb, buses) when its native module is there; else the thin expo-audio fallback (plain
 * unpanned sound, Q39); else silence, so a missing native module never crashes the game.
 */
const silent: AudioEngine = {
  kind: 'none',
  load: async () => {},
  unload: () => {},
  isLoaded: () => false,
  play: () => null,
  loop: () => null,
  duck: () => {},
  setBusLevel: () => {},
  setBusFilter: () => {},
  setVolumes: () => {},
  setRoom: () => {},
  suspend: async () => {},
  resume: async () => {},
  onInterruption: () => {},
};

let engine: AudioEngine | null = null;
let ambience: Ambience | null = null;
let started = false;

function create(): AudioEngine {
  try {
    // required lazily: importing the package without its native module throws
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return createAudioApiEngine(require('react-native-audio-api'));
  } catch (e) {
    if (__DEV__) console.warn('react-native-audio-api is not available; trying expo-audio', e);
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return createExpoEngine(require('expo-audio'));
  } catch (e) {
    if (__DEV__) console.warn('expo-audio is not available either; the game stays silent', e);
  }
  return silent;
}

export function getEngine(): AudioEngine {
  engine ??= create();
  return engine;
}

export function getAmbience(): Ambience {
  ambience ??= createAmbience(getEngine());
  return ambience;
}

const volumes = () => {
  const s = useSettings.getState();
  return { master: 1, sfx: s.sfx, ambience: s.ambience, muted: !s.sound };
};

/** Starts the engine, loads the core sounds, follows the settings and the app's lifecycle. Idempotent. */
export function initAudio() {
  if (started) return;
  started = true;
  const e = getEngine();
  e.setVolumes(volumes());
  void e.load('core');
  useSettings.subscribe(() => e.setVolumes(volumes()));
  // background and foreground: a suspended context costs no battery
  AppState.addEventListener('change', (next) => void (next === 'active' ? e.resume() : e.suspend()));
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    // browsers start audio on the first gesture
    const go = () => {
      void e.resume();
      window.removeEventListener('pointerdown', go);
      window.removeEventListener('keydown', go);
    };
    window.addEventListener('pointerdown', go);
    window.addEventListener('keydown', go);
  }
}
