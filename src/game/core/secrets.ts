import type { ArchProfile } from './architecture';
import { DIRS, TILE, type Collapse, type Fixture, type GuardianPlan, type Item, type Layout, type Trap } from './floor';
import type { GameState } from './game';
import { createRng, shuffle } from './rng';
import { emit, invalidatePaths, noise } from './runtime';

/**
 * Sealed secret chambers (plan 05): a doorway closed with plaster in a wall face. Pushing it twice
 * from the floor tile in front breaks it and opens a small chamber with a grave good (and, on some
 * floors, a story fragment). The chamber stays ROCK in `floor.tiles/solid/opaque`, so every layout
 * and feature invariant, the sand order, trapdoor landings and all committed hashes are unchanged;
 * only the run's `grid` opens it.
 */

export type TreasureKind = 'amulet' | 'jar' | 'collar' | 'figurine';
export const TREASURE_KINDS: readonly TreasureKind[] = ['amulet', 'jar', 'collar', 'figurine'];
export const TREASURE_NAME: Record<TreasureKind, string> = { amulet: 'Faience amulet', jar: 'Alabaster jar', collar: 'Broad collar', figurine: 'Shabti figurine' };

export type Secret = {
  /** ROCK tile: the plastered doorway, on the north wall of `front` */
  seal: number;
  /** FLOOR tile south of it (you push north from here) */
  front: number;
  /** chamber tiles, ROCK in floor.tiles/solid/opaque until opened (run grid only) */
  tiles: Int32Array;
  /** chamber rect (tiles), for the art */
  rect: { x: number; y: number; w: number; h: number };
  /** the chamber tile the grave good lies on (farthest from the seal, ties lowest index) */
  spot: number;
  treasure: TreasureKind;
  /** story fragment index in the pyramid, or -1 */
  fragment: number;
};

/** per secret: 0 sealed, 1 knocked (hollow), 2 breaking, 3 open */
export const SEAL = { SEALED: 0, KNOCKED: 1, BREAKING: 2, OPEN: 3 } as const;

export const KNOCK_COOLDOWN = 0.3;
export const BREAK_SECONDS = 0.6;
export const NOISE_KNOCK = 4;
export const NOISE_BREAK = 8;

const SEED_XOR = 0x3c6ef372;
/** shapes w x h in the order they are tried */
const SHAPES: ReadonlyArray<readonly [number, number]> = [
  [3, 2],
  [2, 2],
  [2, 1],
  [1, 2],
  [1, 1],
];

export type SecretPlaceArgs = {
  layout: Layout;
  profile: ArchProfile;
  floorIndex: number;
  seed: number;
  items: Item[];
  fixtures: Fixture[];
  traps: Trap[];
  collapse: Collapse | null;
  exit: number;
  exitFront: number;
  guardian: GuardianPlan | null;
};

type Cand = { f: number; shape: number; x0: number; leaf: number; path: number; sand: number };

/** Chebyshev rectangle expanded by `m` tiles. */
const expand = (r: Secret['rect'], m: number) => ({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m });
const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Chooses the sealed chambers of a floor: `profile.secrets(floorIndex)` of them, in rock above a
 * floor tile in a wall that faces south (the face the 3/4 view shows). Own rng stream
 * `seed ^ 0x3c6ef372`; runs after everything else so nothing earlier changes.
 */
export function placeSecrets(a: SecretPlaceArgs): Secret[] {
  const { layout, profile, floorIndex, items, fixtures, traps, collapse, exit, exitFront, guardian } = a;
  const { size, tiles, room: roomOf, rooms, mainPath, spots, start, stairs } = layout;
  const want = profile.secrets?.(floorIndex) ?? 1;
  const rng = createRng(a.seed ^ SEED_XOR);
  const n = size * size;
  const onPath = new Uint8Array(n);
  for (const p of mainPath) onPath[p] = 1;
  const taken = new Uint8Array(n);
  const ban = (t: number) => {
    if (t >= 0 && t < n) taken[t] = 1;
  };
  for (const it of items) ban(it.tile);
  for (const f of fixtures) ban(f.tile);
  for (const sp of spots) if (sp.kind === 'niche') ban(sp.tile);
  for (const tr of traps) {
    ban(tr.tile);
    if (tr.target >= 0) ban(tr.target);
    for (const [dx, dy] of DIRS) ban(tr.tile + dy * size + dx);
  }
  if (guardian) {
    ban(guardian.lair);
    for (const [dx, dy] of DIRS) ban(guardian.lair + dy * size + dx);
  }
  ban(start);
  ban(stairs);
  if (exitFront >= 0) ban(exitFront);

  const rockRect = (x: number, y: number, w: number, h: number) => {
    if (x < 0 || y < 0 || x + w > size || y + h > size) return false;
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (tiles[yy * size + xx] !== TILE.ROCK) return false;
    return true;
  };
  /** the rect expanded by 1 contains the exit or a tile 4-adjacent to it */
  const nearExit = (x: number, y: number, w: number, h: number) => {
    if (exit < 0) return false;
    const ex = exit % size;
    const ey = (exit - ex) / size;
    for (const [dx, dy] of [[0, 0], ...DIRS] as Array<readonly [number, number]>) {
      const tx = ex + dx;
      const ty = ey + dy;
      if (tx >= x - 1 && tx <= x + w && ty >= y - 1 && ty <= y + h) return true;
    }
    return false;
  };

  const cands: Cand[] = [];
  const floorOrder: number[] = [];
  for (let f = 0; f < n; f++) {
    if (tiles[f] !== TILE.FLOOR || taken[f]) continue;
    const r = roomOf[f];
    if (r < 0) continue;
    const kind = rooms[r].kind;
    if (kind === 'stairsUp' || kind === 'stairsDown' || kind === 'burial') continue;
    floorOrder.push(f);
  }
  for (const f of floorOrder) {
    const fx = f % size;
    const fy = (f - fx) / size;
    for (let si = floorIndex < 6 ? 2 : 0; si < SHAPES.length; si++) {
      const [w, h] = SHAPES[si];
      if (fy < h + 3) continue;
      for (let x0 = fx - w + 1; x0 <= fx; x0++) {
        const y0 = fy - 1 - h;
        // the rect expanded by 1 (it contains the seal and its side neighbours) must be rock
        if (!rockRect(x0 - 1, y0 - 1, w + 2, h + 2)) continue;
        if (x0 < 1 || x0 + w > size - 1 || y0 < 1) continue;
        if (nearExit(x0, y0, w, h)) continue;
        cands.push({ f, shape: si, x0, leaf: rooms[roomOf[f]].leaf ? 0 : 1, path: onPath[f], sand: collapse && collapse.rank[f] !== -1 ? 1 : 0 });
        break; // first offset that fits
      }
    }
  }
  shuffle(cands, rng);
  cands.sort((p, q) => p.shape - q.shape || p.path - q.path || p.sand - q.sand || p.leaf - q.leaf);

  const out: Secret[] = [];
  const mk = (c: Cand): Secret => {
    const [w, h] = SHAPES[c.shape];
    const fy = Math.floor(c.f / size);
    const rect = { x: c.x0, y: fy - 1 - h, w, h };
    const seal = c.f - size;
    const sx = seal % size;
    const sy = (seal - sx) / size;
    const ts: number[] = [];
    for (let yy = rect.y; yy < rect.y + h; yy++) for (let xx = rect.x; xx < rect.x + w; xx++) ts.push(yy * size + xx);
    let spot = ts[0];
    let best = -1;
    for (const t of ts) {
      const d = Math.abs((t % size) - sx) + Math.abs(Math.floor(t / size) - sy);
      if (d > best) {
        best = d;
        spot = t;
      }
    }
    return { seal, front: c.f, tiles: Int32Array.from(ts), rect, spot, treasure: TREASURE_KINDS[(rng() * 4) | 0], fragment: -1 };
  };
  const fits = (c: Cand, minGap: number) => {
    const [w, h] = SHAPES[c.shape];
    const rect = { x: c.x0, y: Math.floor(c.f / size) - 1 - h, w, h };
    const e1 = expand(rect, 1);
    for (const o of out) {
      if (overlaps(e1, expand(o.rect, 1))) return false;
      const dm = Math.abs((c.f % size) - (o.front % size)) + Math.abs(Math.floor(c.f / size) - Math.floor(o.front / size));
      if (dm < minGap) return false;
    }
    return true;
  };
  for (const minGap of [size / 4, 0]) {
    for (const c of cands) {
      if (out.length >= want) break;
      if (out.some((o) => o.front === c.f)) continue;
      if (fits(c, minGap)) out.push(mk(c));
    }
    if (out.length >= want) break;
  }
  if (out.length) out[0].fragment = profile.fragment?.(floorIndex) ?? -1;
  return out;
}

// ---- rules ------------------------------------------------------------------------------------------

/** The secret whose seal tile is `tile`, or -1. */
export function secretAtSeal(floor: { secrets: Secret[] }, tile: number): number {
  const list = floor.secrets;
  for (let k = 0; k < list.length; k++) if (list[k].seal === tile) return k;
  return -1;
}

/** Pushes the plaster from its front tile: the first push sounds hollow, the second breaks it. */
export function pushSeal(s: GameState, k: number): boolean {
  const sec = s.floor.secrets[k];
  const phase = s.secretPhase[k];
  if (phase >= SEAL.BREAKING) return false;
  s.burning = true;
  s.idle = 0;
  if (phase === SEAL.SEALED) {
    s.secretPhase[k] = SEAL.KNOCKED;
    s.cooldown = KNOCK_COOLDOWN;
    emit(s, 'secretKnock', null, sec.seal);
    noise(s, sec.seal, NOISE_KNOCK);
  } else {
    s.secretPhase[k] = SEAL.BREAKING;
    s.secretTimer[k] = BREAK_SECONDS;
    s.cooldown = BREAK_SECONDS;
    emit(s, 'secretBreak', null, sec.seal);
    noise(s, sec.seal, NOISE_BREAK);
  }
  return true;
}

/** Counts breaking plaster down; an opened chamber is plain open tiles in the run's grid. */
export function tickSecrets(s: GameState, dt: number) {
  const list = s.floor.secrets;
  for (let k = 0; k < list.length; k++) {
    if (s.secretPhase[k] !== SEAL.BREAKING) continue;
    s.secretTimer[k] -= dt;
    if (s.secretTimer[k] > 0) continue;
    s.secretTimer[k] = 0;
    s.secretPhase[k] = SEAL.OPEN;
    const sec = list[k];
    const { solid, opaque } = s.grid;
    solid[sec.seal] = opaque[sec.seal] = 0;
    for (const t of sec.tiles) solid[t] = opaque[t] = 0;
    s.opaqueDirty = true;
    invalidatePaths(s);
    emit(s, 'secretOpen', null, sec.seal);
  }
}

/** Standing on the grave good of an open chamber takes it (once per run; the save keeps finds). */
export function takeSecretAt(s: GameState) {
  const list = s.floor.secrets;
  for (let k = 0; k < list.length; k++) {
    const sec = list[k];
    if (sec.spot !== s.pos || s.secretPhase[k] !== SEAL.OPEN || s.secretsFound & (1 << k)) continue;
    s.secretsFound |= 1 << k;
    emit(s, 'treasure', sec.treasure, sec.spot);
    if (sec.fragment >= 0) emit(s, 'fragment', null, sec.spot);
    noise(s, sec.spot, 3);
  }
}

export const popcount = (v: number) => {
  let c = 0;
  for (let x = v >>> 0; x; x &= x - 1) c++;
  return c;
};
