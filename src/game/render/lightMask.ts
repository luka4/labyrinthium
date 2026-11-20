import { AlphaType, ColorType, Skia, type SkImage } from '@shopify/react-native-skia';

import type { GameState } from '../core/game';

/** Brightness of tiles you have seen (and walked) but that the torch does not reach now. */
export const MEMORY_SEEN = 0.13;
export const MEMORY_WALKED = 0.3;

/**
 * Per-frame light as a small image: 2x2 pixels per tile, alpha = brightness. The baked
 * floor is multiplied by it (DstIn) with linear filtering, which gives soft light edges.
 * Wall tiles take, per half tile, the light of the open tile they face, so a wall is lit
 * from the player's side only and nothing behind it is revealed (walls are 1+ tiles thick).
 */
export type LightMask = {
  /** pixels per side */
  px: number;
  /** a fresh image of the current light; older ones are disposed a few frames later */
  render: (s: GameState, flicker: number) => SkImage | null;
  dispose: () => void;
};

export function createLightMask(size: number): LightMask {
  const px = size * 2;
  const data = new Uint8Array(px * px * 4);
  const value = new Float32Array(size * size);
  const ring: SkImage[] = [];
  const info = { width: px, height: px, alphaType: AlphaType.Premul, colorType: ColorType.RGBA_8888 };

  const render = (s: GameState, flicker: number): SkImage | null => {
    const { opaque } = s.floor;
    for (let i = 0; i < value.length; i++) {
      if (opaque[i]) continue;
      const memory = s.seen[i] ? (s.walked[i] ? MEMORY_WALKED : MEMORY_SEEN) : 0;
      value[i] = Math.max(s.light[i] * flicker, memory);
    }
    const open = (x: number, y: number) => (x < 0 || y < 0 || x >= size || y >= size || opaque[y * size + x] ? 0 : value[y * size + x]);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        let a = 0;
        let b = 0;
        let c = 0;
        let d = 0;
        if (opaque[i]) {
          const n = open(x, y - 1);
          const so = open(x, y + 1);
          const w = open(x - 1, y);
          const e = open(x + 1, y);
          a = Math.max(n, w);
          b = Math.max(n, e);
          c = Math.max(so, w);
          d = Math.max(so, e);
        } else a = b = c = d = value[i];
        put(data, (2 * y * px + 2 * x) * 4, a);
        put(data, (2 * y * px + 2 * x + 1) * 4, b);
        put(data, ((2 * y + 1) * px + 2 * x) * 4, c);
        put(data, ((2 * y + 1) * px + 2 * x + 1) * 4, d);
      }
    const image = Skia.Image.MakeImage(info, Skia.Data.fromBytes(data), px * 4);
    if (!image) return null;
    ring.push(image);
    // the picture of the last frame may still be drawing: keep a few
    while (ring.length > 4) ring.shift()?.dispose();
    return image;
  };

  return {
    px,
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
