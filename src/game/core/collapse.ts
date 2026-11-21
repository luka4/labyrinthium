import type { EgyptRow } from './egypt';
import { DIRS, TILE, type Collapse, type Layout } from './floor';
import type { GameState } from './game';
import { reachable } from './graph';
import { buryItem, emit, invalidatePaths, smotherFixture } from './runtime';

/**
 * The collapse (plan 03): from Egypt floor 11 the ceiling over the stairwell you came by gives
 * way once you have been moving for a while. Sand pours in and spreads outward at a constant
 * volume rate (tiles per second, a precomputed BFS order from the stairwell), with a slope of
 * SLOPE tiles between the toe and the full-height front. Behind the slope a passage is filled to
 * the ceiling: solid and opaque. Deterministic: no rng, time comes in through `tick`.
 */

/** Tiles between the toe of the sand and the tile that is filled to the ceiling. */
export const SLOPE = 3;
/** Sand level (0..1) from which a tile counts as covered: wading, buried items. */
export const COVER = 0.2;
/** Moving into covered sand costs this many steps. */
export const WADE = 1.8;
/** Items under at least this much sand are lost. */
export const BURY_ITEM = 0.35;
/** A newly covered tile within this many tiles (Chebyshev) of you raises `sandNear`. */
export const SAND_NEAR = 3;
const NEAR_EVERY = 5;

/** Live sand 0..1 on a tile: the collapse or a sandfall. */
export function sandLevel(s: Pick<GameState, 'sand' | 'localSand'>, i: number): number {
  return Math.max(s.sand[i], s.localSand[i]) / 255;
}

export type SandOrder = { order: Int32Array; rank: Int32Array; sdist: Int32Array; cap: number; lowered: boolean };

type SandLayout = Pick<Layout, 'size' | 'tiles' | 'solid' | 'opaque' | 'stairs'>;

/**
 * The BFS order of the sand from the STAIRS_UP tiles over tiles that let light through (sand flows
 * over benches, braziers and the sarcophagus, never down the stairs or onto the goal), cut at the
 * cap plus the slope. If the stairs' side would keep less than `keepPct` (40) % of the open tiles the
 * cap is lowered, deterministically.
 */
export function sandOrder(layout: SandLayout, row: NonNullable<EgyptRow['collapse']>, keepPct = 40, protect: Uint8Array | null = null): SandOrder {
  const { size, tiles, opaque, stairs } = layout;
  const n = size * size;
  const sdist = new Int32Array(n).fill(-1);
  const full: number[] = [];
  const queue: number[] = [];
  for (let i = 0; i < n; i++)
    if (tiles[i] === TILE.STAIRS_UP) {
      sdist[i] = 0;
      queue.push(i);
    }
  for (let h = 0; h < queue.length; h++) {
    const p = queue[h];
    const px = p % size;
    const py = (p - px) / size;
    for (const [dx, dy] of DIRS) {
      const nx = px + dx;
      const ny = py + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const q = ny * size + nx;
      if (sdist[q] >= 0 || opaque[q] || tiles[q] === TILE.STAIRS_DOWN || q === stairs || (protect && protect[q])) continue;
      sdist[q] = sdist[p] + 1;
      queue.push(q);
      full.push(q);
    }
  }
  let open = 0;
  for (let i = 0; i < n; i++) if (!layout.solid[i]) open++;
  let cap = Math.max(1, Math.round((open * row.cap) / 100));
  let lowered = false;
  for (;;) {
    const c = Math.min(cap, full.length);
    const front = c > 0 ? sdist[full[c - 1]] : 0;
    let total = c;
    while (total < full.length && sdist[full[total]] <= front + SLOPE) total++;
    const solid = layout.solid.slice();
    for (let k = 0; k < total; k++) solid[full[k]] = 1;
    // the stairs' side must keep 40 % of the open tiles
    const keep = stairs >= 0 && !solid[stairs] ? reachable(solid, size, stairs) : 0;
    if (keep * 100 >= open * keepPct || cap <= 1) {
      const order = Int32Array.from(full.slice(0, total));
      const rank = new Int32Array(n).fill(-1);
      order.forEach((t, k) => (rank[t] = k));
      return { order, rank, sdist, cap: c, lowered };
    }
    cap = Math.floor(cap * 0.9);
    lowered = true;
  }
}

/** The collapse of a floor, or null when the profile has none on this floor. */
export function buildSandOrder(layout: SandLayout, row: EgyptRow['collapse']): Collapse | null {
  if (!row) return null;
  const { order, rank, sdist, cap } = sandOrder(layout, row);
  return { delay: row.delay, rate: row.rate, cap, capLen: order.length, order, rank, sdist, protect: null };
}

/**
 * The basement's escape sand (plan 04): once the artifact is taken the sand runs on to `escapeCap` %
 * of the open tiles, but never over `protect`, the route from the artifact to the false door. The
 * first `capLen` entries are the sand that falls before the artifact is taken (identical to `plain`);
 * if the longer order would not extend it, the plain order stays.
 */
export function extendSandOrder(layout: SandLayout, row: NonNullable<EgyptRow['collapse']>, plain: Collapse, escapeCap: number, protect: Uint8Array): Collapse {
  const b = sandOrder(layout, { ...row, cap: escapeCap }, 0, protect);
  let same = b.order.length > plain.order.length;
  for (let k = 0; same && k < plain.order.length; k++) if (b.order[k] !== plain.order[k]) same = false;
  return same ? { ...plain, order: b.order, rank: b.rank, sdist: b.sdist, protect } : { ...plain, protect };
}

/** Per-run collapse state (the static plan is `floor.collapse`). */
export type CollapseRun = {
  started: boolean;
  /** seconds burning on this floor */
  t: number;
  /** tiles worth of sand poured so far (fractional) */
  fill: number;
  /** order entries covered / blocked so far */
  covered: number;
  blocked: number;
  /** pace multiplier: the artifact's escape sand pours faster (plan 04) */
  speed: number;
  /** order entries the sand may reach now: `plan.capLen`, all of `order` once the artifact is taken */
  limit: number;
  /** run copies: traps that seal a passage re-rank the sand */
  rank: Int32Array;
  order: Int32Array;
  sdist: Int32Array;
  /** the tile you stand on is blocked when you leave it, or -1 */
  pending: number;
  lastNear: number;
};

export function startCollapse(c: Collapse | null): CollapseRun | null {
  return c
    ? { started: false, t: 0, fill: 0, covered: 0, blocked: 0, speed: 1, limit: c.capLen, rank: c.rank.slice(), order: c.order.slice(), sdist: c.sdist.slice(), pending: -1, lastNear: -1e9 }
    : null;
}

/** Marks a tile filled to the ceiling. The tile you stand on waits until you leave it. */
export function blockTile(s: GameState, i: number) {
  const c = s.collapse;
  if (c && i === s.pos) {
    c.pending = i;
    return;
  }
  s.grid.solid[i] = 1;
  s.grid.opaque[i] = 1;
  s.opaqueDirty = true;
  s.solidDirty = true;
  invalidatePaths(s);
}

/** Applies the pending tile once you have left it. */
export function releasePending(s: GameState) {
  const c = s.collapse;
  if (c && c.pending >= 0 && c.pending !== s.pos) {
    const i = c.pending;
    c.pending = -1;
    blockTile(s, i);
  }
}

function setSeen(s: GameState, i: number) {
  if (s.light[i] > 0) s.seenSand[i] = Math.max(s.sand[i], s.localSand[i]);
}

/**
 * After a passage changed (a block fell, a portcullis closed): ranks the tiles that are not
 * covered yet by a multi-source BFS from the sand's reach over the current open tiles, so sand
 * cannot pass a sealed port. The cap (length of `order`) stays.
 */
export function rebuildRank(s: GameState) {
  const c = s.collapse;
  if (!c) return;
  const { size } = s.grid;
  const n = size * size;
  const limit = c.order.length;
  const order: number[] = [];
  const sdist = new Int32Array(n).fill(-1);
  const visited = new Uint8Array(n);
  const buckets: number[][] = [];
  let maxD = 0;
  const put = (t: number, d: number) => {
    (buckets[d] ??= []).push(t);
    if (d > maxD) maxD = d;
  };
  // sources: everything poured so far keeps its distance
  for (let k = 0; k < c.covered; k++) {
    const t = c.order[k];
    order.push(t);
    visited[t] = 1;
    sdist[t] = c.sdist[t];
    put(t, c.sdist[t]);
  }
  if (c.covered === 0) {
    for (let i = 0; i < n; i++)
      if (s.floor.tiles[i] === TILE.STAIRS_UP) {
        visited[i] = 1;
        sdist[i] = 0;
        put(i, 0);
      }
  }
  for (let d = 0; d <= maxD && order.length < limit; d++) {
    const b = buckets[d];
    if (!b) continue;
    for (let h = 0; h < b.length && order.length < limit; h++) {
      const p = b[h];
      const px = p % size;
      const py = (p - px) / size;
      for (const [dx, dy] of DIRS) {
        const nx = px + dx;
        const ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const q = ny * size + nx;
        if (visited[q] || s.grid.opaque[q] || s.floor.tiles[q] === TILE.STAIRS_DOWN || q === s.floor.stairs || q === s.floor.exit || s.floor.collapse?.protect?.[q]) continue;
        visited[q] = 1;
        sdist[q] = d + 1;
        order.push(q);
        put(q, d + 1);
        if (order.length >= limit) break;
      }
    }
  }
  c.order = Int32Array.from(order);
  c.sdist = sdist;
  c.rank = new Int32Array(n).fill(-1);
  c.order.forEach((t, k) => (c.rank[t] = k));
  c.fill = Math.min(c.fill, c.order.length);
  c.covered = Math.min(c.covered, c.order.length);
  c.blocked = Math.min(c.blocked, c.covered);
}

/** Advances the sand. Call only while the light burns (the clock is burning time). */
export function tickCollapse(s: GameState, dt: number) {
  const c = s.collapse;
  const plan = s.floor.collapse;
  if (!c || !plan) return;
  c.t += dt;
  if (!c.started) {
    if (c.t < plan.delay) return;
    c.started = true;
    emit(s, 'quake', null);
  }
  const reach = Math.min(c.limit, c.order.length);
  if (c.fill < reach) c.fill = Math.min(reach, c.fill + plan.rate * c.speed * dt);
  const n = Math.floor(c.fill);
  if (n <= 0) return;
  const { order, sdist } = c;
  const { size } = s.grid;
  const front = sdist[order[n - 1]];
  const px = s.pos % size;
  const py = (s.pos - px) / size;
  while (c.covered < n) {
    const i = order[c.covered++];
    s.sand[i] = Math.round(255 * 0.15);
    // jam plates, smother fixtures
    const k = s.floor.trapAt[i];
    if (k >= 0 && s.trapPhase[k] === 0) s.trapPhase[k] = 3;
    smotherFixture(s, i);
    const x = i % size;
    const y = (i - x) / size;
    if (Math.max(Math.abs(x - px), Math.abs(y - py)) <= SAND_NEAR && c.t - c.lastNear >= NEAR_EVERY) {
      c.lastNear = c.t;
      emit(s, 'sandNear', null);
    }
  }
  // levels over the slope band, then the tiles that just reached the ceiling
  for (let k = c.blocked; k < c.covered; k++) {
    const i = order[k];
    const v = Math.max(0.15, Math.min(1, (front - sdist[i]) / SLOPE));
    s.sand[i] = Math.round(255 * v);
    setSeen(s, i);
  }
  while (c.blocked < c.covered && sdist[order[c.blocked]] <= front - SLOPE) {
    const i = order[c.blocked++];
    s.sand[i] = 255;
    setSeen(s, i);
    buryItem(s, i);
    blockTile(s, i);
  }
  for (const tile of Array.from(s.items.keys())) if (sandLevel(s, tile) >= BURY_ITEM) buryItem(s, tile);
}
