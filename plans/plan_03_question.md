# Plan 03 · Questions and decisions

## Q0 (orchestrator). Where does phase 2's "real art" go?

The roadmap lists "real art" in phase 2 (Egypt complete) and a full code-made-art phase 4.

- A. Build Egypt's final art in phase 2, then build the art system again for the others in phase 4.
- B. Keep phase 2 to mechanics with tidy draw code; deliver real art for every pyramid in phase 4 through one shared system (shaders, sprites, ornaments, lighting).

**Picked: B.** One art system applied to all five pyramids gives a consistent professional look and avoids redoing Egypt. Phase 2 tasks keep the draw code structured (per-pyramid palette/theme hooks) so phase 4 can drop in.

Planner entries below (plan_03.md). Each: options, picked answer, one-line reason. Implementation agents append below.

## Q1. Size curve for floors 11–25
- A. Keep growing one site every floor (floor 25 ≈ 25 sites, ~126 tiles). B. Map the design doc's cell sizes literally. C. Time-targeted: play time grows with area (sites²), so pick sites per floor to hit 1.5 min (f10) → 2 min (f15) → 3 min (f20) → ~4 min (f24): 9,9,9,9,10,10,10,11,11,11,12,12,12,13, basement 12.

**Picked: C.** "Big but a few minutes each" needs area growth to slow down; rules (loops, less light, traps, collapse) carry the rest of the difficulty.

_Revised: rows unchanged, but floor 10 is no longer frozen (R1)._

## Q2. Basement size
- A. Largest floor (13+). B. 12 sites, smaller than floor 24.

**Picked: B.** The escape (task 04) roughly doubles the basement's play time; 12 keeps it near 4 min plus the escape.

## Q3. Grow room spans on deep floors
- A. Span [3,6] from floor 16. B. Keep [3,5]; more halls and galleries instead.

**Picked: B.** Bigger halls would make the torch reveal more (easier) and cost bake/light area; more hall/gallery quota gives variety without that.

## Q4. Camp placement for 25 floors
- A. Every 5 floors (5,10,15,20,25). B. Every 5 without the basement. C. Time-balanced: 5, 10, 14, 17, 20, 22, 24, 25.

**Picked: C.** With deep floors at 3–4 min, every-5 stretches would reach ~18 min before a checkpoint; C keeps each stretch ≈ 6–8 min (a mobile session) and keeps a checkpoint at the basement entrance for the escape.

## Q5. Camp data model
- A. Keep `campEvery` with exceptions. B. `Pyramid.camps: number[]` (0-based indices).

**Picked: B.** Explicit, tunable per pyramid, trivially checked; other pyramids use `[4]`.

## Q6. The 2048 px bake cap (plan 01 risk)
- A. Lower bake scale to fit (floor 24 → ~31 px/tile, blurry on a 2.75× screen). B. One big texture (~3200² px, ~40 MB, near max texture size). C. Chunked bake: 8×8-tile images with 2 px real-content padding, baked lazily around the camera, LRU of 20. D. Record vector `SkPicture`s per chunk and replay every frame. E. No bake, full runtime shader now.

**Picked: C.** Keeps full sharpness on any floor size with ≤ 12 MB and one blit per chunk; D costs thousands of path draws per frame on a Mali-G52, E is task 10/11's job.

_Superseded in part by R4/R5: chunks are rasterised from a recorded RTree picture, and the LRU is sized by bytes (≤ 16 MB, min 12)._

## Q7. Chunk size
- A. 16 tiles (768 px, 2.4 MB, ~20 ms bake). B. 8 tiles (384 px, 0.6 MB, ~5 ms bake).

**Picked: B.** A chunk bake fits inside one frame's spare budget; ≤ 9 visible blits are trivial.

## Q8. Light mask extent
- A. Whole floor (plan 01, 82² px at floor 10). B. View window (≤ 19×19 tiles).

**Picked: B.** Constant per-frame cost on 66-tile floors.

## Q9. Generating the floor chain up to 25
- A. Full generation of every floor above. B. Split: `layoutFor` (cheap, needed for arrival chains) and `floorFor` (lights, traps, sand order) for the played floor only; warm layouts on the pyramid screen.

**Picked: B.** Resuming at camp 24 stays under ~400 ms on a Redmi 9 and usually costs nothing.

_Superseded in part by R2/R3: the split is `generateLayout`/`addFeatures`; traps and sand are a post-light stage, not `profile.hooks`; the real reason for the split is the trapdoor/arrival dependency._

## Q10. When does the collapse start
- A. At arrival. B. A per-floor delay after the first move (when the torch starts burning).

**Picked: B.** Consistent with the torch rule; reading the floor or putting the phone down never costs sand.

## Q11. Spread model
- A. Per-tick cellular flood with random spreading. B. Precomputed BFS order from the stairwell, filled at a constant volume rate (tiles/s), with a slope of 3 tiles between the toe and the full-height front, capped per floor.

**Picked: B.** Physically right (a fixed pour races down corridors and crawls across halls), deterministic, O(1) per tick, and lets task 04 change the speed with one multiplier.

## Q12. What sand does to a tile
- A. Instantly blocks. B. Covered (wading, items buried, light passes) → blocked (solid and opaque) 3 tiles behind the toe.

**Picked: B.** Readable advancing front, a slope that looks like real sand, a moment to react.

## Q13. Sand reaching the player's tile
- A. Instant death. B. Your own tile never blocks while you stand on it (applied when you leave); you are lost only when cut off.

**Picked: B.** No unseen insta-kill; the danger is being cut off, which is what "lingering near the arrival is the worst choice" means.

## Q14. Cut off from every way down
- A. Let the torch burn out. B. Detect it (BFS on solid changes) and end immediately with status `buried`.

**Picked: B.** No pointless waiting; same retry flow as a burnt-out torch.

## Q15. Collapse on camp floors
- A. Exempt camp floors. B. Same rules; the camp landing is the source, so the camp brazier is eventually smothered.

**Picked: B.** One rule everywhere, and a resumed camp still pushes you on; flagged as a playtest risk.

## Q16. Collapse and light
- A. Sand never blocks light. B. Blocked sand is opaque, covered sand is not; dust haze is render-only.

**Picked: B.** A passage filled to the ceiling stops light; core stays exact, haze is decoration.

## Q17. Remembered tiles and sand
- A. Memory shows the live sand. B. Memory shows the sand level as last seen (`seenSand`).

**Picked: B.** You remember what you saw; a remembered open passage may be gone when you return, which is the collapse's tension, not an information leak.

## Q18. Items and fixtures under sand
- A. Stay. B. Items buried at level ≥ 0.35 (lost); fixtures smothered when their tile is covered (candles, braziers) or blocked (sconces); plates jammed.

**Picked: B.** Real consequence and a reason to take the oil near the arrival first.

## Q19. Which plate traps
- A. Darts from wall holes. B. Ceiling block. C. Granite portcullis. D. Sand release over tomb goods. E. Spiked pit. F. Rolling boulder. G. Flooding / gas.

**Picked: B, C, D (+ the trapdoor as its own mechanic).** Portcullis slabs and sand-filled shafts are real Egyptian tomb engineering (Khufu's antechamber, sand-lowered blocks in later shaft tombs), ceiling blocks are plausible plug-stone mechanics; darts, spikes, boulders and gas are Hollywood and clash with requirement 2.

_Revised by R6: portcullises sit on ports on loop cycles; antechamber doors are never eligible._

## Q20. What a trap costs you
- A. Death. B. Resource and route costs: block → hand light destroyed + 0.8 s stun; portcullis → route sealed; sand release → loot buried and wading.

**Picked: B.** Feeds the core light economy and route planning, no cheap deaths on a mobile run.

## Q21. Telltales and readability
- A. Invisible traps. B. Each kind has a constant visual sign visible in torchlight and in memory: granite plate among limestone, stone chips (block), slab hanging in the door grooves (portcullis), sand trickle (sand release), pivot pins and seams (trapdoor); one-time captions per save.

**Picked: B.** "Skill decides": a careful player always sees the sign before stepping.

## Q22. Fairness guarantee
- A. Random placement. B. Invariants: every tile reachable while avoiding all trap tiles, still true with every trap fired, none on the main path or near start/doors/items; enforced with articulation points.

**Picked: B.** A floor can never be ruined by a trap; the check script proves it on every seed.

## Q23. Trap reset
- A. Re-arm. B. One-shot; floors restart fresh on retry.

**Picked: B.** Deterministic, simple, matches real mechanisms.

## Q24. What "drops you a floor early" means
- A. Trapdoor on floor k drops you to k+1 before you found the stairs, skipping the rest of floor k's items. B. Drops you two floors (k → k+2).

**Picked: A.** A shortcut-vs-resources choice that fits the descent; B would skip camps and break the size curve.

## Q25. Trapdoor landing
- A. Fixed tile computed at generation. B. World point stored at generation (pre-filtered against the layout below), resolved at fall time to the nearest safe tile on the full floor below.

**Picked: B.** Avoids chaining feature generation across floors while keeping the landing deterministic and checked.

## Q26. Trapdoors before camps and the basement
- A. Allowed. B. Not on floors whose next floor is a camp or the basement.

**Picked: B.** The camp and the basement are reached through their stairwell (camp landing, burial approach).

## Q27. Collapse source after a fall
- A. The trapdoor hole. B. Always the stairwell.

**Picked: B.** The floor above caves in over the stairs regardless of how you arrived; landing elsewhere is part of the shortcut's reward.

## Q28. Auto-walk and traps
- A. Ignore traps. B. `runDir` stops before trap tiles and covered sand; `holdDir` never bends onto a trap.

**Picked: B.** A flick or a corridor bend must never trigger a trap the player did not choose.

_Implemented with `avoid` predicates (R8)._

## Q29. Wading
- A. No effect. B. Moving into covered sand costs 1.8× a step.

**Picked: B.** Sand reads physically and makes the slope zone matter.

## Q30. Teaching new traps
- A. Tutorial screens. B. One-time caption per kind (persisted in `progress.hints`) when first lit, using plan 02's caption line.

**Picked: B.** No modal UI; the caption names the telltale so the player learns to read it.

## Q31. Side view with 25 floors
- A. Show a zoomed window of tiers. B. Whole pyramid as fine courses (min 6 px), camp flames, fall animation.

**Picked: B.** A full pyramid of fine courses is realistic and shows progress at a glance; tasks 13/15 redo the art.

## Q32. Sand rendering
- A. Per-tile heap sprites. B. Sand pattern image shader masked by a per-tile level image (view window), wall-like south faces on blocked tiles, pour column and haze.

**Picked: B.** Smooth continuous sand at the cost of one layer; task 10's sand material shader drops in.

## Q33. Mechanic introduction order
- A. All at once from floor 11. B. Block 4, portcullis 6, trapdoor 7, sand release 8, collapse 11, full by 15.

**Picked: B.** One new rule every couple of floors; the doc's "pyramid's own rule in full" at 15.

## Q34. New statuses
- A. Reuse `burntOut` for every loss. B. Add `falling` (like `descending`) and `buried` (sealed in), both via `continue`/`retry`.

**Picked: B.** Distinct panels and overviews, same flows; task 04 can add `caught` the same way.

## Q35. Plates under sand
- A. Sand triggers them. B. Sand jams them.

**Picked: B.** No unseen trap firings far from the player.

## Q36. Saves
- A. No migration. B. Progress v3: camp index not in the new list → last valid camp; `deepest` clamped; adds `hints`.

**Picked: B.** Plan 01's camps (4, 9) stay valid, everything else is sanitised cheaply.

_Revised by R15._

## Q37. Sconces on big floors
- A. Keep the cap of 8. B. Cap 12 from floor 11 (floors 1–10 unchanged).

**Picked: B.** Landmarks scale with floor size without changing frozen floors.

_Implemented as `ArchProfile.sconceCap` (R10)._

## Revision after tasks 01–02

Plan 03 was re-checked against the merged code (`601f342`). These entries win over the ones above where they disagree.

### R1. Floors 1–10 "frozen"
- A. Keep floor 10 identical (impossible: it was the basement; a burial carver uses the rooms rng differently from a stairs room, so the whole floor shifts). B. Freeze floors 1–9 (snapshot `egypt:0..8`), regenerate floor 10 as a normal floor with its row values unchanged.
**Picked: B.** The only honest guarantee; floor 10 stays a camp, so prototype saves stay valid.

### R2. Where traps and the sand order run
- A. As `profile.hooks` (plan). B. A post-light generator stage in `addFeatures` (`placeLights` → `placeTraps` → `buildSandOrder`), own rng `seed ^ 0x2545f491`.
**Picked: B.** Real hooks run before the masks (plan 01 I4) and see no items, fixtures, `dist` or main path, all of which trap placement needs.

### R3. Layout/features split
- A. Split for cost (plan). B. Split because of the dependency: trapdoors on floor i need floor i+1's layout, whose arrival needs floor i's stairs. `Layout` = everything up to braziers, masks, `dist`, main path, spots; `Floor` adds lights, traps, collapse and stores `dist`.
**Picked: B.** Measured: the full 25-floor chain is ~46 ms on desktop; the split is needed for correctness and keeps the warm-up cheap anyway.

### R4. How chunks are drawn
- A. Rewrite the bake to visit only geometry per chunk (plan). B. Record today's bake once as an `SkPicture` with bounds (RN Skia 2.14 then uses an RTree), flush the big masonry/shadow paths per 8-row band, and rasterise each chunk by clipped playback.
**Picked: B.** Reuses the existing bake code unchanged in look, PAD content is real by construction (no seams), and RTree culling keeps a chunk's cost local.

### R5. Chunk cache size
- A. Fixed LRU of 20. B. By bytes: `max(12, floor(16 MB / chunkBytes))`, evicted images disposed 4 `ensure` calls later.
**Picked: B.** The board can reach 75 px/tile on tablets (1.5 MB per chunk); a byte budget keeps memory bounded on every screen, and delayed disposal matches the mask ring (a recorded frame may still draw the image).

### R6. Portcullis placement
- A. Prefer antechamber doors (plan). B. Any port tile (`links[].door`, DOOR or passage port) on a loop cycle, off the main path; plate on the approach side.
**Picked: B.** The antechamber is always the only way into the leaf stairs room, so its doors are articulation points and could never pass I1/I2; portcullises in passages are also authentic (Khafre's passages).

### R7. Trap count checks
- A. Every target on the fixed seed. B. Every target except portcullis, which must reach `min(target, eligible ports)`; fuzz seeds ≥ 50 % of the total target.
**Picked: B.** Portcullis supply is bounded by loops (1–5 on floors 6–10); the other kinds have plenty of candidates.

### R8. Dynamic masks in walk and vision
- A. Change every signature to take `GameState`. B. Structural `Grid = { size, solid, opaque }` (a `Floor` still fits), walk helpers get `avoid`/`interesting` predicates from the walker.
**Picked: B.** Smallest change, keeps `walk.ts` independent of `GameState` (plan 02 I10), and check-script calls with a `Floor` keep working.

### R9. Deeper loop ramp
- A. Change `profile.loops`. B. Optional `loopRate(i)`; Egypt uses the existing linear ramp (extracted as `linearLoopRate`) for floors 1–10 and table values (0.124 … 0.180, basement 0.15) from floor 11.
**Picked: B.** Floors 1–9 keep the exact same expression, so they stay bit-identical.

### R10. Sconce cap
`placeLights` has a literal cap of 8. **Picked:** `ArchProfile.sconceCap(i)` (Egypt 8 for floors 1–10, 12 from 11; generic/black 8).

### R11. Snapshots and safety net
- A. One hash including traps (plan). B. Keep today's `fnv` as the layout+lights hash (floors 1–9 must match), add `egypt:i:feat` for traps and collapse, and commit replay hashes for floors 1/5/9 before any change.
**Picked: B.** Proves "floors unchanged" exactly and gives the `Grid` refactor a real regression net (the existing replay check only compares two runs of the new code).

### R12. Bot
- A. Keep giving up at the first burn-out. B. Retry from the last camp (≤ 3 per floor), 20 seeds, avoids seen armed traps and covered sand.
**Picked: B.** Without retries the report never reaches floors 11–25.

### R13. Events and push-back
`GameEvent.kind` becomes `ItemKind | FixtureKind | TrapKind | null`; core gains `prevPos` (the render's `prevPos` in `Board` stays separate). **Picked:** both; the hit push-back needs a deterministic "where you came from".

### R14. Dev floor jump
**Picked:** a 1–25 stepper calling the existing `devReachCamp('egypt', n − 1)` and opening the Egypt page; eight camp buttons would not fit in one row.

### R15. Progress v3
Real v2 saves only hold camps 4 and 9 (still valid) and `deepest` never shrinks. **Picked:** keep v3 for `hints`; the sanitising stays because it is cheap and protects dev saves (the stepper can store non-camp floors).

### R16. Overview pre-bake budget
**Picked: 8 ms per frame** (plan: 10). The between-floors side view is animated on the JS thread (`useTicker`), so the bake must leave it frame time.

### R17. Hint captions
**Picked:** reuse the existing `caption` ref with `until = clock + 3` (no new UI); the plate hint first, the kind hint on the next sighting, so two captions never collide.

### R18. Hit with an empty bag
- A. Keep the torch. B. `loseHand` = the burn-out path: spare lit, else embers (6 s).
**Picked: B.** One shared code path (`lightSpare`), and a careful player sees the chips before stepping.

### R19. Fall timing on screen
**Picked:** the screen waits 0.25 s after `falling` before `continue`, so the tilt-and-drop sprite plays; core is unaffected.
