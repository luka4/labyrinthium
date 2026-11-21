# Plan 04 · Egypt complete: the guardian and the artifact escape

Decisions and reasons: `plan_04_question.md` (Q-numbers). Written 2026-11-21 against the merged code of tasks 01–03 (`e8bd339`): every name, file and signature below is the real one or an explicit change to it. Q0 of plan 03 stands (real art arrives in phase 4): new art here is tidy, considered vector art in `src/game/render`, themed through `themes.ts`, behind functions tasks 10–13 can swap.

What exists and is reused (do not re-plan it): `GameState` with `grid` (run masks), `prevPos`, `trapPhase/trapTimer`, `collapse: CollapseRun` (`speed` multiplier, `started`, `fill/covered/blocked`, `rank/order/sdist` run copies), `sand/seenSand/localSand`, `solidDirty/opaqueDirty`, `skipped`, statuses `playing | descending | falling | burntOut | buried | escaped`; `runtime.ts` (`emit`, `setHand`, `lightSpare`, `loseHand`, `buryItem`, `smotherFixture`); `traps.ts` (`placeTraps`, `pressPlate(s, k, by)`, `tickTraps`, `fire`, `resolveLanding`); `collapse.ts` (`sandOrder`, `buildSandOrder`, `startCollapse`, `tickCollapse`, `rebuildRank`, `blockTile`, `releasePending`, `SLOPE/COVER/WADE/BURY_ITEM`); `graph.ts` (`bfsFrom`, `reachable`, `articulationPoints`, `nearestOpen`); `generate.ts` `generateLayout` / `addFeatures(layout, spec, below)` / `layoutFor` / `floorFor` / `specFor`; `startFloor(p, i, hand, bag, steps, ember, opts: StartOptions)`; `walker.ts` `avoid`; `drawGame(canvas, s, layers, view, frame)` with the masked `saveLayer`; `Board.tsx` anim refs (quake, fall); `FloorOverview` kinds; `progress.ts` v3 with `hints`; `scripts/check-floors.ts` + `check-traps.ts` + `check-trap-rules.ts` + `check-light-rules.ts` (rules, `hashState(full)`, replay keys `replay:0/4/8/10/16/23`, plain bot, deep bot); the burial chamber (a leaf room, one door; `floor.stairs` = the artifact tile in front of the sarcophagus; two eternal braziers).

## Goal

Egypt gets its hunter and its ending. From floor 18 a **tomb guardian** (the Keeper: a mummified priest-guardian in resin-dark linen and a gilded cartonnage mask, fictional, never a deity) stands dormant in a lair and wakes after a while or on a noise. It walks the floor deterministically, sees you only by your own light (a bigger flame is seen from further, a candle or embers hide you, it looks where it faces), hears your steps along the corridors (slow steps are quiet), trips the pressure plates when it rushes, wades in sand, puts out the sconces and braziers it passes, and is felt before it is seen (events with a tile position for task 05's stereo sound and haptics, and a guttering flame now). Contact smothers your hand light (the trap rule: a spare lights itself); on embers it takes you, back to the last camp. From floor 22 a guardian that is hunting you follows you down the stairs. In the basement a sentinel stands dormant beside the burial chamber's door. Taking the Golden Scarab wakes the pyramid: the sand starts pouring again, faster and further, the sentinel rises and hunts, and a **false door** elsewhere on the floor grinds open onto the workmen's escape shaft. Step through it and you climb out into daylight (side-view animation), then the artifact reveal; the escape is recorded.

## Scope

In:
- `egypt.ts`: guardian row per floor (wake, paces, follow, sentinel) and the basement's `escapeCap`.
- Generation: `placeExit` (the false door), `placeGuardian` (lair or sentinel post, patrol route), `Collapse.capLen`.
- Core: `guardian.ts` (AI, senses, noise, contact, follow, cue), `escape.ts` (take the Scarab, open the door, win), statuses `caught`, events with a tile (`at`), `idle` (quiet steps), `floorTime`, run fields; `CollapseRun.limit`.
- Render: `drawGuardian.ts` (sprite, rise, memory ghost), false door baked + opening sprite, Golden Scarab sprite and empty plinth, daylight from the shaft, the Scarab's brief pointer, flame gutter near the guardian, smoke wisps of snuffed fixtures, the escape shaft in the side view.
- UI: caught panel, escape overview → artifact screen, captions/hints, minimal haptics, progress v4 `records`, artifact screen escape time.
- Checks: `scripts/check-guardian.ts` (placement, fairness, rules), replay keys, bot report columns.

Out (task 05+): stereo sound, patterned haptics ("heartbeat"), stars, secrets, records UI beyond one line; artifact powers in other pyramids (06); guardians of Maya/Cambodia/China/Black (07–09); guardian footprints in sand (render nicety, later); New Game+.

Hooks left for 05: `GameEvent.at` (tile) on every event, guardian events (`guardianStep/Near/Wake/Spotted/Lost/Touch/Hit/Follow/Gone`, `snuffed`, `caught`, `artifactTaken`, `exitOpened`), `guardianCue(s)` (offset, path distance, visibility, mode), `s.floorTime`, `s.escape.t`, `s.guardian.touches`, `progress.records`.

## Design

### 1. Data (`egypt.ts`, `architecture.ts`) (Q1–Q4, Q21)

```ts
export type GuardianRow = {
  /** seconds of burning time before it wakes by itself (sentinel: Infinity, only the Scarab wakes it) */
  wake: number;
  /** seconds per tile: walking its rounds, searching a noise, hunting you */
  patrol: number; search: number; hunt: number;
  /** a guardian hunting you on the floor above comes down after you */
  follow: boolean;
  /** the basement: stands beside the burial chamber's door until the Scarab is lifted */
  sentinel: boolean;
};
EgyptRow.guardian: GuardianRow | null;
EgyptRow.escapeCap: number | null;   // % of open tiles the sand may reach once the Scarab is taken
export const ESCAPE_TARGET = 60;      // s from the Scarab to the false door (bot report)
```

| Floor | wake s | patrol | search | hunt | follow | notes |
|---|---|---|---|---|---|---|
| 1–17 | – | | | | | no guardian |
| 18 | 45 | 0.65 | 0.45 | 0.28 | – | first guardian; target 155 → 165 s |
| 19 | 40 | 0.62 | 0.44 | 0.28 | – | 170 → 180 |
| 20 ● | 35 | 0.62 | 0.42 | 0.27 | – | camp; 180 → 190 |
| 21 | 30 | 0.60 | 0.42 | 0.27 | – | 190 → 200 |
| 22 ● | 28 | 0.60 | 0.40 | 0.26 | ✓ | camp; 205 → 215 |
| 23 | 25 | 0.58 | 0.40 | 0.26 | ✓ | 215 → 225 |
| 24 ● | 22 | 0.58 | 0.38 | 0.25 | ✓ | camp; 230 → 240 |
| 25 basement ● | ∞ (sentinel) | 0.55 | 0.36 | 0.23 | – | `escapeCap` 60; target 240 + escape 60 |

The player walks 0.15 s/tile, so even a hunting guardian is 1.5–1.8× slower: it wins by surprise, dead ends, sand (both wade ×1.8) and your stuns, never by speed. Only guardian rows, `escapeCap` and the targets of rows 18–25 may be tuned (bot report). Rows 1–17 unchanged.

`ArchProfile` gains `guardian?: (i) => GuardianRow | null` and `falseDoor: boolean` (Egypt `true`; `generic` and `black` set `guardian: undefined, falseDoor: false` explicitly because they spread `EGYPT`), and `collapse?` keeps returning the row's `collapse`; `escapeCap` is read through `escapeCap?: (i) => number | null`.

### 2. Floor model (`floor.ts`)

```ts
Collapse.capLen: number;        // order entries the sand reaches before the Scarab (= order.length without an escape)
Floor.exit: number;             // the false door: a ROCK tile that opens, or -1
Floor.exitFront: number;        // the open tile in front of it (south), or -1
Floor.guardian: GuardianPlan | null;
export type GuardianPlan = {
  lair: number;                 // tile it stands on while dormant (the sentinel's post in the basement)
  facing: Direction;            // facing while dormant: out of the niche / towards the burial door
  route: Int32Array;            // patrol waypoints (room anchor tiles), generation order
} & GuardianRow;
```
`Layout` excludes the new fields (`Omit<Floor, … | 'exit' | 'exitFront' | 'guardian'>`). `Direction` stays in `game.ts` (import type only).

### 3. Generation (`generate.ts` `addFeatures`, `collapse.ts`, new `escape.ts`, new `guardian.ts`) (Q5–Q10)

Order in `addFeatures`: `placeLights` → `placeTraps` (unchanged) → `buildSandOrder(layout, row, escapeCap)` → `placeExit` → `placeGuardian` (own rng `seed ^ 0x6c8e9cf5`). Nothing before `buildSandOrder` changes, so `egypt:0..24` and `egypt:0..23:feat` stay identical (assert); only `egypt:24:feat` changes (longer order).

**Sand with an escape** (`buildSandOrder(layout, row, escapeCap?)`): `a = sandOrder(layout, row)` as today; if `escapeCap`, `b = sandOrder(layout, { ...row, cap: escapeCap })` (same BFS, longer cut, same 40 % rule with its own lowering). Use `b.order/rank/sdist` when `b.order.length > a.order.length`, store `cap = a.cap`, `capLen = a.order.length`; otherwise as today with `capLen = order.length`. `inCollapse` (traps.ts) keeps using `cap`, so trapdoor landings do not move.

**False door** (`escape.ts` `placeExit(layout, traps, trapAt, fixtures, items, collapse)`, only when `profile.falseDoor && spec.basement`; no rng):
- Candidates: front tile `T` (`tiles[T] === FLOOR`), door tile `R = T − size` with `tiles[R] === ROCK` and `R−1`, `R+1`, `R−size` all ROCK (a pocket: opening it never joins two passages), `y(R) ≥ 1`; `T` not in a `stairsUp/stairsDown/burial/antechamber` room, not an item, fixture (no sconce on the same face), niche or trap tile, not 4-adjacent to a trap tile, `rank[T] === −1` (never reached by the sand, escape cap included).
- Worst-case mask `W` = static solid + every ranked sand tile + every trap tile + portcullis ports (plan 03's I2) ; `T` must be reachable from `stairs` on `W`.
- Score: `d = distancesFrom(solid, size, stairs)[T]`, `D = max d over candidates`; keep `0.45·D ≤ d ≤ 0.85·D`; pick the smallest `|d − 0.65·D| − (rooms[room[T]].leaf ? 4 : 0)`, ties lowest index. Fallback: drop the side-rock rule (keep `R−size` rock). None → `exit = −1` (the check fails for Egypt).

**Guardian** (`guardian.ts` `placeGuardian(layout, ctx, rng)`), when `profile.guardian?.(i)`:
- Lair (not sentinel): leaf rooms of kind `chamber | shrine | magazines`, off the main path, `dist[door] ≥ 0.4 × dist[stairs]`; the room's FLOOR tile with the largest `dist` (its back), not an item/fixture/trap tile or 4-adjacent to one, `rank` −1 or `> cap + 4·SLOPE`, and removing it keeps every open tile reachable (`stillConnected`) and `stairs` reachable on `W` + lair. Candidates shuffled with the rng; first that passes. Fallback: any off-path FLOOR tile with `dist ≥ 0.4 × dist[stairs]` passing the same tests. `facing` = towards its open neighbour.
- Sentinel post (basement): `D` = the burial door (`rooms[stairsRoom].doors[0]`), `O` = its neighbour outside the burial room. Candidates: FLOOR tiles of `O`'s room within Chebyshev 2 of `O`, not `O`, off the main path, with a ROCK/PILLAR 4-neighbour (its back to a wall), passing the removal tests and keeping `stairs → exitFront` on `W`; nearest to `O` (Manhattan, ties lowest index). Fallback: the burial room's tiles 4-adjacent to the door's inner neighbour, off the main path (always exist: burial rooms are ≥ 3 wide with the door on the axis). `facing` = towards `O`.
- Route: one anchor per room (its FLOOR tile nearest the room's centre that is no trap tile) for rooms that are not `stairsUp`, `stairsDown`, `burial` and not the lair's room; shuffle, keep up to 8, at least 3 (fallback: any rooms). Anchors must be reachable from the lair on the static mask.

### 4. Runtime state (`game.ts`, `guardian.ts`, `escape.ts`) (Q11–Q20, Q22–Q27)

```ts
// game.ts
export type Status = 'playing' | 'descending' | 'falling' | 'burntOut' | 'buried' | 'caught' | 'escaped';
GameEvent = { seq; type; kind; at: number /* tile, -1 */ };   // emit(s, type, kind, at = -1); EVENT_LOG 8 → 16
GameEvent.type adds: 'guardianWake' | 'guardianStep' | 'guardianSpotted' | 'guardianLost' | 'guardianNear'
  | 'guardianTouch' | 'guardianHit' | 'guardianFollow' | 'guardianGone' | 'snuffed' | 'caught' | 'artifactTaken' | 'exitOpened';
GameState.guardian: GuardianRun | null;
GameState.escape: { taken: boolean; t: number; open: boolean; openIn: number } | null;   // non-null when floor.exit >= 0
GameState.idle: number;        // seconds since the last move (quiet steps)
GameState.floorTime: number;   // burning seconds on this floor (stars hook)
GameState.noises: number[];    // pending [tile, radius] pairs, consumed by tickGuardian
StartOptions.follow?: { gap: number };

// guardian.ts
export type GuardianMode = 'dormant' | 'waking' | 'patrol' | 'listen' | 'investigate' | 'hunt' | 'recoil' | 'arriving' | 'gone';
export type GuardianRun = {
  mode: GuardianMode; pos: number; prev: number; facing: Direction;
  cooldown: number;   // s to the next step; carries the remainder like the player's cadence
  stepDur: number;    // s of the current step (render interpolation)
  timer: number;      // dormant: wake clock; waking/listen/recoil: s left; arriving: s until it reaches the landing
  target: number; lastSeen: number; waypoint: number;
  rng: number;        // mulberry32 state (uint32), seeded floor.seed ^ 0x6c8e9cf5
  dist: Int32Array; distFrom: number;      // BFS steps from the guardian over grid.solid; distFrom = pos it was built at, -1 stale
  toTarget: Int32Array; toTargetFor: number; toTargetPlates: boolean;   // BFS from the target over the path mask
  scratch: Uint8Array;                      // path mask buffer
  sense: number;      // escape: s to the next Scarab pulse
  lastNear: number; warned: boolean;
  seenTrail: number; seenPos: number;       // the player's memory of it: trail when last lit, and where
  touches: number;
};
```
`rng.ts` gains `nextRandom(box: { rng: number }): number` (mulberry32 on a stored state, same algorithm as `createRng`). `runtime.ts` gains `noise(s, at, radius)` (pushes when `s.guardian` is awake or dormant; keeps `traps.ts` free of a `guardian.ts` import). Any grid change sets `distFrom = toTargetFor = −1` (in `blockTile`, `fire`'s `seal`, the exit opening).

`startFloor`: `idle = 1`, `floorTime = 0`, `noises = []`, `escape = floor.exit >= 0 ? { taken: false, t: 0, open: false, openIn: 0 } : null`, `guardian = startGuardian(floor, opts.follow)`: no plan → null; `opts.follow && plan.follow && !plan.sentinel` → mode `arriving`, `pos = −1`, `timer = gap`; else mode `dormant` at `lair`, `timer = 0`.

### 5. Rules (Q11–Q20)

Constants (`guardian.ts`): `QUIET_GAP 0.35`, noise radii in path steps `{ quiet 2, step 5, pickup 3, lit 3, plate 7, block 16, portcullis 16, sandfall 9, bump 5 }`, sight `range = 2·handR + 1` (embers 1.5; standing in fixture light `lightFixed[pos] ≥ 0.15` → at least 9), cone half-angle 60° (`dot ≥ 0` and `4·dot² ≥ d²`, integers), `CLOSE 2` (seen at Chebyshev ≤ 2 in any direction), `RISE 1.5`, `SENTINEL_RISE 3.0`, `LISTEN 2.5`, patrol pause 1–3 s, `RECOIL 4` (first `RECOIL_STILL 1.5` s still), `STUN_TOUCH 1.0`, `HEAR_STEPS 16`, `NEAR_PATH 6`, `NEAR_EVERY 1.5`, follow gap clamp `[5, 25]` s, `FOLLOW_WARN 3`, `ESCAPE_SENSE 4`. `escape.ts`: `ESCAPE_SPEED 2.5`, `EXIT_OPEN 1.5`, exit light radius 2.5, falloff 2.0.

**move(dir)** additions, in this order around today's code:
- Blocked: `next` is the tile of a `dormant`/`waking` guardian → no move; `noise(s, next, bump)` (you bumped a statue). An awake guardian's tile is not blocked.
- `quiet = s.idle ≥ QUIET_GAP`; `s.idle = 0`.
- After `pickUp`/`lightFixtures`: `noise` for a pickup or refill (3) and for each fixture lit (3).
- Goal: `next === stairs` → basement with `escape` → `takeArtifact(s)` (§6) instead of `escaped`; basement without `escape` (other pyramids) → `escaped` as today; `next === floor.exit && escape.open` → `escaped`.
- `pressPlate(s, k, 'player')` → `noise(s, tile, plate)` inside `pressPlate` (for any `by`).
- Footstep: `noise(s, next, quiet ? quiet : step)`.
- Contact: `touchIfMet(s)`.

**tick(dt)**: `idle += dt` (always); then as today; `floorTime += dt` while burning; order: `burn` → `tickTraps` → `tickCollapse` → `tickEscape` → `tickGuardian` → cut-off → relight → `noteGuardianSeen` (after relight: if `light[g.pos] > 0`, `seenTrail = trail`, `seenPos = g.pos`). `fire` adds `noise` (block/portcullis 16, sandfall 9) and, when the guardian stands on the sealed tile, pushes it to `g.prev` (or the first open neighbour), mode `recoil`, event `guardianHit` at the tile.

**Cut-off** (`wayDownLeft`): the goal is `escape?.taken ? exitFront : stairs` (the door tile is solid until open); armed trapdoors as today.

**tickGuardian(s, dt)** (one guardian; all integer BFS, `DIRS` tie order):
1. Noises: for each pending `[at, r]`: refresh `dist` if stale; heard iff `dist[at] ≥ 0 && dist[at] ≤ r`. Dormant (not sentinel) → `waking` (`timer = RISE`, then `investigate at`); `patrol/listen/investigate` → `investigate` target `at`; `hunt` while not seeing you → target `at`. Clear `noises`.
2. Clocks: `dormant` non-sentinel: `timer += dt`; `≥ wake` → `waking` (`RISE`), event `guardianWake` at `pos`; also wakes if `sees(s, close only)`. `waking`: `timer −= dt`; at 0 → `investigate` the last noise, or `hunt` with `target = s.pos` for the sentinel, or `patrol`. `listen`: `timer −= dt` → `patrol`. `recoil`: `timer −= dt` → `patrol` (`hunt` during the escape). `arriving`: `timer −= dt`; at `≤ FOLLOW_WARN` once → event `guardianFollow` at `floor.start`; at `≤ 0`: start tile solid (sand) → mode `gone`, event `guardianGone`; player within Chebyshev 1 of start → wait; else `pos = prev = start`, mode `investigate`, `target = s.pos` (it follows your trail once).
3. Sight (modes `patrol | listen | investigate | hunt | recoil`): `sees(s)` = your tile is lit (`s.light[s.pos] > 0`), Chebyshev ≤ CLOSE, or (`d² ≤ range²` and (mode `hunt`/`listen` or inside the cone of `facing`)), and `clearLine(grid, g, you)`. Seen and not recoiling → mode `hunt`, `target = lastSeen = s.pos` (event `guardianSpotted` on entering hunt). Hunting, not seen, reached `lastSeen` → `listen` (`LISTEN`), event `guardianLost`.
4. Escape pulse: `escape.taken` and mode not `recoil`: `sense −= dt`; at 0 → `sense = ESCAPE_SENSE`, mode `hunt`, `target = lastSeen = s.pos` (the Scarab calls it).
5. Steps: `cooldown −= dt`; while `cooldown ≤ 0` and the mode walks (`patrol`, `investigate`, `hunt`, `recoil` after the still part): pick target (patrol: `route[waypoint]`; arrived → `listen` for 1–3 s by rng, then the next waypoint = the farther (by `dist`) of two rng picks ≠ current; recoil: the waypoint farthest from you), path field `toTarget` = BFS from `target` over the path mask (grid.solid + STAIRS_DOWN tile + exit tile + armed trapdoor tiles + armed plate tiles unless mode `hunt`; if the target is unreachable that way, retry with plates allowed; trapdoors never). Step to the neighbour with `toTarget − 1` (DIRS order); none → `listen`. Then `prev = pos`, `pos = next`, `facing`, `cooldown += pace(mode) × (sandLevel(next) ≥ COVER ? WADE : 1)`, `stepDur` = that; armed plate on `next` → `pressPlate(s, k, 'other')`; snuff every non-eternal lit fixture within Chebyshev 1 (`fixtureLeft = −1`, `fixedDirty`, event `snuffed` at its tile); `guardianStep` at `pos` when `dist`-to-you ≤ `HEAR_STEPS`; `touchIfMet(s)`.
6. Sand: if `grid.solid[pos]` (blocked under it) → move to the first open 4-neighbour not your tile, else `nearestOpen`.
7. Near: not visible to you (`light[pos] ≤ 0`), path ≤ `NEAR_PATH`, `floorTime − lastNear ≥ NEAR_EVERY` → event `guardianNear` at `pos`.

**touchIfMet(s)**: awake guardian on your tile → `touches++`; hand burning: `loseHand(s)` (spare lights itself), event `guardianTouch` at the tile, `cooldown = max(cooldown, STUN_TOUCH)`, push you to `prevPos` if open and not the guardian's tile, else the first open neighbour; guardian → `recoil` (`RECOIL`). On embers: `status = 'caught'`, event `caught`.

**continue** from `descending`: `follow = followGap(s)`: guardian in `hunt | investigate | listen` → `{ gap: clamp(dist[stairs] × hunt + 3, 5, 25) }`, else none; passed in `StartOptions` (the next floor decides with `plan.follow`). From `falling`: no follow (the shaft loses it). **retry** accepts `caught` (and keeps `burntOut | buried`).

### 6. The escape (`escape.ts`) (Q5–Q8, Q24)

- `takeArtifact(s)`: `escape.taken = true`, event `artifactTaken` at `stairs`; collapse: `limit = order.length`, `speed = ESCAPE_SPEED`, not started → `started = true` + `quake`; sentinel → `waking` with `SENTINEL_RISE`; `escape.openIn = EXIT_OPEN`.
- `tickEscape(s, dt)`: `t += dt` while taken; `openIn` reaches 0 → `grid.solid[exit] = grid.opaque[exit] = 0`, `opaqueDirty`, path caches stale, `open = true`, event `exitOpened` at `exit`.
- `relight`: when `escape.open`, the shaft's daylight joins the fixed lights: `computeLight(grid, exit, 2.5, 2.0, lightFixed, true)` (seen through line of sight like any fixed light, so it guides you once in view).
- `CollapseRun.limit` (new; `startCollapse` sets it to `plan.capLen`): `tickCollapse` and `rebuildRank` use `limit` where they use `order.length` today (rebuild keeps `order.length` entries, `limit` unchanged). Floors 11–24: `capLen === order.length` → identical behaviour (replay hashes unchanged).
- Fairness by construction: the exit is outside every sand rank and reachable from the Scarab on the worst-case mask with the sentinel post solid; sand can cut you off only in a side branch (then `buried`, retry at camp 25).

### 7. Rendering (Q28–Q33)

**Guardian sprite** (`src/game/render/drawGuardian.ts`, `drawGuardian(canvas, s, theme, t, time, win)` inside the masked layer after `sand.draw`, so it is only seen in light; drawn only when `s.light[g.pos] > 0` (no leak through memory): about 1.15 tiles tall and 0.55 wide in the board's 3/4 view, feet at the tile's lower third. Linen ramp `#3a2c1e` (resin) → `#6b5a43` → `#a08a68` (highlight), 7–9 thin wrapping bands at alternating ±12°, two loose strips that sway with time, contact shadow ellipse. Head: tripartite striped wig (lapis `#2b4a8a` and gold bands) framing a gilded cartonnage face (`#c49a3f → #e8c66a` gradient, dark almond eyes outlined, no glow, no animal head, no crown or uraeus). Poses: dormant arms crossed over the chest under a dust film (reads as a statue); waking: dust falls, arms uncross, slight rise (progress = `1 − timer / rise`); walking: 0.03-tile bob, ±3° sway, arms low; hunting: leans 6° forward, arms forward; recoil: tilt back. Facing north shows the wig's back. Position interpolates `prev → pos` by `1 − cooldown / stepDur`. Paths cached per pose at unit scale, gradients cached by colour; no per-frame allocation beyond today's pattern.
**Memory ghost**: when not lit and `trail − seenTrail < MEMORY_STEPS`, a flat silhouette (single path, `#8b8170`) at `seenPos`, under the mask (it shows at memory brightness and fades with it).
**Snuffed fixtures**: `Board` keeps a small list of `snuffed` events (`at`, time) and draws a 1.5 s smoke wisp there (two drifting grey curves, inside the masked layer).
**False door** (baked in `floorArt.ts` `drawTelltales`, on `exit`'s south face): a stepped recess, two nested jambs, a lintel with a cavetto cornice and a torus roll, a narrow central slab, faint red-ochre and yellow paint traces and abstract glyph strokes (no real inscriptions). **Opening** (per frame, `drawEscape.ts`): the slab sinks 1.5 s with dust, then a black shaft mouth with a cool draught haze; the daylight tint (`LIGHT_STYLE.daylight = { color '#cfd8e6', tint 0.35, low flicker }`) through the existing coloured-light pass.
**Golden Scarab** (replaces `artifact()` in `drawGame.ts`): a low alabaster plinth, a gold scarab (domed wing cases with a centre seam, head shield, six fine legs, lapis inlay line), glint; after `taken`, the empty plinth with a dust outline. While taken: a small gold glint in the player's free hand, and for 5 s after taking, gold motes drifting from you along the straight-line direction to the exit (emissive, after the mask; the Scarab's power, "briefly points the way").
**Flame gutter**: in `drawGame`, `guardianCue(s).path ≤ 8` and not visible → the hand flicker gets extra amplitude and a lean towards nothing in particular (a cold draught); render-only.
**Side view** (`drawPyramidSide.ts`): `sideLayout` gains `shaft(u)` (0..1) — a narrow passage from the basement chamber rising at 26° (the real descending passages' angle) to the ground outside the base, ending in a small mouth with a daylight glow; `SideView.escape?: number` draws it and the marker on it. `FloorOverview` kind `'escape'`: title "Out through the shaft", line "Daylight. The {artifact} is yours.", marker along the shaft (no "Floor n" label).
**Haptics placeholders** (the existing event loop; task 05 replaces with sound and patterns): `guardianNear` bump, `guardianWake` heavy, `guardianTouch` and `caught` warning, `artifactTaken` success, `exitOpened` heavy.

### 8. UI (`GameScreen.tsx`, `FloorOverview.tsx`, `progress.ts`, `artifact/[id].tsx`, `pyramid/[id].tsx`, `LightHud`/`drawLightHud`)

- Phase `caught`: haptic warning; Panel eyebrow floor text, title "Taken in the dark", text "With your light gone, the guardian found you. You come to at {campLabel}.", buttons as burnt-out.
- `escaped` with `floor.exit ≥ 0`: after 0.3 s (the step into the doorway plays), phase overview kind `'escape'`; its `onDone` → `takeArtifact(pyramid.id, { escape: s.escape.t, touches: s.guardian?.touches ?? 0 })` → `router.replace('/artifact/[id]')`. Without an exit: today's immediate path.
- Captions: `guardianTouch` "It smothers your light"; `guardianFollow` "Footsteps on the stairs behind you"; `artifactTaken` "The Golden Scarab is yours. The pyramid wakes."; `exitOpened` "Far off, stone grinds open. Air moves."; `guardianHit` "The stone falls on the guardian"; others none.
- Hints (`HintId` adds `'guardian' | 'guardianWake' | 'escape'`, once per save): `guardian` when its tile is first lit ≥ 0.3: "A guardian in linen and gold. Your light shows you to it; it hears you walk. Slow steps are quiet."; `guardianWake` at the first `guardianWake`: "Stone grinds somewhere. Something is awake."; `escape` 3 s after `artifactTaken`: "A false door has opened somewhere. The Scarab points the way, briefly."
- Strip: `drawLightHud` draws a small gold scarab glyph at the right end while `escape.taken`; `HudText` unchanged.
- `progress.ts` v4: `records: Partial<Record<PyramidId, { escapes: number; bestEscape: number | null; untouched: number }>>` (`untouched` = escapes with 0 touches), `takeArtifact(id, result?)` updates it; migration `version < 4` adds `records: {}`; `partialize` + `EMPTY`.
- Artifact screen: under the existing lines, "Out in m:ss · best m:ss" when `records[id]?.bestEscape` exists.
- Pyramid page fact: "Guardian from floor 18" (Egypt only, from the rows).

## Files

Add:
- `src/game/core/guardian.ts` — types, constants, `placeGuardian`, `startGuardian`, `tickGuardian`, `touchIfMet`, `followGap`, `noteGuardianSeen`, `guardianCue`.
- `src/game/core/escape.ts` — constants, `placeExit`, `takeArtifact`, `tickEscape`.
- `src/game/render/drawGuardian.ts`, `src/game/render/drawEscape.ts` (door opening, shaft mouth, scarab, plinth, pointer motes).
- `scripts/check-guardian.ts` — placement/fairness asserts and rule tests, `runGuardianChecks(report)`.

Change:
- `egypt.ts` (`GuardianRow`, rows, `escapeCap`, `ESCAPE_TARGET`, targets 18–25), `architecture.ts` (`guardian?`, `escapeCap?`, `falseDoor`; generic/black overrides).
- `floor.ts` (`Collapse.capLen`, `Floor.exit/exitFront/guardian`, `GuardianPlan`, `Layout` omit), `generate.ts` (`addFeatures` order), `collapse.ts` (`buildSandOrder` escape cap, `CollapseRun.limit`, cache invalidation in `blockTile`), `traps.ts` (`noise` in `pressPlate`/`fire`, guardian push in `fire`, cache invalidation), `runtime.ts` (`emit(…, at)`, `EVENT_LOG 16`, `noise`), `rng.ts` (`nextRandom`), `game.ts` (statuses, events, state, `move`/`tick`/`continue`/`retry`, `wayDownLeft`, exit light in `relight`, `StartOptions.follow`).
- `render/drawGame.ts` (guardian, ghost, escape sprites, scarab, daylight tint, pointer, gutter, wisps), `floorArt.ts` (false door), `lightStyle.ts` (`daylight`), `drawLightHud.ts` (scarab glyph), `drawPyramidSide.ts` (shaft), `themes.ts` (`linen`, `linenDark`, `mask` gold, derived for other themes).
- `screens/GameScreen.tsx`, `screens/play/Board.tsx` (wisps), `screens/play/FloorOverview.tsx` (`'escape'`), `screens/play/walker.ts` (avoid also the guardian's tile while it is dormant), `app/artifact/[id].tsx`, `app/pyramid/[id].tsx`.
- `state/progress.ts` (v4, `records`, hint ids).
- `scripts/check-floors.ts` (call `runGuardianChecks`, ASCII `G` lair, `S` sentinel post, `E` exit, `w` waypoints, hash `egypt:i:g`), `scripts/check-light-rules.ts` (`hashState(full)` + guardian/escape fields, replay floors 18/22/25 → `replay:17/21/24`, bot columns), `scripts/floors.snapshot.json`.
- `CLAUDE.md` — Journey (guardian from floor 18, follows from 22, sentinel, the Scarab wakes the pyramid, false door, escape overview), Layout (new files), Rules ("the guardian is core state, tick-driven with a stored rng; sound and haptics read events with `at`").

## Implementation order

1. Safety net: `npm run check:floors` passes on `e8bd339` unchanged; note the replay hashes.
2. `CollapseRun.limit` + `Collapse.capLen` (pure refactor): all snapshots and replays unchanged.
3. Data rows, profile fields, `Floor` fields (null/−1 everywhere): unchanged snapshots.
4. `escapeCap` sand order, `placeExit`, `placeGuardian`; check asserts (§Verification); `egypt:24:feat` changes deliberately (`--update`), every other `egypt:*` key equal; new `egypt:i:g` keys.
5. Events `at`, `noise`, `idle`, `floorTime`, statuses; then `guardian.ts` runtime and `escape.ts`; rule tests in `check-guardian.ts`; `replay:0/4/8/10/16` unchanged, `replay:23` changes (guardian on floor 24) — update once, deliberately; add `replay:17/21/24`.
6. Rendering: guardian sprite (headless PNG at 120 px/tile: dormant, waking, walking 4 facings, hunting, ghost), false door closed/opening, scarab/plinth, pointer, daylight, wisps, side-view shaft.
7. UI: phases, overview, captions/hints, haptics, progress v4, artifact screen line, pyramid fact.
8. Bot report → tune guardian rows/targets 18–25 and `escapeCap`; `--update`; CLAUDE.md; full verification.

## Verification

- `npx tsc --noEmit`, `npx expo-doctor`, `npx expo export --platform android --output-dir <scratchpad>` and `--platform web`.
- `npm run check:floors` (fixed seed + fuzz seeds 1..100 over floors 18–25):
  - snapshots: `egypt:0..24` and `egypt:0..23:feat` equal the committed values; `maya/cambodia/china/black:*` equal; `egypt:17..24:g` committed.
  - exit (basement, every seed): exists; `R` ROCK with three ROCK side neighbours; `T` FLOOR, `rank[T] = −1`, not a trap/item/fixture tile; `T` reachable from `stairs` on the worst-case mask with the sentinel post solid; distance band 0.45–0.85 of the best; floors 1–24 and every non-Egypt pyramid `exit = −1`.
  - guardian: present exactly on rows with `guardian`; lair/post FLOOR, off the main path, not on/4-adjacent to a trap, item or fixture; removing it keeps every open tile reachable and `stairs` (basement: `exitFront`) reachable on the worst-case mask; lair outside the sand (rank −1 or > cap + 4·SLOPE); sentinel post within 3 path steps of the burial door; route 3–8 anchors, none in `stairsUp/stairsDown/burial`, all reachable.
  - rules (scripted states): no step before `wake` s of burning; a normal step at path 5 wakes it, a quiet step (idle ≥ 0.35 s) at path 3 does not; a torch-lit player in the cone at 10 tiles is spotted, at 12 not; behind it at 6 not while patrolling, yes while hunting; embers at 3 not, adjacent yes; swapping to a candle shrinks the range to 5.8; contact with light → hand lost, spare lit, stun 1.0, pushed to `prevPos`, guardian recoils 4 s; contact on embers → `caught`, `retry` → last camp; hunting over a block plate → `trapFired`, its tile solid, guardian pushed + `recoil`; 600 s of patrol never steps on an armed plate or trapdoor; a lit sconce within 1 of its path → `fixtureLeft −1`, `snuffed`; wading slows it ×1.8; a sand-blocked tile pushes it off; a dormant guardian blocks your move and wakes; follow: hunting at descend on floor 22 → floor 23 `arriving`, `guardianFollow` 3 s before it steps onto `start`, then `investigate` towards you; fall through a trapdoor → no follower; sand on `start` → `gone`; escape: stepping on the Scarab sets `taken`, not `escaped`; `limit = order.length`, `speed = 2.5`, quake if not started; sentinel rises 3 s then hunts; exit opens after 1.5 s and lights through line of sight; stepping into it → `escaped`; Maya basement still `escaped` at once; cut-off during the escape checks `exitFront`; replay 3000 random actions twice on floors 18/22/25 equal and matching `replay:17/21/24`; `hashState(full)` adds guardian (mode, pos, cooldown, timer, rng, target, touches) and escape (taken, t, open).
  - bot report: the deep bot (floors 11–25) now also counts touches and caught; in the basement after taking the Scarab it walks the BFS path to `exitFront` (an informed upper bound), avoiding the guardian's tile and its neighbours. Targets (warn): floors 18–24 caught ≤ 15 %, median touches ≤ 1, median time within [0.6, 1.6] × target; basement escape success ≥ 60 % and median escape within [0.5, 1.5] × `ESCAPE_TARGET`. Existing fails/warns unchanged.
  - timing (desktop, warn): `tickGuardian` average < 0.05 ms, worst < 1 ms on floor 24; `placeExit + placeGuardian` < 10 ms.
- Headless render (canvaskit-wasm harness in the scratchpad, as tasks 01–03): guardian poses, false door, scarab, shaft side view.
- Web preview (dev stepper to 18, 22, 25): dormant guardian reads as a statue in torchlight; wakes on a hint; patrols, puts out a sconce; sneaking past with slow taps; candle hides you; contact smothers the torch and a spare lights; on embers → caught panel; it trips a block plate while chasing; floor 21 → 22 follow with the caption; basement: the sentinel beside the door, taking the Scarab: quake, sand moves again, the sentinel rises as you pass, the pointer, the false door opens with daylight, escape overview climbs the shaft, artifact screen with "Out in m:ss"; a v3 save loads.
- Device (release `preview` APK, Redmi 9): floor 24 with the guardian hunting, the collapse running and 8 fixtures: 60 fps walking; basement escape with the sand at 2.5× and daylight: 60 fps.

## Performance budget (Redmi 9: Helio G80, Mali-G52, Hermes)

- Core: `tickGuardian` O(1) per frame except BFS: `dist` on each guardian step (≤ 4.5/s), `toTarget` on target change (hunting: ≤ 6.7/s, your steps) or grid change; each BFS ≤ 4600 tiles ≈ 0.2 ms → ≤ 2.5 ms/s. Sight: one `clearLine` per tick when in range. Noise: array lookups.
- Memory: `GuardianRun` 2 × Int32Array + 1 Uint8Array of size² ≈ 40 KB on floor 24.
- Render: one sprite ≈ 30 draw ops from cached paths, ghost 1 op, wisps ≤ 4, escape sprites ≤ 20 ops, pointer ≤ 24 motes; daylight one extra fixed light. Budget: +0.6 ms JS picture recording, no new layers or images.
- Generation: `placeExit` + `placeGuardian` ≤ 8 ms on device (a few BFS and articulation checks).

## Risks

- The guardian may feel toothless (speed 1.5–1.8× slower) or oppressive (follow, escape pulse); tune paces, wake, sight factor and `ESCAPE_SENSE` from the bot and playtests only.
- Hunting BFS per player step on 66-tile floors: if over budget, recompute `toTarget` at most every other step (the guardian moves slower than you anyway).
- Contact pushing into sand or a sealed port: the push falls back to any open neighbour; the check covers it.
- Without task 05's sound the guardian is warned only by the gutter, captions and placeholder haptics; web preview has no haptics. Task 05 must voice `guardianStep/Near/Follow` with stereo pan from `guardianCue`.
- The sentinel beside a single-door burial chamber: fairness rests on `SENTINEL_RISE 3 s`; the rule test walks out past it; tune if playtests find it cheap.
- The false door may sit very far from the Scarab on small seeds; the 0.45–0.85 band and the daylight keep it findable; bot escape median is the guard.
- Escape cap 60 % may lower (40 % rule) on some seeds; reported by the check like plan 03's lowered caps.
