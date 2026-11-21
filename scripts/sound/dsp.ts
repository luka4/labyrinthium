/**
 * Sound synthesis kit (plan 05, build time only): plain TypeScript, no dependencies. Everything is
 * float32 at 48 kHz and driven by a seeded PRNG, so `npm run sounds` renders the same set every
 * time. Recipes (recipes.ts) are built from these primitives: noise, filters, a modal bank of
 * resonators for struck bodies, Poisson grains for sand and debris, stick-slip friction, fire,
 * sweeps and loop helpers.
 */
export const SR = 48000;
export type Buf = Float32Array;
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const sec = (t: number) => Math.round(t * SR);
export const db = (d: number) => Math.pow(10, d / 20);
export const zeros = (n: number): Buf => new Float32Array(n);

export function gauss(r: Rng): number {
  return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
}

// ---- noise -----------------------------------------------------------------------------------------------

export function white(n: number, r: Rng): Buf {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = r() * 2 - 1;
  return x;
}

/** Pink noise (Kellet's refined filter), roughly unit-peak. */
export function pink(n: number, r: Rng): Buf {
  const x = new Float32Array(n);
  let b0 = 0,
    b1 = 0,
    b2 = 0,
    b3 = 0,
    b4 = 0,
    b5 = 0,
    b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = r() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    x[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return biquad(x, 'hp', 28, 0.7071);
}

/** Brown noise: leaky integrated white, rescaled to about +-1. */
export function brown(n: number, r: Rng): Buf {
  const x = new Float32Array(n);
  let y = 0;
  for (let i = 0; i < n; i++) {
    y = y * 0.997 + (r() * 2 - 1) * 0.06;
    x[i] = y;
  }
  return normalize(biquad(x, 'hp', 22, 0.7071), 0);
}

// ---- filters ---------------------------------------------------------------------------------------------

type FilterKind = 'lp' | 'hp' | 'bp' | 'peak' | 'lowshelf' | 'highshelf' | 'notch';

/** RBJ biquad, direct form I in doubles. `bp` is the constant-0-dB-peak band-pass. */
export function biquad(x: Buf, kind: FilterKind, f: number, q = 0.7071, gainDb = 0): Buf {
  const w0 = (2 * Math.PI * Math.min(f, SR * 0.49)) / SR;
  const cw = Math.cos(w0);
  const sw = Math.sin(w0);
  const alpha = sw / (2 * q);
  const A = Math.pow(10, gainDb / 40);
  let b0 = 1,
    b1 = 0,
    b2 = 0,
    a0 = 1,
    a1 = 0,
    a2 = 0;
  switch (kind) {
    case 'lp':
      b0 = (1 - cw) / 2;
      b1 = 1 - cw;
      b2 = (1 - cw) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cw;
      a2 = 1 - alpha;
      break;
    case 'hp':
      b0 = (1 + cw) / 2;
      b1 = -(1 + cw);
      b2 = (1 + cw) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cw;
      a2 = 1 - alpha;
      break;
    case 'bp':
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
      a0 = 1 + alpha;
      a1 = -2 * cw;
      a2 = 1 - alpha;
      break;
    case 'notch':
      b0 = 1;
      b1 = -2 * cw;
      b2 = 1;
      a0 = 1 + alpha;
      a1 = -2 * cw;
      a2 = 1 - alpha;
      break;
    case 'peak':
      b0 = 1 + alpha * A;
      b1 = -2 * cw;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cw;
      a2 = 1 - alpha / A;
      break;
    case 'lowshelf': {
      const t = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 - (A - 1) * cw + t);
      b1 = 2 * A * (A - 1 - (A + 1) * cw);
      b2 = A * (A + 1 - (A - 1) * cw - t);
      a0 = A + 1 + (A - 1) * cw + t;
      a1 = -2 * (A - 1 + (A + 1) * cw);
      a2 = A + 1 + (A - 1) * cw - t;
      break;
    }
    case 'highshelf': {
      const t = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 + (A - 1) * cw + t);
      b1 = -2 * A * (A - 1 + (A + 1) * cw);
      b2 = A * (A + 1 + (A - 1) * cw - t);
      a0 = A + 1 - (A - 1) * cw + t;
      a1 = 2 * (A - 1 - (A + 1) * cw);
      a2 = A + 1 - (A - 1) * cw - t;
      break;
    }
  }
  b0 /= a0;
  b1 /= a0;
  b2 /= a0;
  a1 /= a0;
  a2 /= a0;
  const y = new Float32Array(x.length);
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = xi;
    y2 = y1;
    y1 = yi;
    y[i] = yi;
  }
  return y;
}
export const lp = (x: Buf, f: number, q = 0.7071) => biquad(x, 'lp', f, q);
export const hp = (x: Buf, f: number, q = 0.7071) => biquad(x, 'hp', f, q);
export const bp = (x: Buf, f: number, q = 1) => biquad(x, 'bp', f, q);

/** Steeper low-pass: two cascaded biquads. */
export const lp4 = (x: Buf, f: number) => lp(lp(x, f, 0.54), f, 1.3);

/** Time-varying state-variable filter (TPT): `freq(i)` in Hz per sample. mode: low | band | high. */
export function svf(x: Buf, freq: (i: number) => number, q: number, mode: 'low' | 'band' | 'high' = 'band'): Buf {
  const y = new Float32Array(x.length);
  const k = 1 / q;
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < x.length; i++) {
    const g = Math.tan((Math.PI * Math.min(freq(i), SR * 0.45)) / SR);
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    const v3 = x[i] - s2;
    const v1 = a1 * s1 + a2 * v3;
    const v2 = s2 + a2 * s1 + a3 * v3;
    s1 = 2 * v1 - s1;
    s2 = 2 * v2 - s2;
    y[i] = mode === 'low' ? v2 : mode === 'band' ? v1 * k : x[i] - k * v1 - v2;
  }
  return y;
}

/** A slow wandering value in [lo, hi], sampled per call (smooth random walk through random knots, `rate` knots/s). */
export function wander(n: number, lo: number, hi: number, rate: number, r: Rng): (i: number) => number {
  const knots = Math.ceil((n / SR) * rate) + 3;
  const k = Array.from({ length: knots }, () => lo + (hi - lo) * r());
  return (i: number) => {
    const p = (i / SR) * rate;
    const a = Math.floor(p);
    const f = p - a;
    const s = f * f * (3 - 2 * f);
    return k[a] + (k[a + 1] - k[a]) * s;
  };
}

// ---- envelopes and level helpers ---------------------------------------------------------------------------

export function fade(x: Buf, inMs = 3, outMs = 8): Buf {
  const a = sec(inMs / 1000);
  const b = sec(outMs / 1000);
  for (let i = 0; i < Math.min(a, x.length); i++) x[i] *= i / a;
  for (let i = 0; i < Math.min(b, x.length); i++) x[x.length - 1 - i] *= i / b;
  return x;
}

export function peakOf(x: Buf): number {
  let m = 0;
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
  return m;
}

export function rmsOf(x: Buf, from = 0, to = x.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, to - from));
}

/** Scales to a peak of `peakDb` dBFS. */
export function normalize(x: Buf, peakDb = -3): Buf {
  const p = peakOf(x);
  if (p < 1e-9) return x;
  const g = db(peakDb) / p;
  for (let i = 0; i < x.length; i++) x[i] *= g;
  return x;
}

export function gain(x: Buf, g: number): Buf {
  for (let i = 0; i < x.length; i++) x[i] *= g;
  return x;
}

export function dcBlock(x: Buf): Buf {
  const y = new Float32Array(x.length);
  let px = 0;
  let py = 0;
  const R = 1 - 40 / SR;
  for (let i = 0; i < x.length; i++) {
    py = x[i] - px + R * py;
    px = x[i];
    y[i] = py;
  }
  return y;
}

export function softClip(x: Buf, drive = 1): Buf {
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * drive) / Math.tanh(drive);
  return x;
}

/** exp(-t / tau) envelope with a short attack. */
export function envExp(n: number, tau: number, attack = 0.001): Buf {
  const e = new Float32Array(n);
  const a = Math.max(1, sec(attack));
  for (let i = 0; i < n; i++) e[i] = Math.exp(-i / SR / tau) * (i < a ? i / a : 1);
  return e;
}

/** Piecewise-linear envelope through [timeSeconds, level] points. */
export function envPoints(n: number, pts: Array<[number, number]>): Buf {
  const e = new Float32Array(n);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    while (k < pts.length - 2 && t > pts[k + 1][0]) k++;
    const [t0, v0] = pts[k];
    const [t1, v1] = pts[Math.min(k + 1, pts.length - 1)];
    const f = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 1;
    e[i] = v0 + (v1 - v0) * f;
  }
  return e;
}

export function mul(x: Buf, e: Buf | ((i: number) => number)): Buf {
  if (typeof e === 'function') for (let i = 0; i < x.length; i++) x[i] *= e(i);
  else for (let i = 0; i < x.length; i++) x[i] *= e[i];
  return x;
}

/** dst += src * g starting at `at` seconds; grows nothing (clipped to dst). */
export function mixAt(dst: Buf, src: Buf, at: number, g = 1): Buf {
  const o = sec(at);
  for (let i = 0; i < src.length; i++) {
    const j = o + i;
    if (j >= 0 && j < dst.length) dst[j] += src[i] * g;
  }
  return dst;
}

export function sum(n: number, ...parts: Array<[Buf, number, number?]>): Buf {
  const out = zeros(n);
  for (const [b, g, at] of parts) mixAt(out, b, at ?? 0, g);
  return out;
}

// ---- physical building blocks -------------------------------------------------------------------------------

/** A short half-sine strike pulse (hardness: pulse width in ms; smaller is brighter) with a little noise. */
export function strike(widthMs: number, r: Rng, noise = 0.25): Buf {
  const n = Math.max(2, sec(widthMs / 1000));
  const p = new Float32Array(n + 1);
  for (let i = 0; i < n; i++) p[i] = Math.sin((Math.PI * i) / n) * (1 - noise + noise * (r() * 2 - 1));
  // differentiate: a real impact has no net push, so the excitation carries no DC and the high modes ring
  const x = new Float32Array(n + 1);
  let peak = 1e-9;
  for (let i = 0; i <= n; i++) {
    x[i] = p[i] - (i ? p[i - 1] : 0);
    peak = Math.max(peak, Math.abs(x[i]));
  }
  for (let i = 0; i <= n; i++) x[i] /= peak;
  return x;
}

export type Mode = { f: number; t60: number; a: number };

/**
 * A modal bank: a body struck by `exc` rings in damped resonances. Each mode is a two-pole resonator
 * (radius from its T60) driven by the excitation, scaled to a similar level whatever its frequency.
 */
export function modal(n: number, modes: Mode[], exc: Buf, detune = 1): Buf {
  const out = new Float32Array(n);
  for (const m of modes) {
    const f = m.f * detune;
    if (f >= SR * 0.48) continue;
    const w = (2 * Math.PI * f) / SR;
    const rr = Math.exp(-6.9078 / (m.t60 * SR));
    const c1 = 2 * rr * Math.cos(w);
    const c2 = -rr * rr;
    const g = m.a * Math.sin(w);
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < n; i++) {
      const x = i < exc.length ? exc[i] : 0;
      const y = g * x + c1 * y1 + c2 * y2;
      y2 = y1;
      y1 = y;
      out[i] += y;
    }
  }
  return out;
}

/** Modes spread between f0 and f1: `count` partials, inharmonic by `spread`, t60 falling with frequency. */
export function stoneModes(r: Rng, f0: number, f1: number, count: number, t60Lo: number, t60Hi: number): Mode[] {
  const modes: Mode[] = [];
  for (let k = 0; k < count; k++) {
    const f = f0 * Math.pow(f1 / f0, (k + r() * 0.8) / count);
    const t = t60Hi * Math.pow(t60Lo / t60Hi, (k + 0.5) / count);
    modes.push({ f, t60: t * (0.7 + 0.6 * r()), a: (0.45 + 0.55 * r()) / (1 + 0.5 * k) });
  }
  return modes;
}

/** Free-bar partial ratios: bronze bars, bells, bowls. */
export const BAR_RATIOS = [1, 2.76, 5.4, 8.93, 13.34];

export function barModes(f0: number, t60: number, amps = [1, 0.6, 0.35, 0.2, 0.1]): Mode[] {
  return BAR_RATIOS.map((ratio, k) => ({ f: f0 * ratio, t60: t60 / (1 + 0.7 * k), a: amps[k] ?? 0.05 }));
}

/**
 * Poisson grains: short windowed noise bursts. `rate(t)` grains per second at time t (seconds),
 * length in ms [min, max], amplitude log-normal with spread `sigma`.
 */
export function grains(n: number, rate: (t: number) => number, lenMs: [number, number], sigma: number, r: Rng): Buf {
  const out = new Float32Array(n);
  let t = 0;
  const total = n / SR;
  while (t < total) {
    const lam = Math.max(0.01, rate(t));
    t += -Math.log(1 - r()) / lam;
    if (t >= total) break;
    const start = sec(t);
    const len = Math.max(4, sec((lenMs[0] + (lenMs[1] - lenMs[0]) * r()) / 1000));
    const amp = Math.exp(sigma * gauss(r));
    for (let i = 0; i < len && start + i < n; i++) out[start + i] += (r() * 2 - 1) * amp * Math.sin((Math.PI * i) / len) ** 2;
  }
  return out;
}

/** Stick-slip impulse train: period 1/f(t) with `jitter` (0..1) randomness; each slip a random strength. */
export function stickSlip(n: number, f: (t: number) => number, jitter: number, r: Rng): Buf {
  const out = new Float32Array(n);
  let t = 0;
  while (t < n / SR) {
    const period = 1 / Math.max(5, f(t));
    t += period * (1 + jitter * (r() * 2 - 1));
    const i = sec(t);
    if (i < n) out[i] += 0.4 + 0.6 * r();
  }
  return out;
}

/** Resonators in parallel on an excitation (friction, creaks): [freq, Q] pairs. */
export function resonators(x: Buf, bank: Array<[number, number]>): Buf {
  const out = new Float32Array(x.length);
  for (const [f, q] of bank) {
    const y = bp(x, f, q);
    for (let i = 0; i < out.length; i++) out[i] += y[i];
  }
  return out;
}

/** Fire: a roar, Poisson crackle, and a hiss, each with its own level. */
export function fire(n: number, r: Rng, o: { roarLp: number; roar: number; crackle: number; pops: number; hiss: number; ticks?: number }): Buf {
  const roar = hp(lp(pink(n, r), o.roarLp, 0.7), 60);
  // 1/f-ish slow amplitude modulation of the roar
  const am = wander(n, 0.55, 1.15, 5, r);
  const am2 = wander(n, 0.8, 1.1, 17, r);
  for (let i = 0; i < n; i++) roar[i] *= am(i) * am2(i);
  normalize(roar, 0);
  const out = zeros(n);
  mixAt(out, roar, 0, o.roar);
  if (o.pops > 0) {
    const cr = bp(grains(n, () => o.pops, [0.6, 2.2], 0.9, r), 1800, 0.9);
    normalize(cr, 0);
    mixAt(out, cr, 0, o.crackle);
  }
  if (o.hiss > 0) {
    const h = hp(white(n, r), 4500);
    const f = wander(n, 0.4, 1.2, 9, r);
    for (let i = 0; i < n; i++) h[i] *= f(i);
    normalize(h, 0);
    mixAt(out, h, 0, o.hiss);
  }
  return out;
}

/** Sine sweep, exponential between f0 and f1 (Hz) over n samples. */
export function sweep(n: number, f0: number, f1: number): Buf {
  const x = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const f = f0 * Math.pow(f1 / f0, i / Math.max(1, n - 1));
    ph += (2 * Math.PI * f) / SR;
    x[i] = Math.sin(ph);
  }
  return x;
}

export function sine(n: number, f: number, phase = 0): Buf {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = Math.sin((2 * Math.PI * f * i) / SR + phase);
  return x;
}

// ---- loops ---------------------------------------------------------------------------------------------------

/**
 * A seamless cycle from `raw` (length n + xfade): the tail is cross-faded (equal power) into the head
 * so the last sample continues into the first. Returns n samples.
 */
export function seamlessLoop(raw: Buf, n: number, xfade: number): Buf {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = raw[i];
  for (let i = 0; i < xfade; i++) {
    const a = (Math.PI / 2) * (i / xfade);
    out[i] = raw[i] * Math.sin(a) + raw[n + i] * Math.cos(a);
  }
  // no DC: a constant offset keeps the seam continuous
  let mean = 0;
  for (let i = 0; i < n; i++) mean += out[i];
  mean /= n;
  for (let i = 0; i < n; i++) out[i] -= mean;
  return out;
}

export const LOOP_PAD = 0.1;

/** pad a cycle with 100 ms of itself before and after, so AAC priming and decoder trim never touch the loop points */
export function padLoop(cycle: Buf): Buf {
  const pad = sec(LOOP_PAD);
  const out = new Float32Array(cycle.length + 2 * pad);
  for (let i = 0; i < pad; i++) out[i] = cycle[cycle.length - pad + i];
  out.set(cycle, pad);
  for (let i = 0; i < pad; i++) out[pad + cycle.length + i] = cycle[i];
  return out;
}

/** Makes a loop of `seconds` from a generator that renders `n` samples; applies the cross-fade and padding. */
export function makeLoop(seconds: number, xfadeSec: number, render: (n: number) => Buf): Buf {
  const n = sec(seconds);
  const xf = sec(xfadeSec);
  return padLoop(seamlessLoop(render(n + xf), n, xf));
}

// ---- stereo helpers -----------------------------------------------------------------------------------------

export type Stereo = [Buf, Buf];

/** Equal-power pan of a mono buffer: p -1..1. */
export function pan(x: Buf, p: number): Stereo {
  const a = ((p + 1) * Math.PI) / 4;
  const l = new Float32Array(x.length);
  const r = new Float32Array(x.length);
  const gl = Math.cos(a);
  const gr = Math.sin(a);
  for (let i = 0; i < x.length; i++) {
    l[i] = x[i] * gl;
    r[i] = x[i] * gr;
  }
  return [l, r];
}

/** Applies a delay of `ms` to the second channel for a little width (Haas), keeping length. */
export function widen(x: Buf, ms: number, r: Rng): Stereo {
  const d = sec(ms / 1000);
  const R = new Float32Array(x.length);
  for (let i = d; i < x.length; i++) R[i] = x[i - d];
  void r;
  return [x, R];
}
