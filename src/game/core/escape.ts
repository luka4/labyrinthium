import { TILE, distancesFrom, type Collapse, type Fixture, type Item, type Layout, type Trap } from './floor';
import type { GameState } from './game';
import { wakeSentinel } from './guardian';
import { emit, invalidatePaths } from './runtime';

/**
 * The escape (plan 04): lifting the Golden Scarab wakes the pyramid. The sand starts again (faster
 * and further), the sentinel rises, and a false door elsewhere on the basement floor grinds open
 * onto the workmen's escape shaft. Stepping into it ends the run.
 */

/** The sand pours this much faster once the artifact is taken. */
export const ESCAPE_SPEED = 2.5;
/** Seconds from taking the artifact until the false door is open. */
export const EXIT_OPEN = 1.5;
/** The daylight that falls down the shaft: radius in tiles and falloff, a fixed light once open. */
export const EXIT_LIGHT = { radius: 2.5, falloff: 2.0 } as const;

export type EscapeRun = { taken: boolean; t: number; open: boolean; openIn: number };

const ROOMS_OFF = new Set(['stairsUp', 'stairsDown', 'burial', 'antechamber']);

export type PlacedExit = { exit: number; exitFront: number; /** the route artifact -> exitFront that the escape sand never takes */ protect: Uint8Array | null };

/**
 * The false door: a ROCK tile on the north face of an open tile `T` that the sand never reaches,
 * in a pocket of rock (opening it joins no two passages), at about 0.65 of the farthest distance
 * from the artifact. No rng: the choice is a pure function of the layout.
 */
export function placeExit(a: { layout: Layout; traps: Trap[]; fixtures: Fixture[]; items: Item[]; collapse: Collapse | null }): PlacedExit {
  const { layout, traps, fixtures, items, collapse } = a;
  const { size, tiles, solid, room: roomOf, rooms, stairs } = layout;
  const n = size * size;
  const none: PlacedExit = { exit: -1, exitFront: -1, protect: null };
  const trapTile = new Uint8Array(n);
  const nearTrap = new Uint8Array(n);
  for (const t of traps) {
    trapTile[t.tile] = 1;
    nearTrap[t.tile] = 1;
    for (const d of [1, -1, size, -size]) nearTrap[t.tile + d] = 1;
  }
  const busy = new Uint8Array(n);
  for (const it of items) busy[it.tile] = 1;
  for (const f of fixtures) busy[f.tile] = 1;
  // the worst case: static walls, every tile the sand may take, every trap tile and portcullis port
  const worst = solid.slice();
  for (const t of traps) {
    worst[t.tile] = 1;
    if (t.kind === 'portcullis') worst[t.target] = 1;
  }
  if (collapse) for (let i = 0; i < n; i++) if (collapse.rank[i] >= 0) worst[i] = 1;
  const fromStairs = distancesFrom(solid, size, stairs);
  const onWorst = distancesFrom(worst, size, stairs);

  const pick = (strict: boolean): PlacedExit => {
    const cands: Array<{ t: number; d: number }> = [];
    for (let t = 2 * size; t < n - size; t++) {
      if (tiles[t] !== TILE.FLOOR || solid[t] || trapTile[t] || nearTrap[t] || busy[t] || t === stairs) continue;
      const r = t - size;
      if (tiles[r] !== TILE.ROCK || tiles[r - size] !== TILE.ROCK) continue;
      if (strict && (tiles[r - 1] !== TILE.ROCK || tiles[r + 1] !== TILE.ROCK)) continue;
      const room = roomOf[t] >= 0 ? rooms[roomOf[t]] : null;
      if (room && ROOMS_OFF.has(room.kind)) continue;
      if (collapse && collapse.rank[t] >= 0) continue;
      if (onWorst[t] < 0 || fromStairs[t] < 0) continue;
      cands.push({ t, d: fromStairs[t] });
    }
    if (!cands.length) return none;
    const D = Math.max(...cands.map((c) => c.d));
    let best = -1;
    let bestScore = Infinity;
    for (const c of cands) {
      if (c.d < 0.45 * D || c.d > 0.85 * D) continue;
      const leaf = roomOf[c.t] >= 0 && rooms[roomOf[c.t]].leaf;
      const score = Math.abs(c.d - 0.65 * D) - (leaf ? 4 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = c.t;
      }
    }
    if (best < 0) return none;
    // the route the escape sand never takes: a shortest way from the artifact over the worst-case mask
    const protect = new Uint8Array(n);
    for (let p = best; ; ) {
      protect[p] = 1;
      if (p === stairs) break;
      let next = -1;
      for (const d of [1, -1, size, -size]) {
        const q = p + d;
        if (q >= 0 && q < n && onWorst[q] >= 0 && onWorst[q] === onWorst[p] - 1) {
          next = q;
          break;
        }
      }
      if (next < 0) return none;
      p = next;
    }
    return { exit: best - size, exitFront: best, protect };
  };
  const strict = pick(true);
  return strict.exit >= 0 ? strict : pick(false);
}

/** You stepped on the artifact: the pyramid wakes. */
export function takeArtifact(s: GameState) {
  const e = s.escape;
  if (!e || e.taken) return;
  e.taken = true;
  e.openIn = EXIT_OPEN;
  emit(s, 'artifactTaken', null, s.floor.stairs);
  const c = s.collapse;
  if (c) {
    c.limit = c.order.length;
    c.speed = ESCAPE_SPEED;
    if (!c.started) {
      c.started = true;
      emit(s, 'quake', null);
    }
  }
  wakeSentinel(s);
}

/** Runs the escape clock and opens the false door. Call while the light burns. */
export function tickEscape(s: GameState, dt: number) {
  const e = s.escape;
  if (!e || !e.taken) return;
  e.t += dt;
  if (e.open) return;
  e.openIn -= dt;
  if (e.openIn > 0) return;
  e.open = true;
  const { exit } = s.floor;
  s.grid.solid[exit] = 0;
  s.grid.opaque[exit] = 0;
  s.opaqueDirty = true;
  invalidatePaths(s);
  emit(s, 'exitOpened', null, exit);
}
