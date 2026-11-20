# Plan 01 · Questions and decisions

Each answer: picked option and a one-line reason. Implementation agents append below.

## Q1. Underlying representation of a floor
- A. Keep a tile grid (walkable/opaque per tile) plus room metadata; derive visuals.
- B. Vector polygons (rooms as polygons, free movement).
- C. Pure room graph, rendered as prefab art.

**Picked: A.** `step()`, vision, seeds, ghosts and multiplayer stay simple and exact; realism comes from how rooms are carved and drawn, not from the data type.

## Q2. Generation method
- A. Old cell backtracker, then decorate.
- B. BSP partition into rooms + corridors.
- C. Random room placement + corridor connect (TinyKeep style).
- D. Site lattice → spanning tree (+ loops) → merge sites into halls/galleries → per-kind room carvers.
- E. Hand-made prefabs stitched together.

**Picked: D.** Keeps the proven guarantees (single way down, farthest stairs, dead ends for items, loops by depth) while producing axial passages, varied rooms and thick walls; cheap and deterministic.

## Q3. Regular or warped lattice
- A. Fixed site size. B. Per-band random spans (rows = shuffled columns).

**Picked: B.** Breaks the visible rhythm and gives rooms of different sizes, while the floor stays square.

## Q4. Corridor width
- A. All 1 tile. B. Passages 1 tile; galleries 3 (walkway + ramps); halls full width.

**Picked: B.** Matches Egyptian interiors (narrow passages, Grand Gallery, hypostyle halls) and gives contrast.

## Q5. Wall thickness
- A. 1 tile everywhere (old maze). B. ≥ 1 tile, usually 2–4 tiles of rock between passages; walls drawn with faces.

**Picked: B.** Reads as masonry, not lines; falls out of the lattice (passages only on axes).

## Q6. Where do ports/doors sit
- A. Random position on the shared boundary. B. On band axes.

**Picked: B.** Straight long passages and axial rooms are how Egyptian builders worked, and it needs no doglegs.

## Q7. Floor size curve
- A. Relative curve over `floorCount` (old `floorCells`). B. Explicit per-profile table of sites per side.

**Picked: B, Egypt `[3,4,5,5,6,6,7,7,8,8]`, spans 3–5 (floor 10 ≈ 41 tiles).** Extending to 25 floors (task 03) appends entries without changing floors 1–10.

## Q8. Floor count and basement
- A. Floor 10 is the basement now. B. Keep 25 floors with only 10 playable.

**Picked: A.** The prototype journey stays complete (artifact, map, Black Pyramid); task 03 moves the basement to 25.

## Q9. Camps at 5 and 10
- A. Keep `index % campEvery` (camps at floors 6, 11). B. Camp when the 1-based floor number is divisible by `campEvery`; the basement can be a camp.

**Picked: B, Egypt `campEvery 5`.** Gives exactly floors 5 and 10 and carries to 15/20/25 later.

## Q10. Other pyramids during the prototype
- A. Give them 10 floors too. B. Keep 5 floors, `generic` profile (Egypt rules, own seeds), camp at floor 5.

**Picked: B.** Their architecture is tasks 07–09; the journey stays testable without extra tuning.

## Q11. Arrival position
- A. Always the floor centre. B. Under the previous floor's stairs (floors world-aligned, shared centre).

**Picked: B.** The stairs you take lead where you arrive, as in a real building; trapdoors (03) and the guardian following down (04) reuse the same mapping. Floor 1 starts at the centre.

## Q12. Stairs placement and "single way down"
- A. Farthest tile anywhere. B. Farthest leaf site by weighted tree distance, carved as a stairwell with one door, excluded from loops and merges.

**Picked: B.** Always a real search, and the stairwell reads as a room you enter.

## Q13. Loops
- A. Old 5 % ramp. B. None on floors 1–3, linear ramp to 12 % of candidate edges at floor 10, never touching arrival/stairs rooms.

**Picked: B.** Early floors teach, deep floors defeat wall-following.

## Q14. Merging without accidental loops
- A. Merge any rect. B. Merge only rects whose sites are connected by tree edges.

**Picked: B.** Contracting a connected subtree keeps a tree, so loop counts stay under control.

## Q15. Do pillars and furniture block light
- A. One `walls` mask for both. B. Separate `solid` (movement) and `opaque` (light): pillars both; benches, sarcophagus, up-stairs solid only.

**Picked: B.** Pillar shadows and lit furniture look real; later water, roots and statues need the same split.

## Q16. Item placement
- A. Random dead-end tiles. B. Typed `spots` (dead-end chamber backs, storerooms, niches, shrine niches) off the main path, spacing ≥ 6, one jar per 70 open tiles.

**Picked: B.** Detours stay meaningful, and task 02 places its light sources from the same spots.

## Q17. How rendering derives walls and rooms
- A. Per-tile rects every frame (current). B. Bake the static architecture once per floor into an image; per frame only a light mask and sprites. C. Full runtime shader now.

**Picked: B.** Lets the architecture have rich detail (faces, joints, AO, pillars) at almost no per-frame cost; the shader comes in task 11.

## Q18. View projection
- A. Pure top-down. B. 3/4 oblique: south-facing wall faces visible, others as caps with contact shadows.

**Picked: B.** Standard for polished top-down games; shows wall height and thickness clearly.

## Q19. Light mask quality
- A. Per tile, nearest. B. 2 px per tile, linear filtered, wall faces lit only from the facing open tile.

**Picked: B.** Soft light edges without revealing anything behind walls (walls ≥ 1 tile thick).

## Q20. Bake resolution
- A. 1× dp. B. `min(PixelRatio, 2)` × tile px, side capped at 2048.

**Picked: B.** Sharp on the Redmi 9's ~2.75× screen within texture and memory limits (≤ 16 MB).

## Q21. Camera
- A. Whole floor fits the board (old). B. Camera following the player, 15 tiles across, smoothed, clamped.

**Picked: B.** Tiles stay large enough (~24 px) to show architecture; whole-floor view would be ~9 px on floor 10.

## Q22. Extension points for later tasks
- A. Hard-code Egypt. B. `ArchProfile` per pyramid + `ROOM_CARVERS` registry + post-carve `hooks` with their own RNG streams + extendable `TILE` table with flag arrays.

**Picked: B.** Cultures (07–09, 13), traps (03), light sources (02) and the guardian (04) plug in without touching the base layout.

## Q23. RNG streams
- A. One stream. B. Separate layout, rooms, items and per-hook streams from the floor seed.

**Picked: B.** Tuning items or adding a hook does not reshuffle the architecture.

## Q24. Egypt room kinds
- A. Chambers and corridors only. B. Passage, chamber, pillared hall (hypostyle), gallery (Grand Gallery with ramps), magazines (storerooms), shrine (serdab niche), antechamber (portcullis grooves), stairwells, burial chamber (sarcophagus).

**Picked: B.** These are the real spaces of Old Kingdom pyramids and mortuary temples.

## Q25. Basement layout
- A. Artifact on the stairs tile in any room. B. Burial chamber in the farthest leaf, granite paving, sarcophagus, artifact on the axis in front of it.

**Picked: B.** The goal room looks like the place the artifact belongs.

## Q26. Floor 1 tutorial
- A. Same rules as others. B. 3×3 sites, no halls, galleries or loops; still has one side room with oil.

**Picked: B.** "One corridor and a turn" as the doc intends, now in architectural form.

## Q27. Board layout
- A. Full-bleed canvas now. B. Keep the square board; full-screen layout in task 14.

**Picked: B.** Keeps this task to generation and its rendering; the camera already makes it read as a place.

## Q28. Smooth player motion / hold-to-walk
- A. Now. B. Task 02.

**Picked: B.** Controls are task 02; only the camera is smoothed here.

## Q29. Can the player walk back up
- A. Yes. B. No, the up-stairs are solid scenery.

**Picked: B.** Descent-only matches the game; no extra state.

## Q30. Test tooling
- A. Jest. B. `tsx` devDependency running `scripts/check-floors.ts` with snapshot hashes and ASCII dumps.

**Picked: B.** Smallest dependency, runs the plain-TS core directly on Node 24, gives an agent visual feedback without a device.

## Q31. Old saves
- A. Ignore. B. Progress `version 2` migration: drop camps, clamp `deepest`.

**Picked: B.** Old camp indices point to floors that no longer match; keeping artifacts avoids losing real progress.

## Q32. Integer-only generator
- A. Allow floats. B. Integer math + mulberry32 only in generation.

**Picked: B.** Bit-identical floors across Hermes, V8 and a future server.

## Implementation decisions

Each: options and the pick.

### I1. Where `floorFor` lives
- A. In `floor.ts` (plan). B. In `generate.ts`, `floorSeed` moved into `floor.ts`.
**Picked: B.** `floor.ts` holds the types and flag tables that `generate.ts` imports at module load; importing `generate` back from `floor.ts` is a runtime cycle (TDZ on `TILE_SOLID`). `game.ts` re-exports `floorSeed`.

### I2. Stairs site and loops (check "stairs dist >= 0.6 x max dist")
- A. Pick the stairs site on the spanning tree before loops (plan). B. Also re-pick after loops as the farthest leaf of the final graph, ban tree leaves from halls/galleries, and accept a loop only if the farthest dead end stays within 80 % of the farthest site.
**Picked: B.** With A, loops and merged leaves made some middle-of-the-labyrinth tile much farther than the stairs (41 failures over seeds 1..300). B passes all 300 seeds x 10 floors. The pre-loop candidate (and its neighbours) is still excluded from merges and loops, so the final choice may be that candidate.

### I3. Niche eligibility
- A. "3x3 around the niche except the passage tile is ROCK" (plan; impossible for a straight passage, the two diagonal tiles are passage). B. The niche and the five tiles around it on the far side must be rock.
**Picked: B.**

### I4. Hooks run before the masks are derived
- A. After everything (plan step 12). B. After niches, before `solid`/`opaque`/BFS/spots/oil.
**Picked: B.** A hook that adds tiles (traps, water, plates) then gets correct masks and its spots/tiles are seen by oil placement; connectivity is verified by the same check script.

### I5. `Floor.loops`
Added the number of loop edges to `Floor` (the check script needs it; also useful for the debugging dump).

### I6. Stairs-up flight placement
Plan: on the side farthest from the ports. Pick: a side with no door if there is one, else any side; the two flight tiles never sit on a tile where a door enters the room (arrival rooms with 4 doors stay connected).

### I7. Burial artifact tile
The sarcophagus fills the two far tiles on the door's axis; the artifact (`stairs`) sits 3 tiles from the far wall on that axis (the open tile right inside the door in a 3-deep chamber).

### I8. Render details decided while baking
- Wall tops: only rock tiles with an open 4-neighbour get a cap (diagonal-only tiles stay dark rock); with 8-neighbours the caps made walls read as floor. Cap and face are pale limestone, paving is warmer and darker so walls and floors separate even in dim light.
- Light mask is built for the whole floor (86 x 86 px at floor 10) and drawn clipped by the board; no per-frame mask windowing.
- The mask ring keeps 4 images (not 2) before `dispose()`, because the recorded picture of the previous frame may still draw. The baked art is disposed when the next floor's art replaces it; nothing is disposed on unmount (the GC frees it; avoids a StrictMode double-effect disposing a live image).
- Camp brazier: drawn on the first open tile beside the arrival landing, inside the lit layer.
- Egypt hall paving is laid in 2x2 slabs, galleries in 1-tile slabs, granite rooms in 1.5-tile slabs, a running bond elsewhere; painted friezes (lapis + gold) on the wall faces of burial, antechamber, shrine and stairwell rooms.

### I9. Dev shortcut
"Egypt: camp at floor 5 / 10" buttons call `devReachCamp` (sets the camp and deepest floor) and open the Egypt page, where "Continue from camp" starts the floor.

### I10. tsconfig
`scripts/` is excluded from `tsc --noEmit` (it uses Node built-ins and runs through `tsx`).

### I11. Headless render check
`bakeFloor` and `drawGame` were rendered to PNG in Node with canvaskit-wasm behind the RN-Skia web bindings (throwaway harness, not committed) to look at the result; on-device look and speed are unverified.
