/**
 * Secret chamber checks (plan 05), called from check-floors.ts: placement on every floor of every
 * pyramid and on fuzz seeds, rule tests on scripted states of the real Egypt floors, and the
 * deterministic replay with the secret sequence in it. Pure core code only.
 */
import { profileFor } from '../src/game/core/architecture';
import { EGYPT_FRAGMENT_FLOORS } from '../src/game/core/egypt';
import { DIRS, TILE, distancesFrom, type Floor } from '../src/game/core/floor';
import { floorFor, layoutFor } from '../src/game/core/generate';
import { startFloor, step, type Direction, type GameState, type Pyramid } from '../src/game/core/game';
import { createRng } from '../src/game/core/rng';
import { BREAK_SECONDS, KNOCK_COOLDOWN, NOISE_BREAK, NOISE_KNOCK, SEAL, TREASURE_KINDS, placeSecrets } from '../src/game/core/secrets';
import { PYRAMIDS } from '../src/game/core/pyramids';
import type { Report } from './check-traps';

const egypt = PYRAMIDS.egypt;
const tick = (s: GameState, seconds: number) => step(s, { type: 'tick', seconds });
const move = (s: GameState, dir: Direction) => step(s, { type: 'move', dir });
const has = (s: GameState, type: string) => s.events.some((e) => e.type === type);

/** FNV of the secrets of a floor (the `egypt:i:sec` snapshot keys). */
export function secretsHash(f: Floor): string {
  let h = 0x811c9dc5;
  const mix = (v: number) => {
    h ^= v & 255;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  const num = (v: number) => {
    for (let b = 0; b < 4; b++) mix(v >> (8 * b));
  };
  num(f.secrets.length);
  for (const sec of f.secrets) {
    num(sec.seal);
    num(sec.front);
    for (const t of sec.tiles) num(t);
    num(sec.spot);
    num(TREASURE_KINDS.indexOf(sec.treasure));
    num(sec.fragment);
  }
  return h.toString(16).padStart(8, '0');
}

export type SecretStats = { total: number; offPath: number; short: number; floors: number };
export const newSecretStats = (): SecretStats => ({ total: 0, offPath: 0, short: 0, floors: 0 });

/** Placement assertions for one floor. `real` = a fixed-seed pyramid (full count is a failure). */
export function checkSecretsFloor(label: string, p: Pyramid, i: number, f: Floor, { fail, warn }: Report, real: boolean, stats?: SecretStats) {
  const size = f.size;
  const want = profileFor(p.architecture).secrets?.(i) ?? 1;
  if (f.secrets.length > want) fail(`${label}: ${f.secrets.length} secrets, want at most ${want}`);
  if (f.secrets.length < want) {
    if (real) fail(`${label}: ${f.secrets.length} of ${want} secrets placed`);
    else if (f.secrets.length === 0) (i < 6 ? warn : fail)(`${label}: no secret${i < 6 ? ' (a tiny early floor has no rock to carve)' : ''}`);
    else if (stats) stats.short++;
  }
  if (stats) stats.floors++;
  const path = new Set(f.mainPath);
  const trapTiles = new Set<number>();
  for (const t of f.traps) {
    trapTiles.add(t.tile);
    for (const d of [1, -1, size, -size]) trapTiles.add(t.tile + d);
    if (t.target >= 0) trapTiles.add(t.target);
  }
  const lair = f.guardian?.lair ?? -2;
  const near = (a: number, b: number) => a === b || Math.abs(a - b) === 1 || Math.abs(a - b) === size;
  f.secrets.forEach((sec, k) => {
    const tag = `${label} secret ${k}`;
    if (stats) {
      stats.total++;
      if (!path.has(sec.front)) stats.offPath++;
    }
    if (f.tiles[sec.seal] !== TILE.ROCK) fail(`${tag}: seal is not rock`);
    if (f.tiles[sec.front] !== TILE.FLOOR || f.solid[sec.front]) fail(`${tag}: front is not floor`);
    if (sec.seal !== sec.front - size) fail(`${tag}: seal is not north of the front`);
    const { x, y, w, h } = sec.rect;
    if (sec.tiles.length !== w * h) fail(`${tag}: tiles do not fill the rect`);
    for (let yy = y - 1; yy <= y + h; yy++)
      for (let xx = x - 1; xx <= x + w; xx++) {
        if (xx < 0 || yy < 0 || xx >= size || yy >= size || f.tiles[yy * size + xx] !== TILE.ROCK) fail(`${tag}: rect margin is not rock at ${xx},${yy}`);
        if (f.exit >= 0 && (f.exit === yy * size + xx || [1, -1, size, -size].some((d) => f.exit + d === yy * size + xx))) fail(`${tag}: touches the exit pocket`);
      }
    if (!sec.tiles.includes(sec.spot)) fail(`${tag}: spot outside the chamber`);
    if (f.items.some((it) => it.tile === sec.front)) fail(`${tag}: front holds an item`);
    if (f.fixtures.some((fx) => fx.tile === sec.front)) fail(`${tag}: front holds a fixture`);
    if (trapTiles.has(sec.front)) fail(`${tag}: front on or next to a trap`);
    if (sec.front === f.exitFront) fail(`${tag}: front is the exit front`);
    if (near(sec.front, lair)) fail(`${tag}: front next to the guardian's lair`);
    if (f.spots.some((sp) => sp.kind === 'niche' && sp.tile === sec.front)) fail(`${tag}: front is a niche`);
    const kind = f.rooms[f.room[sec.front]].kind;
    if (kind === 'stairsUp' || kind === 'stairsDown' || kind === 'burial') fail(`${tag}: front in a ${kind}`);
    const fr = profileFor(p.architecture).fragment?.(i) ?? -1;
    const wantFrag = k === 0 ? fr : -1;
    if (sec.fragment !== wantFrag) fail(`${tag}: fragment ${sec.fragment}, want ${wantFrag}`);
    for (let j = k + 1; j < f.secrets.length; j++) {
      const o = f.secrets[j].rect;
      const gapX = Math.max(o.x - (x + w), x - (o.x + o.w), 0);
      const gapY = Math.max(o.y - (y + h), y - (o.y + o.h), 0);
      if (Math.max(gapX, gapY) < 2) fail(`${tag}: chamber ${j} too close`);
    }
  });
}

// ---- rule tests -------------------------------------------------------------------------------------

function put(s: GameState, tile: number) {
  s.pos = s.prevPos = tile;
  s.burning = true;
  s.cooldown = 0;
}

/** Walks along the grid to `target` with the real cadence (tick until the move is allowed). */
export function walkTo(s: GameState, target: number, dt = 1 / 60): GameState {
  const dist = distancesFrom(s.grid.solid, s.grid.size, target);
  let guard = 0;
  while (s.pos !== target && s.status === 'playing' && guard++ < 4000) {
    let dir: Direction | -1 = -1;
    for (let d = 0; d < 4; d++) {
      const [dx, dy] = DIRS[d];
      const nx = (s.pos % s.grid.size) + dx;
      const ny = Math.floor(s.pos / s.grid.size) + dy;
      if (nx < 0 || ny < 0 || nx >= s.grid.size || ny >= s.grid.size) continue;
      const q = ny * s.grid.size + nx;
      if (dist[q] >= 0 && dist[q] < dist[s.pos]) {
        dir = d as Direction;
        break;
      }
    }
    if (dir < 0) break;
    while (s.cooldown > 0 && s.status === 'playing') s = tick(s, dt);
    s = move(s, dir);
  }
  return s;
}

function openSeal(s: GameState, k: number, fail: (m: string) => void, tag: string): GameState {
  const sec = s.floor.secrets[k];
  put(s, sec.front);
  s = move(s, 3);
  if (s.secretPhase[k] !== SEAL.KNOCKED) fail(`${tag}: first push did not knock`);
  while (s.cooldown > 0) s = tick(s, 0.05);
  s = move(s, 3);
  if (s.secretPhase[k] !== SEAL.BREAKING) fail(`${tag}: second push did not break`);
  for (let t = 0; t < BREAK_SECONDS + 0.2 && s.secretPhase[k] !== SEAL.OPEN; t += 0.05) s = tick(s, 0.05);
  return s;
}

/** The secret sequence plus random actions; used for the replay check. */
function replay(fi: number, seed: number): string {
  const rng = createRng(seed);
  let s = startFloor(egypt, fi, { kind: 'bigTorch', left: 100 }, []);
  const f = s.floor;
  for (let k = 0; k < f.secrets.length && s.status === 'playing'; k++) {
    s = openSeal(s, k, () => {}, '');
    s = walkTo(s, f.secrets[k].spot);
  }
  for (let a = 0; a < 3000 && s.status === 'playing'; a++) {
    if (a % 2 === 0) s = tick(s, 0.1);
    else s = move(s, Math.floor(rng() * 4) as Direction);
  }
  let h = 0x811c9dc5;
  const mix = (v: number) => {
    h ^= v & 255;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  const num = (v: number) => {
    const b = new DataView(new ArrayBuffer(8));
    b.setFloat64(0, v);
    for (let i = 0; i < 8; i++) mix(b.getUint8(i));
  };
  num(s.pos);
  num(s.trail);
  num(s.secretsFound);
  for (const v of s.secretPhase) num(v);
  for (const v of s.secretTimer) num(v);
  for (const v of s.grid.solid) mix(v);
  for (const v of s.seenAt) num(v);
  for (const e of s.events) {
    num(e.seq);
    num(e.at);
  }
  for (let k = 0; k < s.status.length; k++) mix(s.status.charCodeAt(k));
  return h.toString(16);
}

export function runSecretRules({ fail, warn }: Report) {
  void warn;
  for (const fi of [2, 7, 17, 24]) {
    const tag = `secrets rules floor ${fi + 1}`;
    let s = startFloor(egypt, fi, { kind: 'bigTorch', left: 100 }, []);
    const f = s.floor;
    const sec = f.secrets[0];
    if (!sec) {
      fail(`${tag}: no secret`);
      continue;
    }
    if (s.secretPhase.some((v) => v !== 0) || s.secretsFound !== 0) fail(`${tag}: run does not start sealed`);
    // pushing from the side or from below does nothing
    put(s, sec.front);
    for (const dir of [0, 1, 2] as Direction[]) {
      const before = s.secretPhase[0];
      s = move(s, dir);
      if (s.secretPhase[0] !== before) fail(`${tag}: a push in direction ${dir} touched the seal`);
      put(s, sec.front);
    }
    put(s, sec.seal + 1);
    s.cooldown = 0;
    s = move(s, 1);
    if (s.secretPhase[0] !== SEAL.SEALED) fail(`${tag}: the seal opened from the side`);
    // first push: knock
    put(s, sec.front);
    const seq0 = s.eventSeq;
    s = move(s, 3);
    if (s.secretPhase[0] !== SEAL.KNOCKED) fail(`${tag}: first push is not a knock`);
    if (!s.events.some((e) => e.seq > seq0 && e.type === 'secretKnock' && e.at === sec.seal)) fail(`${tag}: no secretKnock event at the seal`);
    if (Math.abs(s.cooldown - KNOCK_COOLDOWN) > 1e-6) fail(`${tag}: knock cooldown ${s.cooldown}`);
    if (!s.grid.solid[sec.seal]) fail(`${tag}: the seal opened on the first push`);
    if (s.guardian) {
      let queued = false;
      for (let q = 0; q < s.noises.length; q += 2) if (s.noises[q] === sec.seal && s.noises[q + 1] === NOISE_KNOCK) queued = true;
      if (!queued) fail(`${tag}: the knock made no noise for the guardian`);
    }
    // a push during the cooldown is ignored
    s = move(s, 3);
    if (s.secretPhase[0] !== SEAL.KNOCKED) fail(`${tag}: a push during the cooldown counted`);
    while (s.cooldown > 0) s = tick(s, 0.05);
    s = move(s, 3);
    if (s.secretPhase[0] !== SEAL.BREAKING) fail(`${tag}: second push is not a break`);
    if (!has(s, 'secretBreak')) fail(`${tag}: no secretBreak event`);
    if (s.guardian) {
      let queued = false;
      for (let q = 0; q < s.noises.length; q += 2) if (s.noises[q] === sec.seal && s.noises[q + 1] === NOISE_BREAK) queued = true;
      if (!queued) fail(`${tag}: the break made no noise for the guardian`);
    }
    s = tick(s, BREAK_SECONDS - 0.1);
    if (s.secretPhase[0] !== SEAL.BREAKING || !s.grid.solid[sec.seal]) fail(`${tag}: opened early`);
    s = tick(s, 0.2);
    if (s.secretPhase[0] !== SEAL.OPEN) fail(`${tag}: not open after ${BREAK_SECONDS} s`);
    if (!has(s, 'secretOpen')) fail(`${tag}: no secretOpen event`);
    if (s.grid.solid[sec.seal] || s.grid.opaque[sec.seal] || sec.tiles.some((t) => s.grid.solid[t] || s.grid.opaque[t])) fail(`${tag}: grid not open`);
    if (!f.solid[sec.seal] || sec.tiles.some((t) => !f.solid[t])) fail(`${tag}: the floor's own mask changed`);
    const reach = distancesFrom(s.grid.solid, s.grid.size, s.pos);
    if (reach[sec.spot] < 0) fail(`${tag}: the spot is not reachable`);
    if (!sec.tiles.some((t) => s.light[t] > 0)) fail(`${tag}: light does not reach inside`);
    if (s.guardian) {
      const g = distancesFrom(s.grid.solid, s.grid.size, f.guardian!.lair);
      if (g[sec.spot] < 0) fail(`${tag}: the guardian cannot path into the open chamber`);
    }
    // the grave good
    const seq1 = s.eventSeq;
    s = walkTo(s, sec.spot);
    if (s.pos !== sec.spot) fail(`${tag}: could not walk to the spot`);
    const got = s.events.filter((e) => e.seq > seq1 && e.type === 'treasure');
    if (got.length !== 1 || got[0].kind !== sec.treasure || got[0].at !== sec.spot) fail(`${tag}: treasure event wrong`);
    const frag = s.events.filter((e) => e.seq > seq1 && e.type === 'fragment');
    if (frag.length !== (sec.fragment >= 0 ? 1 : 0)) fail(`${tag}: fragment events ${frag.length}, secret holds ${sec.fragment}`);
    if (!(s.secretsFound & 1)) fail(`${tag}: secretsFound bit not set`);
    const seq2 = s.eventSeq;
    s = walkTo(s, sec.front);
    s = walkTo(s, sec.spot);
    if (s.events.some((e) => e.seq > seq2 && (e.type === 'treasure' || e.type === 'fragment'))) fail(`${tag}: the grave good was taken twice`);
    // a fresh run starts sealed again
    const fresh = startFloor(egypt, fi);
    if (fresh.secretPhase.some((v) => v !== 0) || fresh.secretsFound !== 0 || !fresh.grid.solid[sec.seal]) fail(`${tag}: a fresh run is not sealed`);
  }
  // fragments sit on the story floors only
  for (let i = 0; i < egypt.floorCount; i++) {
    const f = floorFor(egypt, i);
    const frag = f.secrets.filter((x) => x.fragment >= 0).length;
    const want = (EGYPT_FRAGMENT_FLOORS as readonly number[]).includes(i) ? 1 : 0;
    if (frag !== want) fail(`egypt floor ${i + 1}: ${frag} fragments, want ${want}`);
  }
  // determinism
  for (const fi of [2, 17, 24]) {
    const a = replay(fi, 4321 + fi);
    const b = replay(fi, 4321 + fi);
    if (a !== b) fail(`secrets replay: egypt floor ${fi + 1} diverged between two runs`);
  }
  // timing
  const f24 = floorFor(egypt, 23);
  const l24 = layoutFor(egypt, 23);
  const p = profileFor('egypt');
  const t0 = performance.now();
  for (let r = 0; r < 20; r++)
    placeSecrets({ layout: l24, profile: p, floorIndex: 23, seed: f24.seed, items: f24.items, fixtures: f24.fixtures, traps: f24.traps, collapse: f24.collapse, exit: f24.exit, exitFront: f24.exitFront, guardian: f24.guardian });
  const ms = (performance.now() - t0) / 20;
  console.log(`secrets: placeSecrets on floor 24 ${ms.toFixed(2)} ms`);
  if (ms > 5) warn(`placeSecrets ${ms.toFixed(1)} ms on floor 24 (target < 5)`);
}
