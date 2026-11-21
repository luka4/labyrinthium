import { SR, biquad, normalize, sec, svf, white, type Buf, type Rng } from './dsp';

/** Radix-2 complex FFT in place (doubles). */
export function fft(re: Float64Array, im: Float64Array, inverse: boolean) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

/** Linear convolution by FFT (x length + ir length - 1 samples). */
export function convolve(x: Buf, ir: Buf): Buf {
  const need = x.length + ir.length - 1;
  let n = 1;
  while (n < need) n <<= 1;
  const ar = new Float64Array(n);
  const ai = new Float64Array(n);
  const br = new Float64Array(n);
  const bi = new Float64Array(n);
  ar.set(x);
  br.set(ir);
  fft(ar, ai, false);
  fft(br, bi, false);
  for (let i = 0; i < n; i++) {
    const r = ar[i] * br[i] - ai[i] * bi[i];
    const im = ar[i] * bi[i] + ai[i] * br[i];
    ar[i] = r;
    ai[i] = im;
  }
  fft(ar, ai, true);
  const out = new Float32Array(need);
  for (let i = 0; i < need; i++) out[i] = ar[i];
  return out;
}

/**
 * A room impulse response: decorrelated exponentially decaying noise whose highs die faster than its
 * lows (a time-varying low-pass from `hiHz` to `loHz`), six early reflections between 7 and 35 ms, and a
 * limestone shelf (-3 dB above 4 kHz). Mono; call twice with different seeds for stereo.
 */
export function roomIr(seconds: number, t60: number, hiHz: number, loHz: number, r: Rng): Buf {
  const n = sec(seconds);
  const noise = white(n, r);
  const tail = svf(noise, (i) => hiHz * Math.pow(loHz / hiHz, Math.min(1, i / (n * 0.9))), 0.7, 'low');
  for (let i = 0; i < n; i++) tail[i] *= Math.exp((-6.9078 * i) / SR / t60) * Math.min(1, i / sec(0.004));
  for (let k = 0; k < 6; k++) {
    const at = sec(0.007 + 0.028 * ((k + r() * 0.6) / 6));
    tail[at] += (r() < 0.5 ? -1 : 1) * (0.9 - 0.1 * k) * 4;
  }
  return normalize(biquad(tail, 'highshelf', 4000, 0.7, -3), -3);
}
