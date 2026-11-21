/**
 * Trap, trapdoor and collapse checks (plan 03), called from check-floors.ts.
 * Pure core code only: no Skia, no React.
 */
import { profileFor } from '../src/game/core/architecture';
import { SLOPE, sandOrder } from '../src/game/core/collapse';
import { DIRS, TILE, distancesFrom, type Floor, type Layout, type TrapKind } from '../src/game/core/floor';
import { isCampFloor, type Pyramid } from '../src/game/core/game';
import { reachable } from '../src/game/core/graph';
import { resolveLanding } from '../src/game/core/traps';

export type Report = { fail: (m: string) => void; warn: (m: string) => void };

const manhattan = (size: number, a: number, b: number) => Math.abs((a % size) - (b % size)) + Math.abs(Math.floor(a / size) - Math.floor(b / size));
export const KINDS: TrapKind[] = ['block', 'portcullis', 'sandfall', 'trapdoor'];

/** Per kind totals over many floors, for the fuzz shortfall report. */
export type TrapStats = { target: number; placed: number };

export function featHash(f: Floor): string {
  let h = 0x811c9dc5;
  const mix = (v: number) => {
    h ^= v & 255;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  const num = (v: number) => {
    for (let b = 0; b < 4; b++) mix(v >> (8 * b));
  };
  for (const t of f.traps) {
    num(KINDS.indexOf(t.kind));
    num(t.tile);
    num(t.target);
    for (const a of t.area) num(a);
    num(t.landingWorld ? t.landingWorld.x + 1000 : -1);
    num(t.landingWorld ? t.landingWorld.y + 1000 : -1);
  }
  if (f.collapse) {
    num(f.collapse.cap);
    for (const o of f.collapse.order) num(o);
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * The fairness contract (I1-I3), counts, trapdoor landings and collapse invariants for one floor.
 * `below` is the full floor under it (null on the last). `exact`: the fixed-seed floors must meet
 * every target (except portcullis, limited by the loops); fuzz floors only add to `stats`.
 */
export function checkTraps(label: string, p: Pyramid, i: number, f: Floor, below: Floor | null, exact: boolean, { fail, warn }: Report, stats?: Record<TrapKind, TrapStats>): { lowered: boolean } {
  const profile = profileFor(p.architecture);
  const row = profile.traps?.(i);
  const { size } = f;
  const n = size * size;
  const basement = i === p.floorCount - 1;
  const nextIsCamp = p.camps.includes(i + 1);
  let open = 0;
  for (let k = 0; k < n; k++) if (!f.solid[k]) open++;

  // ---- fairness -------------------------------------------------------------------
  const plates = f.traps.map((t) => t.tile);
  const ports = f.traps.filter((t) => t.kind === 'portcullis').map((t) => t.target);
  const reach = (gone: number[]) => {
    const test = f.solid.slice();
    for (const g of gone) test[g] = 1;
    const unique = new Set(gone.filter((g) => !f.solid[g]));
    return reachable(test, size, f.start) === open - unique.size;
  };
  if (!reach(plates)) fail(`${label}: I1 a trap tile cuts the floor`);
  if (!reach([...plates, ...ports])) fail(`${label}: I2 a trap with its effect cuts the floor`);
  const path = new Set(f.mainPath);
  const items = new Set(f.items.map((it) => it.tile));
  const fixtureTiles = new Set(f.fixtures.map((x) => x.tile));
  const doors = new Set(f.links.map((l) => l.door));
  f.traps.forEach((t, k) => {
    const room = f.rooms[f.room[t.tile]];
    if (f.trapAt[t.tile] !== k) fail(`${label}: trapAt disagrees for trap ${k}`);
    if (f.solid[t.tile] || f.tiles[t.tile] !== TILE.FLOOR) fail(`${label}: ${t.kind} tile is not plain floor`);
    if (path.has(t.tile)) fail(`${label}: I3 ${t.kind} on the main path`);
    if (room && (room.kind === 'stairsUp' || room.kind === 'stairsDown' || room.kind === 'burial')) fail(`${label}: I3 ${t.kind} in a ${room.kind}`);
    if (f.dist[t.tile] < 6) fail(`${label}: I3 ${t.kind} within 6 of the start`);
    if (items.has(t.tile) || DIRS.some(([dx, dy]) => items.has(t.tile + dy * size + dx))) fail(`${label}: I3 ${t.kind} on or next to an item`);
    if (fixtureTiles.has(t.tile)) fail(`${label}: I3 ${t.kind} on a fixture`);
    if (doors.has(t.tile)) fail(`${label}: I3 ${t.kind} plate on a door`);
    if (t.tile === f.stairs) fail(`${label}: I3 trap on the stairs`);
    f.traps.forEach((u, m) => {
      if (m > k && manhattan(size, t.tile, u.tile) < 4) fail(`${label}: I3 trap spacing ${manhattan(size, t.tile, u.tile)}`);
    });
    if (t.kind === 'portcullis') {
      if (!doors.has(t.target)) fail(`${label}: portcullis not on a port`);
      if (manhattan(size, t.tile, t.target) !== 1) fail(`${label}: portcullis plate not next to its port`);
      if (path.has(t.target)) fail(`${label}: portcullis port on the main path`);
      if (f.dist[t.tile] > f.dist[t.target]) fail(`${label}: portcullis plate on the far side`);
    }
    if (t.kind === 'sandfall') {
      if (!t.area.includes(t.target)) fail(`${label}: sandfall does not cover the guarded tile`);
      const test = f.solid.slice();
      test[t.tile] = 1;
      if (reachable(test, size, f.start) !== open - 1) fail(`${label}: sandfall goods not reachable avoiding the plate`);
      for (const a of t.area) if (f.room[a] !== f.room[t.tile] || f.solid[a]) fail(`${label}: sandfall area leaves its room`);
    }
    if (t.kind === 'trapdoor') {
      if (!below || basement || nextIsCamp) fail(`${label}: trapdoor above a camp, the basement or nothing`);
      if (!t.landingWorld) fail(`${label}: trapdoor without a landing`);
      else if (below) {
        const land = resolveLanding(below, t.landingWorld);
        if (land < 0) fail(`${label}: trapdoor landing unresolved`);
        else {
          const lr = below.rooms[below.room[land]];
          if (lr.kind === 'stairsUp' || lr.kind === 'stairsDown' || lr.kind === 'burial') fail(`${label}: landing in a ${lr.kind}`);
          if (below.traps.some((u) => manhattan(below.size, u.tile, land) <= 1)) fail(`${label}: landing on or next to a trap`);
          const d = below.collapse ? below.collapse.rank[land] : -1;
          if (below.collapse && d >= 0 && d <= below.collapse.cap + 4 * SLOPE) fail(`${label}: landing inside the collapse region`);
          // the walk from the landing to the stairs, on the layout's static mask
          const far = distFrom(below, land);
          if (far < 0.4 * below.dist[below.stairs]) fail(`${label}: landing too close to the stairs (${far} < 0.4 x ${below.dist[below.stairs]})`);
        }
      }
    }
  });

  // ---- counts ---------------------------------------------------------------------
  if (row) {
    for (const kind of KINDS) {
      const got = f.traps.filter((t) => t.kind === kind).length;
      let want = row[kind];
      if (kind === 'trapdoor' && (nextIsCamp || basement || !below)) want = 0;
      if (stats) {
        stats[kind].target += want;
        stats[kind].placed += got;
      }
      if (got > want) fail(`${label}: ${got} ${kind} traps, target ${want}`);
      const need = kind === 'portcullis' ? Math.min(want, f.eligiblePorts) : want;
      if (exact && got < need) fail(`${label}: only ${got} of ${need} ${kind} traps${kind === 'portcullis' ? ` (eligible ports ${f.eligiblePorts})` : ''}`);
      else if (got < want && exact) warn(`${label}: ${got} of ${want} ${kind} traps (eligible ports ${f.eligiblePorts})`);
    }
  } else if (f.traps.length) fail(`${label}: traps on a floor without a trap table`);

  // ---- collapse -------------------------------------------------------------------
  const crow = profile.collapse?.(i) ?? null;
  if (!!crow !== !!f.collapse) fail(`${label}: collapse presence disagrees with the profile`);
  const c = f.collapse;
  let lowered = false;
  if (c && crow) {
    if (c.rank[f.stairs] !== -1) fail(`${label}: the stairs are in the sand order`);
    const solid = f.solid.slice();
    for (const t of c.order.slice(0, c.capLen)) solid[t] = 1;
    if (reachable(solid, size, f.stairs) * 10 < open * 4) fail(`${label}: with the sand in, the stairs keep under 40 % of the floor`);
    // the escape sand (basement, plan 04) runs on over everything except the route to the false door
    if (c.capLen > c.order.length) fail(`${label}: capLen beyond the order`);
    if (f.exit >= 0) {
      const all = f.solid.slice();
      for (const t of c.order) all[t] = 1;
      for (const t of f.traps) all[t.tile] = 1;
      if (distancesFrom(all, size, f.stairs)[f.exitFront] < 0) fail(`${label}: the escape sand cuts the artifact from the false door`);
      if (!c.protect) fail(`${label}: no protected route`);
      else for (let t = 0; t < size * size; t++) if (c.protect[t] && c.rank[t] >= 0) fail(`${label}: the protected route is in the sand order`);
    }
    for (let k = 1; k < c.order.length; k++) if (c.sdist[c.order[k]] < c.sdist[c.order[k - 1]]) fail(`${label}: sand order not monotone at ${k}`);
    c.order.forEach((t, k) => {
      if (c.rank[t] !== k) fail(`${label}: rank disagrees with order at ${k}`);
    });
    if (c.rank[f.start] < 0 && c.sdist[f.start] < 0) warn(`${label}: the landing tile is outside the sand's reach`);
    const want = sandOrder(f, crow);
    lowered = want.lowered;
    if (want.lowered && exact) warn(`${label}: collapse cap lowered to ${want.cap} (${crow.cap} % asked)`);
  }
  return { lowered };
}

/** Walking distance from a tile to the stairs over the static mask. */
function distFrom(f: Pick<Floor, 'solid' | 'size' | 'stairs'>, from: number): number {
  const { size, solid } = f;
  const dist = new Int32Array(size * size).fill(-1);
  const queue = [from];
  dist[from] = 0;
  for (let h = 0; h < queue.length; h++) {
    const p = queue[h];
    const px = p % size;
    const py = (p - px) / size;
    for (const [dx, dy] of DIRS) {
      const nx = px + dx;
      const ny = py + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const q = ny * size + nx;
      if (!solid[q] && dist[q] < 0) {
        dist[q] = dist[p] + 1;
        queue.push(q);
      }
    }
  }
  return dist[f.stairs];
}

export function camp(p: Pyramid, i: number): boolean {
  return isCampFloor(p, i);
}

export type { Layout };
