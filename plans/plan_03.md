# Plan 03 · Egypt complete: 25 floors, collapse, pressure-plate traps, trapdoors

Decisions and reasons: `plan_03_question.md` (Q-numbers = original plan, R-numbers = "Revision after tasks 01–02", which win where they disagree). **Revised 2026-11-21 against the merged code of tasks 01–02** (`601f342`): every name, file and signature below is the real one or an explicit change to it. Q0 (real art in phase 4) stands: new art here is tidy vector art in `src/game/render`, themed through `themes.ts`, structured to be swapped in tasks 10–13.

What exists today (do not re-plan it): `generate.ts` `generateFloor(spec)` (lattice → tree → loops → merges → kinds → carvers → niches → `profile.hooks` (before masks, plan 01 I4) → `placeBraziers` → `solid`/`opaque` → `dist` → `mainPath` → spots → `placeLights` with the items rng `seed ^ 0x85ebca6b`) and `floorFor(p, i)` (memo, world-aligned arrival from floor i−1's stairs, `GenSpec.camp` inlined from `campEvery`); `game.ts` `GameState` (hand/bag/ember, `items: Map<number, Lying>`, `fixtureLeft`, `fixtureR`, `cooldown`, `trail`, `seenAt`, `walkedAt`, `lightHand`/`lightFixed`/`lightSeen`/`light`, events) and `step`; `vision.ts` `clearLine(floor,…)`/`computeLight(floor,…)`; `walk.ts` `exits/isCorridor/holdDir/runDir(floor,…)`; `floorArt.ts` `bakeFloor(floor, theme, px)` (one image, `bakeTilePx` caps it at 2048 px); `lightMask.ts` `createLightMask(size)` (whole floor, 2 px/tile, reads `s.floor.opaque`); `drawGame(canvas, s, art, mask, view, frame)`; `Board.tsx` (memo canvas, picture state, redrawn from `GameScreen`'s rAF loop); `walker.ts`; `scripts/check-floors.ts` (+ `scripts/check-light-rules.ts`: rules, replay, light-budget bot), `scripts/floors.snapshot.json`.

## Goal

Egypt becomes the full 25-floor descent. Floors grow on a time-targeted curve (floor 1 ≈ 15 s, floor 10 ≈ 1.5 min, floor 24 ≈ 4 min) and get harder through rules: more loops, less light, then pressure plates that drop ceiling blocks, lower granite portcullises and release sand on tomb goods, trapdoors that drop you to the next floor early, and from floor 11 the collapse: after you set off, the floor above caves in and sand pours down the stairwell you came by and spreads outward, burying passages, items and lit fixtures. Camps are placed by play time. The 2048 px bake cap is replaced by a chunked, lazily rasterised floor image.

## Scope

In:
- `src/game/core/egypt.ts`: the 25-row table (sites, halls, galleries, loops, light density, sconce cap, traps, collapse, target time) and the camp list.
- `Pyramid.camps` replaces `campEvery`; progress v3 (+ `hints`).
- Generator split into `generateLayout` / `addFeatures` (lights, traps, sand order) with `layoutFor` / `floorFor` memos and `warmLayouts`.
- Core: per-run `grid` (dynamic `solid`/`opaque`), traps (3 plate kinds + trapdoor), collapse, wading, statuses `falling` and `buried`, `prevPos`, new events.
- Render: chunked floor art from a recorded picture, view-window light mask, sand renderer, baked trap telltales + per-frame trap sprites, quake shake, fall animation, side view for 25 tiers.
- UI: buried panel, fall overview, first-encounter hints, dev floor stepper.
- Checks: extend `check-floors.ts` and `check-light-rules.ts`.

Out: guardian, artifact escape, stars, records, secrets, sound (tasks 04–05; hooks only), tools, material/particle shaders (10–11), other pyramids' traps (07–09).

Hooks left for 04–05: `GameState.collapse.speed` multiplier, `pressPlate(s, trap, by: 'player' | 'other')`, `startFloor(..., opts.landing)`, events `quake | sandNear | plate | trapFired | hit | fell | sealed | buriedItem`, `s.skipped`, `Status` extended by union.

## Design

### 1. Egypt curve (`src/game/core/egypt.ts`) (Q1–Q5, Q33, Q37, R1, R9, R10)

`export type EgyptRow = { sites; halls; galleries; loops: number | null; secPerTile; sconceCap; traps: { block; portcullis; sandfall; trapdoor }; collapse: { delay; rate; cap } | null; target: number /* s */ }` and `export const EGYPT_ROWS: readonly EgyptRow[]` (index 0..24), `export const EGYPT_CAMPS = [4, 9, 13, 16, 19, 21, 23, 24] as const`. No imports (pure data), so `architecture.ts` and `pyramids.ts` can both import it without cycles.

| Floor | sites | ≈size | halls | gal | loops | secPerTile | block | portc. | sandfall | trapdoor | collapse delay s / rate tiles/s / cap % | camp | target |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 3 | 18 | 0 | 0 | ramp | .30 | – | – | – | – | – | | 0:15 |
| 2 | 4 | 20 | 0 | 0 | ramp | .28 | – | – | – | – | – | | 0:25 |
| 3 | 5 | 27 | 1 | 0 | ramp | .26 | – | – | – | – | – | | 0:30 |
| 4 | 5 | 25 | 1 | 1 | ramp | .24 | 1 | – | – | – | – | | 0:35 |
| 5 | 6 | 29 | 1 | 1 | ramp | .22 | 1 | – | – | – | – | ● | 0:45 |
| 6 | 6 | 31 | 1 | 1 | ramp | .20 | 1 | 1 | – | – | – | | 0:55 |
| 7 | 7 | 33 | 2 | 1 | ramp | .18 | 2 | 1 | – | 1 | – | | 1:00 |
| 8 | 7 | 38 | 2 | 1 | ramp | .16 | 2 | 1 | 1 | 1 | – | | 1:10 |
| 9 | 8 | 40 | 2 | 1 | ramp | .15 | 2 | 1 | 1 | – | – | | 1:20 |
| 10 | 8 | 43 | 2 | 1 | ramp | .14 | 2 | 1 | 1 | 1 | – | ● | 1:30 |
| 11 | 9 | ~48 | 2 | 1 | .124 | .135 | 2 | 1 | 1 | 1 | 45 / 0.8 / 20 | | 1:35 |
| 12 | 9 | ~48 | 2 | 1 | .129 | .13 | 3 | 1 | 1 | 1 | 40 / 0.9 / 22 | | 1:40 |
| 13 | 9 | ~48 | 3 | 2 | .133 | .13 | 3 | 2 | 1 | – | 36 / 1.0 / 25 | | 1:50 |
| 14 | 9 | ~48 | 3 | 2 | .137 | .125 | 3 | 2 | 1 | 1 | 32 / 1.1 / 27 | ● | 1:55 |
| 15 | 10 | ~52 | 3 | 2 | .141 | .125 | 3 | 2 | 2 | 1 | 30 / 1.2 / 30 | | 2:00 |
| 16 | 10 | ~52 | 3 | 2 | .146 | .12 | 4 | 2 | 2 | – | 28 / 1.3 / 32 | | 2:10 |
| 17 | 10 | ~52 | 3 | 2 | .150 | .12 | 4 | 2 | 2 | 1 | 26 / 1.4 / 34 | ● | 2:25 |
| 18 | 11 | ~56 | 4 | 2 | .154 | .115 | 4 | 3 | 2 | 1 | 24 / 1.5 / 36 | | 2:35 |
| 19 | 11 | ~56 | 4 | 2 | .159 | .115 | 4 | 3 | 2 | – | 22 / 1.6 / 38 | | 2:50 |
| 20 | 11 | ~56 | 4 | 2 | .163 | .11 | 5 | 3 | 2 | 1 | 20 / 1.7 / 40 | ● | 3:00 |
| 21 | 12 | ~60 | 4 | 3 | .167 | .11 | 5 | 3 | 3 | – | 18 / 1.8 / 42 | | 3:10 |
| 22 | 12 | ~60 | 4 | 3 | .171 | .105 | 5 | 3 | 3 | 1 | 16 / 1.9 / 44 | ● | 3:25 |
| 23 | 12 | ~62 | 5 | 3 | .176 | .105 | 5 | 4 | 3 | – | 15 / 2.0 / 46 | | 3:35 |
| 24 | 13 | ~66 | 5 | 3 | .180 | .10 | 6 | 4 | 3 | – | 14 / 2.1 / 48 | ● | 3:50 |
| 25 basement | 12 | ~60 | 3 | 1 | .150 | .11 | 4 | 3 | 2 | – | 14 / 2.0 / 40 | ● | 4:00 (+escape, 04) |

Sizes 1–10 are the real floors; 11–25 measured with a trial generator run (open tiles: f11 ≈ 760, f24 ≈ 1360).

- **Frozen:** floors 1–9 must stay bit-identical (snapshot `egypt:0..8` unchanged). Floor 10 is no longer the basement (burial → stairsDown room, different rooms-rng use), so it **is** regenerated (R1); its row values do not change.
- `architecture.ts` Egypt profile reads the table: `sites = EGYPT_ROWS.map(r => r.sites)`, `halls(i) = EGYPT_ROWS[min(i,24)].halls`, `galleries(i)` likewise, `lights.secPerTile = EGYPT_ROWS.map(r => r.secPerTile)`. Rows 1–10 equal today's formulas exactly (halls `i<2?0:i<6?1:2`, galleries `i<3?0:1`, the plan 02 secPerTile list).
- Loops (R9): new optional `ArchProfile.loopRate?: (floorIndex) => number`; if absent, `generate.ts` uses today's linear ramp, extracted unchanged as `export function linearLoopRate(loops, i)`. Egypt: `loopRate = i => EGYPT_ROWS[i].loops ?? linearLoopRate(EGYPT.loops, i)` (`loops: null` on rows 1–10, so those floors use the identical expression).
- Sconces (R10): new `ArchProfile.sconceCap: (i) => number`; `placeLights` uses `Math.min(profile.sconceCap(floorIndex), Math.floor(open / 90))` in place of the literal 8. Egypt `i => EGYPT_ROWS[i].sconceCap` (8 for rows 1–10, 12 from 11); generic/black `() => 8`.
- Traps/collapse per floor: new optional `ArchProfile.traps?: (i) => EgyptRow['traps']` and `collapse?: (i) => EgyptRow['collapse']`. `generic` and `black` spread `EGYPT`, so they must set `traps: undefined, collapse: undefined, loopRate: undefined` explicitly (their floors stay as today).
- Trap counts are targets (see §5 for portcullis limits). Trapdoors only on floors whose next floor is neither a camp nor the basement (Q26); the table respects it, and `addFeatures` enforces it (`spec.nextIsCamp`).
- Camps (1-based) **5, 10, 14, 17, 20, 22, 24, 25** (Q4). Collapse also runs on camp floors (Q15).
- Only rows 11–25 and all trap/collapse numbers may be tuned (bot report, §Verification).

### 2. Camps model (`game.ts`, `pyramids.ts`, `generate.ts`, `progress.ts`) (Q5, Q36, R15)

- `Pyramid.campEvery: number` → `Pyramid.camps: readonly number[]` (0-based, ascending). `pyramids.ts`: `BASE` gets `camps: [4]` (Maya, Cambodia, China, Black: 5 floors); Egypt `floorCount: 25, camps: EGYPT_CAMPS`.
- `game.ts`: `isCampFloor(p, i) = p.camps.includes(i)`; `lastCamp` unchanged in shape (largest camp ≤ i, else 0). `pyramids.ts` `campFloorNumbers(p) = p.camps.map(i => i + 1)`.
- `generate.ts` `floorFor`: `camp: pyramid.camps.includes(floorIndex)` (still inlined: `game.ts` imports `generate.ts`, plan 02 I2).
- `pyramid/[id].tsx` "Camp floors" fact: `"5, 10, 14, … & 25"` (comma list, " & " before the last).
- `progress.ts` `version: 3`; `migrate`: keep the v<2 branch; for v<3, each `camp[id]` not in `PYRAMIDS[id].camps` and ≠ 0 → `lastCamp(PYRAMIDS[id], camp)` (`isCampFloor`/`lastCamp` from `game.ts`; type-only cycle-free), clamp `deepest` to `floorCount − 1`, add `hints: {}`. New data `hints: Partial<Record<HintId, true>>` with `HintId = 'plate' | 'block' | 'portcullis' | 'sandfall' | 'trapdoor' | 'collapse'`, action `markHint(id)`, add `hints` to `partialize` and `EMPTY`. (v2 saves only ever hold camps 4 and 9, both still valid.)

### 3. Generator split (`generate.ts`, `floor.ts`) (Q9, R2, R3)

The split exists because of a dependency, not cost: trapdoor landings on floor i need floor i+1's layout, and floor i+1's arrival needs floor i's stairs. (Measured: the full 25-floor chain is ~46 ms on desktop today; features are a small part.)

- `floor.ts`: `export type Layout = Omit<Floor, 'items' | 'fixtures' | 'traps' | 'trapAt' | 'collapse'> & { braziers: Fixture[]; dist: Int32Array; arrivalRoom: number; stairsRoom: number }`. `Floor` gains `dist: Int32Array` (BFS from `start` on the static mask), `traps`, `trapAt`, `collapse` (§4).
- `generate.ts`:
  - `generateLayout(spec): Layout` = today's `generateFloor` up to and including the dead-end spots and `sp.dist/sp.main` (steps 1–10 + `placeBraziers` + masks + `dist` + `mainPath` + spots). No items rng is touched here.
  - `addFeatures(layout, spec, below: Layout | null): Floor` = `placeLights` with `createRng(spec.seed ^ 0x85ebca6b)` (same stream and sequence as today), `fixtures = [...braziers, ...sconces, ...shrines]` (today's order: `fixtureLeft` indices and the snapshot hash depend on it), then `placeTraps` (§5, own rng `spec.seed ^ 0x2545f491`), then `buildSandOrder` (§6, no rng). `onPath` is rebuilt from `mainPath`.
  - `generateFloor(spec, below = null)` = `addFeatures(generateLayout(spec), spec, below)` (kept for the check script).
  - `GenSpec` gains `nextIsCamp?: boolean`, set by `floorFor` (`p.camps.includes(i + 1)`); trapdoors need `below !== null && !nextIsCamp && !basement` (§5).
  - `layoutFor(p, i)` memo (key as today `${id}:${seed}:${i}`), arrival from `layoutFor(p, i−1).stairs`; `floorFor(p, i)` memo = `addFeatures(layoutFor(p,i), spec, i+1 < floorCount ? layoutFor(p, i+1) : null)`.
  - `warmLayouts(p, upTo, signal?)`: `setTimeout(0)` per layout 0..upTo+1, stops when aborted. Called by `pyramid/[id].tsx` on mount with `upTo = checkpoint` (cleanup aborts).
- `profile.hooks` stay pre-mask (for culture tiles, tasks 07–09); traps and sand are **not** hooks (R2).

### 4. Data model additions (`floor.ts`)

```ts
export type TrapKind = 'block' | 'portcullis' | 'sandfall' | 'trapdoor';
export type Trap = {
  kind: TrapKind;
  tile: number;          // the plate / the trapdoor slab
  target: number;        // block: = tile; portcullis: the port tile it seals; sandfall: the guarded item tile; trapdoor: -1
  area: Int32Array;      // sandfall: tiles it buries in BFS order from the plate; others empty
  delay: number;         // s from press to effect: block 0.5, portcullis 0.35, sandfall 0.6, trapdoor 0.2
  landingWorld: { x: number; y: number } | null;   // trapdoor: world coords (centre = size >> 1, as arrivalWorld)
};
Floor.traps: Trap[];
Floor.trapAt: Int16Array;     // per tile: trap index or -1 (plate / trapdoor tile)
Floor.collapse: {
  delay: number; rate: number; cap: number;   // cap = max tiles covered (integer)
  order: Int32Array;     // sand-graph tiles in BFS order from the STAIRS_UP tiles, ranked part only
  rank: Int32Array;      // per tile: index in order, or -1
  sdist: Int32Array;     // per tile: BFS steps from the source, -1 unreached
} | null;
```

Plates and trapdoors stay FLOOR (or port FLOOR/DOOR) tiles in `tiles`, so `TILE`, `TILE_SOLID`, `TILE_OPAQUE` do not change; their look is drawn from `traps`.

### 5. Trap placement (`src/game/core/traps.ts`, `placeTraps`) (Q19–Q26, R6, R7)

Inputs: layout + items + fixtures (after `placeLights`), `profile.traps(i)`, `below`, the rng. Work on `removed = layout.solid.slice()`.

Fairness contract:
- **I1 avoidable**: with every trap tile solid, every other open tile is reachable from `start`.
- **I2 worst case**: with every trap tile solid and every effect applied (block tiles, portcullis ports solid), I1 still holds.
- **I3** no trap tile on `mainPath`, in `arrivalRoom`/`stairsRoom`, within `dist` 6 of `start`, on or 4-adjacent to an item, a fixture tile, a STAIRS_* tile, or a DOOR/port tile (except a portcullis's own port and plate); Manhattan spacing ≥ 4 between trap tiles.

Method: articulation points (iterative Tarjan in `graph.ts`) of the open graph of `removed`; a tile is usable iff it is not an articulation point. After each accepted trap apply its removals and recompute (≤ 16 recomputes; ≤ 1400 open tiles). Kinds in order block → portcullis → sandfall → trapdoor, candidates shuffled with the traps rng:
- **block** (ceiling block): tiles in `hall`, `chamber`, `shrine`, `magazines` rooms whose 3×3 neighbourhood is open floor (no pillar or wall next to it). Removal: the tile.
- **portcullis** (R6): any `links[k].door` tile (DOOR or a passage-to-passage port) that is not an articulation point (it lies on a loop cycle) and not on `mainPath`; plate = the open tile in front of it on the side with the lower `dist` (the side you approach from), must also be a non-articulation point after the port is removed. Removals: port + plate. Antechamber doors are never eligible (the stairs room is a leaf, so they are always articulation points); the plan-01 decorative antechamber grooves stay as they are. Count is limited by loop edges off the main path: placement stops when no candidate remains (reported).
- **sandfall**: an item whose tile is in a `chamber`/`shrine`/`magazines`/`hall` room; plate = a non-articulation tile of the same room at BFS distance 1–3 from the item, with the item still reachable avoiding the plate. `area` = that room's open tiles within room-BFS 4 of the plate, BFS order (never leaves the room).
- **trapdoor**: only if `below && !spec.nextIsCamp && !spec.basement`; off-main-path tiles in passages or rooms, non-articulation, `dist[tile] ≥ 0.3 × dist[stairs]`. Landing check on `below`: project world coords; nearest open tile (BFS over all tiles from the clamped projection, ties lowest index) outside `below.arrivalRoom`/`below.stairsRoom`, `distancesFrom(below.solid, below.size, landing)[below.stairs] ≥ 0.4 × below.dist[below.stairs]`, and outside the collapse region of `below`: `sandOrder(below, profile.collapse(i+1))` rank −1 or > `cap + 4 × SLOPE` (`sandOrder` is the pure core of §6). Store `landingWorld`.

Shortfall policy (R7): placement may return fewer traps than the target; the check script decides (Verification).

### 6. Collapse order (`src/game/core/collapse.ts`, `buildSandOrder`) (Q10–Q12)

- `sandOrder(layout, spec)`: sand graph = tiles with `!opaque` except STAIRS_DOWN (sand flows over benches, braziers, the sarcophagus); sources = the STAIRS_UP tiles; BFS in `DIRS` order → `sdist`, full order. `cap = round(openTiles × cap% / 100)`; `lag` = number of order entries with `sdist ≤ sdist[order[cap−1]] + SLOPE`; `rank[order[k]] = k` for `k < cap + lag`, others −1; `order` truncated to the ranked part.
- Invariants (asserted in the check): `rank[stairs] = −1`; with all ranked tiles solid, the component of `stairs` holds ≥ 40 % of open tiles; `sdist` non-decreasing along `order`. If the first fails for a cap, `buildSandOrder` lowers `cap` until it holds (deterministic) and the check reports the lowered floors.

### 7. Runtime state (`game.ts`) (R8, R13)

```ts
export type Grid = { size: number; solid: Uint8Array; opaque: Uint8Array };
grid: Grid;             // per-run copies of floor.solid/opaque; every core consumer uses this during a run
prevPos: number;        // tile before the last move (push-back target); render keeps its own copy
trapPhase: Uint8Array;  // per trap: 0 armed, 1 pressed, 2 fired, 3 jammed
trapTimer: Float32Array;
collapse: { started: boolean; t: number; fill: number; covered: number; blocked: number;
            speed: number /* 1; task 04 */; rank: Int32Array /* run copy */; order: Int32Array /* run copy */;
            pending: number /* tile or -1 */; lastNear: number } | null;
sand: Uint8Array;       // per tile: live collapse level 0..255
seenSand: Uint8Array;   // per tile: max(sand, localSand) when last lit (memory shows what you saw)
localSand: Uint8Array;  // per tile: sandfall level 0..255 (wading, burying; never blocks)
opaqueDirty: boolean;
landing: number;        // tile you fell onto this floor, -1
skipped: number;        // floors left through a trapdoor this run (stars hook)
// Status: 'playing' | 'descending' | 'falling' | 'burntOut' | 'buried' | 'escaped'
// GameEvent.type adds 'plate' | 'trapFired' | 'hit' | 'fell' | 'quake' | 'sandNear' | 'sealed' | 'buriedItem';
// GameEvent.kind becomes ItemKind | FixtureKind | TrapKind | null (captionFor handles null)
```

- `vision.ts`: `clearLine(grid: Pick<Grid,'size'|'opaque'>, …)`, `computeLight(grid, …)` (structural: a `Floor` still fits, so callers outside a run keep working). `relight` passes `s.grid`.
- `walk.ts`: `exits(grid, pos)`, `isCorridor(grid, pos)`, `holdDir(grid, pos, dir, avoid?: (tile) => boolean)` (never auto-turns a bend onto an `avoid` tile; straight on is the player's choice), `runDir(floor, grid, pos, dir, interesting, avoid)` (also stops when the next tile is `avoid`). Pure predicates keep `walk.ts` free of `GameState` (plan 02 I10). `walker.ts` builds `avoid = t => (trapAt[t] >= 0 && trapPhase[trapAt[t]] === 0) || level(t) >= COVER` and reads `s.grid` for exits.
- `startFloor(pyramid, i, hand, bag, steps, ember, opts?: { landing?: { x: number; y: number }; skipped?: number })`: grid copies, trap/collapse state from `floor`; with `landing`: `pos` = nearest open tile to the projected point that is not a trap tile, not 4-adjacent to one, not in the stairs room (BFS, ties lowest index); `cooldown = LAND_STUN`, `landing = pos`, `walkedAt[pos] = 0`.
- Extract `lightSpare(s)` from `burn` (drop the dead source, light the bag entry with most `left`, emit `autoLight`), used by burn-out and by `loseHand(s)` (`hand.left = 0`, then `lightSpare`; with an empty bag you are on embers).

### 8. Rules (`step`) (Q12–Q14, Q18, Q20, Q29, Q35)

Constants: `collapse.ts` `SLOPE = 3`, `COVER = 0.2`, `WADE = 1.8`, `BURY_ITEM = 0.35`, `SAND_NEAR = 3`; `traps.ts` `STUN_HIT = 0.8`, `LAND_STUN = 1.0`. `level(s, i) = max(sand[i], localSand[i]) / 255`.

**move(dir)** (today's test, now on `grid.solid`):
- Cadence: `cooldown = (cooldown > −STEP ? cooldown : 0) + STEP × (level(next) ≥ COVER ? WADE : 1)`.
- `prevPos = pos` before moving; if `collapse.pending === prevPos`, apply it now (blocked: solid + opaque, bury, `opaqueDirty`).
- Then today's order: `pickUp`, `lightFixtures`, stairs/artifact status; then **trap enter**: `k = trapAt[pos]`, `trapPhase[k] === 0` → `pressPlate(s, k, 'player')`: phase 1, `trapTimer[k] = delay`, event `plate` (trapdoor emits `fell` when it fires). Then `relight`.

**tick(dt)** order: cooldown → `burn` (if burning) → `tickTraps` → `tickCollapse` → cut-off → relight (`relight(s, false)` plus the opaque condition below).
- **Traps** (index order) phase 1: `timer −= dt`; ≤ 0 → phase 2, event `trapFired`:
  - block: `grid.solid = grid.opaque = 1` at the tile. If `pos === tile`: event `hit`, `loseHand(s)`, `cooldown = max(cooldown, STUN_HIT)`, `pos = prevPos` if open, else the first open neighbour in `DIRS` order.
  - portcullis: the port tile solid + opaque. If `pos === port`: push to the port's open neighbour on the far side from the plate, `hit` as block.
  - sandfall: ramps `localSand` on `area` to 179 (0.7) over 3 s, tile k of the area starting at `k × 3 / area.length` s; tiles reaching `BURY_ITEM` bury their item (`items.delete`, event `buriedItem`) and smother an unlit shrine candle/brazier fixture there (`fixtureLeft = 0`).
  - trapdoor: `status = 'falling'`, `skipped++`, event `fell`.
  - After any solid change: `rebuildRank(s)` when the collapse is active (multi-source BFS from the covered tiles over the current non-solid sand graph; uncovered tiles get ranks `covered + k`; cap unchanged), `opaqueDirty = true`.
- **Collapse** (`floor.collapse`): `t += dt` (only while `burning`). At `t ≥ delay`: `started`, event `quake` (once). While started and `fill < order.length`: `fill += rate × speed × dt`. Front `D = sdist[order[floor(fill) − 1]]`. Covered = rank `< fill`; blocked = covered with `sdist ≤ D − SLOPE`. `sand[i] = 255 × clamp((D − sdist[i]) / SLOPE, 0.15, 1)` for covered. Advance the `covered`/`blocked` pointers; newly blocked: solid + opaque (if it is `pos`: `pending = pos` instead), item buried, fixture on it smothered (sconce: also when its tile is covered, the bracket is low; brazier/shrine: when covered); newly covered: bury items at level ≥ `BURY_ITEM`, jam plates (`trapPhase = 3`). `sandNear` when a newly covered tile is within Chebyshev `SAND_NEAR` of `pos`, at most once per 5 s (`lastNear`).
- **Cut-off**: if any tile turned solid this tick, BFS from `pos` over `!grid.solid`: if neither `stairs` nor an armed trapdoor is reachable → `status = 'buried'`, event `sealed`.
- **Relight**: as today, plus when `opaqueDirty` (hand relight if a changed tile is within `ceil(r) + 1` of `pos`, `fixedDirty = true`, visible set recomputed). Wherever today's loop writes `seenAt[i] = trail`, also `seenSand[i] = max(sand[i], localSand[i])`. The collapse also redraws: `sand` changes do not need a relight (light passes covered sand).

**continue**: from `descending` as today; from `falling`: `startFloor(p, i+1, hand, bag, steps, ember, { landing: trap.landingWorld, skipped })` (no camp refill: never a camp floor by placement). **retry**: from `burntOut` or `buried` → `lastCamp`, as today. `skipped` resets on retry.

### 9. Rendering (Q6–Q8, Q16, Q17, Q21, Q32, R4, R5)

**Chunked floor art** (`floorArt.ts`; `bakeFloor` and `bakeTilePx` are removed):
- `createFloorArt(floor, theme, px): FloorArt` with `px = Math.round(tilePx × Math.min(PixelRatio.get(), 2))` (no size cap). It **records** today's bake drawing (masonry, paving, contact shadows, objects, plus the trap telltales below) once into an `SkPicture` via `Skia.PictureRecorder().beginRecording(floorRect)` — given a rect, RN Skia 2.14 records with an RTree, so clipped playback skips ops outside the clip (R4). To make culling effective, the masonry builders (`capLines`, `capEdges`, `faceJoints`, `faceEdges`) and contact-shadow strips are flushed per band of `CHUNK` rows instead of one path for the whole floor. Output must look identical to today's bake on floors 1–9 (headless PNG diff).
- Chunks: `CHUNK = 8` tiles; chunk image `CHUNK·px + 2·PAD`, `PAD = 2` px. Rasterise: one reused CPU `Skia.Surface.Make(side, side)`; `clear`, `translate(PAD − cx·CHUNK·px, …)`, `clipRect`, `drawPicture`, `flush`, `makeImageSnapshot()`. PAD is real neighbouring content (the picture covers it), so linear filtering shows no seams.
- `art.ensure(view: { x0, y0, x1, y1 } /* tiles */, budgetMs)`: rasterise missing visible chunks first (always, even over budget), then prefetch the ring one chunk beyond the view in the camera's motion direction while `performance.now()` stays within budget (6 ms while playing). `GameScreen`'s rAF loop calls it before `drawRef.current` while playing, and during the overview phase with 8 ms per frame around the start tile (the overview's side view is JS-animated, so leave it frame time). LRU (R5): capacity = `max(12, floor(16 MB / (side² × 4)))` chunks (Redmi 9 board ≈ 24 dp/tile → 48 px → 388² px ≈ 0.6 MB → 26 chunks); evicted images go to a retire list disposed 4 `ensure` calls later (a recorded frame may still draw them, as the mask ring does). `art.dispose()` when the floor or `px` changes (same effect as today's `prevArt`).
- `drawGame(canvas, s, art: FloorArt, mask, view, frame)` draws visible chunks with `drawImageRectOptions(img, {PAD, PAD, CHUNK·px, CHUNK·px}, dst in tile units × t, Linear, None)` inside the existing `saveLayer`.
- Baked trap telltales (armed look, part of the floor): **plate** = darker granite slab inset 0.12 tile among the limestone paving, hairline shadow gap, bevel highlight; **block** adds 5–7 stone chips around the plate; **portcullis** = deep jamb slots in the walls beside the port, the granite slab's lower edge and lifting boss visible in the lintel slot; **sandfall** = a small cone of fine sand on the plate and a dark crack in the ceiling line above; **trapdoor** = limestone slab with a dark seam on three sides and two pivot pins on the fourth.

**Light mask** (`lightMask.ts`, Q8): `createLightMask(size)` stays per floor, but `render(s, t, handF, fixedF, win)` fills only the window `win = { x0, y0, w, h }` (view + 2 tiles margin, ≤ 19 × 19 tiles; 2 px/tile → ≤ 38² px) and returns `{ image, x0, y0 }`; `drawGame` places it at `(x0·t, y0·t)` with size `(w·t, h·t)`. `cur/prev/shown` stay whole-floor arrays but are updated only inside the window (tiles entering it sit in the 2-tile margin, off screen). Opaque test reads `s.grid.opaque`. A shared `viewWindow(view, size)` helper in `drawGame.ts` computes `win` for the mask, the sand image and `art.ensure`.

**Per-frame trap sprites** (`src/game/render/drawTraps.ts`, inside the masked layer, only traps in view): pressed plate sunk (wider gap, darker); fallen block as a 3/4 granite block (top + south face, contact shadow, chips; its tile is opaque now, so the mask lights its faces from your side like a wall); sealed portcullis slab filling the port with the boss; sandfall trickle while armed and lit (thin animated stream), pouring column 3 s after firing; trapdoor seam dust (2–3 drifting grains) while armed; on `falling` the slab tilts open and the player shrinks and darkens into the pit over 0.25 s (the screen delays the `continue` by 0.25 s for it).

**Sand** (`src/game/render/drawSand.ts`, Q32): a 128² sand pattern image (ripples, grain speckle, theme colours `sand`/`sandDark`) made once per `px`; per frame a level image over `win` (2 px/tile, alpha = live level where `light > 0`, `seenSand` where remembered, 0 elsewhere), drawn as a layer: rect with the pattern `ImageShader` (Repeat), then the level image with `DstIn`, Linear. Blocked tiles: darker south face (0.55 tile, like a wall face) and a crest highlight via a second offset pass of the level image. While `started`: pour column at the STAIRS_UP tiles (vertical gradient stream, scrolling bands) + tan dust haze (radial gradient, alpha 0.25, slow pulse; render only). All inside the masked layer, so sand is seen only in light or as memory.

**Quake**: camera shake 0.6 s, amplitude 0.15 tile, decaying hashed noise (none with reduced motion), applied to `cam` in the rAF loop; dust motes around the stairwell; `haptic.heavy()`.

**Side view** (`drawPyramidSide.ts`, `sideLayout(width, height, floors)`): for `floors > 10`, `ground = 0.72 × height` and tiers become fine courses (`th` ≥ 6 px; joint lines every other course), camp flames on every camp tier (`isCampFloor`, already looped). `FloorOverview` kind `'fall'`: the marker drops one tier with a dust puff and shake; title "The floor gave way", line as for `'descend'`.

### 10. UI (`GameScreen.tsx`, `FloorOverview.tsx`, `settings.tsx`, `pyramid/[id].tsx`) (Q30)

- `art` = `useMemo(() => createFloorArt(s.floor, themeFor(pyramid.id, info), px), [s.floor, px, …])` (the picture is recorded while the overview covers the board); a ref gives the rAF loop access for `ensure`.
- Status effect: `falling` → after 0.25 s, `step(continue)`, `reachFloor`, overview kind `'fall'`, `haptic.heavy()`; `buried` → `haptic.warning()`, phase `buried` with a panel: eyebrow floor text, title "Sealed in by sand", text "The sand has closed every way down. You dig back to {campLabel}.", buttons as burnt-out (retry, leave). `retry` handles both.
- Events (existing loop): `plate` caption "Click." + `haptic.tap()`; `trapFired` `bump`; `hit` "The block knocks the light from your hand" + `warning`; `quake` `heavy`; `sandNear` `bump`; `buriedItem`, `fell`, `sealed` no caption.
- First-encounter hints (`progress.hints`, once per save): when a trap tile of a new kind is first lit ≥ 0.3 (checked at the HUD cadence, 4 Hz), or at the first `quake`, set `caption.current` with `until = clock + 3` and `markHint`: plate "A granite slab set in the limestone. A pressure plate."; block "Chips of fallen stone around it."; portcullis "A slab hangs in the slots above the passage."; sandfall "Sand trickles from the ceiling here."; trapdoor "A slab on pivots. It would drop you to the floor below."; collapse "The ceiling over the stairs gives way. Get away from the sand." (the `plate` hint is shown first; the kind hint on the next sighting).
- `settings.tsx` Developer: replace the per-camp buttons with "Egypt: start at floor n" stepper (− / n / +, 1–25) and a Go button: `devReachCamp('egypt', n − 1)` then push the Egypt page (as today).
- `pyramid/[id].tsx`: `warmLayouts(p, checkpoint)` on mount; camp list text.

## Files

Add:
- `src/game/core/egypt.ts` — `EgyptRow`, `EGYPT_ROWS`, `EGYPT_CAMPS`.
- `src/game/core/graph.ts` — `bfsFrom(solid, size, from, out)`, `articulationPoints(solid, size, out: Uint8Array)` (iterative), `nearestOpen(solid, size, x, y, reject)`.
- `src/game/core/traps.ts` — kinds, constants, `placeTraps`, `pressPlate`, `tickTraps`.
- `src/game/core/collapse.ts` — constants, `sandOrder`, `buildSandOrder`, `tickCollapse`, `rebuildRank`, `sandLevel(s, i)`.
- `src/game/render/drawTraps.ts`, `src/game/render/drawSand.ts`.

Change:
- `floor.ts` — `Layout`, `Trap`, `TrapKind`, `Floor.dist/traps/trapAt/collapse`.
- `architecture.ts` — Egypt reads `egypt.ts`; `loopRate?`, `sconceCap`, `traps?`, `collapse?`; `GenSpec.nextIsCamp`; generic/black overrides.
- `generate.ts` — `generateLayout`, `addFeatures`, `generateFloor(spec, below)`, `layoutFor`, `floorFor`, `warmLayouts`, `linearLoopRate`, camps from `p.camps`.
- `placeLights.ts` — `profile.sconceCap`.
- `game.ts` — `Pyramid.camps`, `isCampFloor`, statuses, events, `Grid`, trap/collapse state, rules, `startFloor` opts, `lightSpare`/`loseHand`, `prevPos`.
- `vision.ts`, `walk.ts` — `Grid` parameters, `avoid` predicates.
- `pyramids.ts` — `camps`, Egypt 25 floors, `campFloorNumbers`.
- `render/floorArt.ts` (picture + chunk cache + telltales), `lightMask.ts` (window, `grid.opaque`), `drawGame.ts` (chunks, window, sand, traps, shake offset), `drawPyramidSide.ts` (25 tiers), `themes.ts` (`sand`, `sandDark`, `granite`, `graniteEdge` on `FloorTheme`, derived for other themes).
- `screens/GameScreen.tsx`, `screens/play/Board.tsx` (`art: FloorArt`), `screens/play/walker.ts` (grid, avoid), `screens/play/FloorOverview.tsx` (`'fall'`), `app/pyramid/[id].tsx`, `app/settings.tsx`.
- `state/progress.ts` — v3, `hints`, `markHint`.
- `scripts/check-floors.ts`, `scripts/check-light-rules.ts`, `scripts/floors.snapshot.json`.
- `CLAUDE.md` — Journey (Egypt 25 floors, camps list, collapse from 11, traps, trapdoors), Layout (new files), Rules ("during a run core reads `s.grid`, never the floor's static masks"; "floor art is a recorded picture rasterised in 8-tile chunks").

## Implementation order

1. **Safety net first** (before any change): add to `check-light-rules.ts` a committed replay hash per Egypt floor 1, 5, 9 (snapshot keys `replay:0/4/8`, written by `--update`) and run `--update` on today's code, so later refactors are checked against today's behaviour.
2. `egypt.ts`, `camps` model, `pyramids.ts`, progress v3, profile fields (`loopRate`, `sconceCap`, `traps`, `collapse`); fix callers; `npx tsc --noEmit`; `check:floors`: `egypt:0..8` and `replay:*` unchanged, `egypt:9` changes (expected, R1), floors 11–25 generate and pass the plan 01/02 asserts.
3. Generator split (`generateLayout`/`addFeatures`/`layoutFor`/`warmLayouts`); snapshots unchanged.
4. `Grid` refactor of `game.ts`/`vision.ts`/`walk.ts`/walker/bot (pure refactor): `replay:*` unchanged.
5. `graph.ts`, `placeTraps`, `buildSandOrder`; check asserts (I1–I3, counts, landings, collapse invariants); ASCII legend `b` block plate, `p` portcullis plate, `=` armed port, `s` sandfall plate, `v` trapdoor, `--sand` prints sand rank deciles 0–9.
6. Trap and collapse rules, statuses, landing, events; rule tests; `replay:4/8` now change (traps on floors 5, 9): `--update` once, deliberately.
7. Picture-recorded chunked `floorArt.ts` + windowed `lightMask.ts` first (headless PNG: floor 9 identical to the old bake; floor 24 with no seams at fractional camera positions), then `drawSand.ts`, `drawTraps.ts`, shake, side view.
8. `GameScreen` statuses, panels, captions/hints, dev stepper, warm-up.
9. Bot report → tune rows 11–25; `--update`; CLAUDE.md; full verification.

## Verification

- `npx tsc --noEmit`, `npx expo-doctor`, `npx expo export --platform android --output-dir <scratchpad>` and `--platform web`.
- `npm run check:floors` (seeds: Egypt fixed seed floors 1–25; fuzz seeds 1..100 over all 25 floors and 101..300 over floors 1–10; the fuzz chain builds layouts first, then `generateFloor(spec, below)`):
  - determinism and snapshot: today's `fnv` (tiles, start, stairs, items, fixtures) stays the layout+lights hash (`egypt:i`; `egypt:0..8` must equal the committed values); a second hash `egypt:i:feat` covers traps (kind, tile, target, area, landing) and collapse (`cap`, `order`).
  - camps: `isCampFloor(egypt, i)` true exactly for `[4,9,13,16,19,21,23,24]`; `lastCamp(egypt, 12) = 9`, `(13) = 13`, `(24) = 24`; every seal pyramid's basement is a camp; no trapdoor on floors whose next floor is a camp or the basement; `floorCount ≤ sites.length` for every pyramid.
  - traps: I1, I2, I3 on every floor and seed; fixed seed: every kind meets its target except portcullis, which must meet `min(target, eligible ports)` (eligible count printed); fuzz: total traps ≥ 50 % of the total target for every floor with target ≥ 2; shortfalls printed; sandfall item reachable avoiding the plate; trapdoor landing resolved with `startFloor`'s rule on the full floor below: not a trap or 4-adjacent, outside arrival/stairs rooms, ≥ 0.4 × stairs distance, outside the collapse region.
  - collapse: §6 invariants; lowered caps printed.
  - rules (scripted states in `check-light-rules.ts`): block — stand on the plate 0.5 s → `hit`, hand lost (spare lit / embers), pushed to `prevPos`, tile solid; walking on → no hit, solid behind; portcullis — pass at walking cadence → sealed behind; stop on the port → pushed to the far side + hit; sandfall buries the guarded item within 3 s; trapdoor → `falling`, `continue` lands on the resolved landing with `cooldown = 1.0`, `skipped = 1`; collapse — nothing before first move + delay; covered/blocked monotonic; player tile pending until left; wading cadence 1.8×; items/fixtures buried; plate jammed; cut-off → `buried`; `retry` from `buried`; `rebuildRank` after a portcullis keeps sand from passing the sealed port; `runDir`/`holdDir` never step onto an armed trap or covered sand; 3000-action replay twice on floors 11, 17, 24 equal (`hashState` extended: trapPhase, collapse fill/covered/blocked, `grid.solid`, `sand`, `localSand`, status).
  - **bot report** (the plan 02 bot, now: avoids seen armed trap tiles and covered sand when another frontier exists, `retry`s from the last camp after a burn-out or burial up to 3 times per floor, 20 bot seeds): per floor median time, light found/used, burn-outs, sealed-in rate, trap hits, falls. Targets: median time within [0.6, 1.6] × target time; floors 11–24 sealed-in rate 3–20 %; floors 1–3 identical to today's report; existing fails (no burn-out and ≥ 20 s left on floors 1–3) stay.
  - timing (desktop, warn above): full floor 24 < 12 ms; layout chain 1→25 < 80 ms; replace today's "avg < 2 ms" warning by these.
- Headless render (canvaskit-wasm harness in the scratchpad, as tasks 01–02 did): chunked floor 9 vs old bake pixel diff ≈ 0; floor 24 chunk seams; trap telltales and sprites; sand layer.
- Web preview: dev stepper to floors 4, 6, 8, 11, 15, 24: telltales readable in torchlight; plate click and timing; fallen block lit like a wall; portcullis seals both ways; sandfall buries the jar; trapdoor fall → fall overview → land away from the stairwell with a stun; floor 11 quake after first move + 45 s, sand column, spread, burial, sand only in light, remembered as seen, wading slower, sealed-in panel; floor 24 no seams while moving; side view 25 courses, 8 camp flames; an old v2 save loads.
- Device (release `preview` APK, Redmi 9): floor 24 with the collapse running and 8 fixtures lit: 60 fps while walking, no chunk-bake hitch > 1 dropped frame per 8 tiles walked; resume at camp 24 reaches the overview in < 400 ms.

## Performance budget (Redmi 9: Helio G80, Mali-G52, Hermes)

- Generation: layout ≤ 25 ms, features ≤ 30 ms for floor 24 on device; resume chain ≤ 400 ms cold, normally pre-warmed on the pyramid screen. Picture recording ≤ 40 ms for floor 24, under the overview.
- Core tick: traps O(traps); collapse O(newly covered + band ≤ 150 tiles); cut-off BFS ≤ 0.6 ms (≤ 4600 tiles) only on solid changes (≤ 3/s); relight as today + on opaque changes in reach.
- Memory: per-tile arrays ≈ 15 × 4600 × ≤ 4 B ≈ 280 KB per run; memoised layouts ≈ 1 MB for 25 floors; chunk cache ≤ 16 MB (was ≤ 16 MB for one floor-10 image); picture ≈ 1–3 MB; sand pattern 64 KB.
- JS per frame: chunk raster ≤ 6 ms only on frames that need one (≈ 1 per 8 tiles walked); mask + sand images over the window ≤ 1 ms (≤ 361 tiles each, was 1849 for the whole floor 10); picture record of the frame ≤ 2.5 ms; total ≤ 6 ms on bake-free frames.
- GPU: ≤ 9 chunk blits + one masked layer + sand layer (one shader rect + one mask) + trap sprites in view + today's glows.

## Risks

- Collapse numbers may feel toothless or unfair; tune only `delay/rate/cap` from the bot's sealed-in rate and playtests.
- Chunk raster time on device: if > 8 ms, drop `CHUNK` to 6 or try `Skia.Surface.MakeOffscreen` (GPU) after checking the installed RN Skia docs/types; RTree culling must be confirmed (time a chunk of floor 24 vs floor 3: should be similar).
- Portcullis supply depends on loops off the main path (floors 6–10 have 1–5 loops); counts are targets, shortfalls printed; relax spacing before invariants.
- Dynamic masks touch every core consumer (`step`, vision, walk, walker, bot, mask); the `Grid` refactor is pure and comes first with the committed replay hashes as the net.
- Trapdoor landing depends on the floor below's traps (resolved at fall time); the check resolves it the same way.
- Collapse on camp floors smothers the eternal camp brazier; intended, revisit after playtests.
- 25 thin courses in the side view may read poorly on small phones; tasks 13/15 redo it.
- Floor 10 changes for anyone who played the prototype (no longer the basement); the v3 migration keeps camp 10 valid.
