# Plan 02 · Light sources, fading memory, swipe + hold-to-walk (Egypt floors 1–10)

Decisions and reasons: `plan_02_question.md` (Q-numbers below). Builds on plan 01 as implemented (tile grid with `solid`/`opaque`, rooms, typed `spots`, `mainPath`, `dist`, items rng stream, baked floor art, per-frame light mask, camera). Where plan 01 names something (`floor.oil`, step 11 "Spots → oil", `lightMask.ts`), this plan replaces or extends it explicitly.

## Goal

The torch is no longer one fuel bar. You carry one burning light in your hand and up to three spare lights in a bag; along the paths you find small torches, torches, pitch-soaked big torches, clay oil lamps, candles and oil jars, and you light wall sconces, braziers and shrine candles with your flame. Each source has its own burn time, radius curve, colour and flicker. What you saw fades: only what you saw from your last 20 steps stays dimly on screen, older places fall back into black. Movement is swipe-per-tile plus hold-to-keep-walking that follows corridor bends, a flick to run to the next junction, and keyboard on web; it feels immediate on a Redmi 9. A professional light HUD shows the current source, time left and the bag.

## Scope

In:
- Core: light-source table, hand + bag model, pickup/refill/auto-relight/swap rules, fixtures (sconce, brazier, shrine candles) lit by the player, fixed-light visibility, move cadence in core, trail-based memory stamps, auto-walk helpers.
- Generator: `placeLights` replaces plan 01 step 11 (oil only); per-floor density table; new `TILE.BRAZIER`; `floor.items`, `floor.fixtures` replace `floor.oil`.
- Render: per-source colour/flicker, fixed-light glows, smooth player motion, mask crossfade between steps, memory fade, item and fixture sprites, light HUD strip in the same canvas.
- Input: responder-based swipe/hold/flick on the whole play area, D-pad hold, web keyboard; `autoRun` setting.
- Checks: extend `scripts/check-floors.ts` (placement, determinism replay, rules, memory, auto-walk, light-budget bot).

Out: shader light, particles, real sprite art (tasks 10–12; sprites here are tidy vector art via `art.ts`, structured to be swapped), sound (05), guardian interplay with lit sconces (04), traps (03), UI layout rework (14), artifact powers (06).

## Design

### Core data model

`src/game/core/lights.ts` (gameplay numbers only, no colours):

```ts
export type CarryKind = 'smallTorch' | 'torch' | 'bigTorch' | 'lamp' | 'candle';
export type FixtureKind = 'sconce' | 'brazier' | 'shrineCandles';
export type ItemKind = CarryKind | 'oilJar';
export type LightSpec = {
  seconds: number;      // full burn time
  rMax: number; rMin: number;  // radius in tiles at full and at the last moment
  knee: number;         // fraction of burn left below which the radius shrinks to rMin (1 = linear from full)
  falloff: number;      // exponent of the light curve 1 - (d/(r+0.5))^falloff
};
export const CARRY: Record<CarryKind, LightSpec>;
export const FIXTURE: Record<FixtureKind, LightSpec>;
export const EMBER: { seconds: 6; radius: 0.9 };
export const BAG_SIZE = 3;
export const OIL_MIN_GAIN = 5;        // seconds; a jar is left on the floor if it would add less
export const STEP_SECONDS = 0.15;     // walk cadence, enforced in core
export type Carried = { kind: CarryKind; left: number };   // seconds left
export function radiusOf(spec: LightSpec, left: number): number; // rMin + (rMax-rMin)*min(1, (left/seconds)/knee)
export function radiusQ(r: number): number;                    // Math.round(r*8)/8, relight only when it changes
```

`floor.ts` additions (replacing `oil: number[]`):

```ts
TILE.BRAZIER = 9            // solid, not opaque
export type Item = { tile: number; kind: ItemKind; spot: SpotKind | 'wayside' };
export type Fixture = { tile: number; kind: FixtureKind; wall: Direction | null; eternal: boolean };
// sconce: `tile` is the open tile in front of a north wall face (wall = 3, up); brazier: its own BRAZIER tile;
// shrineCandles: the shrine NICHE tile. eternal = pre-lit, never burns down (camp landing, burial chamber).
Floor.items: Item[]; Floor.fixtures: Fixture[];
```

`GameState` (`game.ts`) loses `fuel`, `oil`, `seen`, `walked`; gains:

```ts
hand: Carried;                 // left <= 0 = embers: you still hold the burnt-out source
bag: Carried[];                // ≤ BAG_SIZE, in pickup order
ember: number;                 // seconds on embers
items: Map<number, Carried | { kind: 'oilJar' }>;   // tile → what still lies there
fixtureLeft: Float32Array;     // per fixture: -1 unlit, >0 seconds left, 0 burnt out, Infinity eternal
cooldown: number;              // seconds until the next move is allowed (≥ -STEP_SECONDS)
trail: number;                 // successful moves on this floor (memory clock)
seenAt: Int32Array;            // per tile: trail value when last lit (-1 never)
walkedAt: Int32Array;          // per tile: trail value when last stood on (-1 never)
lightHand: Float32Array;       // 0..1 from the hand source (or embers)
lightFixed: Float32Array;      // 0..1 union of lit fixtures (no LOS to the player applied)
light: Float32Array;           // what the player sees now: max(lightHand, lightFixed where visible)
events: GameEvent[];  eventSeq: number;  // last 8 events for UI feedback (pickup, refill, lit, bagFull, autoLight, swap, lowLight)
handR: number; fixedDirty: boolean;      // cached quantized radius, recompute flag
```

`Action` adds `{ type: 'swap'; slot: number }`. `startFloor(pyramid, i, hand, bag, steps)` replaces the `fuel` parameter; `continue` carries hand and bag (camp floor: hand = full copy of the better of `hand.kind` and `torch` by `seconds`); `retry` and resume-from-camp start with a full `torch`, empty bag. No save-format change (only the camp index is persisted).

### Rules (`step`)

- **tick(dt)**: `cooldown = max(-STEP, cooldown - dt)` always while `playing` (also before the first move). If `burning`: `hand.left -= dt`; when it reaches ≤ 0 → the burnt-out source is dropped and the bag entry with the most `left` (ties: lowest index) is lit (emit `autoLight`), else `hand.left = 0` (embers); while `hand.left <= 0`: `ember += dt`, `ember > EMBER.seconds` → `burntOut`. Lit, non-eternal fixtures burn `dt` (set `fixedDirty` when one's `radiusQ` changes or it goes out). Emit `lowLight` once per source when `left` crosses 10 s and the bag is empty. Relight only if `radiusQ` of hand changed or `fixedDirty` (never per frame by default).
- **move(dir)**: rejected if `cooldown > 0`, out of bounds or `solid`. Else `cooldown = (cooldown > -STEP ? cooldown : 0) + STEP` (continuous walking keeps an exact 0.15 s average cadence on any frame rate). `pos`, `steps++`, `burning = true`, `trail++`, `walkedAt[pos] = trail`. Then in order:
  1. **Pickup** at `pos`: oil jar → if `hand.left <= spec.seconds - OIL_MIN_GAIN` refill hand to full and reset `ember = 0` (this is also the embers rescue: you re-soak and relight the dying source); else if a bag entry lacks ≥ `OIL_MIN_GAIN`, refill the one with the largest deficit; else it stays. Carried item → if on embers it is lit in hand (the dead one is dropped, `ember = 0`); else into the bag if `bag.length < BAG_SIZE`; else stays on the floor, emit `bagFull`. Emit `pickup`/`refill`.
  2. **Light fixtures**: every unlit fixture whose tile is within Chebyshev distance 1 of `pos` (for sconces: `pos === tile` or orthogonally adjacent) is lit if `hand.left > 0`: `fixtureLeft = spec.seconds`, `fixedDirty = true`, emit `lit`.
  3. Stairs/artifact status as before; relight.
- **swap(slot)**: `hand` and `bag[slot]` exchange (a doused source keeps its seconds; on embers the dead source is dropped, the bag entry is lit and removed from the bag, `ember = 0`). Free, any time while `playing`.
- **relight**: `computeLight(floor, pos, r, falloff, lightHand)` with `r = hand.left > 0 ? radiusOf(hand) : EMBER.radius`; if `fixedDirty`: `lightFixed` = max over burning fixtures of `computeLight(floor, tile, r_f, falloff_f)`. `light[i] = max(lightHand[i], lightFixed[i] if visible(i))` where `visible(i)` = `lightFixed[i] > 0`, Chebyshev distance to `pos` ≤ 12 and `clearLine(pos, i)`; the visible set is recomputed only on move or `fixedDirty`. Every tile with `light[i] > 0` gets `seenAt[i] = trail`. The "lit" decision is the integer-safe test `d² ≤ (r+0.5)²` + `clearLine`; float brightness only feeds rendering, so Hermes/V8 `Math.pow` ulps cannot change state.
- Camps: camp landing has an eternal brazier; `continue` into a camp floor refills as above.

### Numbers (Q3–Q8, Q12)

| Source | Where | Carry | Seconds | rMax→rMin (tiles) | knee | falloff | Look (render) |
|---|---|---|---|---|---|---|---|
| Small torch (reed bundle, linen head) | wayside, store, dead end | yes | 40 | 4.2 → 1.6 | 1 | 1.6 | `#ff8a2a`, fast strong flicker |
| Torch (linen soaked in fat) — start & camp | store, dead end | yes | 60 | 5.0 → 1.8 | 1 | 1.6 | `#ff9a3a`, medium flicker |
| Big torch (pitch/bitumen bundle) | dead end, store, floor ≥ 5 | yes | 100 | 6.0 → 2.2 | 1 | 1.4 | `#ffa040`, slow heavy flicker, sooty edge |
| Oil lamp (clay saucer, linen wick, salted oil) | niche, shrine, floor ≥ 3 | yes | 150 | 3.4 → 2.2 | 0.2 | 2.0 | `#ffc070`, steady, slow sway |
| Candle (tallow, linen wick) | niche, wayside | yes | 90 | 2.4 → 1.8 | 0.1 | 2.2 | `#ffd08a`, small wavering |
| Oil jar (sealed amphora) | store, dead end, niche | refill | = hand full | — | — | — | — |
| Wall sconce (bronze bracket, unlit torch) | north wall faces of passages/halls, floor ≥ 2 | fixed | 180 | 4.5 → 2.0 | 0.1 | 1.6 | torch colour, medium flicker |
| Brazier (bronze bowl on tripod) | pillared halls floor ≥ 5; eternal at camp landing and ×2 in the burial chamber | fixed, solid | 300 / eternal | 5.5 → 2.5 | 0.1 | 1.5 | `#ff7a30`, glowing coals, slow |
| Shrine candles (cluster of 3 on the niche ledge) | shrine niches, floor ≥ 3 | fixed | 240 | 2.8 → 1.8 | 0.1 | 2.0 | `#ffc878`, gentle |
| Embers | when nothing burns | — | 6 | 0.9 | — | 1.6 | `#c0401a`, slow pulse |

Walk: 0.15 s/tile (6.7 tiles/s); hold repeat starts after the first step's cooldown (no extra delay beyond the swipe window, see Input). Memory: 20 steps.

### Placement (`src/game/core/placeLights.ts`, replaces plan 01 step 11; items rng `seed ^ 0x85ebca6b`) (Q9–Q11)

Inputs: floor after step 10 (tiles, solid, dist, rooms, spots, mainPath), `floorIndex`, `profile.lights` (new `ArchProfile` field, Egypt table below; generic uses Egypt's).

1. Candidates: plan 01 `spots` (niche, store, shrine, deadEnd; excluding arrival/stairs rooms and `main`) plus **wayside**: passage tiles with exactly two open orthogonal neighbours in a straight line, at least one opaque side (the sprite leans on it), not adjacent to a DOOR, `dist ≥ 8`. Wayside tiles on `mainPath` are allowed only for the floor's single **teaching item** (below).
2. Budget: `budget = round(openTiles × secPerTile[f])` seconds of found carried light; an oil jar counts 60. Pick from shuffled candidates, kind by weighted table per spot kind (gated by `minFloor`), Manhattan spacing ≥ 5 between items, until the budget is met; at least one oil jar (plan 01 invariant), at most `ceil(budget/60)+1` items.
3. Teaching item: floors 1–2 place one `smallTorch` (floor 1) / `candle` (floor 2) on a main-path wayside tile at 30–50 % of the main path (so the bag and HUD are learned without a detour).
4. Fixtures: sconces `= f < 2 ? 0 : min(8, floor(openTiles / 90))`; candidate tiles = open tiles whose north neighbour is ROCK, in passages with a straight run ≥ 6 (run middle), or first tile inside a hall/gallery/chamber door; spacing ≥ 7; never on `start` or `stairs`. Braziers: per pillared hall on floor ≥ 5, one on the hall axis at an even-offset tile with 4 open orthogonal neighbours (set `TILE.BRAZIER`, re-derive `solid`, BFS: revert if any open tile became unreachable); eternal braziers on camp floors (landing tile beside `start`, not on the walk line) and in the burial chamber flanking the sarcophagus. Shrine candles on every shrine NICHE from floor 3 (the shrine spot then gets no item).
5. Write `floor.items`, `floor.fixtures`; derive solid again if braziers were placed.

Egypt `lights` table (floor index 0..9):

| | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| secPerTile | 0.30 | 0.28 | 0.26 | 0.24 | 0.22 | 0.20 | 0.18 | 0.16 | 0.15 | 0.14 |

Kind weights per spot (`minFloor` 1-based in brackets): niche → candle 3, lamp [3] 2, oilJar 1; store → oilJar 3, torch [2] 2, smallTorch 2, bigTorch [5] 1; deadEnd → torch [2] 2, bigTorch [5] 2, oilJar 2, lamp [3] 1, smallTorch 1; shrine (floors 1–2 only) → lamp/candle 1; wayside → smallTorch 3, candle 2.

### Memory (`src/game/core/memory.ts`) (Q13–Q16)

- Memory unit = one successful move (`trail`). A tile is remembered while `age = trail - seenAt[i] ≤ MEMORY_STEPS = 20`; `walkedAt` gives the brighter "walked" level under the same age rule. Standing still does not fade memory; walking back over a tile refreshes it.
- `memoryLevel(age: number): number` (pure, used by render): `age ≤ 6 → 1`, `6 < age < 20 → smoothstep(20, 6, age)`, `≥ 20 → 0`. Brightness = `level × (walked ? 0.26 : 0.12)`.
- Lit fixtures are not memory: their light shows only while visible (LOS ≤ 12), so lit sconces work as landmarks you recognise again when you see them, without revealing the floor.

### Auto-walk helpers (`src/game/core/walk.ts`) (Q19, Q20)

- `holdDir(floor, pos, dir, prevDir)`: if `dir` is open → `dir`; else if `pos` is a corridor tile (exactly 2 open orthogonal neighbours) and the one non-back exit exists → that exit (follow the bend); else `null` (stop).
- `runDir(floor, s, pos, dir)`: like `holdDir`, but returns `null` when `pos` is a junction (≥ 3 open neighbours), a DOOR or room change, a dead end, the stairs, or orthogonally next to an item or unlit fixture. Pure, tested by the check script; the UI issues plain `move` actions, so replays stay a list of moves.

### Rendering (Q21–Q26)

- `src/game/render/lightStyle.ts`: per kind `{ color, tintAlpha, flickerAmp, flickerHz: [a,b,c], sway }`; `flicker(kind, timeS, phase)` = `1 + amp·(0.6 sin(2π a t+φ) + 0.3 sin(2π b t+2φ) + 0.1 sin(2π c t))` (decor only, never core). Phase per fixture from `hash01(tile)`.
- Light mask (`lightMask.ts`, extended): per tile value `max(lightHand·fHand, lightFixedVisible·fFixedAvg, memory)`, where `memory = memoryLevel(ageC)·level` with continuous age `ageC = trail - 1 + t - seenAt` (`t` = step progress 0..1 = `1 - cooldown/STEP` clamped), so memory fades smoothly during the step, never pops. On every move, copy the last displayed per-tile values to `prevVal: Float32Array`; the displayed value is `lerp(prevVal, curVal, ease(t))`, so light slides with the player instead of jumping a tile. Reused typed arrays, no per-frame allocation besides the mask image (plan 01 ring of 2).
- Tints: after the mask, one radial gradient per light with `SrcATop` and the source colour: hand light centred on the interpolated player position + a small flame-height offset (torches jitter ±0.03 tile with flicker); each visible lit fixture its own gradient (≤ 10 drawn, nearest first). Gradient shaders cached per kind and radius bucket, re-centred via `canvas.translate`.
- Sprites (`src/game/render/drawItems.ts`), drawn inside the masked layer so darkness hides them; flames and glows of burning things drawn after the mask (emissive) only when their tile is visible: small torch / torch / big torch (wood shaft, wrapped head, leaning on the wall side), clay lamp (saucer with pinched spout), candle (tallow column, wick), oil jar (amphora with handles, clay stopper), sconce on the north wall face (bronze bracket + torch; lit adds flame, soot stain baked as a dark gradient), brazier (tripod bowl; coals glow when lit), shrine candles (three heights). A faint specular glint on unpicked items when lit, so they are findable. Sizes scale with `tilePx`; all paths built once per `tilePx` and cached.
- Player: drawn at the interpolated position (linear while walking continuously, ease-out cubic for an isolated step); the held source is drawn at the hand with its flame leaning against the motion direction.
- Redraw: every frame while walking, camera moving, or any flame is on screen (flames always are while playing), so 60 fps while playing; nothing while overlays freeze the game. The board `Picture` is delivered through a Reanimated shared value (`useSharedValue<SkPicture>`, `<Picture picture={sv} />`) set from the rAF loop, so React does not re-render `GameScreen` per frame; fall back to a memoised `Board` component with its own state if the shared-value path misbehaves on web.

### Light HUD (Q27, Q28)

- One canvas: the `Canvas` grows by a 64 dp **light strip** above the board (board drawn translated by 64 + gap). The existing top row (pause, pyramid name, floor) stays; the old `45 s` text and fuel bar are removed.
- Strip, drawn in Skia (`src/game/render/drawLightHud.ts`): left a 48 dp medallion — dark bronze ring with an arc showing `left/seconds` in the source colour, inner icon of the source with its live flame; under 25 % the arc turns ember red, under 10 s it pulses (1 Hz). Right: three bag recesses with the spare icons and a thin time bar each; empty recesses are engraved outlines. Embers: medallion shows a dying coal and an ember-red countdown.
- RN text over it (Cinzel name, Inter tabular time `m:ss`): "Oil lamp" / "1:42"; `bagFull`/`pickup`/`lit` events show a 1.6 s caption in the label line ("+ Oil lamp", "Bag full", "Sconce lit") with a Reanimated fade. Text updates at most 4 Hz from a small ref-driven state, not per frame.
- Transparent `Pressable`s (≥ 44 dp) over each bag slot dispatch `swap(slot)`; accessibility labels ("Spare 2: small torch, 31 seconds, double tap to light it"); the medallion label reads source, time and spare count.
- Haptics: pickup `tap`, fixture lit `bump`, auto-relight `bump`, `lowLight` `warning` (once per source), bag full nothing.

### Input (Q17–Q20)

`src/screens/play/walker.ts`: a plain object driven by the existing rAF loop. State: `held: { dir, source } | null`, `queued: Direction | null`, `run: Direction | null`. Each frame after `tick`: if `game.cooldown <= 0`, pick the move: `queued` (consumed) → else `run` via `runDir` → else `held` via `holdDir`; dispatch `step(move)`; on `null` from `holdDir/runDir` stop that mode. A press while `cooldown > 0` sets `queued` (1 deep, latest wins), so quick swipes are never lost. Bump haptic only when a fresh press hits a wall, never during hold/run.

- Touch (responder system on a full-screen-below-HUD `View`, `onResponderTerminationRequest={() => false}`): on move, once the finger is ≥ 14 dp from the anchor, the dominant axis gives `dir` → immediate move (or queue) and `held = dir`. The anchor trails the finger at ≤ 36 dp, so changing direction never requires dragging back past the origin; switching axis needs 1.3× dominance (hysteresis). Release clears `held`. Flick: on release, if the last 60 ms velocity ≥ 0.9 dp/ms, total travel ≥ 48 dp and `settings.autoRun` → `run = dir`. A new touch cancels `run`.
- D-pad (controls `pad`/`both`): `onPressIn` = press(dir), `onPressOut` = release; long press walks.
- Web keyboard (`src/screens/play/useKeyboard.ts`, `Platform.OS === 'web'`): `keydown` arrows/WASD → press (ignore `e.repeat`), `keyup` → release (stack of held keys, the last pressed wins), `Shift+dir` = run, `Escape`/`P` = pause; listeners on `window`, removed on unmount; `preventDefault` for arrows.
- Phase change (overview, pause, camp, burnt out), app background and blur: `walker.reset()`.
- `settings.ts`: add `autoRun: boolean` (default true; zustand persist merges the new default, no version bump); toggle in `settings.tsx` "Flick to run to the next junction".

## Files

Add:
- `src/game/core/lights.ts` — kinds, `CARRY`, `FIXTURE`, `EMBER`, constants, `radiusOf`, `radiusQ`, `Carried`.
- `src/game/core/placeLights.ts` — generator step (items + fixtures + braziers).
- `src/game/core/memory.ts` — `MEMORY_STEPS`, `memoryLevel`, levels.
- `src/game/core/walk.ts` — `holdDir`, `runDir`, `isCorridor`.
- `src/game/render/lightStyle.ts`, `src/game/render/drawItems.ts`, `src/game/render/drawLightHud.ts`.
- `src/screens/play/walker.ts`, `src/screens/play/useKeyboard.ts`, `src/screens/play/LightHud.tsx` (RN text + Pressables over the strip).
(No new snapshot file: the floor snapshot hash in `scripts/floors.snapshot.json` now covers items and fixtures.)

Change:
- `src/game/core/floor.ts` — `TILE.BRAZIER` + flag tables, `Item`, `Fixture`, `Floor.items/fixtures` (remove `oil`).
- `src/game/core/architecture.ts` — `ArchProfile.lights` (secPerTile table, weights, sconce/brazier rules); remove `oilPerTiles`.
- `src/game/core/generate.ts` — step 11 calls `placeLights`; hooks unchanged.
- `src/game/core/game.ts` — state, actions (`swap`), rules above; remove `TORCH_SECONDS`/`EMBER_SECONDS` (moved to `lights.ts`).
- `src/game/core/vision.ts` — `computeLight(floor, origin, radius, falloff, out)` with integer-safe lit test; export `clearLine`; `visibleFrom`.
- `src/game/render/lightMask.ts`, `src/game/render/drawGame.ts` — as in Rendering.
- `src/screens/GameScreen.tsx` — walker + keyboard, shared-value picture, strip layout, events → captions/haptics, remove old fuel HUD and tap-only swipe code.
- `src/state/settings.ts`, `src/app/settings.tsx` — `autoRun`.
- `scripts/check-floors.ts` — checks below; snapshot regenerated (`--update`) once, intentionally.
- `CLAUDE.md` — Layout (new files), Rules ("light burns by time per source; oil jar refills the hand light"), Journey (bag, sconces, memory 20 steps).

## Implementation order

1. `lights.ts`, `memory.ts`; `floor.ts` types; `architecture.ts` `lights` table.
2. `placeLights.ts` + `generate.ts` wiring; extend the check script's placement asserts and ASCII dump (items `t T B l c o`, fixtures `s b k`); iterate until asserts pass for all pyramid floors and Egypt seeds 1..300.
3. `vision.ts`, `game.ts` rules; `walk.ts`; check script rule tests and replay determinism; `npx tsc --noEmit`.
4. `lightStyle.ts`, `lightMask.ts` (memory + crossfade), `drawItems.ts`, `drawGame.ts` (tints, sprites, interpolated player).
5. `walker.ts`, `useKeyboard.ts`, `GameScreen.tsx` input + shared-value picture; test feel on web first.
6. `drawLightHud.ts`, `LightHud.tsx`, events → captions/haptics; settings toggle.
7. Bot light-budget report; tune `secPerTile` until the targets hold; `--update` snapshot; CLAUDE.md; verification.

## Verification

- `npx tsc --noEmit`, `npx expo-doctor`, `npx expo export --platform android --output-dir <scratchpad>`.
- `npm run check:floors` additionally asserts:
  - placement: deterministic (hash of items+fixtures equal on two runs, snapshot match); items only on open non-stairs non-start tiles; spacing ≥ 5 (items) / ≥ 7 (sconces); exactly one main-path item on floors 1–2, none on floors 3–10; ≥ 1 oil jar per floor; kinds respect `minFloor`; found-light seconds within [budget, budget + 100]; sconce faces have ROCK north; every open tile still reachable after braziers; eternal braziers on Egypt camp floors 5, 10 and two in the burial chamber.
  - replay: a seeded bot (random legal moves + `tick(1/60)` between them, 3000 actions, swaps every 400) run twice on Egypt floors 1, 5, 10 gives identical state hashes (pos, hand, bag, items, fixtureLeft, seenAt, walkedAt, status).
  - rules: oil jar refills hand / largest-deficit spare / is left when < 5 s gain; bag full leaves the item and emits `bagFull`; hand burning out lights the longest spare; embers 6 s then `burntOut`; a carried item picked up on embers relights; fixture lit only with a hand light; swap keeps seconds; `move` rejected while `cooldown > 0`; 1000 ticks of 1/60 s with hold-walking yield 1000/60/0.15 ± 1 moves.
  - memory: after 25 straight moves, the tile walked first has age 25 → `memoryLevel = 0`; tiles walked ≤ 6 moves ago → 1; `memoryLevel` monotonic and continuous.
  - walk: `holdDir` follows an L-bend and stops at T-junctions and dead ends; `runDir` stops at junctions, doors, next to items.
  - budget report (printed, asserted for floors 1–3): an explorer bot (DFS to the nearest unexplored tile, takes items it passes, swaps never, 0.15 s per move) from the top to floor 10 with camp refills; prints per floor time used, light found, hand+bag at the stairs; floors 1–3 must finish with ≥ 20 s left; floors 4–10 report only (target: the bot burns out at least once between camps 5 and 10 but not on every seed).
- Web preview: walk Egypt 1→10 with keyboard and mouse-drag: swipe moves one tile, hold walks and turns corridor bends, flick runs to the junction, quick double swipes both register; teaching small torch on floor 1 goes into the bag and the HUD shows it; swap by tapping a slot; torch dies → spare lights with a flare; embers countdown red; oil jar refill; sconces light when passed and are recognisable from afar in line of sight, not through walls; trail behind fades smoothly to black after ~20 steps; colour and flicker differ visibly between torch, lamp and candle; burial chamber glows from two braziers; pausing freezes flames and the clock.
- Device: release `preview` APK on the Redmi 9 — touch-to-move latency ≤ 1 frame after the 14 dp threshold, steady 60 fps while walking with 8 lit fixtures on screen.

## Performance budget (Redmi 9: Helio G80, Mali-G52, Hermes)

- Core per frame: `tick` O(fixtures) without relight; relight (hand) ≤ 0.3 ms on radius change/move; fixed relight ≤ 1 ms on light-up only; visibility pass ≤ 0.5 ms on move (≤ 625 tiles × clearLine).
- JS per frame: mask values + crossfade + memory over the view window (≤ 17×17 tiles + margin) and image upload ≤ 1.5 ms; picture record ≤ 2 ms (≤ 60 draw calls: art blit, mask, ≤ 11 gradients, ≤ 30 sprites, HUD strip ~15); total JS ≤ 5 ms at 60 fps. No React re-render per frame; HUD text ≤ 4 Hz.
- GPU: one `saveLayer`, ≤ 11 full-gradient circles with SrcATop, rest small paths: well within Mali-G52 at 1080×2340.
- Memory: per-tile arrays 6 × 1681 × 4 B ≈ 40 KB on floor 10; gradient/path caches ≤ 50 objects.
- Input: move dispatched in the same JS frame as the responder event that crosses the threshold (no timers, no worklet hop).

## Risks

- Too much light makes floors trivial; too little punishes exploration. Mitigation: explicit `secPerTile` table + the bot report; tune numbers only in `architecture.ts`.
- Responder system on Android with an ongoing rAF loop: if the JS thread stalls, input lags. Keep per-frame JS ≤ 5 ms; if device tests show lag, move gesture recognition to Gesture Handler 3 (installed; read its v3 docs first, its API changed) with `runOnJS` callbacks.
- `Picture` via shared value on web (CanvasKit) may not update; fallback documented (memo `Board` component).
- Fixed-light visibility at range 12 may still feel like seeing far rooms "through the dark"; it is LOS-correct, and fixtures sit only on known paths you lit yourself (except eternal ones in camps/burial, which are meant to be beacons).
- Bag + swap adds UI on a small strip; if playtests show nobody swaps, keep auto-relight and drop swap targets (rule stays in core).
- Core move cadence couples replays to tick timing; a future server must replay ticks too (already the model: time comes in through ticks).
- Brazier tiles change `solid` after BFS; the revert rule and check script guard connectivity.
