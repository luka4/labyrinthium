import { ClipOp, Skia, TileMode, type SkCanvas, type SkImage } from '@shopify/react-native-skia';

import { TILE, type Floor, type RoomKind } from '../core/floor';
import { fill, hash01, paint, rgba, stroke } from './art';
import type { FloorTheme } from './themes';

/**
 * Bakes a floor's architecture into one image, once per floor (it hides under the
 * between-floors overview). Everything is derived from the tile grid and the room list:
 * thick walls with a 3/4 oblique view (south-facing faces with ashlar joints, caps on
 * top), paving laid per room (never per tile), pillars, benches, doors, niches, stairs.
 * Per frame the game only draws this image, a light mask and a few sprites.
 */

/** Share of a wall tile's height taken by the south-facing face; the cap is the rest. */
const FACE = 0.55;
const CAP_H = 1 - FACE;

/** Pixels per tile for the bake: `tilePx` x pixel ratio, capped so the image stays within 2048 px. */
export function bakeTilePx(size: number, tilePx: number, pixelRatio: number): number {
  const wanted = Math.floor(tilePx * Math.min(pixelRatio, 2));
  return Math.max(8, Math.min(wanted, Math.floor(2048 / size)));
}

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

export function bakeFloor(floor: Floor, theme: FloorTheme, px: number): SkImage | null {
  const { size, tiles } = floor;
  const W = size * px;
  const surface = Skia.Surface.Make(W, W);
  if (!surface) return null;
  const c = surface.getCanvas();
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

  surface.flush();
  return surface.makeImageSnapshot();

  // ---------------------------------------------------------------- walls
  function drawMasonry(canvas: SkCanvas) {
    const capLines = Skia.PathBuilder.Make();
    const capEdges = Skia.PathBuilder.Make();
    const faceJoints = Skia.PathBuilder.Make();
    const faceEdges = Skia.PathBuilder.Make();

    // wall tops, row by row in runs
    for (let y = 0; y < size; y++) {
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
    for (let y = 0; y < size; y++)
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
    for (let y = 0; y < size - 1; y++) {
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
}
