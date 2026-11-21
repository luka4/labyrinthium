import { profileFor, type GenSpec } from './architecture';
import { BURY_ITEM, SLOPE, rebuildRank, sandOrder } from './collapse';
import { DIRS, TILE, distancesFrom, type Collapse, type Fixture, type Item, type Layout, type Trap, type TrapKind } from './floor';
import type { GameState } from './game';
import { articulationPoints, nearestOpen, reachable } from './graph';
import { shuffle, type Rng } from './rng';
import { buryItem, emit, invalidatePaths, loseHand, noise, recoilGuardian, smotherFixture } from './runtime';

/**
 * Pressure-plate traps and trapdoors (plan 03). Placement runs after the lights (it needs items,
 * fixtures, `dist` and the main path); the runtime half (`pressPlate`, `tickTraps`) is called by
 * `step`. Authentic mechanisms only: a ceiling block, a granite portcullis, sand released over
 * tomb goods, and a pivoting trapdoor slab. Nothing kills; a trap costs light, a route or loot.
 */

/** Seconds you are stunned after a block or portcullis hits you. */
export const STUN_HIT = 0.8;
/** Seconds you are stunned after landing from a trapdoor. */
export const LAND_STUN = 1.0;

/** Seconds from press to effect. The trapdoor must open while you are still on the slab (a step takes 0.15 s). */
const DELAY: Record<TrapKind, number> = { block: 0.5, portcullis: 0.35, sandfall: 0.6, trapdoor: 0.1 };
const SPACING = 4;
const MIN_DIST = 6;
const MAX_TRAPS = 24;
const SAND_FULL = 179;
const SAND_STAGGER = 2;
const SAND_RAMP = 1;
const SAND_DONE = SAND_STAGGER + SAND_RAMP + 0.1;

const manhattan = (size: number, a: number, b: number) => Math.abs((a % size) - (b % size)) + Math.abs(Math.floor(a / size) - Math.floor(b / size));

type RoomLike = Pick<Layout, 'size' | 'solid' | 'room' | 'rooms'>;

/** Rooms you must not land in: the stairwells and the burial chamber. */
function protectedRoom(f: RoomLike, tile: number): boolean {
  const r = f.room[tile];
  if (r < 0) return false;
  const k = f.rooms[r].kind;
  return k === 'stairsUp' || k === 'stairsDown' || k === 'burial';
}

/** Is the tile inside the part of the floor the collapse will bury? (`rank` is -1 beyond it.) */
function inCollapse(c: Pick<Collapse, 'rank' | 'cap'> | null, tile: number): boolean {
  return !!c && c.rank[tile] >= 0 && c.rank[tile] <= c.cap + 4 * SLOPE;
}

/**
 * Where a trapdoor drops you on a floor: the open tile nearest the projected world point that is
 * not a trap tile or next to one, not in a stairwell or the burial chamber, and not in the sand's
 * reach. One function for the generator's pre-check (on the bare layout) and for `startFloor`.
 */
export function resolveLanding(
  f: RoomLike & { collapse?: Collapse | null; traps?: Trap[] },
  world: { x: number; y: number },
  collapse: Pick<Collapse, 'rank' | 'cap'> | null = f.collapse ?? null,
  /** tiles to treat as trap tiles too (the generator's worst-case check) */
  extra: number[] = [],
): number {
  const { size } = f;
  const half = size >> 1;
  const x = Math.max(1, Math.min(size - 2, world.x + half));
  const y = Math.max(1, Math.min(size - 2, world.y + half));
  const bad = new Set<number>();
  const tiles = [...(f.traps ?? []).map((t) => t.tile), ...extra];
  for (const tile of tiles) {
    bad.add(tile);
    for (const [dx, dy] of DIRS) bad.add(tile + dy * size + dx);
  }
  return nearestOpen(f.solid, size, x, y, (i) => bad.has(i) || protectedRoom(f, i) || inCollapse(collapse, i));
}

export type PlacedTraps = { traps: Trap[]; trapAt: Int16Array; eligiblePorts: number };

export function placeTraps(a: { layout: Layout; items: Item[]; fixtures: Fixture[]; spec: GenSpec; below: Layout | null; rng: Rng }): PlacedTraps {
  const { layout, items, fixtures, spec, below, rng } = a;
  const { size, tiles, solid, room: roomOf, rooms, links, dist, mainPath, start, stairs } = layout;
  const profile = profileFor(spec.profile);
  const row = profile.traps?.(spec.floorIndex);
  const traps: Trap[] = [];
  const trapAt = new Int16Array(size * size).fill(-1);
  if (!row) return { traps, trapAt, eligiblePorts: 0 };

  const n = size * size;
  const onPath = new Uint8Array(n);
  for (const p of mainPath) onPath[p] = 1;
  const doorTile = new Uint8Array(n);
  for (const l of links) doorTile[l.door] = 1;
  const fixtureTile = new Uint8Array(n);
  for (const f of fixtures) fixtureTile[f.tile] = 1;
  const nearItem = new Uint8Array(n);
  for (const it of items) {
    nearItem[it.tile] = 1;
    for (const [dx, dy] of DIRS) nearItem[it.tile + dy * size + dx] = 1;
  }
  const removed = solid.slice();
  const ap = new Uint8Array(n);
  let open = 0;
  for (let i = 0; i < n; i++) if (!solid[i]) open++;
  articulationPoints(removed, size, ap);
  let recomputes = 0;
  const plates: number[] = [];

  const kindOfRoom = (t: number) => (roomOf[t] >= 0 ? rooms[roomOf[t]].kind : 'passage');
  const roomOk = (t: number) => {
    const k = kindOfRoom(t);
    return k !== 'stairsUp' && k !== 'stairsDown' && k !== 'burial';
  };
  /** the fairness contract I3 for a plate or slab tile */
  const okTile = (t: number) =>
    !removed[t] &&
    tiles[t] === TILE.FLOOR &&
    dist[t] >= MIN_DIST &&
    !onPath[t] &&
    roomOk(t) &&
    !nearItem[t] &&
    !fixtureTile[t] &&
    !doorTile[t] &&
    t !== start &&
    t !== stairs &&
    plates.every((p) => manhattan(size, p, t) >= SPACING);
  /** removing these tiles keeps every other open tile reachable from the start */
  const stillConnected = (gone: number[]) => {
    const test = removed.slice();
    for (const g of gone) test[g] = 1;
    return reachable(test, size, start) === open - gone.length - (removedExtra);
  };
  let removedExtra = 0;
  const accept = (trap: Trap, gone: number[]) => {
    plates.push(trap.tile);
    for (const g of gone) {
      removed[g] = 1;
      removedExtra++;
    }
    trapAt[trap.tile] = traps.length;
    traps.push(trap);
    if (recomputes++ < MAX_TRAPS) articulationPoints(removed, size, ap);
  };
  const count = (k: TrapKind) => traps.filter((t) => t.kind === k).length;
  const area = new Int32Array(0);

  // block: a flagstone in a room, away from pillars and walls ------------------------------
  {
    const roomKinds = new Set(['hall', 'chamber', 'shrine', 'magazines', 'gallery']);
    const cands: number[] = [];
    for (let i = 0; i < n; i++) {
      if (solid[i] || tiles[i] !== TILE.FLOOR || !roomKinds.has(kindOfRoom(i))) continue;
      // open flagstones around it: at most one pillar, wall or bench right next to the plate
      if (DIRS.filter(([dx, dy]) => tiles[i + dy * size + dx] === TILE.FLOOR).length >= 3) cands.push(i);
    }
    shuffle(cands, rng);
    for (const t of cands) {
      if (count('block') >= row.block || traps.length >= MAX_TRAPS) break;
      if (ap[t] || !okTile(t) || !stillConnected([t])) continue;
      accept({ kind: 'block', tile: t, target: t, area, delay: DELAY.block, landingWorld: null }, [t]);
    }
  }

  // portcullis: a port on a loop cycle, plate on the approach side --------------------------
  let eligiblePorts = 0;
  {
    type Cand = { port: number; plate: number };
    const cands: Cand[] = [];
    for (const l of links) {
      const d = l.door;
      if (solid[d] || ap[d] || onPath[d]) continue;
      const open4 = DIRS.map(([dx, dy]) => d + dy * size + dx).filter((q) => !solid[q]);
      if (open4.length !== 2 || open4[0] + open4[1] !== 2 * d) continue; // two open neighbours in a line
      const plate = dist[open4[0]] <= dist[open4[1]] ? open4[0] : open4[1];
      if (dist[plate] < 0) continue;
      cands.push({ port: d, plate });
    }
    // eligibility as a count (the plate rules apply too, so it is the real supply)
    for (const c of cands) if (okTile(c.plate)) eligiblePorts++;
    shuffle(cands, rng);
    for (const c of cands) {
      if (count('portcullis') >= row.portcullis || traps.length >= MAX_TRAPS) break;
      if (ap[c.port] || !okTile(c.plate) || !stillConnected([c.port, c.plate])) continue;
      accept({ kind: 'portcullis', tile: c.plate, target: c.port, area, delay: DELAY.portcullis, landingWorld: null }, [c.port, c.plate]);
    }
  }

  // sandfall: a plate a few steps from a jar or lamp in a room -----------------------------
  {
    const roomKinds = new Set(['hall', 'chamber', 'shrine', 'magazines']);
    // tomb goods: items lying in rooms and the shrine candles
    const goods = [...items.map((it) => it.tile), ...fixtures.filter((f) => f.kind === 'shrineCandles').map((f) => f.tile)];
    const cands = goods.filter((t) => roomOk(t) && !onPath[t]);
    shuffle(cands, rng);
    const bfsRoom = (from: number, room: number, depth: number): Map<number, number> => {
      const seen = new Map<number, number>([[from, 0]]);
      const queue = [from];
      for (let h = 0; h < queue.length; h++) {
        const p = queue[h];
        const d = seen.get(p)!;
        if (d >= depth) continue;
        for (const [dx, dy] of DIRS) {
          const q = p + dy * size + dx;
          if (solid[q] || removed[q] || roomOf[q] !== room || seen.has(q)) continue;
          seen.set(q, d + 1);
          queue.push(q);
        }
      }
      return seen;
    };
    for (const good of cands) {
      if (count('sandfall') >= row.sandfall || traps.length >= MAX_TRAPS) break;
      const room = roomOf[good];
      const near = bfsRoom(good, room, 4);
      const plateCands = [...near.entries()].filter(([t, d]) => d >= 2 && okTile(t) && !ap[t]).map(([t]) => t);
      shuffle(plateCands, rng);
      const plate = plateCands.find((t) => stillConnected([t]));
      if (plate === undefined) continue;
      const sand = [...bfsRoom(plate, room, 4).entries()].sort((x, y) => x[1] - y[1] || x[0] - y[0]).map(([t]) => t);
      accept({ kind: 'sandfall', tile: plate, target: good, area: Int32Array.from(sand), delay: DELAY.sandfall, landingWorld: null }, [plate]);
    }
  }

  // trapdoor: a slab off the main path that drops you onto a safe spot below --------------
  if (row.trapdoor > 0 && below && !spec.nextIsCamp && !spec.basement) {
    const belowRow = profile.collapse?.(spec.floorIndex + 1) ?? null;
    const belowSand = belowRow ? sandOrder(below, belowRow) : null;
    const belowDist = distancesFrom;
    const half = size >> 1;
    const cands: number[] = [];
    for (let i = 0; i < n; i++) if (!solid[i] && tiles[i] === TILE.FLOOR && dist[i] >= 0.3 * dist[stairs]) cands.push(i);
    shuffle(cands, rng);
    for (const t of cands) {
      if (count('trapdoor') >= row.trapdoor || traps.length >= MAX_TRAPS) break;
      if (ap[t] || !okTile(t) || !stillConnected([t])) continue;
      const world = { x: (t % size) - half, y: Math.floor(t / size) - half };
      const land = resolveLanding(below, world, belowSand);
      if (land < 0) continue;
      const far = belowDist(below.solid, below.size, land)[below.stairs];
      // margin over the 0.4 the check asks for: a trap on the floor below can shift the landing a little
      if (far < 0 || far < 0.55 * below.dist[below.stairs]) continue;
      // and if a trap of the floor below sits on that very landing, the next tile must still be fine
      const alt = resolveLanding(below, world, belowSand, [land]);
      if (alt < 0 || belowDist(below.solid, below.size, alt)[below.stairs] < 0.45 * below.dist[below.stairs]) continue;
      accept({ kind: 'trapdoor', tile: t, target: -1, area, delay: DELAY.trapdoor, landingWorld: world }, [t]);
    }
  }

  return { traps, trapAt, eligiblePorts };
}

// ---- runtime -----------------------------------------------------------------------------

/** Sound carried by a plate's click, in path steps (the guardian hears it, whoever stepped on it). */
const PLATE_NOISE = 7;
const BLOCK_NOISE = 16;
const SANDFALL_NOISE = 9;

/** You (or the guardian, `by: 'other'`) stepped on an armed plate or slab. */
export function pressPlate(s: GameState, k: number, by: 'player' | 'other') {
  if (s.trapPhase[k] !== 0) return;
  void by;
  s.trapPhase[k] = 1;
  s.trapTimer[k] = s.floor.traps[k].delay;
  emit(s, 'plate', s.floor.traps[k].kind, s.floor.traps[k].tile);
  noise(s, s.floor.traps[k].tile, PLATE_NOISE);
}

/** The guardian stands on a tile that has just been sealed: the stone drives it back and it recoils. */
function hitGuardian(s: GameState, tile: number) {
  const g = s.guardian;
  if (!g || g.pos !== tile || g.mode === 'dormant' || g.mode === 'arriving' || g.mode === 'gone') return;
  let to = g.prev !== tile && openTile(s, g.prev) ? g.prev : -1;
  if (to < 0) {
    const { size } = s.grid;
    for (const [dx, dy] of DIRS) {
      const q = tile + dy * size + dx;
      if (openTile(s, q)) {
        to = q;
        break;
      }
    }
  }
  if (to >= 0) {
    g.pos = to;
    g.prev = to;
  }
  g.cooldown = 0;
  g.stepDur = 0.3;
  recoilGuardian(s, 4);
  emit(s, 'guardianHit', null, tile);
}

function openTile(s: GameState, t: number) {
  return t >= 0 && !s.grid.solid[t];
}

/** The hit of a block or portcullis: the light is knocked out of your hand and you are pushed out of the way. */
function hit(s: GameState, kind: TrapKind, gone: number, pushTo: number) {
  emit(s, 'hit', kind);
  loseHand(s);
  s.cooldown = Math.max(s.cooldown, STUN_HIT);
  let to = pushTo;
  if (!openTile(s, to) || to === gone) {
    to = -1;
    const { size } = s.grid;
    for (const [dx, dy] of DIRS) {
      const q = gone + dy * size + dx;
      if (openTile(s, q) && q !== gone) {
        to = q;
        break;
      }
    }
  }
  if (to >= 0) s.pos = to;
}

function fire(s: GameState, k: number) {
  const trap = s.floor.traps[k];
  s.trapPhase[k] = 2;
  s.trapTimer[k] = 0;
  emit(s, 'trapFired', trap.kind, trap.tile);
  const { size } = s.grid;
  const seal = (tile: number) => {
    s.grid.solid[tile] = 1;
    s.grid.opaque[tile] = 1;
    s.opaqueDirty = true;
    s.solidDirty = true;
    invalidatePaths(s);
    hitGuardian(s, tile);
  };
  if (trap.kind === 'sandfall') noise(s, trap.tile, SANDFALL_NOISE);
  if (trap.kind === 'block') {
    noise(s, trap.tile, BLOCK_NOISE);
    seal(trap.tile);
    if (s.pos === trap.tile) hit(s, 'block', trap.tile, s.prevPos);
    if (s.collapse?.started) rebuildRank(s);
  } else if (trap.kind === 'portcullis') {
    noise(s, trap.target, BLOCK_NOISE);
    seal(trap.target);
    if (s.pos === trap.target) {
      // far side: opposite the plate
      const far = 2 * trap.target - trap.tile;
      hit(s, 'portcullis', trap.target, Math.abs((far % size) - (trap.target % size)) <= 1 ? far : -1);
    }
    if (s.collapse?.started) rebuildRank(s);
  } else if (trap.kind === 'trapdoor') {
    if (s.pos === trap.tile) {
      s.status = 'falling';
      s.skipped++;
      emit(s, 'fell', 'trapdoor');
    } else s.trapPhase[k] = 3; // you were already gone: the slab stays shut
  }
}

/** Advances pressed plates and running sandfalls. Call while the light burns. */
export function tickTraps(s: GameState, dt: number) {
  const { traps } = s.floor;
  for (let k = 0; k < traps.length; k++) {
    const phase = s.trapPhase[k];
    if (phase === 1) {
      s.trapTimer[k] -= dt;
      if (s.trapTimer[k] <= 0 && s.status === 'playing') fire(s, k);
    } else if (phase === 2 && traps[k].kind === 'sandfall' && s.trapTimer[k] < SAND_DONE) {
      s.trapTimer[k] += dt;
      const { area } = traps[k];
      const t = s.trapTimer[k];
      for (let j = 0; j < area.length; j++) {
        const v = Math.max(0, Math.min(1, (t - (j * SAND_STAGGER) / area.length) / SAND_RAMP));
        const level = Math.round(SAND_FULL * v);
        const i = area[j];
        if (level <= s.localSand[i]) continue;
        s.localSand[i] = level;
        if (s.light[i] > 0) s.seenSand[i] = Math.max(s.sand[i], level);
        if (level / 255 >= BURY_ITEM) {
          buryItem(s, i);
          smotherFixture(s, i);
        }
      }
    }
  }
}
