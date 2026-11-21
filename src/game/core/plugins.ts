import type { ArchProfile, GenSpec } from './architecture';
import type { Floor, Layout } from './floor';
import type { GameState } from './game';
import type { FloorRow } from './tables';
import type { Rng } from './rng';
import { createRng } from './rng';

/**
 * Rule plug-ins (plan 06): one culture rule or one hunter each. Egypt's systems (traps, collapse,
 * guardian, escape, secrets) stay built-in and table-driven; plug-ins run after them, so Egypt's
 * order, rng streams and hashes are untouched.
 *
 * Typed extension: a plug-in file augments the interfaces below,
 *   declare module '../plugins' { interface RunExt { roots: RootsRun } }
 * and `rules/index.ts` imports (and registers) it. A plug-in left out of the index compiles but never
 * runs; check-plugins asserts that every profile's rule ids are registered.
 *
 * Contract every HUNTER plug-in keeps:
 *  - deterministic: a stored mulberry32 state in `s.ext` (see `nextRandom`), BFS ties in `DIRS` order,
 *    time only through `tick`;
 *  - it freezes while `frozen` (the Jade Seal) and perceives nothing then;
 *  - it reads your light through `handRadius(s)` / `sightRange(s)`, so the Mirror shows you to it;
 *  - contact uses `loseHand` / `status = 'caught'` like the guardian;
 *  - it emits events with `at` (the tile), so sound and haptics can place them.
 * Plug-in files never value-import `game.ts` or `generate.ts` (import cycles); they use `runtime.ts`,
 * `water.ts`, `powers.ts`, `graph.ts`, `vision.ts`.
 */

/** static per-floor data, `Floor.ext[id]` */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface FloorExt {}
/** per-run state, `GameState.ext[id]` */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface RunExt {}
/** per-floor table parameters, `FloorRow.rules[id]` */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface RuleRows {}
/** extra `GameEvent` types: `{ rootsGrow: true }` */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface PluginEvents {}

export type HunterCue = { id: string; dx: number; dy: number; path: number; visible: boolean; mode: string; frozen: boolean };

export type PlaceArgs = {
  /** the complete Floor built so far (ext = {}, water = null); mutate only floor.water, floor.ext[id], push to floor.items / floor.fixtures */
  floor: Floor;
  layout: Layout;
  spec: GenSpec;
  profile: ArchProfile;
  row: FloorRow | null;
  rng: Rng;
};

export type RulePlugin = {
  /** unique; its rng stream is createRng(spec.seed ^ fnv32(id)) */
  id: string;
  /** generation, after placeSecrets, in profile.rules order */
  place?: (a: PlaceArgs) => void;
  /** run start (startFloor), writes s.ext[id]; `carried` is what the previous floor's `carry` returned */
  start?: (s: GameState, carried?: unknown) => void;
  /** wants noises: noise() queues even without a guardian */
  listens?: boolean;
  /** the player may not enter `to` (a statue, a closed wheel): a bump */
  blocks?: (s: GameState, to: number) => boolean;
  /** after a successful player move (after pickUp/secrets/lights, before plates) */
  moved?: (s: GameState) => void;
  /** while burning; `noises` = the queue as it was at tick start */
  tick?: (s: GameState, dt: number, frozen: boolean, noises: readonly number[]) => void;
  /** passed to the next floor's start (a hunter that follows you down) */
  carry?: (s: GameState) => unknown;
  /** hunters: sound, heartbeat, HUD */
  cues?: (s: GameState) => HunterCue[];
  /** replay checks */
  hash?: (s: GameState, mix: (v: number) => void) => void;
};

const REGISTRY = new Map<string, RulePlugin>();

export function registerRule(p: RulePlugin): void {
  if (REGISTRY.has(p.id)) throw new Error(`rule plug-in '${p.id}' is already registered`);
  REGISTRY.set(p.id, p);
}

export function ruleFor(id: string): RulePlugin {
  const p = REGISTRY.get(id);
  if (!p) throw new Error(`unknown rule plug-in '${id}'`);
  return p;
}

export function hasRule(id: string): boolean {
  return REGISTRY.has(id);
}

export function fnv32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}

/** The profile registry (architecture.ts) binds itself here, so this file never imports it (cycle). */
let rulesOfProfile: (profileId: string) => readonly string[] = () => [];
export function bindProfileRules(fn: (profileId: string) => readonly string[]) {
  rulesOfProfile = fn;
}

const NONE: RulePlugin[] = [];

/** profileFor(floor.profile).rules mapped to plug-ins */
export function rulesOn(floor: Pick<Floor, 'profile'>): RulePlugin[] {
  const ids = rulesOfProfile(floor.profile);
  return ids.length ? ids.map(ruleFor) : NONE;
}

// ---- runners (generate.ts / game.ts) --------------------------------------------------------

export function placeRules(a: Omit<PlaceArgs, 'rng'>): void {
  for (const p of rulesOn(a.floor)) p.place?.({ ...a, rng: createRng(a.spec.seed ^ fnv32(p.id)) });
}

export function startRules(s: GameState, carry?: Record<string, unknown>): void {
  const list = rulesOn(s.floor);
  s.listening = list.some((p) => p.listens);
  for (const p of list) p.start?.(s, carry?.[p.id]);
}

export function blockedByRules(s: GameState, to: number): boolean {
  for (const p of rulesOn(s.floor)) if (p.blocks?.(s, to)) return true;
  return false;
}

export function movedRules(s: GameState): void {
  for (const p of rulesOn(s.floor)) p.moved?.(s);
}

export function tickRules(s: GameState, dt: number, frozen: boolean, noises: readonly number[]): void {
  for (const p of rulesOn(s.floor)) p.tick?.(s, dt, frozen, noises);
}

export function carryRules(s: GameState): Record<string, unknown> | undefined {
  let out: Record<string, unknown> | undefined;
  for (const p of rulesOn(s.floor)) {
    if (!p.carry) continue;
    const v = p.carry(s);
    if (v !== undefined) (out ??= {})[p.id] = v;
  }
  return out;
}

export function hashRules(s: GameState, mix: (v: number) => void): void {
  for (const p of rulesOn(s.floor)) p.hash?.(s, mix);
}

export function ruleCues(s: GameState): HunterCue[] {
  const out: HunterCue[] = [];
  for (const p of rulesOn(s.floor)) if (p.cues) out.push(...p.cues(s));
  return out;
}
