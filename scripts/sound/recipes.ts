/**
 * The sound set as recipes (plan 05 section 12). Every sound is built from physical models in dsp.ts:
 * struck stone, ceramic and bronze are modal banks, sand and debris are Poisson grains, grinding is
 * stick-slip friction, fire is roar + crackle + hiss. Everything is dry (the runtime adds the room)
 * except where the room is part of the sound (guardian follow, IRs). Each recipe returns audio
 * normalised to -3 dBFS; `level` is the runtime peak level in dBFS at one tile, before user volume.
 */
import {
  BAR_RATIOS,
  SR,
  barModes,
  biquad,
  bp,
  brown,
  db,
  dcBlock,
  envExp,
  envPoints,
  fade,
  fire,
  gain,
  grains,
  hashId,
  hp,
  lp,
  lp4,
  makeLoop,
  mixAt,
  modal,
  mul,
  mulberry32,
  normalize,
  pink,
  resonators,
  sec,
  stickSlip,
  stoneModes,
  strike,
  svf,
  sweep,
  white,
  wander,
  zeros,
  type Buf,
  type Mode,
  type Rng,
} from './dsp';
import { convolve, roomIr } from './room';

export type SoundGroup = 'core' | 'game' | 'bed:egypt' | 'bed:exterior';

export type Recipe = {
  id: string;
  group: SoundGroup;
  /** runtime peak level at one tile, dBFS, before user volume */
  level: number;
  /** a padded loop: the manifest gets loop points */
  loop?: boolean;
  stereo?: boolean;
  /** AAC bitrate in kbps (default 56 mono, 96 stereo) */
  kbps?: number;
  render: () => Buf | [Buf, Buf];
};

/** base id -> variant count (files `<id>.0` ... `<id>.n-1`) */
export const VARIANTS: Record<string, number> = {};

export const RECIPES: Recipe[] = [];
const out = (r: Recipe) => RECIPES.push(r);
const rng = (id: string): Rng => mulberry32(hashId(id));
const done = (x: Buf, peak = -3): Buf => {
  // no DC: block it, then take off what is left and fade the ends again (converges in two passes)
  let y = fade(dcBlock(x), 2, 12);
  for (let k = 0; k < 3; k++) {
    let mean = 0;
    for (let i = 0; i < y.length; i++) mean += y[i];
    mean /= y.length;
    for (let i = 0; i < y.length; i++) y[i] -= mean;
    y = fade(y, 2, 12);
  }
  return normalize(y, peak);
};
const T = (n: number) => sec(n);

function add(id: string, group: SoundGroup, level: number, render: (r: Rng) => Buf, extra: Partial<Recipe> = {}) {
  out({ id, group, level, render: () => render(rng(id)), ...extra });
}
function addVariants(base: string, count: number, group: SoundGroup, level: number, render: (r: Rng, k: number) => Buf) {
  VARIANTS[base] = count;
  for (let k = 0; k < count; k++) out({ id: `${base}.${k}`, group, level, render: () => render(rng(`${base}.${k}`), k) });
}

// ---- shared voices --------------------------------------------------------------------------------------------

/** A struck stone body: low modes with a fast decay. */
function stoneHit(len: number, r: Rng, f0: number, f1: number, count: number, t60: number, hard = 2.5): Buf {
  return modal(len, stoneModes(r, f0, f1, count, t60 * 0.4, t60), strike(hard, r));
}

/** Dull wood: 300-1200 Hz, short. */
function woodHit(len: number, r: Rng, f0 = 300, t60 = 0.09): Buf {
  const modes: Mode[] = [1, 1.6, 2.4, 3.3].map((m, k) => ({ f: f0 * m * (0.95 + 0.1 * r()), t60: t60 / (1 + 0.5 * k), a: 1 / (1 + 0.6 * k) }));
  return modal(len, modes, strike(1.4, r, 0.4));
}

/** Ceramic or faience: 1.2-6 kHz, 0.1-0.4 s. */
function ceramicHit(len: number, r: Rng, f0 = 1500, t60 = 0.25): Buf {
  const modes: Mode[] = [1, 2.32, 4.18, 6.1].map((m, k) => ({ f: f0 * m * (0.97 + 0.06 * r()), t60: t60 / (1 + 0.8 * k), a: 1 / (1 + 0.5 * k) }));
  return modal(len, modes, strike(0.5, r, 0.2));
}

function goldBar(len: number, r: Rng, f0: number, t60: number): Buf {
  return modal(len, barModes(f0, t60), strike(0.6, r, 0.1));
}

/** Cloth: band-limited noise swish with a smooth envelope. */
function cloth(len: number, r: Rng, f0 = 900, q = 0.8): Buf {
  const x = bp(white(len, r), f0, q);
  const e = envPoints(len, [
    [0, 0],
    [(len / SR) * 0.35, 1],
    [len / SR, 0],
  ]);
  return mul(x, e);
}

/** A woosh of air: pink noise through a sweeping low-pass. */
function whoosh(len: number, r: Rng, f0: number, f1: number, peakAt = 0.4): Buf {
  const x = svf(pink(len, r), (i) => f0 * Math.pow(f1 / f0, i / len), 0.9, 'low');
  const dur = len / SR;
  return mul(
    x,
    envPoints(len, [
      [0, 0],
      [dur * peakAt, 1],
      [dur, 0],
    ]),
  );
}

// ---- steps ------------------------------------------------------------------------------------------------------

function footstep(kind: 'stone' | 'granite' | 'grit' | 'sand', r: Rng): Buf {
  const n = T(0.34);
  const d = 0.93 + 0.14 * r();
  const toeAt = 0.09 + 0.05 * r();
  const body = (scale: number): Buf => {
    if (kind === 'sand') {
      // heel and toe are bursts of sand grains, no ring
      const m = Math.round(0.13 * SR);
      const g = lp(grains(m, () => 2400, [0.4, 1.6], 0.5, r), 4800);
      return mul(g, envExp(m, 0.035, 0.004));
    }
    const hit = kind === 'granite' ? stoneHit(n, r, 160 * d, 1400, 7, 0.13 * scale, 0.7) : stoneHit(n, r, 120 * d, 900, 6, 0.09 * scale, 1.1);
    const click = mul(lp(white(T(0.012), r), 3000), envExp(T(0.012), 0.003, 0.0005));
    mixAt(hit, click, 0, 0.5);
    if (kind === 'grit') {
      const crunch = lp(grains(T(0.04), () => 1800, [0.5, 2], 0.7, r), 4500);
      mixAt(hit, mul(crunch, envExp(T(0.04), 0.012, 0.002)), 0.004, 0.6);
    }
    return hit;
  };
  const x = zeros(n);
  mixAt(x, body(1), 0, 1);
  mixAt(x, body(0.6), toeAt, db(-6));
  // the leather sole's scuff
  const scuff = mul(bp(white(T(0.045), r), 1500, 1.2), envExp(T(0.045), 0.015, 0.004));
  mixAt(x, scuff, 0.002, 0.28);
  return done(x);
}
addVariants('step.stone', 6, 'core', -18, (r) => footstep('stone', r));
addVariants('step.granite', 4, 'core', -18, (r) => footstep('granite', r));
addVariants('step.grit', 4, 'core', -18, (r) => footstep('grit', r));
addVariants('step.sand', 4, 'core', -18, (r) => footstep('sand', r));

// ---- fire -------------------------------------------------------------------------------------------------------

const flame = (id: string, level: number, lpHz: number, roar: number, pops: number, crackle: number, hiss: number, extra: Partial<Recipe> = {}) =>
  add(id, 'core', level, (r) => normalize(makeLoop(4, 0.5, (n) => fire(n, r, { roarLp: lpHz, roar, crackle, pops, hiss })), -3), { loop: true, ...extra });

flame('flame.torch', -24, 650, 1, 6, 0.55, 0.03);
flame('flame.bigTorch', -21, 450, 1, 9, 0.6, 0.03);
flame('flame.smallTorch', -27, 900, 1, 4, 0.5, 0.03);
flame('flame.lamp', -28, 300, 1, 0.5, 0.35, 0.01);
flame('flame.candle', -36, 700, 0.12, 0.7, 0.5, 0.06);
add(
  'flame.embers',
  'core',
  -34,
  (r) =>
    normalize(
      makeLoop(4, 0.5, (n) => {
        const x = mul(lp(hp(white(n, r), 2200), 6500), (i) => 0.4 + 0.3 * Math.sin((i / SR) * 3.1));
        const ticks = bp(grains(n, () => 1.2, [0.4, 1.2], 0.6, r), 2200, 1.2);
        normalize(x, -18);
        mixAt(x, normalize(ticks, -8), 0, 0.5);
        return x;
      }),
      -3,
    ),
  { loop: true },
);
flame('fire.brazier', -22, 350, 1, 5, 0.55, 0.04);
flame('fire.sconce', -26, 600, 1, 5, 0.55, 0.03);

// ---- light events ----------------------------------------------------------------------------------------------

function ignition(r: Rng, dur: number, f0: number, f1: number, crackle: number): Buf {
  const n = T(dur);
  const x = svf(white(n, r), (i) => f0 * Math.pow(f1 / f0, Math.min(1, (i / n) * 1.5)), 1.4, 'band');
  mul(
    x,
    envPoints(n, [
      [0, 0],
      [dur * 0.12, 1],
      [dur * 0.45, 0.5],
      [dur, 0],
    ]),
  );
  const cr = mul(bp(grains(n, () => 90, [0.5, 1.8], 0.8, r), 1800, 1), envExp(n, dur * 0.4, 0.001));
  mixAt(x, normalize(cr, -6), 0.01, crackle);
  return x;
}
add('ignite.small', 'core', -16, (r) => done(ignition(r, 0.26, 300, 1500, 0.4)));
add('ignite.brazier', 'game', -14, (r) => {
  const n = T(0.8);
  const x = mul(lp(brown(n, r), 600), envPoints(n, [[0, 0], [0.12, 1], [0.35, 0.55], [0.8, 0]]));
  mixAt(x, mul(sweep(n, 90, 45), envExp(n, 0.18, 0.01)), 0, 0.8);
  mixAt(x, ignition(r, 0.3, 250, 900, 0.5), 0, 0.5);
  return done(x);
});
add('ignite.candles', 'core', -18, (r) => {
  const n = T(0.55);
  const x = zeros(n);
  for (let k = 0; k < 3; k++) mixAt(x, ignition(r, 0.16, 400 + 120 * k, 1700, 0.35), 0.12 * k, 0.9 - 0.12 * k);
  return done(x);
});
add('snuff', 'game', -18, (r) => {
  const n = T(0.45);
  const x = mul(hp(white(n, r), 1800), envExp(n, 0.07, 0.003));
  mixAt(x, mul(hp(pink(n, r), 900), envPoints(n, [[0, 0], [0.05, 0.6], [0.45, 0]])), 0, 0.5);
  return done(x);
});
add('autoLight', 'core', -18, (r) => done(sumMix(T(0.6), [[cloth(T(0.3), r, 700), 0.5, 0], [ignition(r, 0.26, 300, 1400, 0.4), 0.9, 0.12]])));
add('swap', 'core', -18, (r) => done(sumMix(T(0.6), [[cloth(T(0.22), r, 1100), 0.8, 0], [ignition(r, 0.26, 320, 1500, 0.4), 0.8, 0.14]])));

function sumMix(n: number, parts: Array<[Buf, number, number]>): Buf {
  const x = zeros(n);
  for (const [b, g, at] of parts) mixAt(x, b, at, g);
  return x;
}

// ---- pickups ----------------------------------------------------------------------------------------------------

add('pick.torch', 'core', -14, (r) => done(sumMix(T(0.5), [[woodHit(T(0.3), r), 1, 0], [woodHit(T(0.25), r, 380), 0.6, 0.07], [cloth(T(0.25), r, 1000), 0.35, 0]])));
add('pick.lamp', 'core', -14, (r) => {
  const x = sumMix(T(0.6), [[ceramicHit(T(0.5), r, 1300, 0.3), 1, 0], [cloth(T(0.15), r, 1400), 0.2, 0]]);
  mixAt(x, modal(T(0.1), [{ f: 3900, t60: 0.04, a: 1 }], strike(0.3, r)), 0.05, 0.5);
  return done(x);
});
add('pick.candle', 'core', -16, (r) => done(sumMix(T(0.35), [[modal(T(0.3), [{ f: 800, t60: 0.05, a: 1 }, { f: 1500, t60: 0.03, a: 0.4 }], strike(2.5, r, 0.4)), 1, 0], [cloth(T(0.2), r, 1500), 0.2, 0]])));
add('pick.oil', 'core', -14, (r) => {
  const n = T(1.2);
  const x = zeros(n);
  mixAt(x, ceramicHit(T(0.4), r, 1100, 0.3), 0, 1);
  // the glug: bursts of band-passed noise at 9 per second, falling in pitch
  const glug = zeros(n);
  for (let k = 0; k < 6; k++) {
    const b = mul(bp(white(T(0.07), r), 650 - k * 55, 6), envPoints(T(0.07), [[0, 0], [0.012, 1], [0.07, 0]]));
    mixAt(glug, b, 0.18 + k * 0.11, 0.9);
  }
  mixAt(x, normalize(glug, -3), 0, 0.7);
  // the flame swells as the oil takes
  mixAt(x, mul(lp(brown(T(0.5), r), 700), envPoints(T(0.5), [[0, 0], [0.25, 0.7], [0.5, 0]])), 0.7, 0.35);
  return done(x);
});
add('pick.treasure', 'core', -14, (r) => {
  const x = zeros(T(1.4));
  mixAt(x, ceramicHit(T(0.6), r, 2300, 0.4), 0, 0.7);
  mixAt(x, ceramicHit(T(0.6), r, 3300, 0.3), 0.07, 0.5);
  mixAt(x, goldBar(T(1.3), r, 1175, 1.0), 0.12, 0.45);
  return done(x);
});
add('bagFull', 'core', -16, (r) => done(stoneHit(T(0.3), r, 90, 260, 3, 0.09, 4)));

// ---- traps ------------------------------------------------------------------------------------------------------

add('plate.click', 'game', -14, (r) => {
  const n = T(0.9);
  const x = zeros(n);
  mixAt(x, mul(lp(grains(T(0.05), () => 1500, [1, 4], 0.7, r), 2500), envExp(T(0.05), 0.015, 0.002)), 0, 0.6);
  mixAt(x, modal(n, [{ f: 140, t60: 0.3, a: 1 }, { f: 215, t60: 0.15, a: 0.4 }], strike(3, r)), 0.02, 1);
  return done(x);
});
add('block.fall', 'game', -6, (r) => {
  const n = T(2.4);
  const x = zeros(n);
  // 0.2 s of grinding, then the impact
  const grind = resonators(stickSlip(T(0.22), (t) => 70 - 40 * t, 0.4, r), [[150, 3], [320, 4]]);
  mixAt(x, normalize(grind, -6), 0, 0.5);
  mixAt(x, mul(sweep(T(0.5), 70, 35), envExp(T(0.5), 0.14, 0.003)), 0.2, 1);
  mixAt(x, stoneHit(T(0.9), r, 90, 900, 7, 0.5, 1.2), 0.2, 0.7);
  mixAt(x, mul(lp(grains(T(1.6), (t) => 700 * Math.exp(-2 * t), [1, 4], 1, r), 3000), envExp(T(1.6), 0.5, 0.002)), 0.28, 0.35);
  return done(x);
});
add('portcullis.drop', 'game', -8, (r) => {
  const n = T(1.4);
  const x = zeros(n);
  const slide = resonators(stickSlip(T(0.4), (t) => 55 - 20 * (t / 0.4), 0.35, r), [[200, 4], [500, 4], [1100, 3]]);
  mixAt(x, normalize(slide, -6), 0, 0.5);
  mixAt(x, mul(sweep(T(0.6), 95, 40), envExp(T(0.6), 0.16, 0.003)), 0.4, 1);
  mixAt(x, stoneHit(T(0.9), r, 120, 1400, 7, 0.45, 1), 0.4, 0.8);
  mixAt(x, modal(T(1), barModes(420, 0.5, [1, 0.4, 0.2, 0.1, 0.05]), strike(0.8, r)), 0.4, 0.15);
  return done(x);
});
add('sand.fall', 'game', -12, (r) => {
  const n = T(2.6);
  const g = grains(n, (t) => 1800 + 3500 * Math.min(1, t / 1.5), [0.5, 2], 0.6, r);
  const x = svf(g, (i) => 1000 + 5000 * Math.min(1, i / SR / 1.8), 0.8, 'low');
  return done(mul(x, envPoints(n, [[0, 0], [0.4, 0.5], [1.6, 1], [2.1, 0.8], [2.6, 0]])));
});
add('trapdoor.open', 'game', -12, (r) => {
  const n = T(1.3);
  const x = zeros(n);
  const creak = resonators(stickSlip(T(0.7), (t) => 12 + 14 * t, 0.5, r), [[230, 10], [380, 9], [590, 8]]);
  mixAt(x, mul(normalize(creak, -3), envPoints(T(0.7), [[0, 0], [0.1, 1], [0.6, 0.6], [0.7, 0]])), 0, 0.6);
  mixAt(x, whoosh(T(0.6), r, 2500, 300, 0.2), 0.55, 0.7);
  return done(x);
});
add('hit', 'game', -10, (r) => {
  const n = T(0.9);
  const x = zeros(n);
  mixAt(x, mul(sweep(T(0.3), 120, 50), envExp(T(0.3), 0.08, 0.002)), 0, 0.9);
  mixAt(x, stoneHit(T(0.6), r, 120, 1000, 6, 0.3, 1.2), 0, 0.7);
  mixAt(x, mul(hp(white(T(0.3), r), 1800), envExp(T(0.3), 0.06, 0.003)), 0.04, 0.35);
  return done(x);
});

// ---- collapse ---------------------------------------------------------------------------------------------------

add('quake', 'game', -6, (r) => {
  const n = T(2.8);
  const am = wander(n, 0.5, 1.2, 9, r);
  const rumble = mul(lp4(brown(n, r), 120), (i) => am(i));
  const x = mul(rumble, envPoints(n, [[0, 0], [0.25, 1], [2.0, 0.85], [2.8, 0]]));
  normalize(x, -3);
  mixAt(x, mul(lp(grains(n, (t) => 120 * (1 - t / 3), [1, 5], 1, r), 2500), envPoints(n, [[0, 0], [0.4, 1], [2.8, 0]])), 0, 0.25);
  for (const t of [0.2, 1.0, 1.7]) mixAt(x, mul(sweep(T(0.5), 58, 30), envExp(T(0.5), 0.15, 0.004)), t, 0.8);
  return done(x);
});
add(
  'sand.pour',
  'game',
  -16,
  (r) =>
    normalize(
      makeLoop(4, 0.5, (n) => {
        const dense = lp(grains(n, () => 6000, [0.4, 1.4], 0.5, r), 4000);
        const rush = lp(brown(n, r), 300);
        normalize(dense, -6);
        normalize(rush, -9);
        return sumMix(n, [[dense, 1, 0], [rush, 0.7, 0]]);
      }),
      -3,
    ),
  { loop: true },
);
add('sealed', 'game', -10, (r) => {
  const n = T(2);
  const boom = mul(lp(sweep(T(0.7), 55, 26), 160), envExp(T(0.7), 0.25, 0.004));
  const x = zeros(n);
  mixAt(x, boom, 0, 1);
  mixAt(x, mul(lp4(brown(T(1.4), r), 140), envExp(T(1.4), 0.5, 0.05)), 0, 0.5);
  return done(x);
});

// ---- guardian ---------------------------------------------------------------------------------------------------

addVariants('g.step', 4, 'game', -14, (r) => {
  const n = T(0.7);
  const x = zeros(n);
  // dragged linen, a soft heavy foot, a resin creak
  const drag = mul(bp(white(T(0.5), r), 900 + 1000 * r(), 1.1), envPoints(T(0.5), [[0, 0], [0.18, 1], [0.5, 0]]));
  mixAt(x, normalize(drag, -9), 0, 0.9);
  mixAt(x, lp(stoneHit(T(0.35), r, 60, 300, 4, 0.12, 5), 420), 0.12, 1);
  const creak = mul(resonators(stickSlip(T(0.12), () => 95, 0.3, r), [[1200, 12]]), envExp(T(0.12), 0.04, 0.005));
  mixAt(x, normalize(creak, -9), 0.16, 0.3);
  return done(x);
});
add('g.wake', 'game', -12, (r) => {
  const n = T(1.5);
  const crack = resonators(stickSlip(n, (t) => 20 + 6 * Math.sin(t * 9), 0.7, r), [[320, 6], [900, 5]]);
  const x = mul(normalize(crack, -3), envPoints(n, [[0, 0], [0.4, 1], [1.2, 0.7], [1.5, 0]]));
  mixAt(x, mul(lp(grains(n, () => 400, [1, 4], 1, r), 3500), envPoints(n, [[0, 0], [0.3, 1], [1.5, 0]])), 0, 0.4);
  return done(x);
});
function dissonance(r: Rng, n: number, f1: number, f2: number): Buf {
  const x = zeros(n);
  for (const f0 of [f1, f2]) {
    for (let h = 1; h <= 7; h++) {
      const s = new Float32Array(n);
      const ph = r() * 6.28;
      for (let i = 0; i < n; i++) s[i] = Math.sin((2 * Math.PI * f0 * h * i) / SR + ph);
      mixAt(x, s, 0, 1 / (h * 1.3));
    }
  }
  // a bowed stone: a little rubbing noise
  mixAt(x, lp(white(n, r), 500), 0, 0.08);
  return x;
}
add('g.spotted', 'game', -10, (r) => {
  const n = T(2.2);
  const x = zeros(n);
  mixAt(x, mul(sweep(T(0.5), 80, 38), envExp(T(0.5), 0.14, 0.003)), 0, 1);
  const d = dissonance(r, n, 55, 58);
  mul(d, envPoints(n, [[0, 0], [1.2, 1], [2.2, 0]]));
  mixAt(x, normalize(d, -6), 0.1, 0.6);
  return done(x);
});
add('g.lost', 'game', -14, (r) => {
  const n = T(1.9);
  const d = dissonance(r, n, 55, 58);
  mul(d, envPoints(n, [[0, 0], [0.15, 0.9], [1.9, 0]]));
  return done(lp(d, 900));
});
add('g.touch', 'game', -10, (r) => {
  const n = T(1.0);
  const x = zeros(n);
  mixAt(x, whoosh(T(0.5), r, 3000, 400, 0.15), 0, 1);
  mixAt(x, mul(bp(white(T(0.6), r), 1200, 0.7), envPoints(T(0.6), [[0, 0], [0.1, 1], [0.6, 0]])), 0.05, 0.4);
  mixAt(x, mul(hp(white(T(0.3), r), 1800), envExp(T(0.3), 0.06, 0.003)), 0.4, 0.35);
  return done(x);
});
add('g.caught', 'game', -10, (r) => {
  const n = T(2);
  const sub = mul(sweep(n, 45, 38), envPoints(n, [[0, 0], [0.9, 1], [2, 0]]));
  const hush = mul(lp(pink(n, r), 1200), envPoints(n, [[0, 0], [1.1, 0.6], [2, 0]]));
  return done(sumMix(n, [[sub, 1, 0], [hush, 0.3, 0]]));
});
add('g.follow', 'game', -16, (r) => {
  // three slow steps on stone stairs, with their own long tail (baked distance)
  const dry = zeros(T(2.2));
  for (let k = 0; k < 3; k++) mixAt(dry, stoneHit(T(0.4), r, 110, 700, 6, 0.1, 3), 0.1 + 0.62 * k, 0.9 - 0.12 * k);
  const ir = roomIr(1.4, 1.2, 4000, 700, r);
  const wet = convolve(dry, ir);
  const x = zeros(T(2.2));
  mixAt(x, lp(wet.subarray(0, x.length) as Buf, 2500), 0, 0.5);
  mixAt(x, lp(dry, 1200), 0, 0.15);
  return done(x);
});
add('g.gone', 'game', -18, (r) => {
  const n = T(1.0);
  const x = lp(stoneHit(n, r, 50, 200, 3, 0.3, 6), 260);
  mixAt(x, mul(lp(grains(T(0.7), () => 300, [2, 6], 1, r), 900), envExp(T(0.7), 0.2, 0.01)), 0.02, 0.3);
  return done(x);
});
add(
  'g.dread',
  'game',
  -20,
  (r) =>
    normalize(
      makeLoop(6, 0.6, (n) => {
        // a breath-like pulsing sub (38 Hz and a little of its octave) and faint linen rustles; no melody
        const x = zeros(n);
        for (let i = 0; i < n; i++) {
          const t = i / SR;
          const am = 0.55 + 0.45 * Math.sin(2 * Math.PI * (t / 3) - 1.2);
          x[i] = (Math.sin(2 * Math.PI * 38 * t) + 0.25 * Math.sin(2 * Math.PI * 76 * t + 0.7)) * am;
        }
        const rustle = mul(bp(grains(n, () => 14, [4, 14], 0.8, r), 1800, 0.8), (i) => 0.5 + 0.5 * Math.sin((i / SR) * 1.1));
        normalize(rustle, -22);
        mixAt(x, rustle, 0, 1);
        return x;
      }),
      -3,
    ),
  { loop: true },
);

// ---- escape -----------------------------------------------------------------------------------------------------

add('artifact.lift', 'game', -10, (r) => {
  const n = T(3);
  const x = zeros(n);
  mixAt(x, goldBar(n, r, 293.66, 2.5), 0, 0.8);
  const groan = resonators(stickSlip(T(2.2), (t) => 40 + 30 * Math.min(1, t / 1.5), 0.6, r), [[60, 8], [120, 8], [240, 6]]);
  mixAt(x, mul(normalize(groan, -6), envPoints(T(2.2), [[0, 0], [0.5, 1], [2.2, 0]])), 0, 0.7);
  return done(x);
});
add('exit.grind', 'game', -10, (r) => {
  const n = T(1.5);
  const slab = resonators(stickSlip(n, (t) => 70 - 42 * (t / 1.5), 0.4, r), [[90, 5], [180, 5], [400, 4]]);
  const x = mul(normalize(slab, -3), envPoints(n, [[0, 0], [0.12, 1], [1.3, 0.8], [1.5, 0]]));
  mixAt(x, mul(lp(grains(n, () => 500, [1, 4], 1, r), 2500), envPoints(n, [[0, 0], [0.2, 1], [1.5, 0]])), 0, 0.25);
  return done(x);
});
add(
  'exit.air',
  'game',
  -22,
  (r) =>
    normalize(
      makeLoop(5, 0.6, (n) => {
        // cool wind in a shaft: pink noise through two wandering resonant bands
        const w1 = wander(n, 400, 600, 0.6, r);
        const w2 = wander(n, 1000, 1400, 0.5, r);
        const p = pink(n, r);
        const a = svf(p, w1, 5, 'band');
        const b = svf(p, w2, 5, 'band');
        return sumMix(n, [[a, 1, 0], [b, 0.7, 0]]);
      }),
      -3,
    ),
  { loop: true },
);
add('escape.out', 'game', -14, (r) => {
  const n = T(3.5);
  const x = zeros(n);
  const w = wander(n, 600, 1500, 0.8, r);
  const air = mul(svf(pink(n, r), w, 3, 'band'), envPoints(n, [[0, 0.1], [1.8, 1], [3.5, 0.4]]));
  mixAt(x, normalize(air, -6), 0, 1);
  // a warm D minor 9 pad (D3 F3 A3 C4 E4), soft and slow
  const pad = zeros(n);
  for (const f of [146.83, 174.61, 220, 261.63, 329.63]) {
    for (const d of [-0.8, 0.8]) {
      const s = new Float32Array(n);
      for (let i = 0; i < n; i++) s[i] = Math.sin((2 * Math.PI * (f + d) * i) / SR);
      mixAt(pad, s, 0, 1);
    }
  }
  mul(pad, envPoints(n, [[0, 0], [1.6, 0.7], [2.6, 1], [3.5, 0]]));
  normalize(pad, -12);
  mixAt(x, lp(pad, 1500), 0, 0.5);
  return done(x);
});

// ---- secrets ----------------------------------------------------------------------------------------------------

add('seal.knock', 'game', -14, (r) => {
  const n = T(0.45);
  const x = modal(n, [{ f: 180, t60: 0.13, a: 1 }, { f: 330, t60: 0.06, a: 0.35 }], strike(2.5, r));
  mixAt(x, modal(T(0.2), [{ f: 700, t60: 0.04, a: 1 }, { f: 1100, t60: 0.03, a: 0.5 }], strike(1.2, r)), 0, 0.4);
  mixAt(x, mul(lp(white(T(0.03), r), 800), envExp(T(0.03), 0.008, 0.001)), 0, 0.5);
  return done(x);
});
add('seal.break', 'game', -12, (r) => {
  const n = T(0.9);
  const crumble = mul(lp(grains(n, (t) => 900 * Math.exp(-1.4 * t) + 80, [0.6, 3], 0.9, r), 3500), envPoints(n, [[0, 0], [0.04, 1], [0.7, 0.4], [0.9, 0]]));
  const x = crumble;
  for (const [t, f] of [[0.18, 160], [0.33, 130], [0.5, 190]] as const) mixAt(x, modal(T(0.2), [{ f, t60: 0.1, a: 1 }], strike(3, r)), t, 0.4);
  return done(x);
});
add('seal.open', 'game', -16, (r) => {
  const n = T(1.1);
  const x = mul(svf(pink(n, r), (i) => 600 + 1400 * Math.min(1, i / (SR * 0.5)), 0.8, 'low'), envPoints(n, [[0, 0], [0.18, 1], [0.6, 0.5], [1.1, 0]]));
  mixAt(x, mul(lp(grains(n, () => 120, [1, 4], 1, r), 2500), envExp(n, 0.3, 0.01)), 0, 0.2);
  return done(x);
});
add(
  'seal.draught',
  'game',
  -24,
  (r) =>
    normalize(
      makeLoop(4, 0.5, (n) => {
        // a faint whistle through a hairline gap and moving air
        const f = wander(n, 1020, 1180, 0.7, r);
        const whistle = svf(white(n, r), f, 9, 'band');
        const air = lp(pink(n, r), 900);
        normalize(whistle, -6);
        normalize(air, -14);
        return sumMix(n, [[whistle, 1, 0], [air, 1, 0]]);
      }),
      -3,
    ),
  { loop: true },
);
add('fragment', 'game', -16, (r) => done(goldBar(T(3), r, 110, 3.2)));

// ---- stars and overview -----------------------------------------------------------------------------------------

[293.66, 349.23, 440].forEach((f, k) => add(`star.${k + 1}`, 'game', -14, (r) => done(goldBar(T(1.4), r, f, 1.2))));
add('newBest', 'game', -16, (r) => done(goldBar(T(1.0), r, 587.33, 0.8)));
add('descend', 'game', -14, (r) => {
  const n = T(1.6);
  const x = zeros(n);
  for (let k = 0; k < 4; k++) mixAt(x, lp(stoneHit(T(0.3), r, 120, 700, 5, 0.1, 3), 1800 - 300 * k), 0.12 + 0.3 * k, 0.9 - 0.18 * k);
  mixAt(x, whoosh(n, r, 2400, 400, 0.4), 0, 0.25);
  return done(x);
});
add('fall', 'game', -12, (r) => {
  const n = T(1.3);
  const x = zeros(n);
  mixAt(x, whoosh(T(0.9), r, 3000, 300, 0.3), 0, 0.7);
  mixAt(x, lp(grains(T(0.25), () => 3000, [1, 4], 0.7, r), 900), 0.82, 0.4);
  mixAt(x, lp(stoneHit(T(0.4), r, 70, 220, 3, 0.15, 5), 300), 0.82, 1);
  return done(x);
});

// ---- UI ---------------------------------------------------------------------------------------------------------

add('ui.tap', 'core', -20, (r) => done(modal(T(0.12), [{ f: 1800, t60: 0.02, a: 1 }, { f: 2700, t60: 0.015, a: 0.5 }], strike(0.4, r)), -3));
add('ui.toggle', 'core', -20, (r) => done(sumMix(T(0.2), [[modal(T(0.1), [{ f: 1500, t60: 0.025, a: 1 }], strike(0.4, r)), 1, 0], [modal(T(0.1), [{ f: 2100, t60: 0.025, a: 1 }], strike(0.4, r)), 0.8, 0.07]])));
add('ui.back', 'core', -20, (r) => done(modal(T(0.14), [{ f: 1100, t60: 0.03, a: 1 }, { f: 1650, t60: 0.02, a: 0.4 }], strike(0.5, r))));
add('ui.panel', 'core', -22, (r) => done(mul(bp(white(T(0.2), r), 2000, 0.9), envPoints(T(0.2), [[0, 0], [0.07, 1], [0.2, 0]]))));
add('ui.seal', 'core', -14, (r) => {
  const x = zeros(T(0.9));
  mixAt(x, stoneHit(T(0.5), r, 120, 500, 5, 0.2, 2), 0, 1);
  mixAt(x, modal(T(0.9), [{ f: 784, t60: 0.6, a: 1 }, { f: 784 * 2.76, t60: 0.3, a: 0.4 }], strike(0.6, r)), 0.03, 0.45);
  return done(x);
});

// ---- ambience ---------------------------------------------------------------------------------------------------

add(
  'bed.egypt.room',
  'bed:egypt',
  -30,
  (r) =>
    normalize(
      makeLoop(20, 2, (n) => {
        // the pressure of a deep room: brown noise with slow drift and a 45 Hz tone
        const drift = wander(n, 90, 220, 0.15, r);
        const x = svf(brown(n, r), drift, 0.8, 'low');
        normalize(x, -6);
        const tone = new Float32Array(n);
        for (let i = 0; i < n; i++) tone[i] = Math.sin((2 * Math.PI * 45 * i) / SR) * (0.6 + 0.4 * Math.sin((2 * Math.PI * i) / SR / 12));
        return sumMix(n, [[x, 1, 0], [tone, 0.15, 0]]);
      }),
      -3,
    ),
  { loop: true, kbps: 48 },
);
add(
  'bed.egypt.air',
  'bed:egypt',
  -32,
  (r) =>
    normalize(
      makeLoop(17, 2, (n) => {
        // wind in the air shafts: pink noise through two wandering band-passes
        const p = pink(n, r);
        const a = svf(p, wander(n, 300, 700, 0.12, r), 2.5, 'band');
        const b = svf(p, wander(n, 500, 900, 0.09, r), 2.2, 'band');
        const gust = wander(n, 0.4, 1, 0.1, r);
        return mul(sumMix(n, [[a, 1, 0], [b, 0.8, 0]]), (i) => gust(i));
      }),
      -3,
    ),
  { loop: true, kbps: 48 },
);
addVariants('spot.egypt.settle', 4, 'bed:egypt', -28, (r) => {
  const n = T(1.1);
  const x = zeros(n);
  const ticks = 2 + Math.floor(r() * 3);
  for (let k = 0; k < ticks; k++) mixAt(x, stoneHit(T(0.2), r, 200, 1100, 4, 0.05, 1), 0.05 + 0.28 * k * r() + 0.05 * k, 0.5 + 0.5 * r());
  const creak = mul(resonators(stickSlip(T(0.3), () => 25 + 20 * r(), 0.5, r), [[260 + 200 * r(), 12]]), envPoints(T(0.3), [[0, 0], [0.1, 1], [0.3, 0]]));
  mixAt(x, normalize(creak, -9), 0.1, 0.35);
  return done(x);
});
addVariants('spot.egypt.trickle', 3, 'bed:egypt', -28, (r) => {
  const n = T(1.3);
  const x = mul(lp(grains(n, (t) => 260 * Math.exp(-1.6 * t) + 20, [0.5, 1.6], 0.6, r), 5200), envPoints(n, [[0, 0], [0.05, 1], [1.3, 0]]));
  for (let k = 0; k < 3; k++) mixAt(x, modal(T(0.1), [{ f: 2400 + 900 * r(), t60: 0.03, a: 1 }], strike(0.3, r)), 0.15 + 0.35 * k * r() + 0.1 * k, 0.3);
  return done(x);
});
add(
  'bed.exterior',
  'bed:exterior',
  -30,
  (r) =>
    normalize(
      makeLoop(20, 2, (n) => {
        // night desert wind with sparse gusts
        const p = pink(n, r);
        const w = svf(p, wander(n, 250, 800, 0.1, r), 1.1, 'low');
        const gust = wander(n, 0.15, 1, 0.07, r);
        const body = mul(w, (i) => gust(i) ** 1.5);
        const hiss = mul(hp(lp(white(n, r), 3800), 1500), (i) => 0.05 * gust(i) ** 3);
        return sumMix(n, [[body, 1, 0], [hiss, 1, 0]]);
      }),
      -3,
    ),
  { loop: true, kbps: 48 },
);

// ---- impulse responses --------------------------------------------------------------------------------------------

out({
  id: 'ir.small',
  group: 'core',
  level: 0,
  stereo: true,
  kbps: 96,
  render: () => {
    const r = rng('ir.small');
    return [roomIr(0.9, 0.7, 9000, 2500, r), roomIr(0.9, 0.7, 9000, 2500, r)];
  },
});
out({
  id: 'ir.large',
  group: 'core',
  level: 0,
  stereo: true,
  kbps: 96,
  render: () => {
    const r = rng('ir.large');
    return [roomIr(2.4, 2.0, 9000, 1200, r), roomIr(2.4, 2.0, 9000, 1200, r)];
  },
});

void [BAR_RATIOS, biquad, gain, zeros, sec, wander, brown, bp, hp, lp, lp4, svf, db, white, pink];
