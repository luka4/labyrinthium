# Plan 06 · questions and decisions

Planner entries for `plan_06.md`. Each: options, picked answer, one-line reason. Implementation agents append below under `## Implementation decisions`.

## Q1. How a power is used
- A. Passive while owned. B. Cooldown only (use every N s). C. Charges per floor. D. Charges per camp leg (refill at every camp, at the top and on a retry), carried down between camps, each use active for a few seconds.

**Picked: D.** Makes the powers a resource to plan (save the Jade for the guardian floor), mirrors the light economy players already know (camps relight), and stays short on 5-floor pyramids.

## Q2. Are powers core state
- A. UI-side effects. B. Core: `Action { type: 'power', power }` through `step()`, timers through `tick`, owned powers passed in by `StartOptions.powers`.

**Picked: B.** Replays, ghosts and server checks need them (CLAUDE.md rule); core never reads progress.

## Q3. "Best in another pyramid": natural synergy or explicit bonus
- A. Only natural (the other pyramid's rules make it strong). B. Explicit per-pyramid numbers. C. Both: an "attuned" pyramid id per power with more uses and a longer effect there, on top of the synergy.

**Picked: C.** The design doc's promise must be legible in the UI ("Strongest in Cambodia: 3 uses, 8 s") and testable now, before 07–09 exist; synergy makes it feel earned.

## Q4. The numbers
**Picked:** Scarab 2 uses × 5 s, 12 tiles of the way (Cambodia 3 × 8 s, the whole way); Mirror 2 × 8 s, radius × 1.6 capped at 9.5 tiles (China 3 × 12 s, × 1.8); Naga 2 × 10 s (Maya 3 × 16 s); Jade 1 × 4 s (Egypt 2 × 6 s); 0.5 s between any two uses. Reason: each is a decisive moment, not a mode; Jade is the strongest, so it has the fewest uses. One table to tune after playtests.

## Q5. What the Scarab shows
- A. A straight-line direction (as the escape pointer). B. The real way: motes along the shortest path on the run's current mask, a limited number of tiles ahead.

**Picked: B.** In a maze a straight line lies; the run's mask means it adapts to closed portcullises now and to Cambodia's growing roots later (why it is strongest there). The basement escape keeps its free straight-line pointer (story beat of plan 04).

## Q6. What the Mirror does
- A. A directed beam down the facing corridor. B. A wider, softer pool of hand light; guardians see you from farther too.

**Picked: B.** "Wide light" in the design doc; it reuses the deterministic light model (radius quantised, exact squares) and gives China's statues-that-move-in-darkness its counter; the visibility cost keeps it a choice in Egypt.

## Q7. What the Jade Seal freezes
- A. Only the guardian. B. Guardians and hunters, pressure plates and trapdoors (pressed timers pause), the collapse sand and sandfalls, and any plug-in that declares itself frozen; never your own light, the secrets' breaking or the false door.

**Picked: B.** "Guardians and mechanisms" in the doc; the false door is your way out and freezing it would punish the use. Noises made during a freeze are not heard afterwards (a frozen guardian perceives nothing).

## Q8. Power active across a floor change
- A. Carries on. B. Ends on every floor change; uses carry, refill at camps.

**Picked: B.** No cross-floor timers in core; simpler replays.

## Q9. How water fits the floor model
- A. New TILE kinds (WATER, DEEP). B. A per-tile level layer (0..255) like the sand, static on the floor (`Floor.water`) and copied per run (`s.water`), never part of `solid`/`opaque`.

**Picked: B.** 08's water levels change over time, which tile kinds cannot express without rewriting masks and hashes; a layer keeps every Egypt hash and every generation invariant, and the sand layer already proves the pattern.

## Q10. Water bands and their rules
**Picked:** shallow (≥ 32): wade at 1.4 × cadence, louder steps; deep (≥ 128): swim at 2.0 ×, breath drains 1 s/s from 8 s, no pickups; flooded to the ceiling (≥ 224): impassable without the Naga, with it passable at 1.4 × and no drain (2 s/s if it expires inside). Breath 0 → `drowned`, retry from the last camp. Reason: three readable states, realistic (you cannot carry a flame under water without help), and fair (see Q11).

## Q11. Fairness of water floors
- A. Free for 07/08. B. Every floor clearable with no power: a route start → stairs below flooded with no deep stretch longer than 12 tiles (half the breath); start, stairs, items, fixtures, traps, secret fronts, lairs dry. `waterFairness(floor)` is the shared check.

**Picked: B.** Floors are the same for every player; powers are advantages, never keys. The Black Pyramid's power-gated zones (later) are the deliberate exception and will be designed there.

## Q12. Water art in this task
- A. Wait for the shaders (task 10). B. Tidy vector water now (band fills, wet edge, ripple strokes, torch reflection), drawn per frame from the run layer.

**Picked: B.** The sandbox and 07 need to see it; cheap (≤ 3 fills + 40 strokes); task 10 swaps in a shader.

## Q13. Light in water
**Picked:** deep water: your flame is held above the water, unchanged; flooded with the Naga: radius × 0.6 (murk). Fixtures and items are never placed in deep water; rising water (08) smothers fixtures at ≥ 32 and sinks items at ≥ 128 (`setWater`). Reason: plausible and deterministic.

## Q14. Egypt's systems as plug-ins
- A. Refactor traps, collapse, guardian, escape and secrets into plug-ins now. B. Keep them built-in (already table-driven through the profile) and run plug-ins after them.

**Picked: B.** A refactor risks every committed hash and replay key for no player gain; 07–09 can still reuse the built-in guardian engine through `profile.guardian` rows.

## Q15. Plug-in typing
- A. `Record<string, unknown>` and casts. B. Interfaces augmented by each plug-in file (`FloorExt`, `RunExt`, `RuleRows`, `PluginEvents`).

**Picked: B.** Strict TypeScript without touching shared files when a culture adds state or events.

## Q16. Plug-in order and randomness
**Picked:** placement after `placeSecrets`, in the profile's `rules` order, each with its own stream `seed ^ fnv32(id)`; ticks after the built-in ticks; plug-ins never change tiles or masks at generation (architecture changes belong in layout `hooks` and `ROOM_CARVERS`). Reason: the rng-stream-per-stage rule, and nothing earlier can shift.

## Q17. Noises for hunters without the guardian
**Picked:** `noise()` also queues when a plug-in on the floor `listens`; plug-ins get the queue as it was at tick start, `game.ts` clears it at the end of the tick. Egypt unchanged. Reason: the jaguar hunts by sound (07) and the built-in guardian still consumes its queue as before.

## Q18. Hunter interface
- A. One base class all hunters extend. B. A contract: `cues()` for sound/heartbeat/HUD, `blocks()` for statues, `tick(frozen)`, `carry()` for following downstairs, light read through `handRadius`/`sightRange`, contact through `loseHand`/`caught`; `hunterCues(s)` merges the Egypt guardian and plug-in hunters; `GuardianRow.kind` selects the look.

**Picked: B.** The three hunters differ too much (a sound hunter, many statues, soldiers that move in darkness) for one class; a small contract keeps sound, Jade and Mirror working on all of them.

## Q19. Per-pyramid floor tables
**Picked:** `PyramidTable` (`rows: FloorRow[]`, camps, secrets, fragment floors) where `FloorRow` = today's `EgyptRow` + `rules` parameters; `profileFromTable` builds a profile from it; Egypt gets `EGYPT_TABLE` (rows untouched) and the check proves the helper rebuilds Egypt bit-identically. Reason: 07–09 copy one proven shape.

## Q20. Profile registry
**Picked:** `ArchProfileId = string`, a map built from a static list (`cultures/index.ts` adds culture profiles), `registerProfile` for checks, `profileFor` throws on unknown ids. Reason: adding a culture touches no Egypt file and no union type.

## Q21. Presentation side (palettes, beds, story, hints, sounds, drawing)
**Picked:** a kit registry `src/kits/<id>.ts` (theme, bed, story, hints, captions, feedback, hunter drawers, draw hooks); Egypt's kit wraps the existing modules; the other pyramids use a generic kit until 07–09. `HintId` becomes a string (culture hints namespaced). Reason: one place per culture; core stays UI-free.

## Q22. Map form
- A. Today's abstract layout. B. A flat world map (pan sideways). C. An orthographic globe with true coastlines, drag to turn, plus a card pager.

**Picked: C.** The sites span 200° of longitude in a 13–34° N band, which a portrait flat map shows as a thin strip; a globe shows true geography at full size, reads as a polished commercial game, and the turn between sites is itself the transition.

## Q23. Globe rendering
- A. Skia shader sampling a land texture. B. Vector coastlines projected with d3-geo (orthographic, circle clipping) on the JS thread, the picture owned by the component (like `Board`), redrawn only while it moves.

**Picked: B.** Crisp coastlines at any size, robust clipping, ≈ 110 KB of deps, no texture pipeline; the final art (task 14) can add relief or a shader layer on top.

## Q24. Coastline data
**Picked:** `world-atlas@2.0.2` `land-110m.json` (Natural Earth, public domain) via `topojson-client@3.1.0`, converted once on first map mount. Reason: standard, tiny, enough detail at globe size.

## Q25. Which real places
**Picked:** Egypt at Giza (29.979 N, 31.134 E); Maya in the Petén lowlands (17.222 N, 89.624 W, the Tikal area, labelled by region since the pyramid is not a copy of one temple); Koh Ker, Cambodia (13.785 N, 104.537 E, Prasat Thom); China near Xi'an (34.381 N, 109.254 E, the Lintong imperial mausoleum area). Reason: the real sites the README names, true coordinates.

## Q26. Where the Black Pyramid sits
- A. The spherical centre of the four (≈ 52 N, 79 E: inland Kazakhstan, a real inhabited region). B. Mid-Atlantic. C. An uncharted island in the open Indian Ocean (9.5 S, 83.0 E), ≥ 5° from any coast, hidden in haze while sealed.

**Picked: C.** Fictional ground for a fictional pyramid, close to three of the four sites (smaller sum of distances than the Atlantic), water fits the Drowned City beneath it, and no real place is claimed.

## Q27. Selecting a pyramid
**Picked:** a horizontal pager of five cards under the globe (west → east: Maya, Egypt, Cambodia, China; the Black Pyramid last), two-way linked with the globe (swipe cards, drag/tap the globe; a coast that ends near a site snaps to it); the last focus is remembered. Reason: thumb-friendly, accessible (cards are buttons), and the geographic order makes every turn short.

## Q28. Labels on the globe
- A. RN text labels following the markers. B. No text on the globe; markers only, text on the cards.

**Picked: B.** Labels moving every frame would mean RN layout per frame (or UI-thread projection out of sync with the JS-drawn globe); cards carry the text.

## Q29. Seal door
**Picked:** a black basalt door with four sockets cut to each artifact's shape (oval, disc, fanned hood, square) in `SEALS` order; filled sockets hold the emblem; the opening lights them left to right and sinks the slab. Shown on the Black card and the Black pyramid page; the globe shows gold great-circle arcs from each collected site. Reason: each artifact visibly belongs in its place; no invented inscriptions.

## Q30. Seal-fill and opening animation timing
**Picked:** 400 ms hold on the pyramid, 1600 ms spark along the arc with the globe following, socket fill 600 ms; door 1800 ms after a 300 ms pause; reduced motion: final state at once. Reason: the existing beats, retimed for the arc.

## Q31. Pyramid page and artifact screen
**Picked:** the artifact card shows the power with this pyramid's numbers and its attuned pyramid; a "Powers you carry" card lists owned powers with "Strongest here"; the artifact screen gets a one-time "New power" block. Reason: the player must know what each power does before choosing the next pyramid.

## Q32. Where the power bar goes
- A. In the light strip (no room: medallion + text + bag). B. Floating over the board corners. C. A bar under the board, drawn in the same canvas, RN Pressables over it.

**Picked: C.** Thumb reach on a portrait phone, the one-canvas rule, no cover over the play area; the Redmi 9 keeps its 361 dp board (≈ 350 dp free below it).

## Q33. Show powers not yet owned
**Picked:** empty dark sockets for the missing ones (the bar appears once one power is owned). Reason: shows the set to collect, like the seal door.

## Q34. Input for powers
**Picked:** tap a socket; web keys 1–4. Reason: one tap, no gesture conflict with the board's swipes.

## Q35. Showing a freeze
**Picked:** jade vignette + light desaturation, the guardian tinted, every mechanism animation (sand, trap dust, guardian sway) on a `mechTime` that stops while frozen. Reason: you see that time is held for them and not for you.

## Q36. Sounds for powers and water
**Picked:** new synthesised ids in two lazily loaded groups (`powers`, `water`), modelled with the existing kit (modal chimes, granular splashes, bubbles); jade ducks and low-passes the world bus while active; the decoded-audio cap becomes 32 MB base + 4 MB for these groups. Reason: the 32 MB base cap was already at 31.4 MB; separate groups load only when needed.

## Q37. Progress for pyramids that 07–09 rebuild
- A. Bump `PROGRESS_VERSION` in each task with a hand-written migration. B. A data revision per pyramid (`PyramidInfo.rev`) stored in `progress.revs`, reconciled on every load: a changed revision clears only that pyramid's camp, deepest floor and floor records, keeps its artifact, records and completions.

**Picked: B.** Floors of a rebuilt pyramid are different floors (stars and camps would point at nothing), but an artifact earned stays earned; no migration code in later tasks.

## Q38. Progress v6 contents
**Picked:** `revs` (all current on migration, so no existing save is cleared) and `focus` (the map card); power uses are not saved (a resume is always at a camp, where they refill). Reason: minimal and consistent with the camp rule.

## Q39. Testing water before 07/08
**Picked:** a deterministic `waterSandbox(floor)` (shallow, deep and a flooded side room on Egypt floor 3) for checks and a dev-only sandbox run with all four powers, plus a test plug-in in `check-plugins` that floods side-room doorways on 25 floors and 30 fuzz seeds. Reason: the Naga and the water rules are exercised end to end now, and 07/08 inherit a proven contract.

## Q40. Egypt hashes
**Picked:** no snapshot or replay key may change; powers, water and plug-in state enter `hashState` only when present, the inactive code paths are branches (not multiplications by 1), the noise gating is unchanged without plug-ins. Reason: the brief and the CLAUDE.md rule; any change is a bug to fix.

## Q41. Powers and stars
**Picked:** powers are allowed in replays and descents, and par stays power-free. Reason: stars are personal goals; forbidding powers would make the artifacts feel like a penalty.

## Q42. Black Pyramid
**Picked:** unchanged floors (5 generic); every run there carries all four powers with base numbers; its power-gated zones are left to the task that builds it. Reason: task scope; the powers and water contract are ready for it.

## Q43 (orchestrator). Checks agents cannot run here

The plan needs a Redmi 9 release APK for the globe frame rate and floor 24 with the Mirror, and someone to listen to the new `powers` and `water` sounds. Agents have no device and cannot listen; ffmpeg is installed, so `npm run sounds` runs.

- A. Block the task until the user tests.
- B. Implement everything; verify with tsc, expo-doctor, the check scripts, android and web exports and a web preview; add the device checks and the listening to PROCESS.md's "Checks only the user can do".

**Picked: B.** It keeps the roadmap moving and leaves the user only the checks that need a phone or ears.

## Implementation decisions

Written by the task 06 implementation agent. Each: the problem, the options, the pick.

### I1. The globe's land is drawn by our own projector, not by d3-geo's `geoPath`
d3-geo's clipping and resampling cost 8 ms per frame on a desktop for the 5100 land vertices (the plan estimated 2-3 ms), i.e. 40+ ms on a Redmi 9. Options: (A) keep d3 and cache by quantised centre; (B) thin the data (still 4-5 ms); (C) a texture shader (rejected by Q23); (D) project the rings ourselves. **Picked D**: `src/game/world/projectLand.ts` flattens the rings to unit vectors once, projects them per frame (2 ms on a desktop, one SVG path string, one JSI call), cuts rings at the horizon and joins exits to entries with a Weiler-Atherton rule (the next entry clockwise on the limb, counter-clockwise for lake rings), skips rings behind the globe and specks under 0.6 degrees. `check-world.ts` compares it with `geoContains` on 19 views (worst mismatch 0.85 %, all from antimeridian slivers and the thinning of specks). d3-geo is still used for `geoInterpolate`, `geoDistance`, `geoContains`; the graticule is built by our own sampler. Unmeasured on a phone (PROCESS.md).

### I2. Kits are split in two (data and drawing)
The plan's single `PyramidKit` mixes data and Skia drawers; `scripts/check-audio.ts` runs the director in plain node, so importing the Skia drawers there would break it. **Picked**: `PyramidKit` (bed, story, hints, caption, feedback) in `src/kits/index.ts`, `RenderKit` (theme, hunters by `GuardianRow.kind`, draw hooks) in `src/kits/render.ts`; `kitFor` accepts any string. `storyOf` moved to `src/kits` (story.ts keeps only the data; a cycle otherwise). `BEDS` moved to `src/kits/beds.ts` and is re-exported by `audio/ambience.ts`.

### I3. `splash` is a touch only
The footsteps in water already play `water.wade` / `water.swim` (director surface choice); a `splash` sound on top doubled every entry. **Picked**: `splash` has the `stepSand` haptic only; `dive`, `surface`, `flooded`, `breathLow`, `drowned` have sounds as planned.

### I4. The Mirror's lit-count check is made in open space
The plan measured "floor 10's start", but the arrival stairwell is walled in (13 lit tiles with or without the Mirror). **Picked**: the check scans the floor for the open tile where radius 8 gains most over radius 5 (1.875 x on floor 10) and asserts >= 1.8x on `lightHand` there (not `light`, which also holds the previous position's fixed light).

### I5. `water.ts` does not import `powers.ts`
`powers.ts` needs the water levels (the murk) and `water.ts` needs "is the Naga active": a value cycle. **Picked**: `water.ts` inlines the Naga test; `powers.ts` imports `water.ts`.

### I6. `waterSandbox` floods 3 tiles, not a corridor
The sandbox floods the doorway of the deepest leaf room off the path plus up to 2 passage tiles before it (3 tiles on floor 3); the plan's "door tile and up to 2 passage tiles" is exactly that, but the passage tiles that lie on the main path are skipped, so some floors flood only the door.

### I7. Power keys are the sockets in order
Web keys 1-4 call `step({ type: 'power', power: POWER_ORDER[k] })`; a power you do not own is ignored by core, so the keys never shift when you own fewer than four.

### I8. A frozen guardian stays a bump in every mode
`move` bumps a guardian on `next` when it is dormant or waking, or when the Jade is active and it is awake (`patrol`, `hunt`, ...); a `gone` or `arriving` guardian is never on the floor. Noise from the bump is made only when not frozen.

### I9. `setBusFilter` on the audio engine
The Jade's "world bus 10 dB down with a 1.2 kHz low-pass" needs a per-bus filter the engine did not have. **Picked**: `AudioEngine.setBusFilter(bus, hz, ramp)` (a biquad low-pass between a bus's level and duck nodes in the audio-api engine; a no-op in the expo-audio fallback and the silent engine). The director holds the jade state and applies level and filter together with the overlay fade (`applyWorld`).

### I10. Progress merge runs on every hydration
`persist.merge` calls `reconcileRevisions` on the stored data after `migrate`, so a revision bump clears only that pyramid's camp, deepest floor and floor records; `revs` are stamped on first sight. `ownedPowers` lives in `migrateProgress.ts` (pure, so `check-progress.ts` can import it without AsyncStorage).

### I11. Replay keys
The committed keys are `powers:4`, `powers:17`, `powers:24` (floors 5, 18, 25) and `powers:sandbox` (3000 random actions, a power use about one action in ten, all four powers). Every existing snapshot key is unchanged (checked by `git diff` of `floors.snapshot.json`: only additions).

### I12. The map's animation timeline
Hold 400 ms, spark 1600 ms (the globe centre follows the arc through the `follow` prop, the pager scrolls to the Black card), socket 600 ms, 300 ms pause, door 1800 ms; the Black card's door is the same `drawSealDoor` as the pyramid page's. With reduced motion the final state shows at once with one `uiSound.seal()`. The globe redraws only while turning, coasting or animating, else 15 fps for the pulse (0 with reduced motion).

### I13. Hidden checks
`check-plugins.ts` registers `egypt-t`, `egypt-p`, `egypt-bad` and test plug-ins `test.pools`, `test.probe` globally for the checking process; nothing of them is in the game. The probe's `frozen` count is asserted at 59-61 ticks (float error of 0.1 s steps over 6 s).
