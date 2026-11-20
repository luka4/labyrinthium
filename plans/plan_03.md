# Plan 03 · Egypt complete: 25 floors, collapse, pressure-plate traps, trapdoors

Decisions and reasons: `plan_03_question.md` (Q-numbers below). Builds on plans 01 and 02 as implemented: tile grid with static `solid`/`opaque`, rooms, `spots`, `mainPath`, `dist`, three generator RNG streams + `profile.hooks`, `floorFor` chain with world-aligned arrival, `placeLights` (items + fixtures), hand + bag light model, `trail`/`seenAt` memory, `cooldown` move cadence, `holdDir`/`runDir`, event list, explorer bot, baked floor art, light mask, camera. Q0 (real art in phase 4) stands: all new art here is tidy vector art in `src/game/render`, themed through `themes.ts`, structured to be swapped in tasks 10–13.

## Goal

Egypt becomes the full 25-floor descent. Floors grow on a time-targeted curve (floor 1 ≈ 15 s, floor 10 ≈ 1.5 min, floor 24 ≈ 4 min) and get harder through rules: more loops, less light, then pressure plates that drop ceiling blocks, lower granite portcullises and release sand on tomb goods, trapdoors that drop you to the next floor early, and from floor 11 the collapse: after you set off, the floor above caves in and sand pours down the stairwell and spreads outward from your arrival, burying passages, items and lit fixtures. Camps are placed by play time, not every 5 floors. The plan 01 bake cap (2048 px) is solved with a chunked, lazily baked floor image.

## Scope

In:
- Egypt 25-floor tables (sites, loops, halls, galleries, light density, traps, collapse, camps, target times) in one file.
- `Pyramid.camps` list replacing `campEvery`; progress migration v3.
- Generator split: `layoutFor` (plan 01 steps 1–10) / `floorFor` (+ lights, traps, collapse order); layout warm-up.
- Core: dynamic `solid`/`opaque` per run, traps (plate kinds + trapdoor), collapse, wading, `falling` and `buried` statuses, events.
- Render: chunked floor art cache, view-window light mask, sand renderer, trap decor and state sprites, quake shake, fall animation, side view for 25 tiers.
- UI: buried panel, fall overview, first-encounter captions, dev floor jump.
- Checks: extend `scripts/check-floors.ts` (25 floors, trap fairness invariants, collapse invariants, rule tests, bot timing report).

Out: guardian, artifact escape, stars, records, secrets/treasure chambers, sound (tasks 04–05; hooks below only), tools (chalk/flare/hammer), real material/particle shaders (10–11).

Hooks left for 04–05 (not planned here): `GameState.collapse.speed` multiplier (escape speeds collapse up), `pressPlate(s, trap, by)` with `by: 'player' | 'other'`, `startFloor(..., { landing })`, events `quake | sandNear | plate | trapFired | hit | fell | sealed | buriedItem`, `s.skipped` (floors left through a trapdoor, for stars), `Status` extended by union.

## Design

### 1. Egypt curve (`src/game/core/egypt.ts`) (Q1–Q5, Q33, Q37)

One table, indexed by floor index 0..24; `architecture.ts` Egypt profile reads from it. Floors 1–10 values are exactly plan 01/02's (their layouts must not change; check asserts it).

| Floor | sites | ≈size | halls | gal | secPerTile | block | portc. | sandfall | trapdoor | collapse delay s / rate tiles/s / cap % | camp | target |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 3 | 16 | 0 | 0 | .30 | – | – | – | – | – | | 0:15 |
| 2 | 4 | 21 | 0 | 0 | .28 | – | – | – | – | – | | 0:25 |
| 3 | 5 | 26 | 1 | 0 | .26 | – | – | – | – | – | | 0:30 |
| 4 | 5 | 26 | 1 | 1 | .24 | 1 | – | – | – | – | | 0:35 |
| 5 | 6 | 31 | 1 | 1 | .22 | 1 | – | – | – | – | ● | 0:45 |
| 6 | 6 | 31 | 1 | 1 | .20 | 1 | 1 | – | – | – | | 0:55 |
| 7 | 7 | 36 | 2 | 1 | .18 | 2 | 1 | – | 1 | – | | 1:00 |
| 8 | 7 | 36 | 2 | 1 | .16 | 2 | 1 | 1 | 1 | – | | 1:10 |
| 9 | 8 | 41 | 2 | 1 | .15 | 2 | 1 | 1 | – | – | | 1:20 |
| 10 | 8 | 41 | 2 | 1 | .14 | 2 | 1 | 1 | 1 | – | ● | 1:30 |
| 11 | 9 | 46 | 2 | 1 | .135 | 2 | 1 | 1 | 1 | 45 / 0.8 / 20 | | 1:35 |
| 12 | 9 | 46 | 2 | 1 | .13 | 3 | 1 | 1 | 1 | 40 / 0.9 / 22 | | 1:40 |
| 13 | 9 | 46 | 3 | 2 | .13 | 3 | 2 | 1 | – | 36 / 1.0 / 25 | | 1:50 |
| 14 | 9 | 46 | 3 | 2 | .125 | 3 | 2 | 1 | 1 | 32 / 1.1 / 27 | ● | 1:55 |
| 15 | 10 | 51 | 3 | 2 | .125 | 3 | 2 | 2 | 1 | 30 / 1.2 / 30 | | 2:00 |
| 16 | 10 | 51 | 3 | 2 | .12 | 4 | 2 | 2 | – | 28 / 1.3 / 32 | | 2:10 |
| 17 | 10 | 51 | 3 | 2 | .12 | 4 | 2 | 2 | 1 | 26 / 1.4 / 34 | ● | 2:25 |
| 18 | 11 | 56 | 4 | 2 | .115 | 4 | 3 | 2 | 1 | 24 / 1.5 / 36 | | 2:35 |
| 19 | 11 | 56 | 4 | 2 | .115 | 4 | 3 | 2 | – | 22 / 1.6 / 38 | | 2:50 |
| 20 | 11 | 56 | 4 | 2 | .11 | 5 | 3 | 2 | 1 | 20 / 1.7 / 40 | ● | 3:00 |
| 21 | 12 | 61 | 4 | 3 | .11 | 5 | 3 | 3 | – | 18 / 1.8 / 42 | | 3:10 |
| 22 | 12 | 61 | 4 | 3 | .105 | 5 | 3 | 3 | 1 | 16 / 1.9 / 44 | ● | 3:25 |
| 23 | 12 | 61 | 5 | 3 | .105 | 5 | 4 | 3 | – | 15 / 2.0 / 46 | | 3:35 |
| 24 | 13 | 66 | 5 | 3 | .10 | 6 | 4 | 3 | – | 14 / 2.1 / 48 | ● | 3:50 |
| 25 basement | 12 | 61 | 3 | 1 | .11 | 4 | 3 | 2 | – | 14 / 2.0 / 40 | ● | 4:00 (+escape, 04) |

- `sites` appended to plan 01's `[3,4,5,5,6,6,7,7,8,8]`; `span` stays `[3,5]`.
- `halls(i) = i<2?0 : i<6?1 : i<12?2 : i<17?3 : i<22?4 : 5`, basement (i=24) 3; `galleries(i) = i<3?0 : i<12?1 : i<20?2 : 3`, basement 1 (both identical to plan 01 for i ≤ 9).
- Loops: plan 01's ramp unchanged for i ≤ 9 (reaches 0.12 at i=9); for i > 9: `0.12 + 0.06 × min(1, (i-9)/14)` (0.18 at i=23; basement 0.15).
- `secPerTile` rows 1–10 = plan 02; deeper rows here. Sconces: `min(i < 10 ? 8 : 12, floor(openTiles/90))` (floors 1–10 unchanged).
- Trap counts are targets; placement may fall short when no legal tile exists (reported, see Verification). Trapdoors only on floors whose next floor is neither a camp nor the basement (Q26), which the table already respects.
- Camps (1-based): **5, 10, 14, 17, 20, 22, 24, 25**: each stretch ≈ 6–8 min of target play (Q4). Collapse also runs on camp floors (Q15).
- Introduction order: ceiling block 4, portcullis 6, trapdoor 7, sand release 8, collapse 11 (slow), "in full" by 15.
- Target time = a competent first-time player; the explorer bot is the tuning instrument (Verification). Only rows 11–25 and trap/collapse numbers may be tuned; rows 1–10 of `sites/halls/galleries/loops/secPerTile` are frozen.

### 2. Camps model (`game.ts`, `pyramids.ts`, `progress.ts`) (Q5, Q36)

- `Pyramid.campEvery` → `Pyramid.camps: readonly number[]` (0-based floor indices, ascending). Egypt `[4,9,13,16,19,21,23,24]`; Maya/Cambodia/China/Black (5 floors) `[4]`.
- `isCampFloor(p,i) = p.camps.includes(i)`; `lastCamp(p,i)` = largest camp ≤ i, else 0; `campFloorNumbers(p) = p.camps.map(i => i+1)`. Pyramid detail screen prints them joined with ", " and " & " for the last.
- Egypt `floorCount: 25`.
- Progress `version: 3`, `migrate`: for each `camp[id]` not in `PYRAMIDS[id].camps` (and not 0) → `lastCamp`; clamp `deepest` to `floorCount-1`. Add `hints: Partial<Record<HintId, true>>` (default `{}`; `HintId = 'plate' | 'block' | 'portcullis' | 'sandfall' | 'trapdoor' | 'collapse'`) and action `markHint(id)`.

### 3. Generator split and chain cost (`floor.ts`, `generate.ts`) (Q9)

- `layoutFor(p, i): Layout` = plan 01 steps 1–10 (tiles, masks, rooms, start, stairs, dist, mainPath, spots), memoised by `p.id+i`; needs `layoutFor(p, i-1).stairs` only.
- `floorFor(p, i): Floor` = `layoutFor(p,i)` + step 11 `placeLights` (plan 02) + step 12 hooks. Egypt hooks in order: `placeTraps` (needs `layoutFor(p, i+1)` for trapdoor landings), `buildSandOrder`. Each hook keeps its own rng `seed ^ (hookIndex+1)*0x27d4eb2d` (plan 01). `GenContext` gains `below: Layout | null`, `table: EgyptRow` (generic profile: no traps, no collapse).
- Resuming at camp 24 generates 25 layouts but features for one floor. `warmLayouts(p, upTo)` generates one layout per `setTimeout(0)` slice; called by `pyramid/[id].tsx` on mount for `upTo = camp + 1`, so the play screen usually finds the memo full.

### 4. Data model additions (`floor.ts`)

```ts
export type TrapKind = 'block' | 'portcullis' | 'sandfall' | 'trapdoor';
export type Trap = {
  kind: TrapKind;
  tile: number;          // the plate / the trapdoor slab
  target: number;        // block: = tile; portcullis: the DOOR tile; sandfall: the guarded item tile; trapdoor: -1
  delay: number;         // seconds from press to effect (block 0.5, portcullis 0.35, sandfall 0.6, trapdoor 0.2)
  landingWorld: { x: number; y: number } | null;   // trapdoor only: world coords (plan 01 shared centre)
};
Floor.traps: Trap[];
Floor.trapAt: Int16Array;     // per tile: trap index or -1 (plates and trapdoors)
Floor.collapse: {
  delay: number; rate: number; cap: number;  // cap = max tiles covered (integer)
  order: Int32Array;          // open-for-sand tiles in BFS order from the STAIRS_UP tiles
  rank: Int32Array;           // per tile: position in order, or -1 (never reached / beyond cap)
  sdist: Int32Array;          // per tile: BFS steps from the source
} | null;
```

Tiles stay as plan 01/02 define them: plates and trapdoors are FLOOR tiles marked in `trapAt` (they are walkable and transparent); their look is drawn from `traps`.

### 5. Trap placement (`src/game/core/traps.ts`, `placeTraps`) (Q19–Q26)

Inputs: floor after `placeLights`, row counts, `below` layout. Work on a copy `removed` of the static `solid` mask; item and fixture tiles are never trap tiles.

Global invariants (the fairness contract):
- **I1 avoidable**: with every trap tile treated as solid, every other open tile is reachable from `start` (so the stairs, every item and every fixture are reachable without stepping on a trap).
- **I2 worst case**: with every trap tile solid **and** every effect applied (block tiles solid, portcullis doors solid), I1 still holds.
- **I3** no trap tile on `mainPath`, in the arrival or stairs room, within BFS 6 of `start`, on or orthogonally next to a DOOR (except a portcullis plate), an item, a fixture, STAIRS_*; Manhattan spacing ≥ 4 between trap tiles.

Method: compute articulation points (iterative Tarjan, `graph.ts`) of the open-tile graph with current removals; a tile is removable iff not an articulation point. After each accepted trap, apply its removals and recompute (≤ 15 recomputes per floor). Per kind, candidates shuffled with the hook rng:
- **block** (ceiling block): tiles inside `hall`, `chamber`, `antechamber`, `shrine` rooms (interior ≥ 3 wide) that are not articulation points. Effect removal: the tile itself.
- **portcullis**: DOOR tiles of `antechamber`, `chamber`, `hall`, `gallery` rooms where the door is not an articulation point; plate = the passage-side tile directly in front of the door (must be a non-articulation point after the door is removed). Removals: door + plate. Prefer antechamber doors (Khufu-style) by trying them first.
- **sandfall** (sand release guarding tomb goods): an item tile in a `chamber`/`shrine`/`hall` (not a passage); plate = a non-articulation tile of the same room at BFS distance 1–3 from the item, so the item is reachable without the plate (I1). Effect area: tiles of that room within room-BFS 4 of the plate (never leaves the room).
- **trapdoor**: off-main-path tiles in passages or rooms, not articulation points, `dist[tile] ≥ 0.3 × dist[stairs]`. Landing check against `below`: project the tile's world coords into `below`; nearest open tile (BFS over all tiles, ties lowest index) must be outside `below`'s arrival and stairs rooms, with `bfs(landing → below.stairs) ≥ 0.4 × below.dist[below.stairs]` (no trivial landing) and `rank_below(landing) = -1` or `> cap + 4 × SLOPE` (outside the collapse region, computed from `below` with this row's collapse spec). Store `landingWorld`.

### 6. Collapse order (`src/game/core/collapse.ts`, `buildSandOrder`) (Q10–Q12)

- Sand graph: tiles that are not opaque (sand flows over benches, around the sarcophagus and braziers), minus STAIRS_DOWN. Sources: the STAIRS_UP tiles (the stairwell you came down).
- BFS from the sources in `DIRS` order → `order`, `sdist`; `rank[order[k]] = k` for `k < cap + lag` where `cap = round(openTiles × cap%)`, `lag` = tiles within `SLOPE` of the cap front; others −1.
- Invariants (asserted): `rank[stairs] = -1`; the stairs' component after removing all ranked tiles holds ≥ 40 % of open tiles; no trapdoor landing in the ranked set (see 5).

### 7. Runtime state (`game.ts`)

```ts
grid: { size: number; solid: Uint8Array; opaque: Uint8Array };  // per-run copies of the floor masks; all core
                         // movement, light, visibility and walk helpers use this, never floor.solid/opaque
trapPhase: Uint8Array;   // per trap: 0 armed, 1 pressed (timer running), 2 fired, 3 jammed (sand)
trapTimer: Float32Array;
collapse: { started: boolean; t: number; fill: number; covered: number; blocked: number;
            speed: number /* 1; task 04 */; rank: Int32Array /* run copy */; pending: number /* tile or -1 */ } | null;
seenSand: Uint8Array;    // per tile: sand level 0..255 when last lit (memory shows what you saw)
localSand: Uint8Array;   // per tile: sandfall level 0..255 (wading only, never blocks)
landing: number;         // tile you fell onto this floor, -1
skipped: number;         // floors left through a trapdoor this run (hook for stars)
// Status: 'playing' | 'descending' | 'falling' | 'burntOut' | 'buried' | 'escaped'
```

`startFloor(p, i, hand, bag, steps, opts?: { landing?: { x, y } })`: with `landing`, `pos` = landing tile resolved on this floor (nearest open tile to the projected world point that is not a trap tile, not orthogonally next to one, not in the stairs room; ties lowest index), `cooldown = 1.0` (you land hard), `landing = pos`. `vision.ts`/`walk.ts` signatures take `Grid` instead of `Floor` (plan 02's `computeLight(floor, …)` becomes `computeLight(grid, …)`).

### 8. Rules (`step`) (Q12–Q14, Q18, Q20, Q29, Q35)

Constants (`collapse.ts`/`traps.ts`): `SLOPE = 3` tiles, `COVER = 0.2`, `WADE = 1.8` (move cost multiplier), `BURY_ITEM = 0.35`, `STUN_HIT = 0.8 s`, `LAND_STUN = 1.0 s`, `SAND_NEAR = 3` tiles.

**move(dir)** (after plan 02's acceptance test, now on `grid.solid`):
- Cost: `STEP × (level(target) ≥ COVER ? WADE : 1)` where `level = max(collapse level, localSand)`.
- If leaving `collapse.pending`, apply it (tile becomes solid + opaque, `opaqueDirty`).
- Plan 02 pickup/fixtures/stairs as before; then **trap enter**: `t = trapAt[pos]`, armed → `pressPlate(s, t, 'player')`: phase 1, timer = delay, event `plate` (trapdoor: event `fell` after its 0.2 s tilt, see tick). Pressed plates stay down (one-shot).

**tick(dt)** order: cooldown → plan 02 burn → traps → collapse → cut-off → relight.
- **Traps** (index order), phase 1: `timer -= dt`; at ≤ 0 → phase 2, event `trapFired`:
  - block: target tile solid + opaque. If `pos === tile`: event `hit`, `loseHand(s)` (plan 02's burnt-out path: drop hand, light the longest spare, else embers), `cooldown = max(cooldown, STUN_HIT)`, push to the tile you came from (store `prevPos` on move), or the first open neighbour in `DIRS` order.
  - portcullis: door tile solid + opaque. If `pos === door`: push to the door's far side (opposite the plate), `hit` as block.
  - sandfall: `localSand` ramps to 0.7 over 3 s on its area (in BFS order from the plate); items there with level ≥ `BURY_ITEM` are removed (event `buriedItem`); unlit shrine candles/braziers there are smothered (`fixtureLeft = 0`).
  - trapdoor: `status = 'falling'`, `skipped++`.
  - After any solid change: `rebuildRank(s)` if collapse active (multi-source BFS from covered tiles over current non-solid sand graph; uncovered tiles get ranks `covered + k`; cap unchanged), `opaqueDirty = true`.
- **Collapse** (floors with `floor.collapse`): `t += dt` only while `burning` (starts with the first move). At `t ≥ delay`: `started = true`, event `quake` (once). While started and `fill < cap + lag`: `fill += rate × speed × dt`. Let `D = sdist[order[floor(fill)-1]]` (front distance). Covered prefix = ranks `< fill`; blocked prefix = ranks with `sdist ≤ D - SLOPE`. Level of a covered tile = `clamp((D - sdist)/SLOPE, 0.15, 1)`. Advance `covered`/`blocked` pointers; for each newly blocked tile: `solid = opaque = 1` (unless it is `pos`: then `pending = pos`), item buried, fixture there smothered (sconces on its wall face too); newly covered tiles bury items when level ≥ `BURY_ITEM`. Covered tiles over trap plates jam them (phase 3, never fire). Event `sandNear` when a newly covered tile is within Chebyshev `SAND_NEAR` of `pos` (≤ once per 5 s).
- **Cut-off**: if any tile turned solid this tick, BFS from `pos` over `!grid.solid` (pos open): if neither `stairs` nor any armed trapdoor is reachable → `status = 'buried'`, event `sealed`.
- **Relight** (plan 02 conditions) plus when `opaqueDirty`: hand relight if a changed tile is within `ceil(r)+1`, `fixedDirty = true`, visibility recomputed. Lit tiles write `seenSand[i] = level(i)×255`.

**continue**: from `descending` as plan 02; from `falling`: `startFloor(p, i+1, hand, bag, steps, { landing: trap.landingWorld })`; a fall never lands on a camp floor (placement rule), so no camp refill.
**retry**: from `burntOut` or `buried` → last camp, as plan 02.

Walk helpers (Q28): `runDir` also stops when the next tile is a trap tile or covered sand; `holdDir` never auto-turns a bend onto a trap tile (straight holding onto one is the player's choice).

### 9. Rendering (Q6–Q8, Q16, Q17, Q21, Q32)

**Chunked floor art** (`src/game/render/floorArt.ts`, replaces plan 01's single `bakeFloor`):
- `createFloorArt(floor, theme, tilePx, scale): FloorArt`; `px = round(tilePx × min(PixelRatio.get(), 2))` (no lowered scale, any floor size). Chunks of `CHUNK = 8 × 8` tiles, image `8·px + 2·PAD` square, `PAD = 2 px` of real neighbouring content (so linear filtering at fractional camera positions shows no seams). CPU raster surface per chunk, `makeImageSnapshot()`.
- The bake code draws in floor coordinates; each chunk translates/clips and only visits geometry overlapping the chunk + 1 tile (wall runs indexed by row/column at floor creation, rooms by rect). Decor uses tile hashes only, so chunks are order-independent.
- `art.ensure(viewRect, moveDir, budgetMs)`: bakes missing visible chunks first (must draw), then prefetches the next chunk row/column in the camera's motion direction while the frame budget lasts (default 6 ms, measured with `performance.now()`); during the overview phase the rAF loop calls it with 10 ms so the start area (5×5 chunks) is ready on arrival. LRU of 20 chunks (≈ 11.8 MB at 48 px/tile), evicted images `dispose()`d; whole cache disposed on floor/tilePx change.
- `drawGame` draws visible chunks (≤ 3×3) with `drawImageRect(img, srcInsetByPad, dst)`, Linear filter, inside the existing masked layer.
- Static trap telltales are baked into chunks (they are part of the floor): **plate** = darker granite slab inset 0.12 tile among limestone paving, hairline shadow gap, bevel highlight; **block** adds 5–7 stone chips around the plate; **portcullis** = deep jamb grooves plus the granite slab's lower edge and lifting boss showing in the lintel slot (plan 01's plain antechamber grooves stay empty, so "slab hanging above the door" always means armed); **sandfall** = a small cone of fine sand on the plate; **trapdoor** = limestone slab with a dark seam on three sides and two pivot pins on the fourth.

**Light mask** (`lightMask.ts`): built over the view window (view + 2 tiles margin, ≤ 19×19 tiles, 2 px/tile) positioned under the camera, never the whole floor (floor 24 is 66 tiles). Opaque test reads `grid.opaque` (dynamic).

**Per-frame trap sprites** (`src/game/render/drawTraps.ts`, inside the masked layer, ≤ 12): pressed plate sunk (wider gap, darker); fallen block as a 3/4 granite block (top + south face, contact shadow, chips) — its tile is opaque, so the mask lights its faces from your side like a wall; sealed portcullis slab filling the doorway with the boss; sandfall trickle (animated thin stream while armed and lit, pouring column for 3 s when fired); trapdoor seam dust drift (2–3 moving grains) while armed; on `falling`, the slab tilts open and the player sprite shrinks and darkens into the pit over 0.25 s before the overview.

**Sand** (`src/game/render/drawSand.ts`, Q32): a 128² sand pattern image (ripples, grain speckle, warm `#c9a46a`/`#a88450`, theme-driven) made once per `px`; per frame a level image over the view window (2 px/tile, alpha = level; lit tiles use the live level, remembered tiles `seenSand`, unseen 0) drawn as a layer: rect with the pattern `ImageShader`, then the level image with `DstIn`, Linear. Blocked tiles get a darker south face (wall-like, 0.55 tile) and a crest highlight, drawn from the same level image via a second offset pass. Pour column at the stairwell while `started`: vertical gradient stream with scrolling bands + a dust haze radial gradient (tan, alpha 0.25, slowly pulsing) that dims the stairwell area (render only). Sand is inside the masked layer, so it is seen only in light or as memory.

**Quake**: camera shake 0.6 s, amplitude 0.15 tile, decaying hashed noise (off with reduced motion); dust motes burst around the stairwell; haptic `heavy`.

**Side view** (`drawPyramidSide.ts`, `sideLayout`): for N > 10, `ground` moves to 0.72 height and tiers are drawn as fine courses (min 6 px; joints every other course), camp flames on the 8 camp tiers; overview kind `'fall'`: the marker drops through one tier with a dust puff and shake; title "The floor gave way", line as for descend.

### 10. UI (`GameScreen.tsx`, `FloorOverview.tsx`, `settings.tsx`) (Q30)

- `falling` → like `descending` (dispatch `continue`, `reachFloor`) with overview kind `'fall'`, haptic `heavy`.
- `buried` → haptic `warning`, panel: eyebrow floor, title "Sealed in by sand", text "The sand has closed every way down. You dig back to {camp}.", buttons as burnt-out.
- Events → plan 02 captions + haptics: `plate` "Click." + `tap`; `trapFired` `bump`; `hit` "The block knocks the torch from your hand" + `warning`; `quake` `heavy`; `sandNear` `bump`; `buriedItem` nothing; `sealed` handled by panel.
- First-encounter hints (once per save, `progress.hints`): when a trap tile of a new kind is first lit ≥ 0.3, or at the first quake, show a 3 s caption: plate "A granite slab set in the limestone. A pressure plate."; block "Chips of fallen stone around it."; portcullis "A slab hangs in the grooves above the door."; sandfall "Sand trickles from the ceiling here."; trapdoor "A slab on pivots. It would drop you to the floor below."; collapse "The ceiling over the stairs gives way. Get away from the sand."
- Dev section: "Egypt: jump to floor" stepper 1–25 (`reachCamp('egypt', n-1)`, dev only) replacing plan 01's camp 5/10 buttons.

## Files

Add:
- `src/game/core/egypt.ts` — the 25-row table, camp list, `EgyptRow` type.
- `src/game/core/graph.ts` — `bfs(grid, from, out)`, iterative `articulationPoints(open, size, out)`, `nearestOpen`.
- `src/game/core/traps.ts` — kinds, constants, `placeTraps` hook, `pressPlate`, `tickTraps`.
- `src/game/core/collapse.ts` — constants, `buildSandOrder` hook, `tickCollapse`, `rebuildRank`, `sandLevel(s, i)`.
- `src/game/render/drawTraps.ts`, `src/game/render/drawSand.ts`.

Change:
- `src/game/core/floor.ts` — `Trap`, `traps`, `trapAt`, `collapse`; `layoutFor`/`floorFor` split; `warmLayouts`.
- `src/game/core/architecture.ts` — Egypt profile reads `egypt.ts` (sites, halls, galleries, loops deep ramp, lights, sconce cap), hooks `[placeTraps, buildSandOrder]`; `GenContext.below/table`.
- `src/game/core/generate.ts` — step order, hooks get `below`.
- `src/game/core/game.ts` — `camps`, statuses, `grid`, trap/collapse state, rules, `startFloor` opts, `loseHand` shared with burn-out.
- `src/game/core/vision.ts`, `src/game/core/walk.ts` — `Grid` parameter; trap/sand stops.
- `src/game/core/pyramids.ts` — Egypt `floorCount 25`, `camps`; others `camps [4]`; `campFloorNumbers`.
- `src/game/render/floorArt.ts` (chunk cache + baked telltales), `lightMask.ts` (view window, dynamic opaque), `drawGame.ts` (chunks, sand, traps, shake), `drawPyramidSide.ts` (25 tiers, fall), `themes.ts` (sand, granite plate, trap colours).
- `src/screens/GameScreen.tsx`, `src/screens/play/FloorOverview.tsx` (`'fall'`), `src/app/pyramid/[id].tsx` (warm layouts, camp list text), `src/app/settings.tsx` (dev jump).
- `src/state/progress.ts` — v3 migration, `hints`, `markHint`.
- `scripts/check-floors.ts`, `scripts/floors.snapshot.json`.
- `CLAUDE.md` — Journey (Egypt 25 floors, camps list, collapse from 11, traps, trapdoors), Layout (new files), Rules ("core uses `s.grid`, never the floor's static masks, during a run"; "floor art is chunk-baked").

## Implementation order

1. `egypt.ts`, `camps` model, `pyramids.ts`, progress v3; fix callers; `npx tsc --noEmit`.
2. `layoutFor`/`floorFor` split; extend `sites`/halls/galleries/loops; check script: floors 1–10 layout hashes unchanged, all 25 floors generate and pass plan 01/02 asserts.
3. `graph.ts`, `placeTraps`, `buildSandOrder`; check asserts I1–I3, counts, landings, collapse invariants; ASCII dump legend `b` block plate, `p` portcullis plate, `=` armed door, `s` sandfall plate, `v` trapdoor, `--sand` flag prints sand rank deciles 0–9 instead. Iterate on seeds.
4. `grid` refactor in `game.ts`/`vision.ts`/`walk.ts` (pure refactor, replay hashes from plan 02 must still match on floors 1–10 before traps act).
5. Trap and collapse rules, statuses, `startFloor` landing; rule tests in the check script.
6. Chunked `floorArt.ts` + view-window `lightMask.ts` first (verify on web and on an Android dev build that chunk seams are invisible), then `drawSand.ts`, `drawTraps.ts`, shake, side view.
7. `GameScreen` statuses, panels, captions/hints, dev jump, warm-up.
8. Bot report → tune rows 11–25; `--update` snapshot; CLAUDE.md; verification.

## Verification

- `npx tsc --noEmit`, `npx expo-doctor`, `npx expo export --platform android --output-dir <scratchpad>`.
- `npm run check:floors` adds, for Egypt floors 1–25 (fixed seed) and pyramid seeds 1..300 on floors 1–10, 1..100 on floors 11–25:
  - determinism (two runs equal) and snapshot (hash now includes traps and collapse order); a separate **layout hash** of floors 1–10 equals plan 02's committed values (the extension did not change them);
  - camps: `isCampFloor(egypt, i)` true exactly for `[4,9,13,16,19,21,23,24]`; `lastCamp(egypt, 12) = 9`, `(13) = 13`, `(24) = 24`; trapdoors only on floors whose next floor is not a camp/basement;
  - traps: I1, I2, I3; counts ≥ table target on the fixed seed, and ≥ 50 % of target on every fuzz seed for targets ≥ 2 (else fail), shortfalls printed; portcullis doors not articulation points; sandfall item reachable avoiding the plate; trapdoor landing rules (resolved with `startFloor`'s rule on the full floor below: not a trap/neighbour, outside arrival/stairs rooms, ≥ 0.4 × stairs distance, outside the collapse region);
  - collapse: `rank[stairs] = -1`; stairs component after the full ranked region ≥ 40 % of open tiles; order is a BFS order (sdist non-decreasing);
  - rules (scripted states): block — stop on the plate 0.5 s → `hit`, hand lost (spare lit / embers), pushed back, tile solid; walking on → no hit, tile solid behind; portcullis — pass through at walking cadence → sealed behind; stop on the door → pushed to the far side + hit; step back → sealed in front; sandfall buries the guarded item within 3 s; trapdoor → `falling`, `continue` lands on the resolved landing with `cooldown = 1.0`; collapse — no sand before the first move + delay; covered/blocked prefixes monotonic; player tile pending until left; wading cost 1.8×; items/fixtures buried; plate jammed by sand; cut-off → `buried`; `rebuildRank` after a portcullis keeps sand from passing the sealed door; 3000-action replay twice on floors 11, 17, 24 gives equal hashes (pos, hand, bag, items, fixtureLeft, trapPhase, collapse, grid, status).
  - **bot report** (plan 02 explorer bot, now avoiding seen trap tiles, avoiding covered sand when another frontier exists, camp refills, 20 bot seeds of tie-breaking): per floor median time, light found/used, burn-outs, sealed-in rate, trap hits. Targets: median time within [0.6, 1.6] × target time; floors 11–24 sealed-in rate 3–20 %; floors 1–10 unchanged from plan 02's report ± 5 %.
  - timing: layout < 6 ms, full floor < 12 ms per floor on desktop for floor 24 (warn above); layout chain 1→25 < 80 ms desktop.
- Web preview: dev-jump to floors 4, 6, 8, 11, 15, 24: telltales readable in torchlight; plate click and timing; fallen block lit like a wall; portcullis seal both ways; sandfall buries the jar; trapdoor fall animation → fall overview → land away from the stairwell with a stun; at floor 11 the quake after the first move + 45 s, sand column, sand spreading and burying, sand lit only by light, remembered sand as seen, wading slower, sealed-in panel when cut off; floor 24 art with no seams while the camera moves; side view with 25 courses and 8 camp flames; old save loads (migration).
- Device (release `preview` APK, Redmi 9): floor 24 with the collapse running and 8 fixtures lit: 60 fps while walking, no chunk-bake hitch > 1 dropped frame per 8 tiles walked; resume at camp 24 reaches the overview in < 400 ms.

## Performance budget (Redmi 9: Helio G80, Mali-G52, Hermes)

- Generation: layout ≤ 25 ms, features ≤ 60 ms for floor 24 on device; resume chain ≤ 400 ms, normally pre-warmed on the pyramid screen.
- Core tick: traps O(traps); collapse O(newly covered + active band ≤ 120 tiles); cut-off BFS ≤ 0.6 ms (4356 tiles) only on solid changes (≤ 3/s); relight per plan 02 + on opaque changes in reach.
- Memory: per-tile arrays ~12 × 4356 × ≤ 4 B ≈ 120 KB; chunk cache ≤ 20 × 590 KB ≈ 12 MB (was up to 16 MB for one floor-10 image); sand pattern 64 KB.
- JS per frame: chunk bake ≤ 6 ms only on frames that need one (≈ 1 per 8 tiles walked); mask + sand level images over the view window ≤ 1.5 ms; picture record ≤ 2.5 ms; total ≤ 6 ms on bake-free frames.
- GPU: ≤ 9 chunk blits + one masked layer + sand layer (1 shader rect + 1 mask) + ≤ 12 trap sprites + plan 02's gradients.

## Risks

- Collapse numbers may feel either toothless or unfair; the volume model (tiles/s, so it races down corridors and crawls across halls) is right physically, tune only `delay/rate/cap` from the bot's sealed-in rate and playtests.
- Chunk bake hitches on device: if a chunk bake exceeds 8 ms, drop `CHUNK` to 6 tiles or move baking to a Skia offscreen on the UI thread (worklet) after reading the current Skia docs; seams: PAD content must be drawn, not clamped.
- Articulation-based placement may starve small floors of traps; counts are targets, check prints shortfalls; relax spacing before relaxing invariants.
- Dynamic masks touch every core consumer (`step`, vision, walk, fixtures visibility, bot); the pure `grid` refactor comes first with plan 02 replay hashes as the safety net.
- Trapdoor landing depends on the floor below's traps (resolved at fall time); the check script resolves it the same way, so a rule change shows up there.
- Collapse on camp floors smothers the eternal camp brazier once the sand reaches the landing; intended (pushes you on), revisit if playtests dislike it.
- 25 thin courses in the side view may read poorly on small phones; tasks 13/15 redo the side view; min tier height guards legibility meanwhile.
