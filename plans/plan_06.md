# Plan 06 · World map, artifact powers, pyramid flow, shared pyramid infrastructure

Decisions and reasons: `plan_06_question.md` (Q-numbers). Written 2026-11-21 against the merged code of tasks 01–05 (`0ad7430`): every name below is the real one or an explicit change to it. Real art for the globe, emblems and HUD arrives in tasks 10–14; everything here is tidy vector art behind functions those tasks swap, but **layout, flow, rules and data models are final**. First task of phase 3.

Reused, do not re-plan: `step()` / `startFloor` / `continue` / `retry`, `emit(s, type, kind, at)` + `EVENT_LOG`, `noise()`, `invalidatePaths`, `loseHand`, `buryItem`, `smotherFixture`, `relight`, `computeLight`, `radiusOf`/`radiusQ`, `sandLevel`/`WADE`/`COVER`, `tickTraps`/`tickCollapse`/`tickEscape`/`tickSecrets`/`tickGuardian`, `guardianCue`, `sightRange`, `addFeatures` order (`placeLights → placeTraps → buildSandOrder → placeExit → extendSandOrder → placeGuardian → placeSecrets`), the rng-stream-per-stage rule, `ArchProfile.hooks` (layout-level culture passes), `ROOM_CARVERS`, `progress` v5 + `migrateProgress`, `FEEDBACK` table, `BEDS`, `STORY`, `themeFor`, the sound synth (`npm run sounds`, recipes in `scripts/sound/recipes.ts`), haptic pattern table + sequencer, `Board` (owns its picture), `LightHud` overlay pattern, `useTicker`, `ArtCanvas`, `Panel`, check scripts (`check-floors.ts` drives all; `hashState(full)` in `check-light-rules.ts`).

## Goal

1. **World map as a globe.** The four pyramids sit where the real ones are (Giza; the Petén lowlands; Koh Ker; the imperial mausoleum near Xi'an) on a slowly spinnable orthographic globe with true coastlines; the Black Pyramid sits on an uncharted island in the open Indian Ocean, wrapped in haze until its door opens. Under the globe a pager of five site cards (west → east) selects a pyramid; the globe turns to it. Collected artifacts draw gold great-circle arcs to the Black Pyramid; its door shows four sockets shaped like the four artifacts.
2. **Artifact powers as tools.** Each artifact taken gives a power usable in every pyramid, with a few uses that refill at camps, each strongest ("attuned") in another pyramid: Golden Scarab shows the way down (Cambodia), Obsidian Mirror throws your light wide (China), Naga Amulet carries you through water (Maya), Jade Seal stops guardians and mechanisms (Egypt). Deterministic core actions through `step()`, time only through `tick`; a power bar under the board, drawn in the board canvas.
3. **Shared pyramid infrastructure** that tasks 07–09 fill without touching Egypt code: per-pyramid floor tables (`PyramidTable`, like `egypt.ts`) and `profileFromTable`, a profile registry, a **rule plug-in registry** (generation, run state, ticks, movement, hunters, hashes) with typed extension interfaces, a generic **water layer** (levels, pace, breath, flooded passages) that the Naga Amulet uses now and 07/08 fill, and a **presentation kit** registry (palette, ambience bed, story, hints, captions, sounds/haptics, draw hooks) per pyramid.
4. **Progress v6**: pyramid data revisions (a pyramid rebuilt in 07–09 resets only its own floors), map focus; pure and checked.

**Egypt's floor hashes do not change** (`egypt:*`, `:feat`, `:g`, `:sec`), nor any `replay:*` key: powers, water and plug-ins are absent from every Egypt run unless used.

## Scope

In: globe map + site pager + seal door, pyramid page powers section and Black door, artifact screen power block; `powers.ts`, `water.ts`, `plugins.ts`, `rules/index.ts`, `tables.ts`, `sandbox.ts`, `hunters.ts`; profile registry; `Floor.water/ext`, run fields, `Status 'drowned'`, `Action 'power'`; power bar + in-board effects + water layer art; kits registry with Egypt + generic kits; power/water sounds and haptics; progress v6; dev sandbox; checks (`check-powers.ts`, `check-plugins.ts`, `check-progress.ts`, `check-world.ts`).

Out: Maya/Khmer/China profiles, tables, rules, hunters, beds, story text (07–09; this task leaves the slots); Black Pyramid zones that each need a power (later; Black keeps its 5 generic floors and gets all four powers); final globe/emblem/HUD art (14); water shaders (10); New Game+, shops, coins.

## Design

### 1. Powers: data (`src/game/core/powers.ts`) (Q1–Q8)

```ts
export type PowerId = 'scarab' | 'mirror' | 'naga' | 'jade';
export const POWER_ORDER: readonly PowerId[] = ['scarab', 'mirror', 'naga', 'jade'];   // = SEALS order of their pyramids
/** strength: scarab = tiles of the way shown (999 = all of it), mirror = radius factor, naga/jade unused (0) */
export type PowerSpec = { uses: number; seconds: number; strength: number; attuned: string /* pyramid id */; attunedUses: number; attunedSeconds: number; attunedStrength: number };
export const POWERS: Record<PowerId, PowerSpec> = {
  scarab: { uses: 2, seconds: 5,  strength: 12,  attuned: 'cambodia', attunedUses: 3, attunedSeconds: 8,  attunedStrength: 999 },
  mirror: { uses: 2, seconds: 8,  strength: 1.6, attuned: 'china',    attunedUses: 3, attunedSeconds: 12, attunedStrength: 1.8 },
  naga:   { uses: 2, seconds: 10, strength: 0,   attuned: 'maya',     attunedUses: 3, attunedSeconds: 16, attunedStrength: 0 },
  jade:   { uses: 1, seconds: 4,  strength: 0,   attuned: 'egypt',    attunedUses: 2, attunedSeconds: 6,  attunedStrength: 0 },
};
export const MIRROR_CAP = 9.5;  // tiles, the widest the mirror throws
export const MIRROR_FALLOFF = 0.2; // subtracted from the source's falloff while the mirror is active
export const POWER_GAP = 0.5;   // s between two uses of any power (no double taps)
export type PowerRun = { id: PowerId; uses: number; max: number; seconds: number; strength: number; left: number /* active s, 0 = idle */; attuned: boolean };
export function freshPowers(pyramidId: string, owned: readonly PowerId[]): PowerRun[];   // POWER_ORDER filtered by owned; attuned numbers when pyramidId matches
export function carryPowers(s: GameState, refill: boolean): PowerRun[];  // next floor: actives end (left = 0); refill → fresh
export function power(s: GameState, id: PowerId): PowerRun | null;
export const isActive = (s, id) => (power(s, id)?.left ?? 0) > 0;
export const isFrozen = (s: GameState) => isActive(s, 'jade');
export function handRadius(s: GameState): number;   // the hand light radius in tiles (see §2), used by relight and sightRange
export function usePower(s: GameState, id: PowerId): void;   // called by step
export function tickPowers(s: GameState, dt: number): void;   // last in tick
export function scarabGoal(s: GameState): number;   // escape.taken ? floor.exitFront : floor.stairs
export function scarabPath(s: GameState, reach: number, out?: Int32Array): Int32Array; // pure query: tiles from s.pos towards the goal
```
Display data (names, verbs, texts) lives in `pyramids.ts` `POWER_INFO: Record<PowerId, { artifact: string; verb: string; text: string; color: string }>` and `PyramidInfo.powerId: PowerId | null` (egypt scarab, maya mirror, cambodia naga, china jade, black null). The power's attuned pyramid is shown by name from `PYRAMIDS[POWERS[id].attuned]`.

Texts (final copy):
- scarab: verb "Shows the way down", text "Gold motes run ahead of you along the way to the stairs for {s} s."
- mirror: "Throws your light wide", "The polished obsidian throws your flame back: your light reaches much farther for {s} s. Guardians see you from farther too."
- naga: "Carries you through water", "For {s} s you swim without tiring and can pass passages flooded to the ceiling."
- jade: "Stops guardians and mechanisms", "For {s} s guardians, traps and falling sand stand still. Your light still burns."
- Attuned line: "Strongest in {Pyramid}: {n} uses, {s} s{, the whole way}." Uses line: "Uses refill at every camp."

### 2. Powers: rules (`game.ts`, `powers.ts`, `guardian.ts`) (Q2–Q8)

State (`GameState`): `powers: PowerRun[]` (empty when none owned), `powerGap: number`.
`StartOptions.powers?: PowerRun[]` (copied); absent → `[]`. `Action |= { type: 'power'; power: PowerId }`.

- `step` `power`: ignored unless `status === 'playing'`. Not owned → ignored (no event). `uses === 0` → event `powerEmpty` (kind id). Already active or `powerGap > 0` → ignored. Else `uses--`, `left = seconds`, `powerGap = POWER_GAP`, `burning = true` (a power starts the clock like a move), event `powerUsed` (kind id, at `s.pos`), then `relight(s, false)` (mirror widens at once).
- `tick` order (while burning, after `burn`): `floorTime += dt`; `if (!frozen) tickTraps; if (!frozen) tickCollapse;` `tickEscape` (never frozen: the false door is your way out); `tickSecrets` (your own action); `if (!frozen) tickGuardian(s, dt) else s.noises.length = 0` (a frozen guardian perceives nothing); `tickRules(s, dt, frozen)` (§4); `tickWater(s, dt)` (§3); `tickPowers(s, dt)` last: `powerGap = max(0, powerGap − dt)`, each active `left = max(0, left − dt)`; at 0 event `powerEnded` (kind id). `frozen` is evaluated once at the start of the tick. `wayDownLeft` / `relight` as today.
- `move`: a guardian that is `dormant | waking` **or frozen** on `next` → bump (noise only when not frozen). `touchIfMet` returns early while frozen.
- `handRadius(s)`: `r = hand.left > 0 ? radiusOf(CARRY[kind], left) : EMBER.radius`; mirror active → `r = Math.min(MIRROR_CAP, r * strength)` (branch, so the inactive path is bit-identical); in a flooded tile with the Naga active → `r *= 0.6` (murk). `relight` uses it in place of its inline formula; falloff unchanged except mirror: `falloff − MIRROR_FALLOFF` (a broader, softer pool). `sightRange` uses `2 * radiusQ(handRadius(s)) + 1` on a burning source (identical without powers): a wide light is seen from farther (the Mirror's trade-off).
- Scarab: core only times it; `scarabPath(s, reach)` = BFS distance field from `scarabGoal` over `s.grid.solid` (`bfsFrom`), then from `s.pos` repeatedly the neighbour with `dist − 1` in `DIRS` order, up to `reach` tiles or the goal; empty if unreachable. Render calls it (memoised per `pos` and every 0.25 s while active). In the Egypt basement the escape's free pointer (`drawPointer`) stays as is.
- Charges: `startFloor` default `[]`. GameScreen passes `freshPowers(pyramid.id, owned)` on a new descent, a camp resume and every replay. `continue` (`descending`): `carryPowers(s, isCampFloor(next))`; `continue` (`falling`): `carryPowers(s, false)`; `retry`: `freshPowers(s.pyramid.id, ids)` (back at a camp). Owned ids never change during a run.
- Events: `GameEvent.type += 'powerUsed' | 'powerEnded' | 'powerEmpty'`; `kind += PowerId`.

### 3. Water (`src/game/core/water.ts`) (Q9–Q13)

The generic liquid layer the Naga uses now and 07 (cenotes, flooded passages) and 08 (moats, rising/falling levels) fill.

```ts
/** per-tile water level 0..255 (fraction of floor-to-ceiling height); thresholds inclusive */
export const WATER = { WET: 32, SWIM: 128, FLOODED: 224 } as const;
export const WATER_PACE = { shallow: 1.4, deep: 2.0, naga: 1.4 } as const;   // x STEP_SECONDS
export const BREATH = { max: 8, drainDeep: 1, drainFlooded: 2, recover: 2, low: 3 } as const;  // seconds
export const WATER_NOISE = 1;   // + to step / quiet noise radius in water >= WET
export const MAX_DEEP_RUN = 12; // fairness: longest deep stretch on a power-free route
export type WaterBand = 'dry' | 'shallow' | 'deep' | 'flooded';
export function band(level: number): WaterBand;
export function waterAt(s: Pick<GameState, 'water'>, i: number): number;   // 0 when s.water is null
export function waterPace(s: GameState, i: number): number;   // 1, shallow 1.4, deep 2.0, naga active in deep/flooded 1.4
export function waterBlocks(s: GameState, i: number): boolean; // flooded and the Naga not active
export function setWater(s: GameState, i: number, level: number): void; // for 08: updates s.water, seenWater if lit; >= WET smothers fixtures; >= SWIM sinks items (event 'sunkItem')
export function tickWater(s: GameState, dt: number): void;    // breath
export function waterFairness(floor: Floor): string | null;   // null = fair, else the reason (check scripts and 07/08 generators)
```
- `Floor.water: Uint8Array | null` (static initial levels, written by rule plug-ins at generation; Egypt: `null`). `GameState.water: Uint8Array | null` (run copy), `seenWater: Uint8Array | null` (as last seen; `relight` copies the level for lit tiles like `seenSand`), `waterRev: number` (bumped by `setWater`; the art rebuilds its paths on change), `breath: number` (= `BREATH.max`), `breathWarned: boolean`. Water never changes `solid`/`opaque` (it is a floor overlay); `waterBlocks` is a player-movement test only. Hunters decide their own water rules (the Egypt guardian ignores water; no Egypt floor has any).
- `move`: after the bounds check and before the guardian bump: `if (s.water && waterBlocks(s, next)) { emit 'flooded' (at next); return s; }`. Pace: `wade = Math.max(sand ≥ COVER ? WADE : 1, s.water ? waterPace(s, next) : 1)`. Entering water from a dry tile emits `splash` (kind band), entering flooded `dive`, leaving flooded/deep for shallow/dry `surface`. Step/quiet noise `+ WATER_NOISE` in water ≥ WET. Items lie only on tiles < SWIM (placement rule, checked); `pickUp` is skipped on tiles ≥ SWIM.
- `tickWater` (while burning, not frozen-dependent): on a tile ≥ SWIM with the Naga inactive: `breath −= dt × (flooded ? drainFlooded : drainDeep)`; Naga active: no drain; tile < SWIM: `breath = min(max, breath + recover·dt)`. First drop under `low` → event `breathLow` (once until refilled above `low + 2`); `breath ≤ 0` → `status = 'drowned'`, event `drowned`. A run on a floor without water never calls it (`s.water === null`).
- `Status |= 'drowned'`; `retry` accepts it (back to the last camp, fresh light and powers).
- Fairness (`waterFairness`, for every real floor and the sandbox): `start`, `stairs`, `exitFront`, items, fixtures, trap tiles, secret fronts, guardian lair/post are `< WET` (items/fixtures `< SWIM`); a route start → stairs exists over tiles `< FLOODED` whose longest consecutive run of tiles ≥ SWIM is ≤ `MAX_DEEP_RUN` (26 tiles would exhaust breath; half of it is the margin). So every floor is clearable with no power; flooded passages guard only side ways (shortcuts, secrets, items).
- Events: `+= 'splash' | 'dive' | 'surface' | 'breathLow' | 'drowned' | 'flooded' | 'sunkItem'`; `kind += WaterBand`.

### 4. Rule plug-ins (`src/game/core/plugins.ts`, `src/game/core/rules/index.ts`) (Q14–Q18)

A plug-in is one culture rule or hunter (07: calendar wheels, cenotes, jaguar; 08: roots, water levels, naga statues; 09: moving statues, mercury, clay soldiers). Egypt's systems stay built-in (table-driven by the profile); plug-ins run after them, so Egypt order and hashes are untouched.

```ts
/** augmented by each plug-in file: `declare module '../plugins' { interface RunExt { roots: RootsRun } }` */
export interface FloorExt {}      // static per-floor data, Floor.ext[id]
export interface RunExt {}        // per-run state, GameState.ext[id]
export interface RuleRows {}      // per-floor table parameters, FloorRow.rules[id]
export interface PluginEvents {}  // extra GameEvent types: `{ rootsGrow: true }`
export type HunterCue = { id: string; dx: number; dy: number; path: number; visible: boolean; mode: string; frozen: boolean };
export type PlaceArgs = {
  floor: Floor;             // complete Floor built so far (ext = {}, water = null); mutate only floor.water, floor.ext[id], push to floor.items / floor.fixtures
  layout: Layout; spec: GenSpec; profile: ArchProfile; row: FloorRow | null; rng: Rng;
};
export type RulePlugin = {
  id: string;                                   // unique; its rng stream is createRng(spec.seed ^ fnv32(id))
  place?: (a: PlaceArgs) => void;               // generation, after placeSecrets, in profile.rules order
  start?: (s: GameState, carried?: unknown) => void;  // run start (startFloor), writes s.ext[id]
  listens?: boolean;                            // wants noises: noise() queues even without a guardian
  blocks?: (s: GameState, to: number) => boolean;     // the player may not enter `to` (a statue, a closed wheel); a bump
  moved?: (s: GameState) => void;               // after a successful player move (after pickUp/secrets/lights, before plates)
  tick?: (s: GameState, dt: number, frozen: boolean, noises: readonly number[]) => void;   // while burning; `noises` = the queue as it was at tick start
  carry?: (s: GameState) => unknown;            // passed to the next floor's start (a hunter that follows you down)
  cues?: (s: GameState) => HunterCue[];         // hunters: sound, heartbeat, HUD
  hash?: (s: GameState, mix: (v: number) => void) => void;  // replay checks
};
export function registerRule(p: RulePlugin): void;      // throws on a duplicate id
export function ruleFor(id: string): RulePlugin;         // throws on an unknown id
export function rulesOn(floor: Floor): RulePlugin[];      // profileFor(floor.profile).rules mapped
// runners used by generate.ts / game.ts: placeRules, startRules, tickRules, blockedByRules, movedRules, carryRules, hashRules
```
- `rules/index.ts` holds the production list (`registerRule(...)` calls; **empty in 06**, with a comment where 07–09 add theirs). Imported once by `generate.ts` and `game.ts`. Plug-in files never value-import `game.ts` or `generate.ts` (cycles); they use `runtime.ts`, `water.ts`, `powers.ts`, `graph.ts`, `vision.ts`.
- `ArchProfile.rules?: readonly string[]` (ids); `ArchProfile.row?: (i) => FloorRow`.
- `Floor.ext: Partial<FloorExt>` and `GameState.ext: Partial<RunExt>` (both `{}` on Egypt). `StartOptions.carry?: Record<string, unknown>`; `continue` passes `carryRules(s)`.
- `GameEvent.type` becomes `CoreEventType | keyof PluginEvents` (core types as today plus §2/§3).
- `noise()` (runtime.ts): queue when the guardian is listening (today's test) **or** `s.listening` (true when any plug-in on the floor `listens`). When `s.listening`, `game.ts` snapshots the queue at tick start, passes it to plug-ins and clears `s.noises` at the end of the tick (the built-in guardian still clears it as today). Without plug-ins nothing changes.
- `move`: `blockedByRules(s, next)` after the water test → bump.
- Hunters (`src/game/core/hunters.ts`): `hunterCues(s): HunterCue[]` = the Egypt guardian's `guardianCue(s)` (as `{ id: 'guardian', …, frozen: isFrozen(s) }`) + every plug-in's `cues`. The director and the renderer read this instead of `guardianCue` directly. `GuardianRow.kind?: string` (default `'keeper'`) selects the sprite and sounds in the kit, so 07–09 may reuse the built-in guardian engine with their own look, or write a plug-in hunter.
- Contract every hunter plug-in keeps (documented in `plugins.ts`): deterministic (stored mulberry32 state in `s.ext`, BFS ties in `DIRS` order, time only through `tick`); freezes when `frozen`; reads your light through `handRadius(s)` / `sightRange(s)` (so the Mirror shows you to it); contact uses `loseHand` / `status = 'caught'` like the guardian; emits events with `at`.

### 5. Floor tables and profiles (`src/game/core/tables.ts`, `architecture.ts`, `egypt.ts`) (Q19–Q20)

```ts
// tables.ts
export type FloorRow = EgyptRow & { rules?: Partial<RuleRows> };   // EgyptRow unchanged, generalised by name
export type PyramidTable = {
  rows: readonly FloorRow[]; camps: readonly number[];
  secrets: (i: number) => number; fragmentFloors: readonly number[];
};
/** an ArchProfile whose numbers come from a table (07–09 build theirs with it) */
export function profileFromTable(id: string, table: PyramidTable, shape: Pick<ArchProfile, 'span' | 'straightness' | 'loops' | 'leafRooms' | 'junctionRoom' | 'nicheRate' | 'basementRoom' | 'falseDoor'> & Partial<ArchProfile>): ArchProfile;
```
- `profileFromTable` maps rows exactly as the EGYPT profile literal does today (sites, loopRate with `?? linearLoopRate`, sconceCap, traps, collapse, guardian, escapeCap, halls, galleries, lights, secrets, fragment from `fragmentFloors`, `row`).
- `egypt.ts` adds `export const EGYPT_TABLE: PyramidTable = { rows: EGYPT_ROWS, camps: EGYPT_CAMPS, secrets: EGYPT_SECRETS, fragmentFloors: EGYPT_FRAGMENT_FLOORS }`; rows untouched. The EGYPT profile literal stays as it is (the check proves `profileFromTable('egypt-t', EGYPT_TABLE, …)` builds identical floors).
- `architecture.ts`: `ArchProfileId = string`; `PROFILES = new Map<string, ArchProfile>()` filled from `[EGYPT, GENERIC, BLACK, ...CULTURE_PROFILES]` where `CULTURE_PROFILES` comes from `src/game/core/cultures/index.ts` (empty array in 06; 07 adds `MAYA` built in `cultures/maya.ts`); `registerProfile(p)` (throws on duplicate, used by checks); `profileFor(id)` throws on unknown; a profile's `rules` ids are validated on first `profileFor`.
- `pyramids.ts`: each entry gains `rev: number` (all 1), `powerId`, `site` (§7). Recipe for 07–09 (written as a comment block in `pyramids.ts`): `floorCount: TABLE.rows.length, camps: TABLE.camps, architecture: '<profile id>'`, bump `rev`.
- `pyramid/[id].tsx` and `GameScreen` stop reading `EGYPT_ROWS` / `EGYPT_FRAGMENT_FLOORS`: guardian-from = first `i` with `profile.guardian?.(i)` non-sentinel; fragments via `profile.fragment`.

### 6. Presentation kits (`src/kits/`) (Q21)

```ts
// src/kits/types.ts
export type DrawHook = (canvas: SkCanvas, s: GameState, ctx: { theme: FloorTheme; t: number; time: number; mechTime: number; win: Win }) => void;
export type PyramidKit = {
  theme: (color: string) => FloorTheme;
  bed: BedSpec;                                       // ambience
  story: readonly StoryFragment[];
  hints: Record<string, string>;                      // HintId → text (culture trap/hunter hints)
  caption?: (e: GameEvent, s: GameState) => string | null | undefined;   // undefined = fall through to the common captions
  feedback?: Partial<Record<GameEvent['type'], Feedback>>;               // merged over FEEDBACK (plug-in events need entries here)
  hunters?: Record<string, { draw: DrawHook; dread?: SoundId }>;         // by GuardianRow.kind / plug-in hunter id
  draw?: { floor?: DrawHook[]; overlay?: DrawHook[]; emissive?: DrawHook[] };   // drawGame layers: masked, over the mask, emissive
};
export function kitFor(id: PyramidId): PyramidKit;    // src/kits/index.ts
```
- `src/kits/egypt.ts`: `theme: () => EGYPT` (export the constant from `themes.ts`), `bed: BEDS.egypt` values, `story: STORY.egypt`, `hints`: the Egypt entries of GameScreen's `HINTS` (moved), `hunters.keeper` = today's guardian drawing. `src/kits/generic.ts`: derived theme, the borrowed bed with its low-pass, empty story; used by maya/cambodia/china/black until 07–09 add `src/kits/<id>.ts` and one line in `index.ts`.
- `src/kits/common.ts`: culture-free hints (`power`, `water`, `flooded`) and captions (§10). `HintId` becomes `string` (culture hints namespaced: `'maya:wheel'`).
- Readers switch to the kit: `GameScreen` (theme, hints, captions), `director` (`FEEDBACK` merged with `kitFor(s.pyramid.id).feedback`), `ambience.enter` (`kitFor(id).bed`), `storyOf` (`kitFor(id).story`), `drawGame` (hunters by cue id/kind, hook lists). `themeFor`, `BEDS`, `STORY` stay exported for the Egypt kit.

### 7. World map: globe and site pager (`src/game/world/geo.ts`, `render/drawGlobe.ts`, `screens/map/*`, `app/map.tsx`) (Q22–Q30)

Sites (`PyramidInfo.site`, display data, true coordinates):

| id | label (eyebrow) | lat, lon |
|---|---|---|
| maya | Petén lowlands · Guatemala | 17.222, −89.624 |
| egypt | Giza plateau · Egypt | 29.979, 31.134 |
| cambodia | Koh Ker · Cambodia | 13.785, 104.537 |
| china | Near Xi'an · Shaanxi, China | 34.381, 109.254 |
| black | Uncharted · Indian Ocean | −9.5, 83.0 |

Pager order west → east, Black last: `SITE_ORDER = ['maya', 'egypt', 'cambodia', 'china', 'black']`.

Libraries: `d3-geo@3.1.1` (orthographic projection, circle clipping, great circles, `geoInterpolate`, `geoDistance`, `geoGraticule10`), `topojson-client@3.1.0` + `world-atlas@2.0.2` (`land-110m.json`, Natural Earth, public domain) — runtime deps (≈ 110 KB total). `land` is converted once, lazily, on the first map mount (`feature(topo, topo.objects.land)`), cached at module scope. Add `@types/d3-geo`, `@types/topojson-client` (dev) and `"resolveJsonModule": true` if `expo/tsconfig.base` lacks it.

`geo.ts` (plain TS, no Skia): `SITE_ORDER`, `siteOf(id)`, `viewFor(id) → { lon, lat }` (centre: lon, `clamp(lat, −20, 45)`), `turn(from, to, t)` (shortest-way great-circle centre interpolation, `easeInOutCubic`), `visible(center, site)` (`geoDistance < π/2 − 0.05`), `arc(a, b, t)` (`geoInterpolate`).

`drawGlobe(canvas, w, h, g: GlobeView)` with `GlobeView = { center: {lon, lat}; selected: PyramidId; collected; filling?: { id; t }; unlock: number; time: number }`:
- Projection `geoOrthographic().rotate([−lon, −lat]).scale(R).translate([w/2, h/2]).clipAngle(90).precision(0.4)`, `R = min(w, h) / 2 − 14`. Paths as SVG strings from `geoPath(projection)` → `Skia.Path.MakeFromSVGString` (one JSI call per path).
- Layers: background `#07090c` with a faint star field (40 fixed dots, deterministic); atmosphere: two soft rings outside the limb (radial gradient `#3b6a8c` 0.35 → 0); ocean: radial gradient lit from the upper left (`#16364a` → `#081720` → `#050d13` at the limb); graticule every 10° at 6 % white; land fill: gradient from `#5a4a31` (lit side) to `#2a2318`, coast stroke `#a08758` 0.7 px·dpr at 55 %; a night-side terminator overlay (linear gradient across the disc, 0 → 45 % black) for depth; limb rim highlight 1 px.
- Markers (visible sites only): a small culture silhouette 18 dp (Egypt smooth pyramid with gold cap; Maya stepped temple with stair and roof comb; Koh Ker seven tiers; China truncated mound) in the pyramid colour, a ground shadow ellipse; selected: pulsing ring (1.4 s, reduced motion static) + a thin leader dot; an artifact taken: a small gold glow over it. Black Pyramid: a black stepped silhouette on a dark island blob (procedural, 3 overlapping ellipses), with a slowly drifting grey haze ring (6 soft ellipses rotating) while sealed; on unlock the haze thins with `unlock`.
- Arcs: for each collected seal pyramid a gold great-circle `LineString` site → Black (`#f3c55a` 70 %, 1.5 dp, round caps), dashed dim `#3a3226` for the others; filling: the arc drawn up to `t` with a bright spark head (`glow` + core dot) at `arc(a, b, t)`.
- Budget: ≤ 6 ms per frame on a Redmi 9 while turning (check: ≤ 1.5 ms desktop, warn); static picture otherwise.

`src/screens/map/Globe.tsx` (owns its picture like `Board`): props `selected`, `collected`, `animation` (fill/unlock state), `onSelect(id)`. A rAF loop runs only while turning, coasting or animating (else redraws at 15 fps for the marker pulse, 0 with reduced motion). Gestures (RN responder on a transparent view over the canvas): drag turns (`lon −= dx / R · 180/π`, `lat += dy / R · 180/π` clamped −20…45), release with velocity coasts (decay `e^(−4t)`), a coast that ends within 12° of a site snaps to it and selects it; tap within 28 dp of a visible marker selects it. Selecting animates the centre over 700 ms (`turn`), 0 ms with reduced motion.

`src/screens/map/SiteCard.tsx` (RN views): eyebrow `site.label`, title `name`, status line (as today's `statusOf`), artifact row (a 36 dp emblem `ArtCanvas` + artifact name + "Taken ✓" / "Kept in the basement"), stars "Stars 37 / 75" (when any), attuned line "Your Jade Seal is strongest here" (when an owned power is attuned to this pyramid), buttons: primary "Enter" → `/pyramid/[id]`; secondary "Continue · floor 14" when a camp exists (→ `/play/[id]?from=camp`). Black card: the seal door (`SealDoor`, below) + "Sealed · 2 of 4" + secondary "The door" opening today's sealed panel; open: "Enter".

`map.tsx`: `TopBar` "The World"; `Globe` (top, height `min(width − 32, 0.52 × available)`); a horizontal paging `ScrollView` of cards (card width `screenW − 48`, gap 12, `snapToInterval`, peek of the next card) under it; pager ↔ globe two-way (`onMomentumScrollEnd` → select; `onSelect` → `scrollTo`); focus restored from `progress.focus` (default `egypt`), saved on change (`setFocus`). Accessibility: the globe view `accessibilityLabel="Globe. Choose a pyramid with the cards below."`, cards are buttons with full labels.

Seal fill (`?filled=<id>`, as today's flow, retimed): focus jumps to `id` (no turn), 400 ms hold; the spark travels the arc to the Black Pyramid over 1600 ms while the globe centre follows `turn(site, black, t)`; the pager scrolls to the Black card; its socket fills with the emblem (600 ms, `uiSound.seal()`, `haptic.bump()`). Four filled and not `blackUnlockSeen`: 300 ms later the door opens (1800 ms: the haze clears on the globe, the sockets light one by one, the door slab sinks; `uiSound.seal()`, `haptic.heavy()`), then `markBlackUnlockSeen`. Reduced motion: final states at once, one sound.

`render/drawSealDoor.ts` + `screens/map/SealDoor.tsx` (`ArtCanvas`, 220 × 132 dp on the card, 280 × 168 on the Black pyramid page): a tall trapezoid door of black polished basalt (dark gradient, faint fine-grained speckle from a hash, chamfered jambs and a heavy lintel, no inscriptions), four sockets in a row in `SEALS` order, each cut in the shape of its artifact (oval scarab, round mirror, fanned naga hood, square seal) with an inner shadow; a filled socket shows the emblem seated and a warm rim light; unlock: sockets light left to right, then the slab sinks with a light line growing under the lintel.

`render/drawEmblems.ts`: `drawEmblem(canvas, id: PowerId | 'heart', cx, cy, size, o: { lit: number; dim: boolean })`, top-down vector emblems with gradients and a specular glint:
- scarab: gold heart-scarab (head, pronotum, split elytra, six legs) with lapis-blue inlay lines on the elytra.
- mirror: round polished obsidian disc (near-black with a cool violet-grey sheen and one soft reflection arc) in a carved grey stone backing with a ring of small pyrite dots.
- naga: a gilt-bronze pendant: a fanned hood of seven rounded serpent heads over a coiled body, verdigris in the recesses.
- jade: a square pale-green nephrite seal seen at 3/4 (lighter top face, darker sides, cloudy inclusions) with a crouching-beast knob (abstract rounded form; no inscription on the face).
- heart: today's red relic as an emblem.
Used by the power bar, the seal door, the cards, the pyramid page and the artifact screen (`drawRelic` draws `drawEmblem` at its centre).

### 8. Pyramid page, artifact screen, flow (`app/pyramid/[id].tsx`, `app/artifact/[id].tsx`) (Q31)

- Pyramid page: the artifact card loses "Artifact powers arrive in a later version" and shows the emblem, power verb + text with this pyramid's own numbers, and "Strongest in {X}". New card "Powers you carry" (when any owned): one row per owned power: emblem, name, "2 uses · 8 s here", gold "Strongest here" when attuned to this pyramid. Black Pyramid page: the seal door under the side view.
- Artifact screen: the relic shows the artifact's emblem; new block "New power" (first time the artifact is taken: `completions[id] === 1`): verb, text, "Strongest in {X}", "Uses refill at every camp. Tap it under the board." Button as today → map `?filled=<id>`.
- Flow (final): title → map (globe + pager, focus remembered) → card "Enter" (or "Continue") → pyramid page → play → (artifact screen → map with the seal animation). Black: sealed card → door panel; open → Enter. Ending unchanged.
- Camp panel text: "Progress is saved. Your light burns full again and your artifacts' uses are restored."

### 9. HUD: power bar and in-board effects (`render/drawPowerBar.ts`, `render/drawPowers.ts`, `screens/play/PowerBar.tsx`, `Board.tsx`) (Q32–Q35)

- Shown when the run has any power. Inside the Board canvas below the board: `POWER_GAP = 10`, `POWER_H = 72`; canvas height `STRIP_H + STRIP_GAP + board + POWER_GAP + POWER_H`. GameScreen's `boardSize` budget subtracts `POWER_GAP + POWER_H` when powers exist (Redmi 9 portrait: board stays 361 dp).
- Four sockets centred (`SOCKET = 56`, pitch 72) in `POWER_ORDER`; an unowned power shows an empty dark socket outline (the set to collect). Owned: recessed bronze-rimmed round socket, emblem (`drawEmblem`, 40 dp), uses as small pips under it (filled gold / hollow), attuned: a fine gold outer ring. Active: the emblem glows in the power colour (scarab `#ffcf5a`, mirror `#cfd3f0`, naga `#6fd0bf`, jade `#9fe0b4`) and a ring depletes clockwise with `left / seconds`. No uses: emblem at 35 % and desaturated. `powerEmpty` → the socket shakes 3 dp for 0.25 s.
- `PowerBar.tsx` (like `LightHud`): one `Pressable` per owned socket over the canvas, `hitSlop 6`; `accessibilityLabel` "Golden Scarab, 2 uses left, shows the way down", `accessibilityState.disabled` at 0 uses. Press → `game.current = step(game.current, { type: 'power', power })`, `hudDirty`. Web keyboard (`useKeyboard`): `1`–`4` = sockets in order.
- Board effects (`drawPowers(canvas, s, ctx)` in `drawGame`): Scarab: 24 gold motes flowing from the player along `scarabPath` (Catmull-Rom through tile centres), emissive over the dark, fading in 0.3 s and out over the last 1 s; diving motes over flooded tiles. Mirror: the light mask is wider by itself (core); plus a cool silver rim on the hand glow and a slow glint sweep on the player. Jade: a jade-green vignette (radial gradient, 18 % at the edges) + 10 % desaturation overlay over the board; frozen guardian drawn with a pale jade tint; every mechanism animation (sand pour, sandfall trickle, trap dust, guardian idle sway) uses `mechTime` (Board keeps it; it stops advancing while `isFrozen`). Naga: faint teal scale shimmer ring around the player; in a flooded tile small rising bubbles. Breath: when `breath < max`, a thin cyan arc around the player tile (clockwise, red under `low`).
- Light strip: while the Mirror is active the medallion arc turns silver; `HudText` gains `breath?: string` for the a11y label.

### 10. Water art (`render/drawWater.ts`) (Q12)

Drawn in the masked layer after the floor art, before sand: per band a cached `SkPath` of tile rects (rebuilt when `s.water` changes; a change counter `waterRev` in `s` bumped by `setWater`): shallow `#2b5a5e` at 35 %, deep `#173e48` at 65 %, flooded `#0b252c` at 88 %; a wet-edge line (`#9fc7c2` 30 %) along water/dry boundaries; ≤ 40 animated ripple strokes over visible water tiles (sine-displaced short arcs, hash-placed per tile, period 2–3 s); a warm elongated torch reflection on the water within 2 tiles of the player. Memory uses `seenWater`. `FloorTheme.water?` (`shallow, deep, flooded, edge`) with these defaults. Task 10 replaces it with a shader.

### 11. Sound and haptics (Q36)

New recipes in `scripts/sound/recipes.ts` (same kit, same normalisation), regenerated with `npm run sounds` (lock, manifest, `.m4a` committed):

| Group | Ids | Recipe |
|---|---|---|
| `powers` (loaded when the run has powers) | `power.scarab`, `power.mirror`, `power.naga`, `power.jade`, `power.end`, `power.empty` | scarab: chitin clicks (3 short bp-noise ticks 3 kHz) + gold modal shimmer (free-bar ratios at A5, 0.9 s); mirror: glassy obsidian ring (inharmonic modal 1.8/4.1/6.7 kHz, 1.2 s) + soft rising air whoosh; naga: low water swell (brown → lp 500 Hz, AM) + a serpent hiss (hp noise, slow envelope) + 4 bubbles (sine chirps 300→900 Hz); jade: deep jade chime (modal 220/552/1010 Hz, long) + a sub thump 45 Hz, then a 1.5 s "held" tail; end: soft descending two-tone chime; empty: dull stone tick |
| `water` (loaded when the floor has water) | `water.wade` ×4, `water.swim` ×3, `water.dive`, `water.surface`, `breath.low`, `drowned` | wade: splash transient (granular droplets 1–5 kHz) + body slosh (lp noise 400 Hz); swim: two strokes (low slosh + drips); dive: plunge (sweep down + muffled bubbles); surface: gasp-like air rush (bp noise 1.2 kHz) + drips; breath.low: muffled heartbeat thumps; drowned: underwater rumble swell to silence |

Feedback rows: `powerUsed` → `power.<kind>` (ui bus, priority 6, haptic `power` / jade `freeze`), `powerEnded` → `power.end` (priority 3), `powerEmpty` → `power.empty` + haptic `tap`; `splash` → `water.wade` (spatial), `dive`, `surface`, `breathLow` (haptic `breathLow`), `drowned` (haptic `caught`), `flooded` → `water.wade` gain 0.6 + haptic `wall`. Footsteps on water ≥ WET use `water.wade`, ≥ SWIM `water.swim` (director surface choice). Jade active: world and guardian buses −10 dB with a 1.2 kHz low-pass on the world bus (time held), released over 0.4 s. Haptic patterns: `power` (0 light, 80 soft), `freeze` (0 heavy, 140 soft, 320 soft), `breathLow` (0 medium, 150 light; repeated every 0.9 s while under `low`). Decoded-audio cap in `check:sounds`: core + game + bed ≤ 32 MB (unchanged), + powers + water ≤ 36 MB.

### 12. Progress v6 (`state/migrateProgress.ts`, `state/progress.ts`) (Q37–Q38)

```ts
ProgressData.revs: Partial<Record<PyramidId, number>>;   // the data revision each pyramid's floors were played at
ProgressData.focus: PyramidId | null;                     // the map card shown last
PROGRESS_VERSION = 6
migrate v<6: revs = { every PyramidId: PYRAMIDS[id].rev }, focus = null.
export function reconcileRevisions(data: ProgressData, revOf: (id: PyramidId) => number): ProgressData;
// for each id with data.revs[id] !== undefined && data.revs[id] !== revOf(id): delete camp[id], deepest[id], floors[id]; keep artifacts, records, completions; then revs[id] = revOf(id). Idempotent; pure.
```
- `progress.ts`: `merge: (persisted, current) => ({ ...current, ...reconcileRevisions(persisted as ProgressData, (id) => PYRAMIDS[id].rev) })` (runs on every hydration, after `migrate`); `partialize` adds `revs`, `focus`; actions `setFocus(id)`; selector `ownedPowers(artifacts): PowerId[]` (`POWER_ORDER` filtered by `artifacts[pyramidOfPower]`). `HintId = string`.
- A pyramid rebuilt by 07–09 bumps its `rev`: players keep that artifact and its records, and replay its new floors from the top.

### 13. Sandbox and dev (`core/sandbox.ts`, settings, play route) (Q39)

- `waterSandbox(base: Floor): Floor`: a deterministic copy of a floor (Egypt floor 3 in use) with `water` set: the main path's longest straight passage run of ≥ 6 tiles away from start/stairs gets shallow (2 tiles), deep (4–6 tiles, within `MAX_DEEP_RUN`) water; the doorway of the deepest leaf side room off the path is flooded to the ceiling (the door tile and up to 2 passage tiles before it); the room behind stays dry and holds an added oil jar (the reward for diving). Passes `waterFairness`. Not memoised in `floorFor`.
- `startOn(floor, pyramid, floorIndex, hand, bag, steps, ember, opts)`: `startFloor` becomes a thin wrapper (`startOn(floorFor(...), ...)`); `continue`/`retry` keep using `floorFor` (a sandbox run ends with a result panel, never continues).
- Settings → Developer: "Power sandbox" → `/play/egypt?from=sandbox`: `GameScreen` `mode: 'sandbox'` (all four powers, `freshPowers('sandbox', POWER_ORDER)`, no progress writes at all, result panel on the stairs, retry restarts the sandbox). Settings dev "Grant artifacts" stays.

### 14. GameScreen wiring

- `owned = useState(() => ownedPowers(useProgress.getState().artifacts))` (sandbox: all); every `startFloor` call passes `{ powers: freshPowers(pyramid.id, owned) }`.
- Phases: `drowned` (Panel, as `buried`): eyebrow floor text, title "Out of breath", text "The water was deeper than your breath. You come round at {camp}.", buttons "Back to {camp}" (`retry`) / "Back to the map"; replay/sandbox: "Try again" / "Back".
- Captions (`captionFor` → `kit.caption` first, then common): `powerUsed` scarab "The Scarab turns towards the way down.", mirror "The mirror throws your light wide.", naga "The naga coils around you. The water lets you pass.", jade "The Jade Seal holds everything still."; `powerEnded` jade "Everything moves again." (others none); `powerEmpty` "No uses left until the next camp."; `flooded` "Flooded to the ceiling."; `breathLow` "Out of breath soon."; `sunkItem` "The water took it."; `artifactTaken` uses `PYRAMIDS[id].artifact` ("The {artifact} is yours. The pyramid wakes.").
- Hints (common kit): `power` (first run with a power, at the first frame of `playing`): "Your artifacts are under the board. Tap one to use it; uses refill at camps."; `water` (first water tile lit): "Deep water tires you. Shallow water only slows you."; `flooded` (first `flooded` event): owned Naga "Flooded to the ceiling. The Naga Amulet would carry you through." else "Flooded to the ceiling. No breath would last that far."
- Director: `hunterCues(s)` replaces `guardianCue` (nearest cue drives dread/heartbeat; frozen → silent); loads the `powers` group when `owned.length`, the `water` group when `s.water`.

## Files

Add:
- `src/game/core/powers.ts`, `water.ts`, `plugins.ts`, `hunters.ts`, `tables.ts`, `sandbox.ts`, `rules/index.ts`, `cultures/index.ts`.
- `src/game/world/geo.ts`.
- `src/game/render/drawGlobe.ts`, `drawSealDoor.ts`, `drawEmblems.ts`, `drawPowerBar.ts`, `drawPowers.ts`, `drawWater.ts`.
- `src/screens/map/Globe.tsx`, `SiteCard.tsx`, `SealDoor.tsx`; `src/screens/play/PowerBar.tsx`.
- `src/kits/types.ts`, `index.ts`, `common.ts`, `egypt.ts`, `generic.ts`.
- `scripts/check-powers.ts`, `check-plugins.ts`, `check-progress.ts`, `check-world.ts`.

Change:
- Core: `floor.ts` (`Floor.water`, `Floor.ext`, `Layout` omits both), `generate.ts` (`water: null, ext: {}`, `placeRules` after `placeSecrets`), `architecture.ts` (registry, string ids, `rules`, `row`), `egypt.ts` (`EGYPT_TABLE`, `GuardianRow.kind?`), `game.ts` (fields, `startOn`, `power` action, move/tick/continue/retry, `Status 'drowned'`, event types), `runtime.ts` (`noise` gating), `guardian.ts` (`sightRange` via `handRadius`, frozen guard in `touchIfMet`), `pyramids.ts` (`rev`, `powerId`, `site`, `POWER_INFO`, recipe comment, remove "not implemented yet").
- Render: `drawGame.ts` (water, powers, kit hooks, `mechTime`, hunters via cues), `drawLightHud.ts` (mirror arc), `drawRelic.ts` (emblem), `drawSand.ts`/`drawTraps.ts`/`drawGuardian.ts` (take `mechTime` where they animate), `themes.ts` (export `EGYPT`, `water?` defaults). Delete `drawWorldMap.ts`.
- Screens: `app/map.tsx` (rewrite), `app/pyramid/[id].tsx`, `app/artifact/[id].tsx`, `app/play/[id].tsx` (`from=sandbox`, dev only), `app/settings.tsx` (sandbox button), `screens/GameScreen.tsx`, `screens/play/Board.tsx`, `LightHud.tsx`, `useKeyboard.ts`, `walker.ts` + `core/walk.ts` (a flick-run also stops before a tile whose water band differs from the current one, via the `avoid` predicate `runDir` already takes (walker side only), so you never run into deep water by accident; hold-to-walk unchanged).
- State/audio/ui: `state/migrateProgress.ts`, `state/progress.ts`, `audio/director.ts`, `audio/feedback.ts`, `audio/ambience.ts` (bed from kit), `game/story.ts` (`storyOf` via kit), `ui/hapticPatterns.ts`, `scripts/sound/recipes.ts` (+ regenerated `assets/sounds/*`, `sounds.lock.json`, `src/audio/manifest.ts`, `variants.ts`), `scripts/check-sounds.ts` (cap rule).
- Checks: `scripts/check-floors.ts` (call the four new runners; ASCII water `,` shallow, `~` deep, `W` flooded), `scripts/check-light-rules.ts` (`hashState(full)` mixes powers/breath/water/plug-in hashes only when present).
- `package.json` (`d3-geo`, `topojson-client`, `world-atlas`, `@types/d3-geo`, `@types/topojson-client`; install with `npx expo install` / `npm i --save-exact`), `tsconfig.json` (`resolveJsonModule` only if needed).
- `CLAUDE.md`: Layout (new core files, `src/kits`, `src/game/world`, `src/screens/map`), Journey (globe map, powers, water, drowned), Rules (plug-in contract, water is an overlay never in `solid`, powers come in through `StartOptions`, kits), Commands unchanged. `plans/README.md` status is updated by the orchestrator.

## Implementation order

1. `npm run check:floors` on master passes; note the snapshot (no key may change in steps 2–8).
2. Registries without behaviour: `ArchProfileId` string + profile map, `tables.ts` + `EGYPT_TABLE` + `profileFromTable`, `plugins.ts` + empty `rules/index.ts`, `Floor.water/ext`, `GameState.ext`, `startOn`; `check-plugins.ts` (registry, equivalence, test plug-in). Snapshot unchanged.
3. `powers.ts` + `power` action + tick order + `handRadius`/`sightRange`; `check-powers.ts` (Egypt). Replay keys unchanged.
4. `water.ts` + `Status 'drowned'` + move/tick integration + `sandbox.ts`; water and Naga checks on the sandbox and on the test plug-in's pools.
5. Progress v6 + `reconcileRevisions`; `check-progress.ts`.
6. Kits (`src/kits`) and readers switched (GameScreen hints/captions, director feedback, ambience, story, theme, drawGame hunters); Egypt behaviour unchanged in the web preview.
7. Emblems, power bar, `PowerBar.tsx`, board effects, water art, `mechTime`; headless PNGs (canvaskit harness in the scratchpad) of the bar (all states), each emblem at 40/120 px, the water bands, jade overlay.
8. Sounds (`powers`, `water` groups), feedback rows, haptics; `npm run check:sounds`.
9. Globe: deps, `geo.ts`, `drawGlobe`, `Globe.tsx`, cards, pager, seal door, the fill/unlock flow; `check-world.ts`; pyramid page, artifact screen, camp text.
10. Settings sandbox, CLAUDE.md; full verification.

## Verification

- `npx tsc --noEmit`, `npx expo-doctor`, `npx expo export --platform android --output-dir <scratchpad>` and `--platform web` (d3-geo ESM bundles; land JSON included).
- `npm run check:floors` (all existing assertions; **every existing snapshot key unchanged**, list any that changes in the question file as a failure to fix, not to update), plus:
  - **check-plugins**: `registerRule` rejects a duplicate id; `profileFor('nope')` throws; a profile with an unknown rule id throws. Equivalence: a pyramid `{ ...egypt, id: 'egypt-t', architecture: 'egypt-t' }` with `profileFromTable('egypt-t', EGYPT_TABLE, egyptShape)` gives the same `fnv`, `featHash`, `placementHash`, `secretsHash` as Egypt on all 25 floors. Test plug-in `test.pools` (registered only in the script; profile `egypt-p` = Egypt + `rules: ['test.pools']`): floods the doorways of up to 2 leaf side rooms (door + ≤ 2 tiles, the rooms behind stay dry) and puts deep water on one off-path passage, with its own stream; Egypt hashes of the same seed unchanged for every field except `water/ext` (plug-ins run last, own stream); `waterFairness` null on all 25 floors and fuzz seeds 1..30; determinism (two generations equal, `ext` included); its `tick` sees `frozen` true exactly while the Jade is active; `listens` gets the step noises of a move in its `noises` arg without a guardian on the floor, and the queue is empty after the tick; `blocks` → bump (pos unchanged, no `trail` increment); `carry` reaches the next floor's `start`; `hashRules` mixes into replay hashes; 3000 random actions × 2 runs equal on floors 3, 12, 20 of `egypt-p`.
  - **check-powers** (fixed seed, Egypt; Scarab/Mirror/Jade; Naga on the sandbox): `freshPowers` numbers base and attuned (`'cambodia'` scarab 3/8 s/999, `'egypt'` jade 2/6 s, others base); use → `uses−1`, `left = seconds`, event `powerUsed`; second use while active ignored; `powerGap` blocks a second power for 0.5 s; 0 uses → `powerEmpty`, nothing else changes; not owned → state hash unchanged; after `seconds` of ticks `left = 0` + `powerEnded`; ticks while not burning do not count down. Scarab: `scarabPath` from `start` is a 4-connected open path whose BFS distance to the goal strictly decreases, length `min(reach, dist)`, ends at the stairs when `reach` ≥ dist; after taking the artifact (basement) it targets `exitFront`; on a floor where the way is blocked (a fired portcullis on the only path, synthetic) it is empty. Mirror: `handR` = `radiusQ(min(9.5, r × 1.6))`; lit tile count ≥ 1.8 × before on floor 10's start; `sightRange` grows accordingly; back to the old `handR` after expiry. Jade (floor 18, guardian forced awake via a noise at its lair): during the freeze `g.pos/cooldown/timer/rng/mode` unchanged over 3 s of ticks; a plate pressed during the freeze keeps `trapPhase 1` and its timer; fires `delay` s after the freeze; collapse `fill`/`covered` unchanged during it (floor 12 after the delay); the basement false door still opens during a freeze; noises made during the freeze never wake it; walking into the frozen guardian is a bump with no touch. Charges: `continue` into a camp floor refills, into a non-camp keeps, `falling` keeps, `retry` refills, actives end on every floor change. Naga (sandbox): the flooded tile blocks without the Naga (`flooded` event, pos unchanged) and admits with it; pace = cooldown values exactly (`0.15 × 1.4`, `× 2.0`, Naga `× 1.4`); breath drains 1/s in deep, not with the Naga, recovers 2/s on dry; `breathLow` once; standing in deep water 8 s → `drowned`; `retry` from `drowned` goes to the last camp with fresh powers; Naga expiring inside flooded water drains 2/s. Determinism: 3000 random actions including `power` (1 in 40) twice equal on floors 5, 18, 25 and the sandbox; committed keys `powers:<fi>`. Without powers every `replay:*` key unchanged.
  - **check-progress**: v1–v5 sample saves → v6 (`revs` = current, `focus` null, everything else equal to the v5 result); `reconcileRevisions` with maya bumped to 2: maya `camp/deepest/floors` gone, maya artifact/records/completions kept, egypt untouched, `revs.maya = 2`; a second call is a no-op; missing `revs` entries are left alone and set.
  - **check-world**: sites in range; the four real sites inside a `land-110m` polygon (`geoContains`), the Black Pyramid not on land and ≥ 5° (great-circle) from every land vertex; `SITE_ORDER` is west → east except Black last; `turn(a, b, 0/1)` hits the endpoints, the shortest way (|Δlon| ≤ 180); `arc` endpoints; timing: projection + path strings for one frame ≤ 1.5 ms (warn).
  - water fairness on every real pyramid floor (trivially null: no water yet) and on the sandbox.
- `npm run check:sounds` (new ids, caps).
- Headless renders (step 7) checked by eye: emblems readable at 40 px, sockets, water bands, jade overlay.
- Web preview: dev grant 4 artifacts → map: globe turns between the five cards (drag, coast, snap, tap markers), arcs gold, haze gone, door open; `?filled=china` flow with dev grant 3 → 4 (spark along the arc, socket fills, door opens); Egypt card → pyramid page shows powers (Jade "Strongest here") → play floor 18: power bar, keys 1–4, Scarab motes reach the stairs, Mirror widens the light, Jade stops the guardian and a pressed plate, sounds play; camp refills uses; sandbox: shallow/deep/flooded water, Naga dive, breath ring, drowned panel; a v5 save loads as v6.
- Device (release `preview` APK, Redmi 9, by the user): map turning ≥ 50 fps; floor 24 with the Mirror active (radius 9.5) + collapse + guardian at 60 fps.

## Performance budget (Redmi 9: Helio G80, Mali-G52, Hermes)

- Map: globe frame ≤ 6 ms JS (d3 projection of 110m land with clipping ≈ 2–3 ms, SVG string → `MakeFromSVGString` ≈ 1 ms, ≈ 25 draw ops); redraws only while turning/animating (15 fps pulse otherwise, 0 with reduced motion); 1 globe canvas + ≤ 6 small static canvases (card emblems, door). Land data parsed once (≈ 15 ms, on first mount).
- Game: `usePower`/`tickPowers` O(powers); Mirror radius 9.5 `computeLight` ≈ 2.5× a torch's tiles (≈ 0.5 ms per move on floor 24); `scarabPath` BFS ≤ 0.3 ms, at most 4×/s plus moves while active; Jade skips work. Water: band paths rebuilt only on `waterRev` change (≤ 2 ms), per frame ≤ 3 path fills + ≤ 40 strokes; `tickWater` O(1). Power bar ≤ 40 draw ops; effects ≤ 30 ops (scarab motes) when active.
- Memory: +2 per-run `Uint8Array`s only on water floors; decoded audio ≤ 36 MB worst case.
- Bundle: +≈ 110 KB JS/JSON (d3-geo, topojson-client, land-110m).

## Risks

- d3-geo is ESM-only: Metro with package exports handles it on SDK 58; if bundling fails, vendor `geoOrthographic`/`geoPath`/clip from d3-geo 3.1.1 (ISC) into `src/game/world/vendor/` rather than writing a new clipper.
- Globe redraw on the JS thread can drop frames on a Redmi 9 while a card fling scrolls at the same time: the turn animation is short (700 ms); if it stutters, render the land once per 2° of rotation and reuse the picture between steps (caching by quantised centre).
- Powers make the fast star easier: accepted (stars are personal; par stays power-free).
- Jade freezing traps could be abused to skip every trapdoor: one use per camp leg outside Egypt, two in Egypt, 4–6 s each.
- Water is only exercised by the sandbox and the test plug-in until 07/08: the fairness function and the checks are the contract those tasks must pass.
- Module augmentation for plug-in types needs each plug-in file imported somewhere (`rules/index.ts` does it); a plug-in left out of the index is a type that compiles but never runs: `check-plugins` asserts every profile's rule ids are registered.
