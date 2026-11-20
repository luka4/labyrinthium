import { ROOM_CARVERS, type Dir, type GenContext, type RoomDraft } from './architecture';
import { TILE, type TileKind } from './floor';
import type { Rng } from './rng';

/**
 * Room carvers: write one room's tiles into the floor. Integer math only.
 * Shared rules: a room's rectangle lies inside its sites' interiors, contains every
 * axis line it has a port on, and the gap from the rectangle to a port is carved
 * as FLOOR (a passage through thick wall). Port tiles themselves are finished by
 * the generator (DOOR or FLOOR) once both sides exist.
 */

/** Direction vectors by Dir (east, west, south, north), pointing out of the room through the port. */
const VX = [1, -1, 0, 0];
const VY = [0, 0, 1, -1];

export type Box = { x0: number; y0: number; x1: number; y1: number }; // inclusive

export function siteBox(ctx: GenContext, site: number): Box {
  const { n, colX, rowY } = ctx.lattice;
  const c = site % n;
  const r = (site - c) / n;
  return { x0: colX[c] + 1, y0: rowY[r] + 1, x1: colX[c + 1] - 1, y1: rowY[r + 1] - 1 };
}

export function unionBox(ctx: GenContext, sites: number[]): Box {
  const b = { x0: 1e9, y0: 1e9, x1: -1, y1: -1 };
  for (const s of sites) {
    const t = siteBox(ctx, s);
    b.x0 = Math.min(b.x0, t.x0);
    b.y0 = Math.min(b.y0, t.y0);
    b.x1 = Math.max(b.x1, t.x1);
    b.y1 = Math.max(b.y1, t.y1);
  }
  return b;
}

function put(ctx: GenContext, x: number, y: number, kind: TileKind, room: RoomDraft) {
  const i = y * ctx.size + x;
  ctx.tiles[i] = kind;
  ctx.roomOf[i] = room.id;
}

function fillRect(ctx: GenContext, room: RoomDraft, x: number, y: number, w: number, h: number, kind: TileKind = TILE.FLOOR) {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) put(ctx, xx, yy, kind, room);
}

function setRect(room: RoomDraft, x: number, y: number, w: number, h: number) {
  room.x = x;
  room.y = y;
  room.w = w;
  room.h = h;
}

/** Start of a `len` long run inside [lo, hi] that contains all `must` values. */
export function placeRun(lo: number, hi: number, len: number, must: number[], rng: Rng): number {
  let a = lo;
  let b = hi - len + 1;
  if (must.length) {
    a = Math.max(a, Math.max(...must) - len + 1);
    b = Math.min(b, Math.min(...must));
  }
  if (b < a) b = a;
  return a + Math.floor(rng() * (b - a + 1));
}

function mustX(room: RoomDraft): number[] {
  return room.ports.filter((p) => p.dir >= 2).map((p) => p.x);
}
function mustY(room: RoomDraft): number[] {
  return room.ports.filter((p) => p.dir < 2).map((p) => p.y);
}

/** Carves the gap tiles between the room rectangle and each of its ports. */
function carveGaps(ctx: GenContext, room: RoomDraft) {
  for (const p of room.ports) {
    let x = p.x - VX[p.dir];
    let y = p.y - VY[p.dir];
    while (x < room.x || y < room.y || x >= room.x + room.w || y >= room.y + room.h) {
      put(ctx, x, y, TILE.FLOOR, room);
      x -= VX[p.dir];
      y -= VY[p.dir];
    }
  }
}

function sizeIn(box: Box) {
  return { sx: box.x1 - box.x0 + 1, sy: box.y1 - box.y0 + 1 };
}

/** A rectangle of w×h placed in a single site's interior around the port axes. */
function placeInSite(ctx: GenContext, room: RoomDraft, w: number, h: number) {
  const box = siteBox(ctx, room.sites[0]);
  const x = placeRun(box.x0, box.x1, w, mustX(room), ctx.rng);
  const y = placeRun(box.y0, box.y1, h, mustY(room), ctx.rng);
  setRect(room, x, y, w, h);
}

function isRockAround(ctx: GenContext, tiles: Array<[number, number]>): boolean {
  for (const [x, y] of tiles) {
    if (x < 1 || y < 1 || x >= ctx.size - 1 || y >= ctx.size - 1) return false;
    if (ctx.tiles[y * ctx.size + x] !== TILE.ROCK) return false;
  }
  return true;
}

function rnd(rng: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

function carveChamber(ctx: GenContext, room: RoomDraft, minSide = 2, square = false) {
  const { sx, sy } = sizeIn(siteBox(ctx, room.sites[0]));
  let w = rnd(ctx.rng, Math.min(minSide, sx), sx);
  let h = rnd(ctx.rng, Math.min(minSide, sy), sy);
  if (square) w = h = Math.min(w, h);
  placeInSite(ctx, room, w, h);
  fillRect(ctx, room, room.x, room.y, room.w, room.h);
  carveGaps(ctx, room);
}

/** The open side tile of a niche behind a shrine: opposite the single door. */
function carveShrine(ctx: GenContext, room: RoomDraft) {
  carveChamber(ctx, room, 3);
  const p = room.ports[0];
  if (!p) return;
  const nx = p.dir === 0 ? room.x - 1 : p.dir === 1 ? room.x + room.w : p.x;
  const ny = p.dir === 2 ? room.y - 1 : p.dir === 3 ? room.y + room.h : p.y;
  // tiles around the niche except the room-side one must be rock
  const around: Array<[number, number]> = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const tx = nx + dx;
      const ty = ny + dy;
      const inRoom = tx >= room.x && tx < room.x + room.w && ty >= room.y && ty < room.y + room.h;
      if (!inRoom && !(dx === 0 && dy === 0)) around.push([tx, ty]);
    }
  // the niche itself must be rock too
  around.push([nx, ny]);
  if (isRockAround(ctx, around)) {
    put(ctx, nx, ny, TILE.NICHE, room);
    ctx.spots.push({ tile: ny * ctx.size + nx, kind: 'shrine', room: room.id, dist: 0, main: false });
  }
}

function carveHall(ctx: GenContext, room: RoomDraft) {
  const box = unionBox(ctx, room.sites);
  const { sx, sy } = sizeIn(box);
  const w = sx % 2 ? sx : sx - 1;
  const h = sy % 2 ? sy : sy - 1;
  const x = placeRun(box.x0, box.x1, w, mustX(room), ctx.rng);
  const y = placeRun(box.y0, box.y1, h, mustY(room), ctx.rng);
  setRect(room, x, y, w, h);
  fillRect(ctx, room, x, y, w, h);
  if (w >= 5 && h >= 5) {
    // hypostyle grid; the perimeter ring and the even rows/columns stay open
    for (let yy = 1; yy < h - 1; yy += 2) for (let xx = 1; xx < w - 1; xx += 2) put(ctx, x + xx, y + yy, TILE.PILLAR, room);
  }
  carveGaps(ctx, room);
}

function carveGallery(ctx: GenContext, room: RoomDraft) {
  const box = unionBox(ctx, room.sites);
  const { n, axisX, axisY } = ctx.lattice;
  const horizontal = room.sites[1] - room.sites[0] === 1;
  const first = room.sites[0];
  const c = first % n;
  const r = (first - c) / n;
  if (horizontal) setRect(room, box.x0, axisY[r] - 1, box.x1 - box.x0 + 1, 3);
  else setRect(room, axisX[c] - 1, box.y0, 3, box.y1 - box.y0 + 1);
  fillRect(ctx, room, room.x, room.y, room.w, room.h, TILE.BENCH);
  // walkway on the axis
  if (horizontal) fillRect(ctx, room, room.x, axisY[r], room.w, 1);
  else fillRect(ctx, room, axisX[c], room.y, 1, room.h);
  // openings in the ramps in front of side ports
  for (const p of room.ports) {
    const side = horizontal ? p.dir >= 2 : p.dir < 2;
    if (!side) continue;
    if (horizontal) put(ctx, p.x, p.dir === 2 ? room.y + room.h - 1 : room.y, TILE.FLOOR, room);
    else put(ctx, p.dir === 0 ? room.x + room.w - 1 : room.x, p.y, TILE.FLOOR, room);
  }
  carveGaps(ctx, room);
}

function carveMagazines(ctx: GenContext, room: RoomDraft) {
  const p = room.ports[0];
  const box = siteBox(ctx, room.sites[0]);
  const { n, axisX, axisY } = ctx.lattice;
  const c = room.sites[0] % n;
  const r = (room.sites[0] - c) / n;
  // inward direction: from the port into the room
  const ix = -VX[p.dir];
  const iy = -VY[p.dir];
  const ax = axisX[c];
  const ay = axisY[r];
  const sx0 = ix > 0 ? box.x0 : ix < 0 ? box.x1 : ax;
  const sy0 = iy > 0 ? box.y0 : iy < 0 ? box.y1 : ay;
  const length = ix !== 0 ? box.x1 - box.x0 + 1 : box.y1 - box.y0 + 1;
  // perpendicular room available on each side of the spine
  const perp = ix !== 0 ? [ay - box.y0, box.y1 - ay] : [ax - box.x0, box.x1 - ax];
  for (let k = 0; k < length; k++) put(ctx, sx0 + ix * k, sy0 + iy * k, TILE.FLOOR, room);
  let cells = 0;
  const cellList: Array<[number, number]> = [];
  for (let k = 1; k < length; k += 2) {
    for (let side = 0; side < 2; side++) {
      const depthMax = perp[side];
      if (depthMax < 1) continue;
      if (ctx.rng() > 0.8 && !(cells === 0 && k + 2 >= length && side === 1)) continue;
      const depth = rnd(ctx.rng, Math.max(1, depthMax - 1), depthMax);
      const sign = side === 0 ? -1 : 1;
      // perpendicular vector: (iy, ix) rotated
      const px = ix !== 0 ? 0 : sign;
      const py = ix !== 0 ? sign : 0;
      const bx = sx0 + ix * k;
      const by = sy0 + iy * k;
      for (let d = 1; d <= depth; d++) put(ctx, bx + px * d, by + py * d, TILE.FLOOR, room);
      cellList.push([bx + px * depth, by + py * depth]);
      cells++;
    }
  }
  for (const [x, y] of cellList) ctx.spots.push({ tile: y * ctx.size + x, kind: 'store', room: room.id, dist: 0, main: false });
  setRect(room, box.x0, box.y0, box.x1 - box.x0 + 1, box.y1 - box.y0 + 1);
}

function carvePassage(ctx: GenContext, room: RoomDraft) {
  const { n, axisX, axisY } = ctx.lattice;
  const s = room.sites[0];
  const c = s % n;
  const r = (s - c) / n;
  const cx = axisX[c];
  const cy = axisY[r];
  put(ctx, cx, cy, TILE.FLOOR, room);
  let x0 = cx;
  let y0 = cy;
  let x1 = cx;
  let y1 = cy;
  for (const p of room.ports) {
    let x = cx;
    let y = cy;
    while (x !== p.x || y !== p.y) {
      x += VX[p.dir];
      y += VY[p.dir];
      if (x === p.x && y === p.y) break; // the port tile is finished later
      put(ctx, x, y, TILE.FLOOR, room);
    }
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  setRect(room, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
}

/** The edge tiles of rectangle side `side` (0 east, 1 west, 2 south, 3 north). */
function sideTile(room: RoomDraft, side: Dir, k: number): [number, number] {
  if (side === 0) return [room.x + room.w - 1, room.y + k];
  if (side === 1) return [room.x, room.y + k];
  if (side === 2) return [room.x + k, room.y + room.h - 1];
  return [room.x + k, room.y];
}

function carveStairsUp(ctx: GenContext, room: RoomDraft) {
  const { sx, sy } = sizeIn(siteBox(ctx, room.sites[0]));
  const w = rnd(ctx.rng, Math.min(3, sx), sx);
  const h = rnd(ctx.rng, Math.min(3, sy), sy);
  placeInSite(ctx, room, w, h);
  fillRect(ctx, room, room.x, room.y, room.w, room.h);
  carveGaps(ctx, room);
  // the flight of steps goes up on the side with no door, if there is one
  const used = new Set<number>(room.ports.map((p) => p.dir));
  const free = ([0, 1, 2, 3] as Dir[]).filter((d) => !used.has(d));
  const pool: Dir[] = free.length ? free : [0, 1, 2, 3];
  const side = pool[Math.floor(ctx.rng() * pool.length)];
  const length = side < 2 ? room.h : room.w;
  // keep the flight off the tiles where a door enters the room
  const entries = new Set<number>(
    room.ports.map((p) => {
      const [x, y] = [p.dir === 0 ? room.x + room.w - 1 : p.dir === 1 ? room.x : p.x, p.dir === 2 ? room.y + room.h - 1 : p.dir === 3 ? room.y : p.y];
      return y * ctx.size + x;
    }),
  );
  let off = (length - 2) >> 1;
  for (let t = 0; t < length - 1; t++) {
    const o = (((length - 2) >> 1) + t) % (length - 1);
    const [ax, ay] = sideTile(room, side, o);
    const [bx, by] = sideTile(room, side, o + 1);
    if (!entries.has(ay * ctx.size + ax) && !entries.has(by * ctx.size + bx)) {
      off = o;
      break;
    }
  }
  const front = [VX[side] * -1, VY[side] * -1];
  let start = -1;
  for (let k = 0; k < 2; k++) {
    const [x, y] = sideTile(room, side, off + k);
    put(ctx, x, y, TILE.STAIRS_UP, room);
    if (k === 0) start = (y + front[1]) * ctx.size + x + front[0];
  }
  ctx.marks.start = start;
}

function carveStairsDown(ctx: GenContext, room: RoomDraft) {
  carveChamber(ctx, room, 3);
  const p = room.ports[0];
  // the stairs sit in the far wall, on the axis of the door
  const [x, y] =
    p.dir === 0 ? [room.x, p.y] : p.dir === 1 ? [room.x + room.w - 1, p.y] : p.dir === 2 ? [p.x, room.y] : [p.x, room.y + room.h - 1];
  put(ctx, x, y, TILE.STAIRS_DOWN, room);
  ctx.marks.stairs = y * ctx.size + x;
}

function carveBurial(ctx: GenContext, room: RoomDraft) {
  const box = siteBox(ctx, room.sites[0]);
  setRect(room, box.x0, box.y0, box.x1 - box.x0 + 1, box.y1 - box.y0 + 1);
  fillRect(ctx, room, room.x, room.y, room.w, room.h);
  const p = room.ports[0];
  const ix = -VX[p.dir];
  const iy = -VY[p.dir];
  const depth = ix !== 0 ? room.w : room.h;
  // depth k counts from the door side; the sarcophagus fills the two far tiles on the axis
  const at = (k: number): [number, number] => {
    const x = ix > 0 ? room.x + k : ix < 0 ? room.x + room.w - 1 - k : p.x;
    const y = iy > 0 ? room.y + k : iy < 0 ? room.y + room.h - 1 - k : p.y;
    return [x, y];
  };
  for (const k of [depth - 2, depth - 1]) {
    const [x, y] = at(k);
    put(ctx, x, y, TILE.SARCOPHAGUS, room);
  }
  const [ax, ay] = at(Math.max(0, depth - 3));
  ctx.marks.stairs = ay * ctx.size + ax;
}

ROOM_CARVERS.passage = carvePassage;
ROOM_CARVERS.chamber = (ctx, room) => carveChamber(ctx, room);
ROOM_CARVERS.antechamber = (ctx, room) => carveChamber(ctx, room, 3, true);
ROOM_CARVERS.shrine = carveShrine;
ROOM_CARVERS.hall = carveHall;
ROOM_CARVERS.gallery = carveGallery;
ROOM_CARVERS.magazines = carveMagazines;
ROOM_CARVERS.stairsUp = carveStairsUp;
ROOM_CARVERS.stairsDown = carveStairsDown;
ROOM_CARVERS.burial = carveBurial;
