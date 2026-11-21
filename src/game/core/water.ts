import type { Floor } from './floor';
import { DIRS } from './floor';
import type { GameState } from './game';
import { emit, smotherFixture } from './runtime';

/**
 * The generic liquid layer (plan 06): a per-tile water level 0..255 (fraction of floor-to-ceiling
 * height), static on the floor (`Floor.water`, written by rule plug-ins) and copied per run (`s.water`).
 * It is an overlay: it never touches `solid` / `opaque`. The Naga Amulet uses it now; the Maya cenotes
 * and the Khmer moats and rising levels fill it.
 */
/** thresholds, inclusive */
export const WET = 32;
export const SWIM = 128;
export const FLOODED = 224;
export const WATER = { WET, SWIM, FLOODED } as const;
/** multiplies STEP_SECONDS */
export const WATER_PACE = { shallow: 1.4, deep: 2.0, naga: 1.4 } as const;
/** seconds */
export const BREATH = { max: 8, drainDeep: 1, drainFlooded: 2, recover: 2, low: 3 } as const;
/** added to a step's or quiet step's noise radius in water >= WET */
export const WATER_NOISE = 1;
/** fairness: the longest deep stretch on a power-free route (26 tiles would exhaust the breath; half is the margin) */
export const MAX_DEEP_RUN = 12;

export type WaterBand = 'dry' | 'shallow' | 'deep' | 'flooded';

export function band(level: number): WaterBand {
  return level >= FLOODED ? 'flooded' : level >= SWIM ? 'deep' : level >= WET ? 'shallow' : 'dry';
}

/** the Naga is active (inlined: powers.ts imports this file) */
const nagaActive = (s: Pick<GameState, 'powers'>): boolean => s.powers.some((p) => p.id === 'naga' && p.left > 0);

/** 0 when the run has no water */
export function waterAt(s: Pick<GameState, 'water'>, i: number): number {
  return s.water ? s.water[i] : 0;
}

/** Movement pace in STEP_SECONDS for entering tile i: 1, shallow 1.4, deep 2.0, the Naga in deep or flooded 1.4. */
export function waterPace(s: GameState, i: number): number {
  const lv = waterAt(s, i);
  if (lv >= SWIM) return nagaActive(s) ? WATER_PACE.naga : WATER_PACE.deep;
  return lv >= WET ? WATER_PACE.shallow : 1;
}

/** Flooded to the ceiling and no Naga: a player-movement test only. */
export function waterBlocks(s: GameState, i: number): boolean {
  return waterAt(s, i) >= FLOODED && !nagaActive(s);
}

/**
 * Changes a tile's water level during a run (08's rising and falling levels). >= WET smothers fixtures,
 * >= SWIM sinks items (event `sunkItem`). The art rebuilds on `waterRev`.
 */
export function setWater(s: GameState, i: number, level: number): void {
  if (!s.water) {
    s.water = new Uint8Array(s.floor.size * s.floor.size);
    s.seenWater = new Uint8Array(s.floor.size * s.floor.size);
  }
  const v = Math.max(0, Math.min(255, Math.round(level)));
  if (s.water[i] === v) return;
  s.water[i] = v;
  s.waterRev++;
  if (s.seenWater && s.light[i] > 0) s.seenWater[i] = v;
  if (v >= WET) smotherFixture(s, i);
  if (v >= SWIM && s.items.has(i)) {
    s.items.delete(i);
    emit(s, 'sunkItem', null, i);
  }
}

/** While burning: breath drains in deep and flooded water, recovers on dry or shallow tiles. */
export function tickWater(s: GameState, dt: number): void {
  if (!s.water || s.status !== 'playing') return;
  const lv = s.water[s.pos];
  if (lv >= SWIM) {
    if (nagaActive(s)) return;
    s.breath -= dt * (lv >= FLOODED ? BREATH.drainFlooded : BREATH.drainDeep);
    if (s.breath <= 0) {
      s.breath = 0;
      s.status = 'drowned';
      emit(s, 'drowned', band(lv), s.pos);
      return;
    }
    if (s.breath < BREATH.low && !s.breathWarned) {
      s.breathWarned = true;
      emit(s, 'breathLow', null, s.pos);
    }
  } else if (s.breath < BREATH.max) {
    s.breath = Math.min(BREATH.max, s.breath + BREATH.recover * dt);
    if (s.breath > BREATH.low + 2) s.breathWarned = false;
  }
}

/**
 * Is a water floor fair? null = fair, else the reason. Start, stairs, the false door's front, trap tiles,
 * secret fronts and guardian lair are dry (< WET); items and fixtures are above the swim line (< SWIM);
 * and a route start -> stairs exists over tiles < FLOODED whose longest run of deep tiles is <= MAX_DEEP_RUN,
 * so every floor is clearable with no power.
 */
export function waterFairness(floor: Floor): string | null {
  const w = floor.water;
  if (!w) return null;
  const dry = (t: number, what: string): string | null => (t >= 0 && w[t] >= WET ? `${what} is in water (${w[t]})` : null);
  const e =
    dry(floor.start, 'start') ??
    dry(floor.stairs, 'stairs') ??
    dry(floor.exitFront, 'exit front') ??
    floor.traps.map((t) => dry(t.tile, 'a trap')).find(Boolean) ??
    floor.secrets.map((k) => dry(k.front, 'a secret front')).find(Boolean) ??
    (floor.guardian ? dry(floor.guardian.lair, 'the guardian lair') : null);
  if (e) return e;
  for (const it of floor.items) if (w[it.tile] >= SWIM) return `an item lies in deep water (${w[it.tile]})`;
  for (const f of floor.fixtures) if (w[f.tile] >= SWIM) return `a fixture stands in deep water (${w[f.tile]})`;
  // reachability over (tile, run of deep tiles)
  const { size } = floor;
  const R = MAX_DEEP_RUN + 1;
  const seen = new Uint8Array(size * size * R);
  const queue: number[] = [];
  const push = (tile: number, run: number) => {
    const k = tile * R + run;
    if (seen[k]) return;
    seen[k] = 1;
    queue.push(k);
  };
  push(floor.start, w[floor.start] >= SWIM ? 1 : 0);
  for (let h = 0; h < queue.length; h++) {
    const k = queue[h];
    const tile = Math.floor(k / R);
    const run = k - tile * R;
    if (tile === floor.stairs) return null;
    const x = tile % size;
    const y = (tile - x) / size;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const q = ny * size + nx;
      if (floor.solid[q] || w[q] >= FLOODED) continue;
      const nr = w[q] >= SWIM ? run + 1 : 0;
      if (nr > MAX_DEEP_RUN) continue;
      push(q, nr);
    }
  }
  return `no power-free route to the stairs (flooded tiles or a deep run over ${MAX_DEEP_RUN})`;
}
