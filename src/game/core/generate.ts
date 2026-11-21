import {
  ROOM_CARVERS,
  profileFor,
  linearLoopRate,
  type Dir,
  type GenContext,
  type GenSpec,
  type Port,
  type RoomDraft,
} from './architecture';
import './carvers';
import {
  DIRS,
  TILE,
  TILE_OPAQUE,
  TILE_SOLID,
  distancesFrom,
  floorSeed,
  type Floor,
  type Layout,
  type Fixture,
  type RoomKind,
  type Spot,
} from './floor';
import type { Pyramid } from './game';
import { buildSandOrder, extendSandOrder } from './collapse';
import { placeBraziers, placeLights } from './placeLights';
import { placeExit } from './escape';
import { placeGuardian } from './guardian';
import { placeSecrets } from './secrets';
import { placeTraps } from './traps';
import { createRng, shuffle } from './rng';

/**
 * Architectural floor generator (plan 01). Integer math and mulberry32 only, so
 * Hermes, V8 and a future server build bit-identical floors.
 *
 * site lattice -> spanning tree (+ loops) -> merged halls and galleries -> room kinds
 * -> per-kind carvers -> niches -> hooks -> brazier tiles -> derived masks, main path -> light sources.
 * Three rng streams (layout, rooms, items) so tuning one stage leaves the others alone.
 */

const E = 1;
const S = 4;

function popcount(m: number): number {
  return (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
}

export function generateLayout(spec: GenSpec): Layout {
  const profile = profileFor(spec.profile);
  const { floorIndex } = spec;
  const layout = createRng(spec.seed);
  const roomsRng = createRng(spec.seed ^ 0x9e3779b9);

  // 1. lattice ---------------------------------------------------------------
  const n = profile.sites[Math.min(floorIndex, profile.sites.length - 1)];
  const colSpan: number[] = [];
  for (let c = 0; c < n; c++) colSpan.push(profile.span[0] + Math.floor(layout() * (profile.span[1] - profile.span[0] + 1)));
  const rowSpan = shuffle(colSpan.slice(), layout);
  const colX = [0];
  const rowY = [0];
  for (let k = 0; k < n; k++) {
    colX.push(colX[k] + colSpan[k] + 1);
    rowY.push(rowY[k] + rowSpan[k] + 1);
  }
  const size = colX[n] + 1;
  const axisX = colSpan.map((span, c) => colX[c] + 1 + (span >> 1));
  const axisY = rowSpan.map((span, r) => rowY[r] + 1 + (span >> 1));
  const lattice = { n, colX, rowY, axisX, axisY };
  const sites = n * n;
  const siteX = (s: number) => s % n;
  const siteY = (s: number) => Math.floor(s / n);
  const neighbor = (s: number, k: number): number => {
    const x = siteX(s) + DIRS[k][0];
    const y = siteY(s) + DIRS[k][1];
    return x < 0 || y < 0 || x >= n || y >= n ? -1 : y * n + x;
  };

  // 2. arrival site ----------------------------------------------------------
  let arrival = (n >> 1) * n + (n >> 1);
  if (spec.arrivalWorld) {
    const tx = Math.max(1, Math.min(size - 2, spec.arrivalWorld.x + (size >> 1)));
    const ty = Math.max(1, Math.min(size - 2, spec.arrivalWorld.y + (size >> 1)));
    let c = 0;
    let r = 0;
    while (c < n - 1 && colX[c + 1] <= tx) c++;
    while (r < n - 1 && rowY[r + 1] <= ty) r++;
    arrival = r * n + c;
  }

  // 3. spanning tree: randomized DFS that likes to keep going straight -------------
  const mask = new Uint8Array(sites); // bit k = edge towards DIRS[k]
  {
    const visited = new Uint8Array(sites);
    const arrivedBy = new Int8Array(sites).fill(-1);
    const stack = [arrival];
    visited[arrival] = 1;
    while (stack.length) {
      const s = stack[stack.length - 1];
      const options: number[] = [];
      for (let k = 0; k < 4; k++) {
        const t = neighbor(s, k);
        if (t >= 0 && !visited[t]) options.push(k);
      }
      if (!options.length) {
        stack.pop();
        continue;
      }
      const prev = arrivedBy[s];
      const k = prev >= 0 && options.includes(prev) && layout() < profile.straightness ? prev : options[Math.floor(layout() * options.length)];
      const t = neighbor(s, k);
      mask[s] |= 1 << k;
      mask[t] |= 1 << (k ^ 1);
      visited[t] = 1;
      arrivedBy[t] = k;
      stack.push(t);
    }
  }

  // 4. stairs site: the leaf farthest from the arrival by (doubled) walking distance -
  const treeDist = new Int32Array(sites).fill(-1);
  {
    const order = [arrival];
    treeDist[arrival] = 0;
    for (let h = 0; h < order.length; h++) {
      const s = order[h];
      for (let k = 0; k < 4; k++) {
        if (!(mask[s] & (1 << k))) continue;
        const t = neighbor(s, k);
        if (treeDist[t] >= 0) continue;
        const along = k < 2 ? colSpan[siteX(s)] + colSpan[siteX(t)] : rowSpan[siteY(s)] + rowSpan[siteY(t)];
        treeDist[t] = treeDist[s] + along + 2;
        order.push(t);
      }
    }
  }
  let stairsSite = -1;
  for (let s = 0; s < sites; s++) {
    if (s === arrival || popcount(mask[s]) !== 1) continue;
    if (stairsSite < 0 || treeDist[s] > treeDist[stairsSite]) stairsSite = s;
  }

  const excluded = new Uint8Array(sites);
  for (const s of [arrival, stairsSite]) {
    excluded[s] = 1;
    for (let k = 0; k < 4; k++) if (mask[s] & (1 << k)) excluded[neighbor(s, k)] = 1;
  }

  // 5. merges: galleries then halls, only over connected tree pieces ---------------
  const group = new Int16Array(sites).fill(-1);
  const groups: Array<{ kind: 'hall' | 'gallery'; sites: number[] }> = [];
  // tree leaves stay single rooms, so the farthest dead end can always hold the stairs
  const free = (list: number[]) => list.every((s) => !excluded[s] && group[s] < 0 && popcount(mask[s]) > 1);

  const galleryOptions: number[][] = [];
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      const s = r * n + c;
      if (c + 2 < n && mask[s] & E && mask[s + 1] & E && rowSpan[r] >= 3) galleryOptions.push([s, s + 1, s + 2]);
      if (r + 2 < n && mask[s] & S && mask[s + n] & S && colSpan[c] >= 3) galleryOptions.push([s, s + n, s + 2 * n]);
    }
  shuffle(galleryOptions, roomsRng);
  let quota = profile.galleries(floorIndex);
  for (const g of galleryOptions) {
    if (quota <= 0) break;
    if (!free(g)) continue;
    g.forEach((s) => (group[s] = groups.length));
    groups.push({ kind: 'gallery', sites: g });
    quota--;
  }

  const hallOptions: number[][] = [];
  for (const [dw, dh] of [
    [2, 2],
    [3, 2],
    [2, 3],
  ])
    for (let r = 0; r + dh <= n; r++)
      for (let c = 0; c + dw <= n; c++) {
        const list: number[] = [];
        let edges = 0;
        for (let y = 0; y < dh; y++)
          for (let x = 0; x < dw; x++) {
            const s = (r + y) * n + c + x;
            list.push(s);
            if (x + 1 < dw && mask[s] & E) edges++;
            if (y + 1 < dh && mask[s] & S) edges++;
          }
        if (edges === list.length - 1) hallOptions.push(list);
      }
  shuffle(hallOptions, roomsRng);
  quota = profile.halls(floorIndex);
  for (const g of hallOptions) {
    if (quota <= 0) break;
    if (!free(g)) continue;
    g.forEach((s) => (group[s] = groups.length));
    groups.push({ kind: 'hall', sites: g });
    quota--;
  }

  // 6. loops -----------------------------------------------------------------
  const rate = profile.loopRate ? profile.loopRate(floorIndex) : linearLoopRate(profile.loops, floorIndex);
  const loopOptions: Array<[number, number]> = [];
  for (let s = 0; s < sites; s++)
    for (const k of [0, 2]) {
      const t = neighbor(s, k);
      if (t < 0 || mask[s] & (1 << k)) continue;
      if (s === arrival || t === arrival || s === stairsSite || t === stairsSite) continue;
      if (group[s] >= 0 && group[s] === group[t]) continue;
      loopOptions.push([s, k]);
    }
  shuffle(loopOptions, layout);
  let loopCount = 0;
  const loopTarget = Math.round(loopOptions.length * rate);
  /** weighted walking distance (doubled) from the arrival site over the current graph */
  const siteDist = (): Int32Array => {
    const d = new Int32Array(sites).fill(1 << 28);
    const done = new Uint8Array(sites);
    d[arrival] = 0;
    for (;;) {
      let u = -1;
      for (let s = 0; s < sites; s++) if (!done[s] && d[s] < 1 << 28 && (u < 0 || d[s] < d[u])) u = s;
      if (u < 0) break;
      done[u] = 1;
      for (let k = 0; k < 4; k++) {
        if (!(mask[u] & (1 << k))) continue;
        const t = neighbor(u, k);
        const along = k < 2 ? colSpan[siteX(u)] + colSpan[siteX(t)] : rowSpan[siteY(u)] + rowSpan[siteY(t)];
        if (d[u] + along + 2 < d[t]) d[t] = d[u] + along + 2;
      }
    }
    return d;
  };
  for (let i = 0; i < loopOptions.length && loopCount < loopTarget; i++) {
    const [s, k] = loopOptions[i];
    const t = neighbor(s, k);
    mask[s] |= 1 << k;
    mask[t] |= 1 << (k ^ 1);
    // a loop must not make a middle of the labyrinth much farther than the farthest dead end
    const d = siteDist();
    let leafMax = 0;
    let allMax = 0;
    for (let q = 0; q < sites; q++) {
      allMax = Math.max(allMax, d[q]);
      if (q !== arrival && group[q] < 0 && popcount(mask[q]) === 1) leafMax = Math.max(leafMax, d[q]);
    }
    if (leafMax * 10 >= allMax * 8) loopCount++;
    else {
      mask[s] &= ~(1 << k);
      mask[t] &= ~(1 << (k ^ 1));
    }
  }

  // 6b. final stairs site: the farthest leaf of the finished graph
  {
    const d = siteDist();
    let best = stairsSite;
    for (let s = 0; s < sites; s++) if (s !== arrival && group[s] < 0 && popcount(mask[s]) === 1 && d[s] > d[best]) best = s;
    stairsSite = best;
  }

  // 7. rooms and kinds -------------------------------------------------------
  const rooms: RoomDraft[] = [];
  const roomOfSite = new Int16Array(sites).fill(-1);
  for (let s = 0; s < sites; s++) {
    if (roomOfSite[s] >= 0) continue;
    const g = group[s] >= 0 ? groups[group[s]] : null;
    const members = g ? g.sites : [s];
    const id = rooms.length;
    members.forEach((m) => (roomOfSite[m] = id));
    rooms.push({
      id,
      kind: g ? g.kind : 'passage',
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      sites: members,
      doors: [],
      leaf: false,
      main: false,
      depth: 0,
      ports: [],
    });
  }
  const portTile = (s: number, k: number): [number, number] => {
    const c = siteX(s);
    const r = siteY(s);
    if (k === 0) return [colX[c + 1], axisY[r]];
    if (k === 1) return [colX[c], axisY[r]];
    if (k === 2) return [axisX[c], rowY[r + 1]];
    return [axisX[c], rowY[r]];
  };
  const links: Floor['links'] = [];
  for (const room of rooms)
    for (const s of room.sites)
      for (let k = 0; k < 4; k++) {
        if (!(mask[s] & (1 << k))) continue;
        const t = neighbor(s, k);
        if (roomOfSite[t] === room.id) continue;
        const [x, y] = portTile(s, k);
        const port: Port = { site: s, dir: k as Dir, x, y, to: roomOfSite[t] };
        room.ports.push(port);
        room.doors.push(y * size + x);
        if (room.id < port.to) links.push({ a: room.id, b: port.to, door: y * size + x });
      }
  for (const room of rooms) room.leaf = room.ports.length === 1;

  const arrivalRoom = roomOfSite[arrival];
  const stairsRoom = roomOfSite[stairsSite];
  rooms[arrivalRoom].kind = 'stairsUp';
  rooms[stairsRoom].kind = spec.basement ? profile.basementRoom : 'stairsDown';
  const before = rooms[stairsRoom].ports[0].to;
  if (before !== arrivalRoom && rooms[before].sites.length === 1 && rooms[before].ports.length === 2) rooms[before].kind = 'antechamber';
  const leafTotal = Object.values(profile.leafRooms).reduce((a, b) => a + (b ?? 0), 0);
  for (const room of rooms) {
    if (room.id === arrivalRoom || room.id === stairsRoom || room.kind !== 'passage') continue;
    if (room.leaf) {
      const s = room.sites[0];
      const big = colSpan[siteX(s)] >= 3 && rowSpan[siteY(s)] >= 3;
      let roll = roomsRng() * leafTotal;
      let kind: RoomKind = 'chamber';
      for (const [k, w] of Object.entries(profile.leafRooms) as Array<[RoomKind, number]>) {
        roll -= w;
        if (roll < 0) {
          kind = k;
          break;
        }
      }
      room.kind = kind === 'magazines' && !big ? 'chamber' : kind;
    } else if (room.ports.length >= 3 && roomsRng() < profile.junctionRoom) {
      room.kind = 'chamber';
    }
  }

  // 8. carve -----------------------------------------------------------------
  const tiles = new Uint8Array(size * size);
  const roomOf = new Int16Array(size * size).fill(-1);
  const spots: Spot[] = [];
  const ctx: GenContext = { spec, profile, size, lattice, tiles, roomOf, rooms, spots, rng: roomsRng, marks: { start: -1, stairs: -1 } };
  for (const room of rooms) ROOM_CARVERS[room.kind](ctx, room);
  // doorways: a door if either side is more than a passage
  for (const l of links) {
    const door = rooms[l.a].kind !== 'passage' || rooms[l.b].kind !== 'passage';
    tiles[l.door] = door ? TILE.DOOR : TILE.FLOOR;
    roomOf[l.door] = l.a;
  }

  // 9. niches in straight passages --------------------------------------------
  const nicheAt: number[] = [];
  const open = (x: number, y: number) => tiles[y * size + x] !== TILE.ROCK;
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] !== TILE.FLOOR || roomOf[i] < 0 || rooms[roomOf[i]].kind !== 'passage') continue;
    const x = i % size;
    const y = (i - x) / size;
    if (x < 2 || y < 2 || x > size - 3 || y > size - 3) continue;
    const horizontal = open(x - 1, y) && open(x + 1, y) && !open(x, y - 1) && !open(x, y + 1);
    const vertical = open(x, y - 1) && open(x, y + 1) && !open(x - 1, y) && !open(x + 1, y);
    if (!horizontal && !vertical) continue;
    if (nicheAt.some((j) => Math.abs((j % size) - x) <= 2 && Math.abs(Math.floor(j / size) - y) <= 2)) continue;
    if (roomsRng() >= profile.nicheRate) continue;
    const side = roomsRng() < 0.5 ? -1 : 1;
    const nx = horizontal ? x : x + side;
    const ny = horizontal ? y + side : y;
    // the niche and the five tiles around it, away from the passage, must be solid rock
    const around: Array<[number, number]> = [[nx, ny]];
    for (let d = -1; d <= 1; d++) {
      around.push(horizontal ? [x + d, ny + side] : [nx + side, y + d]);
      if (d !== 0) around.push(horizontal ? [nx + d, ny] : [nx, ny + d]);
    }
    if (!around.every(([ax, ay]) => ax >= 1 && ay >= 1 && ax < size - 1 && ay < size - 1 && !open(ax, ay))) continue;
    tiles[ny * size + nx] = TILE.NICHE;
    roomOf[ny * size + nx] = roomOf[i];
    nicheAt.push(i);
    spots.push({ tile: ny * size + nx, kind: 'niche', room: roomOf[i], dist: 0, main: false });
  }

  // 10. hooks (own rng stream each), then derive masks ---------------------------
  (profile.hooks ?? []).forEach((hook, k) => {
    ctx.rng = createRng(spec.seed ^ Math.imul(k + 1, 0x27d4eb2d));
    hook(ctx);
  });
  const fixtures: Fixture[] = placeBraziers({
    tiles,
    roomOf,
    rooms,
    size,
    start: ctx.marks.start,
    stairs: ctx.marks.stairs,
    floorIndex,
    camp: !!spec.camp,
  });
  const solid = new Uint8Array(size * size);
  const opaque = new Uint8Array(size * size);
  for (let i = 0; i < tiles.length; i++) {
    solid[i] = TILE_SOLID[tiles[i]];
    opaque[i] = TILE_OPAQUE[tiles[i]];
  }
  const start = ctx.marks.start;
  const stairs = ctx.marks.stairs;
  const dist = distancesFrom(solid, size, start);

  const path: number[] = [stairs];
  for (let p = stairs; p !== start; ) {
    const px = p % size;
    const py = (p - px) / size;
    for (const [dx, dy] of DIRS) {
      const q = (py + dy) * size + px + dx;
      if (px + dx >= 0 && px + dx < size && dist[q] === dist[p] - 1) {
        p = q;
        break;
      }
    }
    path.push(p);
  }
  const mainPath = Int32Array.from(path.reverse());
  const onPath = new Uint8Array(size * size);
  for (const p of mainPath) onPath[p] = 1;

  for (const room of rooms) {
    let best = -1;
    for (const d of room.doors) if (dist[d] >= 0 && (best < 0 || dist[d] < best)) best = dist[d];
    room.depth = Math.max(0, best);
  }
  for (let i = 0; i < tiles.length; i++) if (onPath[i] && roomOf[i] >= 0) rooms[roomOf[i]].main = true;
  rooms[arrivalRoom].depth = 0;

  // dead ends at the back of leaf chambers
  for (const room of rooms) {
    if (!room.leaf || room.kind !== 'chamber') continue;
    let best = -1;
    for (let y = room.y; y < room.y + room.h; y++)
      for (let x = room.x; x < room.x + room.w; x++) {
        const i = y * size + x;
        if (tiles[i] === TILE.FLOOR && dist[i] > (best < 0 ? -1 : dist[best])) best = i;
      }
    if (best >= 0) spots.push({ tile: best, kind: 'deadEnd', room: room.id, dist: 0, main: false });
  }
  for (const sp of spots) {
    sp.dist = dist[sp.tile];
    sp.main = !!onPath[sp.tile];
  }

  return {
    size,
    tiles,
    solid,
    opaque,
    room: roomOf,
    rooms,
    links,
    start,
    stairs,
    braziers: fixtures,
    spots,
    mainPath,
    lattice,
    profile: spec.profile,
    loops: loopCount,
    seed: spec.seed,
    dist,
    arrivalRoom,
    stairsRoom,
  };
}

/**
 * Features of a floor, after the layout: found light (items rng `seed ^ 0x85ebca6b`, the same
 * stream as before the split), then pressure plates and the collapse sand order.
 */
export function addFeatures(layout: Layout, spec: GenSpec, below: Layout | null): Floor {
  const profile = profileFor(spec.profile);
  const { size, tiles, solid, room: roomOf, rooms, spots, dist, mainPath, arrivalRoom, stairsRoom, start, stairs } = layout;
  const onPath = new Uint8Array(size * size);
  for (const p of mainPath) onPath[p] = 1;
  const lights = placeLights({
    profile,
    size,
    tiles,
    solid,
    roomOf,
    rooms,
    spots,
    dist,
    onPath,
    mainPath,
    arrivalRoom,
    stairsRoom,
    start,
    stairs,
    floorIndex: spec.floorIndex,
    rng: createRng(spec.seed ^ 0x85ebca6b),
  });
  const fixtures: Fixture[] = [...layout.braziers, ...lights.sconces, ...lights.shrines];
  const { braziers: _braziers, arrivalRoom: _a, stairsRoom: _s, ...rest } = layout;
  void _braziers;
  void _a;
  void _s;
  const placed = placeTraps({ layout, items: lights.items, fixtures, spec, below, rng: createRng(spec.seed ^ 0x2545f491) });
  const sandRow = profile.collapse?.(spec.floorIndex) ?? null;
  let collapse = buildSandOrder(layout, sandRow);
  const door = profile.falseDoor && spec.basement ? placeExit({ layout, traps: placed.traps, fixtures, items: lights.items, collapse }) : { exit: -1, exitFront: -1, protect: null };
  const escapeCap = spec.basement ? (profile.escapeCap?.(spec.floorIndex) ?? null) : null;
  if (collapse && sandRow && door.protect && escapeCap) collapse = extendSandOrder(layout, sandRow, collapse, escapeCap, door.protect);
  const row = profile.guardian?.(spec.floorIndex) ?? null;
  const guardian = row
    ? placeGuardian({ layout, row, items: lights.items, fixtures, traps: placed.traps, collapse, exit: door.exit, exitFront: door.exitFront, basement: spec.basement })
    : null;
  const secrets = placeSecrets({
    layout,
    profile,
    floorIndex: spec.floorIndex,
    seed: spec.seed,
    items: lights.items,
    fixtures,
    traps: placed.traps,
    collapse,
    exit: door.exit,
    exitFront: door.exitFront,
    guardian,
  });
  return {
    ...rest,
    items: lights.items,
    fixtures,
    traps: placed.traps,
    trapAt: placed.trapAt,
    eligiblePorts: placed.eligiblePorts,
    collapse,
    exit: door.exit,
    exitFront: door.exitFront,
    guardian,
    secrets,
  };
}

export function generateFloor(spec: GenSpec, below: Layout | null = null): Floor {
  return addFeatures(generateLayout(spec), spec, below);
}

const layoutMemo = new Map<string, Layout>();
const floorMemo = new Map<string, Floor>();

export function specFor(pyramid: Pyramid, floorIndex: number): GenSpec {
  let arrivalWorld: { x: number; y: number } | null = null;
  if (floorIndex > 0) {
    const above = layoutFor(pyramid, floorIndex - 1);
    const half = above.size >> 1;
    arrivalWorld = { x: (above.stairs % above.size) - half, y: Math.floor(above.stairs / above.size) - half };
  }
  return {
    seed: floorSeed(pyramid, floorIndex),
    floorIndex,
    basement: floorIndex === pyramid.floorCount - 1,
    camp: pyramid.camps.includes(floorIndex) && floorIndex > 0,
    nextIsCamp: pyramid.camps.includes(floorIndex + 1),
    profile: pyramid.architecture,
    arrivalWorld,
  };
}

/**
 * The layout of a floor of a pyramid. Floors are world-aligned: you arrive under the previous
 * floor's stairs, so layout k depends on layouts 0..k-1 (memoised per session).
 */
export function layoutFor(pyramid: Pyramid, floorIndex: number): Layout {
  const key = `${pyramid.id}:${pyramid.seed}:${floorIndex}`;
  const hit = layoutMemo.get(key);
  if (hit) return hit;
  const layout = generateLayout(specFor(pyramid, floorIndex));
  layoutMemo.set(key, layout);
  return layout;
}

/** The played floor: layout plus lights, traps and the collapse (memoised). */
export function floorFor(pyramid: Pyramid, floorIndex: number): Floor {
  const key = `${pyramid.id}:${pyramid.seed}:${floorIndex}`;
  const hit = floorMemo.get(key);
  if (hit) return hit;
  const below = floorIndex + 1 < pyramid.floorCount ? layoutFor(pyramid, floorIndex + 1) : null;
  const floor = addFeatures(layoutFor(pyramid, floorIndex), specFor(pyramid, floorIndex), below);
  floorMemo.set(key, floor);
  return floor;
}

/** Generates the layouts down to `upTo + 1` one per timer tick, so resuming a deep camp is instant. */
export function warmLayouts(pyramid: Pyramid, upTo: number, signal?: AbortSignal) {
  let i = 0;
  const last = Math.min(pyramid.floorCount - 1, upTo + 1);
  const next = () => {
    if (signal?.aborted || i > last) return;
    layoutFor(pyramid, i++);
    setTimeout(next, 0);
  };
  setTimeout(next, 0);
}
