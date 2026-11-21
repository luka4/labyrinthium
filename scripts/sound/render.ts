import { createHash } from 'node:crypto';

import { LOOP_PAD, SR, peakOf, rmsOf, type Buf } from './dsp';
import { RECIPES, type Recipe } from './recipes';

export type Rendered = {
  recipe: Recipe;
  channels: Buf[];
  /** seconds */
  duration: number;
  loop: [number, number] | null;
};

/** Renders one recipe: mono or stereo float32 at 48 kHz, and its loop points in seconds. */
export function renderRecipe(recipe: Recipe): Rendered {
  const r = recipe.render();
  const channels = Array.isArray(r) ? r : [r];
  const len = channels[0].length;
  const loop: [number, number] | null = recipe.loop ? [LOOP_PAD, (len - LOOP_PAD * SR) / SR] : null;
  return { recipe, channels, duration: len / SR, loop };
}

/** sha1 of the 16-bit quantised samples (robust against last-bit float differences between engines). */
export function pcmHash(channels: Buf[]): string {
  const h = createHash('sha1');
  const len = channels[0].length;
  const block = new Int16Array(len * channels.length);
  for (let i = 0; i < len; i++) for (let c = 0; c < channels.length; c++) block[i * channels.length + c] = Math.max(-32768, Math.min(32767, Math.round(channels[c][i] * 32767)));
  h.update(Buffer.from(block.buffer));
  return h.digest('hex');
}

export type SoundStats = { sha1: string; duration: number; peakDb: number; rmsDb: number; dc: number; loop: [number, number] | null; channels: number };

export function statsOf(r: Rendered): SoundStats {
  let peak = 0;
  let rms = 0;
  let dc = 0;
  for (const ch of r.channels) {
    peak = Math.max(peak, peakOf(ch));
    rms = Math.max(rms, rmsOf(ch));
    // DC of the sound itself: for a loop, of the cycle between its loop points
    const from = r.loop ? Math.round(r.loop[0] * SR) : 0;
    const to = r.loop ? Math.round(r.loop[1] * SR) : ch.length;
    let s = 0;
    for (let i = from; i < to; i++) s += ch[i];
    dc = Math.max(dc, Math.abs(s / (to - from)));
  }
  const dbf = (v: number) => Math.round(20 * Math.log10(Math.max(v, 1e-9)) * 100) / 100;
  return { sha1: pcmHash(r.channels), duration: Math.round(r.duration * 1000) / 1000, peakDb: dbf(peak), rmsDb: dbf(rms), dc: Math.round(dc * 1e6) / 1e6, loop: r.loop, channels: r.channels.length };
}

/** Interleaved float32 little-endian bytes, for ffmpeg's `-f f32le`. */
export function interleave(channels: Buf[]): Buffer {
  const len = channels[0].length;
  const out = new Float32Array(len * channels.length);
  for (let i = 0; i < len; i++) for (let c = 0; c < channels.length; c++) out[i * channels.length + c] = channels[c][i];
  return Buffer.from(out.buffer);
}

export const ALL = RECIPES;
