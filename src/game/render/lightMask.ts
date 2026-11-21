import { AlphaType, ColorType, Skia, type SkImage } from '@shopify/react-native-skia';

import type { GameState } from '../core/game';
import { MEMORY_SEEN, MEMORY_WALKED, memoryLevel } from '../core/memory';

/**
 * Per-frame light as a small image: 2x2 pixels per tile, alpha = brightness. The baked
 * floor is multiplied by it (DstIn) with linear filtering, which gives soft light edges.
 * Wall tiles take, per half tile, the light of the open tile they face, so a wall is lit
 * from the player's side only and nothing behind it is revealed (walls are 1+ tiles thick).
 *
 * Only a window of the floor is rendered (the view plus a margin), so the cost stays constant on
 * 60-tile floors. The tiles that enter the window sit in its margin, off screen.
 *
 * Brightness per tile = max(hand light x flicker, visible fixed lights, memory). Memory fades
 * by the continuous age (moves + step progress), and the whole value cross-fades from the
 * previous step's, so light slides with the player instead of jumping a tile.
 */
/** A window of tiles: top-left tile and size. */
export type MaskWindow = { x0: number; y0: number; w: number; h: number };

export type MaskImage = { image: SkImage; x0: number; y0: number; w: number; h: number };

export type LightMask = {
  /**
   * A fresh image of the current light over `win` (2x2 pixels per tile); older ones are disposed a
   * few frames later. `t` = step progress 0..1; flickers multiply the hand light and the fixed lights.
   */
  render: (s: GameState, t: number, handFlicker: number, fixedFlicker: number, win: MaskWindow) => MaskImage | null;
  dispose: () => void;
};

const ease = (t: number) => t * t * (3 - 2 * t);

export function createLightMask(size: number): LightMask {
  const data = new Uint8Array(size * 2 * size * 2 * 4);
  const cur = new Float32Array(size * size);
  const prev = new Float32Array(size * size);
  const shown = new Float32Array(size * size);
  const ring: SkImage[] = [];
  let lastTrail = -1;
  let lastFloor: unknown = null;

  const render = (s: GameState, t: number, handF: number, fixedF: number, win: MaskWindow): MaskImage | null => {
    const { opaque } = s.grid;
    if (lastFloor !== s.floor) {
      lastFloor = s.floor;
      lastTrail = s.trail;
      prev.fill(0);
      shown.fill(0);
    } else if (s.trail !== lastTrail) {
      // a step was taken: the next frames fade from what is on screen now
      prev.set(shown);
      lastTrail = s.trail;
    }
    const x0 = Math.max(0, win.x0);
    const y0 = Math.max(0, win.y0);
    const x1 = Math.min(size, win.x0 + win.w);
    const y1 = Math.min(size, win.y0 + win.h);
    const w = x1 - x0;
    const h = y1 - y0;
    if (w <= 0 || h <= 0) return null;
    const px = w * 2;
    const k = ease(Math.min(1, Math.max(0, t)));
    // age of a stamp in moves, continuous while the step plays out
    const clock = s.trail - 1 + Math.min(1, Math.max(0, t));
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = y * size + x;
        if (opaque[i]) {
          // an opaque tile is lit through its open neighbours below; keep its own value at 0
          cur[i] = 0;
          shown[i] = 0;
          continue;
        }
        let v = Math.max(s.lightHand[i] * handF, s.lightSeen[i] * fixedF);
        const seen = s.seenAt[i];
        if (seen >= 0 && v < MEMORY_WALKED) {
          const walked = s.walkedAt[i];
          const m = Math.max(memoryLevel(clock - seen) * MEMORY_SEEN, walked >= 0 ? memoryLevel(clock - walked) * MEMORY_WALKED : 0);
          if (m > v) v = m;
        }
        cur[i] = v;
        shown[i] = prev[i] + (v - prev[i]) * k;
      }
    const open = (x: number, y: number) => (x < 0 || y < 0 || x >= size || y >= size || opaque[y * size + x] ? 0 : shown[y * size + x]);
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = y * size + x;
        let a = 0;
        let b = 0;
        let c = 0;
        let d = 0;
        if (opaque[i]) {
          const n = open(x, y - 1);
          const so = open(x, y + 1);
          const we = open(x - 1, y);
          const e = open(x + 1, y);
          a = Math.max(n, we);
          b = Math.max(n, e);
          c = Math.max(so, we);
          d = Math.max(so, e);
        } else a = b = c = d = shown[i];
        const lx = x - x0;
        const ly = y - y0;
        put(data, (2 * ly * px + 2 * lx) * 4, a);
        put(data, (2 * ly * px + 2 * lx + 1) * 4, b);
        put(data, ((2 * ly + 1) * px + 2 * lx) * 4, c);
        put(data, ((2 * ly + 1) * px + 2 * lx + 1) * 4, d);
      }
    const info = { width: px, height: h * 2, alphaType: AlphaType.Premul, colorType: ColorType.RGBA_8888 };
    const image = Skia.Image.MakeImage(info, Skia.Data.fromBytes(data.subarray(0, px * h * 2 * 4)), px * 4);
    if (!image) return null;
    ring.push(image);
    // the picture of the last frame may still be drawing: keep a few
    while (ring.length > 4) ring.shift()?.dispose();
    return { image, x0, y0, w, h };
  };

  return {
    render,
    dispose: () => {
      while (ring.length) ring.shift()?.dispose();
    },
  };
}

function put(data: Uint8Array, at: number, v: number) {
  const a = Math.max(0, Math.min(255, Math.round(v * 255)));
  data[at] = a;
  data[at + 1] = a;
  data[at + 2] = a;
  data[at + 3] = a;
}
