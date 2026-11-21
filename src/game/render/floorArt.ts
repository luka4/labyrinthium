import { ClipOp, FilterMode, MipmapMode, Skia, TileMode, type SkCanvas, type SkImage, type SkPicture, type SkSurface } from '@shopify/react-native-skia';

import { TILE, type Floor, type RoomKind, type Trap } from '../core/floor';
import { fill, hash01, paint, rgba, stroke } from './art';
import type { FloorTheme } from './themes';

/**
 * A floor's architecture as art. Everything is derived from the tile grid and the room list:
 * thick walls with a 3/4 oblique view (south-facing faces with ashlar joints, caps on top),
 * paving laid per room (never per tile), pillars, benches, doors, niches, stairs, and the
 * telltales of the traps. The drawing is recorded once into an SkPicture (with bounds, so native
 * Skia keeps an RTree) under the between-floors overview; the board shows it in 8x8-tile chunks,
 * each rasterised from the picture on demand and kept in a byte-bounded LRU. Floors of any size
 * stay sharp (the old single image was capped at 2048 px). Per frame the game draws a few chunk
 * images, a light mask and a few sprites.
 */

/** Share of a wall tile's height taken by the south-facing face; the cap is the rest. */
const FACE = 0.55;
const CAP_H = 1 - FACE;

/** Tiles per chunk side, and real neighbouring pixels kept around each chunk image. */
export const CHUNK = 8;
const PAD = 2;
/** Chunk cache budget in bytes. */
const CACHE_BYTES = 16 * 1024 * 1024;
const MIN_CHUNKS = 12;
/** Evicted images are disposed this many `ensure` calls later: a recorded frame may still draw them. */
const RETIRE_AFTER = 4;

/** The tiles in view, inclusive. */
export type TileWindow = { x0: number; y0: number; x1: number; y1: number };

export type FloorArt = {
  /** pixels per tile of the chunk images */
  px: number;
  /** rasterises the chunks the window needs (always) and prefetches the next ones while within `budgetMs` */
  ensure: (win: TileWindow, budgetMs: number) => void;
  /** draws the chunks of the window; `t` = screen units per tile; the canvas is in world units * t */
  draw: (canvas: SkCanvas, win: TileWindow, t: number) => void;
  /** chunks rasterised so far (tests, tuning) */
  stats: () => { built: number; cached: number; capacity: number };
  dispose: () => void;
};

type Rect = { x: number; y: number; width: number; height: number };
const R = (x: number, y: number, w: number, h: number): Rect => ({ x, y, width: w, height: h });

function gradient(x0: number, y0: number, x1: number, y1: number, c0: Float32Array, c1: Float32Array) {
  paint.setPathEffect(null);
  paint.setColor(rgba('#ffffff'));
  paint.setShader(Skia.Shader.MakeLinearGradient({ x: x0, y: y0 }, { x: x1, y: y1 }, [c0, c1], null, TileMode.Clamp));
  return paint;
}

/** [row height, slab length, stagger] in tiles: how paving is laid in each kind of room. */
const SLABS: Record<RoomKind, [number, number, boolean]> = {
  passage: [1, 1.5, false],
  chamber: [1, 1.5, true],
  hall: [2, 2, false],
  gallery: [1, 1, false],
  magazines: [1, 1.5, false],
  shrine: [1, 1, true],
  antechamber: [1.5, 1.5, false],
  stairsUp: [1, 1.5, true],
  stairsDown: [1, 1.5, true],
  burial: [1.5, 1.5, false],
};

export function createFloorArt(floor: Floor, theme: FloorTheme, px: number): FloorArt {
  const { size } = floor;
  const W = size * px;
  const picture = recordFloor(floor, theme, px);
  const nc = Math.ceil(size / CHUNK);
  const side = CHUNK * px + 2 * PAD;
  const capacity = Math.max(MIN_CHUNKS, Math.floor(CACHE_BYTES / (side * side * 4)));
  const cache = new Map<number, { image: SkImage; used: number }>();
  const retired: Array<{ image: SkImage; at: number }> = [];
  let surface: SkSurface | null = null;
  let tick = 0;
  let built = 0;
  let lastCx = 0;
  let lastCy = 0;
  let moveX = 0;
  let moveY = 0;

  const key = (cx: number, cy: number) => cy * nc + cx;

  const raster = (cx: number, cy: number): SkImage | null => {
    surface ??= Skia.Surface.Make(side, side);
    if (!surface) return null;
    const c = surface.getCanvas();
    c.clear(Float32Array.of(0, 0, 0, 0));
    c.save();
    c.translate(PAD - cx * CHUNK * px, PAD - cy * CHUNK * px);
    c.clipRect(R(cx * CHUNK * px - PAD, cy * CHUNK * px - PAD, side, side), ClipOp.Intersect, false);
    c.drawPicture(picture);
    c.restore();
    surface.flush();
    built++;
    return surface.makeImageSnapshot();
  };

  const evict = () => {
    while (cache.size > capacity) {
      let oldest = -1;
      let at = Infinity;
      for (const [k, v] of cache) if (v.used < at) (at = v.used), (oldest = k);
      // never throw out what the last `ensure` asked for
      if (oldest < 0 || at >= tick) break;
      retired.push({ image: cache.get(oldest)!.image, at: tick });
      cache.delete(oldest);
    }
  };

  return {
    px,
    ensure(win, budgetMs) {
      tick++;
      const start = performance.now();
      while (retired.length && tick - retired[0].at >= RETIRE_AFTER) retired.shift()?.image.dispose();
      const cx0 = Math.max(0, Math.floor(win.x0 / CHUNK));
      const cy0 = Math.max(0, Math.floor(win.y0 / CHUNK));
      const cx1 = Math.min(nc - 1, Math.floor(win.x1 / CHUNK));
      const cy1 = Math.min(nc - 1, Math.floor(win.y1 / CHUNK));
      for (let cy = cy0; cy <= cy1; cy++)
        for (let cx = cx0; cx <= cx1; cx++) {
          const k = key(cx, cy);
          const hit = cache.get(k);
          if (hit) hit.used = tick;
          else {
            const image = raster(cx, cy);
            if (image) cache.set(k, { image, used: tick });
          }
        }
      // the camera's motion, in chunks, decides which ring to prefetch
      const ccx = (cx0 + cx1) / 2;
      const ccy = (cy0 + cy1) / 2;
      if (ccx !== lastCx) moveX = Math.sign(ccx - lastCx);
      if (ccy !== lastCy) moveY = Math.sign(ccy - lastCy);
      lastCx = ccx;
      lastCy = ccy;
      const want: Array<[number, number]> = [];
      if (moveX) for (let cy = cy0; cy <= cy1; cy++) want.push([moveX > 0 ? cx1 + 1 : cx0 - 1, cy]);
      if (moveY) for (let cx = cx0; cx <= cx1; cx++) want.push([cx, moveY > 0 ? cy1 + 1 : cy0 - 1]);
      if (!moveX && !moveY) {
        for (let cy = cy0; cy <= cy1; cy++) want.push([cx0 - 1, cy], [cx1 + 1, cy]);
        for (let cx = cx0; cx <= cx1; cx++) want.push([cx, cy0 - 1], [cx, cy1 + 1]);
      }
      for (const [cx, cy] of want) {
        if (performance.now() - start >= budgetMs) break;
        if (cx < 0 || cy < 0 || cx >= nc || cy >= nc || cache.has(key(cx, cy))) continue;
        const image = raster(cx, cy);
        if (image) cache.set(key(cx, cy), { image, used: tick - 0.5 });
      }
      evict();
    },
    draw(canvas, win, t) {
      const cx0 = Math.max(0, Math.floor(win.x0 / CHUNK));
      const cy0 = Math.max(0, Math.floor(win.y0 / CHUNK));
      const cx1 = Math.min(nc - 1, Math.floor(win.x1 / CHUNK));
      const cy1 = Math.min(nc - 1, Math.floor(win.y1 / CHUNK));
      const k = t / px;
      for (let cy = cy0; cy <= cy1; cy++)
        for (let cx = cx0; cx <= cx1; cx++) {
          const hit = cache.get(key(cx, cy));
          if (!hit) continue;
          // the whole image, padding included: the padding is real neighbouring art, so the chunks overlap invisibly
          canvas.drawImageRectOptions(hit.image, R(0, 0, side, side), R((cx * CHUNK * px - PAD) * k, (cy * CHUNK * px - PAD) * k, side * k, side * k), FilterMode.Linear, MipmapMode.None);
        }
    },
    stats: () => ({ built, cached: cache.size, capacity }),
    dispose() {
      for (const v of cache.values()) v.image.dispose();
      cache.clear();
      for (const r of retired) r.image.dispose();
      retired.length = 0;
      surface?.dispose?.();
      surface = null;
      void W;
    },
  };
}

/** Records the whole floor's drawing once. With a bounds rect the native recorder keeps an RTree. */
function recordFloor(floor: Floor, theme: FloorTheme, px: number): SkPicture {
  const { size, tiles } = floor;
  const W = size * px;
  const recorder = Skia.PictureRecorder();
  const c = recorder.beginRecording(R(0, 0, W, W));
  c.drawColor(rgba(theme.rock));

  const kindAt = (x: number, y: number): number => (x < 0 || y < 0 || x >= size || y >= size ? TILE.ROCK : tiles[y * size + x]);
  const rockAt = (x: number, y: number) => kindAt(x, y) === TILE.ROCK;
  const near = (x: number, y: number) => {
    if (!rockAt(x, y)) return false;
    return !rockAt(x - 1, y) || !rockAt(x + 1, y) || !rockAt(x, y - 1) || !rockAt(x, y + 1);
  };
  const roomKindAt = (x: number, y: number): RoomKind | null => {
    if (x < 0 || y < 0 || x >= size || y >= size) return null;
    const r = floor.room[y * size + x];
    return r >= 0 ? floor.rooms[r].kind : null;
  };
  const line = Math.max(1, px * 0.045);

  drawMasonry(c);
  drawPaving(c);
  drawContactShadows(c);
  drawObjects(c);
  drawTelltales(c);

  return recorder.finishRecordingAsPicture();

  // ---------------------------------------------------------------- walls
  /**
   * Walls band by band (CHUNK rows): the joint and edge strokes are flushed per band, so each
   * recorded op stays local and the picture's RTree can skip it when a chunk is rasterised.
   */
  function drawMasonry(canvas: SkCanvas) {
    for (let band = 0; band * CHUNK < size; band++) {
      const yFrom = band * CHUNK;
      const yTo = Math.min(size, yFrom + CHUNK);
      const capLines = Skia.PathBuilder.Make();
      const capEdges = Skia.PathBuilder.Make();
      const faceJoints = Skia.PathBuilder.Make();
      const faceEdges = Skia.PathBuilder.Make();

      // wall tops, row by row in runs
      for (let y = yFrom; y < yTo; y++) {
        let x = 0;
        while (x < size) {
          if (!near(x, y)) {
            x++;
            continue;
          }
          const x0 = x;
          while (x < size && near(x, y)) x++;
          canvas.drawRect(R(x0 * px, y * px, (x - x0) * px, px), fill(rgba(theme.cap)));
        }
      }
      for (let y = yFrom; y < yTo; y++)
        for (let x = 0; x < size; x++) {
          if (!near(x, y)) continue;
          const face = !rockAt(x, y + 1) && y + 1 < size;
          if (!face) {
            // faint masonry courses on the flat top; staggered joints
            const yy = (y + 0.5) * px;
            capLines.moveTo(x * px, yy).lineTo((x + 1) * px, yy);
            const jx = (x + (hash01(x * 31 + y * 17) > 0.5 ? 0.3 : 0.7)) * px;
            capLines.moveTo(jx, y * px).lineTo(jx, yy);
            const kx = (x + (hash01(x * 13 + y * 29) > 0.5 ? 0.2 : 0.8)) * px;
            capLines.moveTo(kx, yy).lineTo(kx, (y + 1) * px);
          }
          // bright edge where the top meets open floor (west, east, north)
          if (!rockAt(x - 1, y) && x > 0) capEdges.moveTo(x * px + line * 0.5, y * px).lineTo(x * px + line * 0.5, (y + 1) * px);
          if (!rockAt(x + 1, y) && x + 1 < size) capEdges.moveTo((x + 1) * px - line * 0.5, y * px).lineTo((x + 1) * px - line * 0.5, (y + 1) * px);
          if (!rockAt(x, y - 1) && y > 0) capEdges.moveTo(x * px, y * px + line * 0.5).lineTo((x + 1) * px, y * px + line * 0.5);
        }

      // south-facing faces, merged along each wall run
      for (let y = yFrom; y < Math.min(size - 1, yTo); y++) {
        let x = 0;
        while (x < size) {
          if (!(rockAt(x, y) && !rockAt(x, y + 1))) {
            x++;
            continue;
          }
          const x0 = x;
          while (x < size && rockAt(x, y) && !rockAt(x, y + 1)) x++;
          const fy = (y + CAP_H) * px;
          const fh = FACE * px;
          const fx = x0 * px;
          const fw = (x - x0) * px;
          canvas.drawRect(R(fx, fy, fw, fh), gradient(0, fy, 0, fy + fh, rgba(theme.faceTop), rgba(theme.faceBottom)));
          paint.setShader(null);
          // top edge of the face (the lip of the cap)
          faceEdges.moveTo(fx, fy + line * 0.5).lineTo(fx + fw, fy + line * 0.5);
          // two courses of ashlar, joints staggered; blocks ~0.9 tile long
          const mid = fy + fh * 0.5;
          faceJoints.moveTo(fx, mid).lineTo(fx + fw, mid);
          for (let k = 0; k < 2; k++) {
            const top = k === 0 ? fy : mid;
            const bottom = k === 0 ? mid : fy + fh;
            const block = px * (0.82 + 0.18 * hash01(y * 7 + k));
            for (let jx = fx + (k === 0 ? 0.45 : 0.05) * block + block * hash01(x0 * 5 + y + k); jx < fx + fw; jx += block)
              if (jx > fx + 1) faceJoints.moveTo(jx, top).lineTo(jx, bottom);
          }
          // painted frieze on the faces of royal rooms
          for (let t = x0; t < x; t++) {
            const kind = roomKindAt(t, y + 1);
            if (!kind || !theme.royal.has(kind)) continue;
            const by = fy + fh * 0.2;
            canvas.drawRect(R(t * px, by, px, fh * 0.2), fill(rgba(theme.lapis, 0.9)));
            canvas.drawRect(R(t * px, by - line, px, line), fill(rgba(theme.gold)));
            canvas.drawRect(R(t * px, by + fh * 0.2, px, line), fill(rgba(theme.gold)));
            for (let d = 0; d < 4; d++) canvas.drawRect(R((t + 0.1 + d * 0.25) * px, by + fh * 0.3, px * 0.1, fh * 0.1), fill(rgba(theme.gold, 0.85)));
          }
        }
      }

      canvas.drawPath(capLines.build(), stroke(rgba(theme.joint, 0.28), line * 0.8));
      canvas.drawPath(faceJoints.build(), stroke(rgba(theme.joint, 0.55), line));
      canvas.drawPath(capEdges.build(), stroke(rgba(theme.capEdge, 0.55), line));
      canvas.drawPath(faceEdges.build(), stroke(rgba(theme.capEdge, 0.8), line));
    }
  }

  // --------------------------------------------------------------- paving
  function drawPaving(canvas: SkCanvas) {
    // row runs per room, over every non-rock tile (benches, pillars... sit on paving)
    const runs: number[][] = floor.rooms.map(() => []);
    for (let y = 0; y < size; y++) {
      let x = 0;
      while (x < size) {
        const r = tiles[y * size + x] === TILE.ROCK ? -1 : floor.room[y * size + x];
        if (r < 0) {
          x++;
          continue;
        }
        const x0 = x;
        while (x < size && tiles[y * size + x] !== TILE.ROCK && floor.room[y * size + x] === r) x++;
        runs[r].push(x0, y, x - x0);
      }
    }
    floor.rooms.forEach((room, id) => {
      const list = runs[id];
      if (!list.length) return;
      const path = Skia.PathBuilder.Make();
      let minX = size;
      let minY = size;
      let maxX = 0;
      let maxY = 0;
      for (let k = 0; k < list.length; k += 3) {
        const [x, y, len] = [list[k], list[k + 1], list[k + 2]];
        path.addRect(R(x * px, y * px, len * px, px));
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + len);
        maxY = Math.max(maxY, y + 1);
      }
      const shape = path.build();
      canvas.drawPath(shape, fill(rgba(theme.floor[room.kind])));
      const [rowH, len, stagger] = SLABS[room.kind];
      const joints = Skia.PathBuilder.Make();
      let band = 0;
      for (let yy = minY; yy < maxY; yy += rowH, band++) {
        joints.moveTo(minX * px, yy * px).lineTo(maxX * px, yy * px);
        const shift = stagger && band % 2 ? len / 2 : 0;
        for (let xx = minX + shift; xx < maxX; xx += len) joints.moveTo(xx * px, yy * px).lineTo(xx * px, Math.min(yy + rowH, maxY) * px);
      }
      const jp = joints.build();
      canvas.save();
      canvas.clipPath(shape, ClipOp.Intersect, true);
      canvas.drawPath(jp, stroke(rgba(theme.floorJoint, 0.6), line));
      canvas.translate(line, line);
      canvas.drawPath(jp, stroke(rgba('#ffffff', 0.07), line));
      canvas.restore();
    });
  }

  // ------------------------------------------- ambient occlusion beside walls
  function drawContactShadows(canvas: SkCanvas) {
    const floorLike = (x: number, y: number) => {
      const k = kindAt(x, y);
      return k !== TILE.ROCK && k !== TILE.PILLAR;
    };
    const dark = rgba('#000000', 0.5);
    const clear = rgba('#000000', 0);
    // horizontal runs: shadow under a north wall (strong) and above a south wall (short)
    const north = Skia.Shader.MakeLinearGradient({ x: 0, y: 0 }, { x: 0, y: px * 0.4 }, [dark, clear], null, TileMode.Clamp);
    const south = Skia.Shader.MakeLinearGradient({ x: 0, y: px * 0.86 }, { x: 0, y: px }, [clear, rgba('#000000', 0.3)], null, TileMode.Clamp);
    const west = Skia.Shader.MakeLinearGradient({ x: 0, y: 0 }, { x: px * 0.22, y: 0 }, [rgba('#000000', 0.36), clear], null, TileMode.Clamp);
    const east = Skia.Shader.MakeLinearGradient({ x: px * 0.78, y: 0 }, { x: px, y: 0 }, [clear, rgba('#000000', 0.3)], null, TileMode.Clamp);
    const p = Skia.Paint();
    const strip = (shader: ReturnType<typeof Skia.Shader.MakeLinearGradient>, x: number, y: number, w: number, h: number) => {
      p.setShader(shader);
      canvas.save();
      canvas.translate(x * px, y * px);
      canvas.drawRect(R(0, 0, w * px, h * px), p);
      canvas.restore();
    };
    for (let y = 0; y < size; y++) {
      for (const [shader, dy] of [
        [north, -1],
        [south, 1],
      ] as const) {
        let x = 0;
        while (x < size) {
          if (!(floorLike(x, y) && rockAt(x, y + dy))) {
            x++;
            continue;
          }
          const x0 = x;
          while (x < size && floorLike(x, y) && rockAt(x, y + dy)) x++;
          strip(shader, x0, y, x - x0, 1);
        }
      }
    }
    for (let x = 0; x < size; x++) {
      for (const [shader, dx] of [
        [west, -1],
        [east, 1],
      ] as const) {
        let y = 0;
        while (y < size) {
          if (!(floorLike(x, y) && rockAt(x + dx, y))) {
            y++;
            continue;
          }
          const y0 = y;
          while (y < size && floorLike(x, y) && rockAt(x + dx, y)) y++;
          strip(shader, x, y0, 1, y - y0);
        }
      }
    }
  }

  // -------------------------------------------------------------- objects
  function drawObjects(canvas: SkCanvas) {
    const sarcDone = new Set<number>();
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const k = tiles[y * size + x];
        if (k === TILE.PILLAR) pillar(canvas, x, y);
        else if (k === TILE.DOOR) door(canvas, x, y);
        else if (k === TILE.BENCH) bench(canvas, x, y);
        else if (k === TILE.NICHE) niche(canvas, x, y);
        else if (k === TILE.STAIRS_DOWN) stairs(canvas, x, y, true);
        else if (k === TILE.STAIRS_UP) stairs(canvas, x, y, false);
        else if (k === TILE.SARCOPHAGUS && !sarcDone.has(y * size + x)) sarcophagus(canvas, x, y, sarcDone);
      }
  }

  function pillar(canvas: SkCanvas, x: number, y: number) {
    const cx = (x + 0.5) * px;
    const cy = (y + 0.7) * px;
    const r = px * 0.4;
    canvas.drawOval(R(cx - r * 0.9 + px * 0.16, cy - r * 0.45 + px * 0.1, r * 2.2, r * 1.2), fill(rgba('#000000', 0.38)));
    canvas.drawOval(R(cx - r * 1.05, cy - r * 0.5 + px * 0.04, r * 2.1, r * 1.1), fill(rgba(theme.pillarDark)));
    // shaft with a rounded shading across it, and flutes
    const top = cy - px * 0.5;
    canvas.drawRect(R(cx - r, top, r * 2, cy - top), gradient(cx - r, 0, cx + r, 0, rgba(theme.pillar, 1, 1.05), rgba(theme.pillarDark)));
    paint.setShader(null);
    const flutes = Skia.PathBuilder.Make();
    for (const f of [-0.5, 0, 0.5]) flutes.moveTo(cx + f * r, top).lineTo(cx + f * r, cy);
    canvas.drawPath(flutes.build(), stroke(rgba('#000000', 0.16), line));
    // papyrus capital
    canvas.drawOval(R(cx - r * 1.15, top - r * 0.62, r * 2.3, r * 1.25), fill(rgba(theme.pillarDark, 1, 0.85)));
    canvas.drawOval(R(cx - r * 1.05, top - r * 0.68, r * 2.1, r * 1.2), gradient(cx - r, 0, cx + r, 0, rgba(theme.pillar, 1, 1.1), rgba(theme.pillar, 1, 0.8)));
    paint.setShader(null);
    canvas.drawOval(R(cx - r * 0.55, top - r * 0.5, r * 1.1, r * 0.64), stroke(rgba(theme.pillarDark, 0.6), line));
    canvas.drawRect(R(cx - r, top + px * 0.04, r * 2, px * 0.05), fill(rgba(theme.gold, 0.7)));
  }

  function door(canvas: SkCanvas, x: number, y: number) {
    const vertical = rockAt(x - 1, y) && rockAt(x + 1, y); // walking north-south through it
    const inset = px * 0.06;
    canvas.drawRect(R(x * px + inset, y * px + inset, px - inset * 2, px - inset * 2), fill(rgba(theme.floor.passage, 1, 0.82)));
    canvas.drawRect(R(x * px + inset, y * px + inset, px - inset * 2, px - inset * 2), stroke(rgba(theme.joint, 0.7), line));
    const jamb = rgba(theme.cap, 1, 0.9);
    if (vertical) {
      canvas.drawRect(R(x * px, y * px, px * 0.16, px), fill(jamb));
      canvas.drawRect(R((x + 0.84) * px, y * px, px * 0.16, px), fill(jamb));
    } else {
      canvas.drawRect(R(x * px, (y + 0.86) * px, px, px * 0.14), fill(jamb));
    }
    // a portcullis door beside the antechamber of the stairs
    const kinds = [roomKindAt(x - 1, y), roomKindAt(x + 1, y), roomKindAt(x, y - 1), roomKindAt(x, y + 1)];
    if (kinds.includes('antechamber') || kinds.includes('burial')) {
      const grooves = Skia.PathBuilder.Make();
      for (const f of [0.3, 0.5, 0.7]) {
        if (vertical) grooves.moveTo(x * px + px * 0.18, (y + f) * px).lineTo((x + 0.82) * px, (y + f) * px);
        else grooves.moveTo((x + f) * px, y * px + px * 0.1).lineTo((x + f) * px, (y + 0.86) * px);
      }
      canvas.drawPath(grooves.build(), stroke(rgba('#000000', 0.55), line * 1.4));
    }
  }

  function bench(canvas: SkCanvas, x: number, y: number) {
    const horizontal = kindAt(x - 1, y) === TILE.BENCH || kindAt(x + 1, y) === TILE.BENCH;
    const faceH = kindAt(x, y + 1) === TILE.BENCH ? 0 : px * 0.26;
    const topH = px - faceH;
    canvas.drawRect(R(x * px, y * px, px, topH), gradient(0, y * px, 0, y * px + topH, rgba(theme.cap, 1, 1.02), rgba(theme.cap, 1, 0.86)));
    paint.setShader(null);
    if (faceH) canvas.drawRect(R(x * px, y * px + topH, px, faceH), fill(rgba(theme.faceBottom, 1, 0.9)));
    // corbelled ramp: stepped courses along its length
    const steps = Skia.PathBuilder.Make();
    for (const f of [1 / 3, 2 / 3]) {
      if (horizontal) steps.moveTo(x * px, y * px + topH * f).lineTo((x + 1) * px, y * px + topH * f);
      else steps.moveTo(x * px + px * f, y * px).lineTo(x * px + px * f, y * px + topH);
    }
    canvas.drawPath(steps.build(), stroke(rgba(theme.joint, 0.55), line));
    canvas.drawRect(R(x * px, y * px, px, line), fill(rgba(theme.capEdge, 0.5)));
  }

  function niche(canvas: SkCanvas, x: number, y: number) {
    const inset = px * 0.1;
    canvas.drawRect(R(x * px, y * px, px, px), fill(rgba(theme.floor.shrine, 1, 0.55)));
    canvas.drawRect(R(x * px + inset, y * px + inset, px - inset * 2, px - inset * 2), gradient(0, y * px, 0, (y + 1) * px, rgba('#000000', 0.7), rgba('#000000', 0.25)));
    paint.setShader(null);
    canvas.drawRect(R(x * px + inset, y * px + inset, px - inset * 2, px - inset * 2), stroke(rgba(theme.gold, 0.55), line));
  }

  /** Steps: lighter and nearer at the open side, darker towards the far end. */
  function stairs(canvas: SkCanvas, x: number, y: number, down: boolean) {
    // direction from this tile towards its open neighbour
    let dx = 0;
    let dy = 1;
    for (const [ax, ay] of [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ])
      if (kindAt(x + ax, y + ay) !== TILE.ROCK && kindAt(x + ax, y + ay) !== TILE.STAIRS_UP && kindAt(x + ax, y + ay) !== TILE.STAIRS_DOWN) {
        dx = ax;
        dy = ay;
        break;
      }
    const n = 5;
    const base = down ? rgba(theme.floor.stairsDown) : rgba(theme.cap);
    const lips = Skia.PathBuilder.Make();
    for (let i = 0; i < n; i++) {
      const t0 = i / n;
      const f = down ? 1 - 0.78 * (i / (n - 1)) : 0.78 + 0.3 * (i / (n - 1));
      const color = rgba(down ? theme.floor.stairsDown : theme.cap, 1, f);
      // band i measured from the open side
      const x0 = dx === 0 ? x * px : dx > 0 ? (x + 1 - (i + 1) / n) * px : (x + t0) * px;
      const y0 = dy === 0 ? y * px : dy > 0 ? (y + 1 - (i + 1) / n) * px : (y + t0) * px;
      const w = dx === 0 ? px : px / n;
      const h = dy === 0 ? px : px / n;
      canvas.drawRect(R(x0, y0, w, h), fill(color));
      if (dy !== 0) lips.moveTo(x0, dy > 0 ? y0 : y0 + h).lineTo(x0 + w, dy > 0 ? y0 : y0 + h);
      else lips.moveTo(dx > 0 ? x0 : x0 + w, y0).lineTo(dx > 0 ? x0 : x0 + w, y0 + h);
    }
    canvas.drawPath(lips.build(), stroke(rgba(down ? '#000000' : theme.capEdge, down ? 0.45 : 0.6), line));
    if (down) {
      // the shaft falls into darkness
      const far = dy !== 0 ? [x * px, dy > 0 ? y * px : (y + 0.5) * px, px, px * 0.5] : [dx > 0 ? x * px : (x + 0.5) * px, y * px, px * 0.5, px];
      canvas.drawRect(R(far[0], far[1], far[2], far[3]), fill(rgba('#000000', 0.35)));
    }
    void base;
  }

  function sarcophagus(canvas: SkCanvas, x: number, y: number, done: Set<number>) {
    let w = 1;
    let h = 1;
    if (kindAt(x + 1, y) === TILE.SARCOPHAGUS) w = 2;
    else if (kindAt(x, y + 1) === TILE.SARCOPHAGUS) h = 2;
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) done.add((y + yy) * size + x + xx);
    const X = x * px;
    const Y = y * px;
    const bw = w * px;
    const bh = h * px;
    canvas.drawRRect(Skia.RRectXY(R(X + px * 0.14, Y + px * 0.2, bw - px * 0.1, bh - px * 0.06), px * 0.1, px * 0.1), fill(rgba('#000000', 0.4)));
    const box = Skia.RRectXY(R(X + px * 0.08, Y + px * 0.08, bw - px * 0.16, bh - px * 0.16), px * 0.1, px * 0.1);
    canvas.drawRRect(box, gradient(X, Y, X, Y + bh, rgba(theme.floor.burial, 1, 0.8), rgba(theme.floor.burial, 1, 0.4)));
    paint.setShader(null);
    const lid = Skia.RRectXY(R(X + px * 0.16, Y + px * 0.12, bw - px * 0.32, bh - px * 0.34), px * 0.14, px * 0.14);
    canvas.drawRRect(lid, gradient(X, Y, X, Y + bh, rgba(theme.floor.burial, 1, 1.35), rgba(theme.floor.burial, 1, 0.95)));
    paint.setShader(null);
    canvas.drawRRect(lid, stroke(rgba(theme.gold, 0.8), line));
    const long = w >= h;
    const gold = Skia.PathBuilder.Make();
    for (let t = 0.2; t < 0.9; t += 0.2) {
      if (long) gold.moveTo(X + bw * t, Y + px * 0.18).lineTo(X + bw * t, Y + bh - px * 0.28);
      else gold.moveTo(X + px * 0.24, Y + bh * t).lineTo(X + bw - px * 0.24, Y + bh * t);
    }
    canvas.drawPath(gold.build(), stroke(rgba(theme.gold, 0.55), line));
  }

  // ------------------------------------------------------------ trap telltales
  /**
   * What an armed trap looks like in torchlight, always: a granite plate among the paving, chips
   * of fallen stone (block), grooves in the walls and a slab edge in the lintel (portcullis), a
   * cone of fine sand and a crack above (sandfall), a seamed slab on pivot pins (trapdoor).
   * The per-frame sprites (drawTraps.ts) draw over this when a trap is pressed or has fired.
   */
  function drawTelltales(canvas: SkCanvas) {
    for (const t of floor.traps) {
      const x = t.tile % size;
      const y = Math.floor(t.tile / size);
      if (t.kind === 'trapdoor') trapdoorSlab(canvas, x, y, t.tile);
      else plate(canvas, x, y, t.tile);
      if (t.kind === 'block') chips(canvas, x, y, t.tile);
      else if (t.kind === 'sandfall') sandCone(canvas, x, y);
      else if (t.kind === 'portcullis') portcullis(canvas, t);
    }
  }

  function plate(canvas: SkCanvas, x: number, y: number, seed: number) {
    const X = x * px;
    const Y = y * px;
    const i = px * 0.12;
    const slab = R(X + i, Y + i, px - i * 2, px - i * 2);
    // the hairline gap that shows it is a separate stone
    canvas.drawRect(R(slab.x - line, slab.y - line, slab.width + line * 2, slab.height + line * 2), fill(rgba('#000000', 0.55)));
    canvas.drawRect(slab, gradient(0, slab.y, 0, slab.y + slab.height, rgba(theme.granite, 1, 1.18), rgba(theme.granite, 1, 0.82)));
    paint.setShader(null);
    // grains of the granite
    for (let k = 0; k < 7; k++) {
      const gx = slab.x + slab.width * (0.12 + 0.76 * hash01(seed * 7 + k));
      const gy = slab.y + slab.height * (0.12 + 0.76 * hash01(seed * 13 + k * 3));
      canvas.drawCircle(gx, gy, Math.max(0.6, px * 0.018), fill(rgba(k % 2 ? theme.graniteEdge : '#000000', k % 2 ? 0.5 : 0.35)));
    }
    // bevel: lit top and left, shadowed bottom and right
    const bevel = Skia.PathBuilder.Make().moveTo(slab.x, slab.y + slab.height).lineTo(slab.x, slab.y).lineTo(slab.x + slab.width, slab.y);
    canvas.drawPath(bevel.build(), stroke(rgba(theme.graniteEdge, 0.85), line));
    const shade = Skia.PathBuilder.Make().moveTo(slab.x + slab.width, slab.y).lineTo(slab.x + slab.width, slab.y + slab.height).lineTo(slab.x, slab.y + slab.height);
    canvas.drawPath(shade.build(), stroke(rgba('#000000', 0.4), line));
  }

  /** A trapdoor: limestone slab, a dark seam on three sides, two pivot pins on the fourth. */
  function trapdoorSlab(canvas: SkCanvas, x: number, y: number, seed: number) {
    const X = x * px;
    const Y = y * px;
    const i = px * 0.07;
    const slab = R(X + i, Y + i, px - i * 2, px - i * 2);
    canvas.drawRect(slab, gradient(0, slab.y, 0, slab.y + slab.height, rgba(theme.cap, 1, 1.0), rgba(theme.cap, 1, 0.84)));
    paint.setShader(null);
    const pinSide = Math.floor(hash01(seed * 3 + 1) * 4); // 0 north, 1 south, 2 west, 3 east
    const seam = Skia.PathBuilder.Make();
    const L = slab.x;
    const T = slab.y;
    const Rr = slab.x + slab.width;
    const B = slab.y + slab.height;
    const sides: Array<[number, number, number, number]> = [
      [L, T, Rr, T],
      [L, B, Rr, B],
      [L, T, L, B],
      [Rr, T, Rr, B],
    ];
    sides.forEach(([x0, y0, x1, y1], k) => {
      if (k !== pinSide) seam.moveTo(x0, y0).lineTo(x1, y1);
    });
    canvas.drawPath(seam.build(), stroke(rgba('#000000', 0.7), line * 1.5));
    canvas.drawPath(seam.build(), stroke(rgba(theme.capEdge, 0.4), line * 0.6));
    // pivot pins on the hinge side
    const [hx0, hy0, hx1, hy1] = sides[pinSide];
    for (const f of [0.25, 0.75]) {
      const pxp = hx0 + (hx1 - hx0) * f;
      const pyp = hy0 + (hy1 - hy0) * f;
      canvas.drawCircle(pxp, pyp, px * 0.045, fill(rgba('#2a2118', 0.95)));
      canvas.drawCircle(pxp - px * 0.01, pyp - px * 0.012, px * 0.02, fill(rgba(theme.gold, 0.8)));
    }
    canvas.drawRect(slab, stroke(rgba(theme.joint, 0.5), line * 0.7));
  }

  /** Stone chips around a block plate: where something heavy has fallen before. */
  function chips(canvas: SkCanvas, x: number, y: number, seed: number) {
    const n = 5 + Math.floor(hash01(seed) * 3);
    for (let k = 0; k < n; k++) {
      const a = hash01(seed * 5 + k) * Math.PI * 2;
      const d = px * (0.5 + 0.18 * hash01(seed * 11 + k * 2));
      const cx = (x + 0.5) * px + Math.cos(a) * d;
      const cy = (y + 0.5) * px + Math.sin(a) * d;
      const r = px * (0.035 + 0.04 * hash01(seed * 17 + k));
      const chip = Skia.PathBuilder.Make().moveTo(cx - r, cy + r * 0.5).lineTo(cx - r * 0.2, cy - r).lineTo(cx + r, cy - r * 0.1).lineTo(cx + r * 0.6, cy + r * 0.8).close();
      canvas.drawPath(chip.build(), fill(rgba(theme.cap, 1, 0.95)));
      canvas.drawPath(chip.build(), stroke(rgba('#000000', 0.4), line * 0.6));
    }
  }

  /** A small cone of fine sand on the plate and a dark crack in the ceiling line above it. */
  function sandCone(canvas: SkCanvas, x: number, y: number) {
    const cx = (x + 0.5) * px;
    const cy = (y + 0.5) * px;
    const cone = Skia.PathBuilder.Make().moveTo(cx - px * 0.2, cy + px * 0.2).lineTo(cx, cy - px * 0.12).lineTo(cx + px * 0.2, cy + px * 0.2).close();
    canvas.drawPath(cone.build(), fill(rgba(theme.sand, 0.95)));
    canvas.drawPath(Skia.PathBuilder.Make().moveTo(cx, cy - px * 0.12).lineTo(cx + px * 0.2, cy + px * 0.2).lineTo(cx, cy + px * 0.2).close().build(), fill(rgba(theme.sandDark, 0.7)));
    canvas.drawOval(R(cx - px * 0.26, cy + px * 0.16, px * 0.52, px * 0.1), fill(rgba(theme.sand, 0.5)));
    // the crack: a dark zigzag across the top edge of the tile
    const crack = Skia.PathBuilder.Make().moveTo(cx - px * 0.3, y * px + px * 0.02);
    for (let k = 1; k <= 5; k++) crack.lineTo(cx - px * 0.3 + k * px * 0.12, y * px + px * (k % 2 ? 0.1 : 0.03));
    canvas.drawPath(crack.build(), stroke(rgba('#000000', 0.75), line * 1.3));
  }

  /** Grooves in the walls beside the port and the lower edge of the slab in the lintel. */
  function portcullis(canvas: SkCanvas, t: Trap) {
    const x = t.target % size;
    const y = Math.floor(t.target / size);
    const X = x * px;
    const Y = y * px;
    const northSouth = rockAt(x - 1, y) && rockAt(x + 1, y); // walls west and east: the passage runs north-south
    const slot = px * 0.11;
    const dark = fill(rgba('#000000', 0.8));
    if (northSouth) {
      canvas.drawRect(R(X - slot, Y + px * 0.05, slot, px * 0.9), dark);
      canvas.drawRect(R(X + px, Y + px * 0.05, slot, px * 0.9), fill(rgba('#000000', 0.8)));
    } else {
      canvas.drawRect(R(X + px * 0.05, Y - slot, px * 0.9, slot), dark);
      canvas.drawRect(R(X + px * 0.05, Y + px, px * 0.9, slot), fill(rgba('#000000', 0.8)));
    }
    // the slab's lower edge, hanging at the top of the doorway, with its lifting boss
    const edge = R(X + px * 0.08, Y + px * 0.02, px * 0.84, px * 0.16);
    canvas.drawRect(edge, gradient(0, edge.y, 0, edge.y + edge.height, rgba(theme.graniteEdge), rgba(theme.granite, 1, 0.8)));
    paint.setShader(null);
    canvas.drawRect(edge, stroke(rgba('#000000', 0.6), line * 0.8));
    canvas.drawCircle(X + px * 0.5, Y + px * 0.18, px * 0.05, fill(rgba(theme.graniteEdge)));
    canvas.drawCircle(X + px * 0.5, Y + px * 0.18, px * 0.05, stroke(rgba('#000000', 0.5), line * 0.7));
  }
}
