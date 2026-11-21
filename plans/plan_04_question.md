# Plan 04 · Questions and decisions

Planner entries for `plan_04.md`. Each: options, picked answer, one-line reason. Implementation agents append below under `## Implementation decisions`.

## Q1. Who the guardian is
- A. A classic bandaged mummy (shambling, arms out). B. Anubis or another god. C. A fictional mummified priest-guardian (the Keeper): resin-dark linen, gilded cartonnage mask, tripartite striped wig, arms crossed while dormant.

**Picked: C.** Realistic and dignified (cartonnage masks and wrapping are real funerary craft), no caricature, no deity as a monster (README requirement 2).

## Q2. Depth at which it wakes
- A. From floor 11 with the collapse. B. From floor 20 ("guardian territory" in the doc). C. From floor 18: rules keep arriving one every few floors (collapse 11, full traps 15, guardian 18, follow 22).

**Picked: C.** Three floors of a roaming guardian before it starts following, and the doc's floor 20 sits inside its territory.

## Q3. One guardian or several per floor
- A. Several. B. One per floor (a follower replaces the floor's own).

**Picked: B.** One readable threat; cheaper AI and clearer sound cues for task 05.

## Q4. Speed
- A. As fast as the player. B. Slower (hunt 0.28 → 0.23 s/tile vs 0.15), patrol 0.65–0.55.

**Picked: B.** A fair chase on a phone: it catches you through surprise, dead ends, sand and stuns, never by raw speed.

## Q5. Escape route after taking the Scarab
- A. Back up the stairs through every floor. B. Back up to the basement's arrival stairs. C. A new exit on the basement floor: a false door that opens onto the workmen's escape shaft to the surface. D. A shaft right inside the burial chamber.

**Picked: C.** A is a 25-floor slog; B is impossible by design (the collapse fills the arrival stairwell); D has no escape gameplay. C is authentic (false doors are real tomb architecture; Khufu's "well shaft" is believed to be the workmen's way out after the plugs were lowered) and makes you cross the waking basement again.

## Q6. What taking the Scarab does
- A. Only opens the exit. B. Wakes the pyramid: the sand starts again (immediately if it had not), 2.5× faster and up to a larger cap (60 %); the sentinel rises; the false door opens 1.5 s later.

**Picked: B.** The doc's "collapse speeds up and the guardian appears", with real pressure even when the normal collapse had already settled.

## Q7. Where the false door goes
- A. Farthest tile from the Scarab. B. Random. C. Deterministic: a rock pocket on a wall face, never reached by the sand, reachable on the worst-case mask, at about 0.65 of the farthest candidate (band 0.45–0.85), dead-end rooms preferred.

**Picked: C.** Fair by construction, a real crossing of the floor, never an hour-long hunt.

## Q8. How the player finds the open door
- A. A map marker. B. The Scarab's power once (gold motes along the straight-line direction for 5 s), daylight from the shaft seen through line of sight, a caption.

**Picked: B.** Diegetic, teaches the Scarab's power ("briefly points the way"), keeps the dark.

## Q9. The sentinel in the basement
- A. A roaming guardian like floors 18–24. B. A dormant sentinel beside the burial chamber's door (like the guardian statues that flanked real sealed burial doors) that rises only when the Scarab is lifted, 3 s rise.

**Picked: B.** A memorable, fair climax: you pass it on the way in, and dash past it as it stirs on the way out.

## Q10. Lair placement
- A. Random tile. B. The back of a leaf chamber/shrine/storeroom off the main path, ≥ 0.4 of the stairs distance, outside the sand, removal keeps connectivity.

**Picked: B.** It reads as a tomb niche, never blocks the route, never gets buried while asleep.

## Q11. How it sees you
- A. Omniscient. B. Line of sight to your tile only when your tile is lit, range 2 × hand radius + 1 (torch 11, candle 5.8, embers adjacent), at least 9 in fixture light, a 60° forward cone while patrolling (all round while hunting), always within 2 tiles.

**Picked: B.** "Your torch lets it spot you" with real choices: swap to a candle, stay out of braziers, approach from behind. Integer tests stay exact.

## Q12. How it hears you
- A. Euclidean radius. B. Path distance along open tiles (sound travels down corridors) from a per-step BFS; radii: step 5, slow step 2, pickup/lighting 3, plate 7, sandfall 9, block/portcullis 16.

**Picked: B.** Physically right, deterministic, and gives a sneak mechanic (a step taken after ≥ 0.35 s still is quiet).

## Q13. What contact does
- A. Instant death. B. It smothers your hand light (the trap rule: a spare lights itself), you are stunned 1 s and pushed back, it recoils for 4 s; on embers it takes you (`caught`, back to the last camp).

**Picked: B.** Fits the no-cheap-death light economy: each contact costs a light source; only a lightless player is lost.

## Q14. Status for being taken
- A. Reuse `burntOut`. B. New `caught` with its own panel, same `retry`.

**Picked: B.** Plan 03's Q34 left the slot; a distinct panel explains what happened.

## Q15. Plates
- A. It never triggers them. B. Always. C. Its rounds avoid armed plates (it knows its tomb); when hunting it rushes over them; trapdoors never.

**Picked: C.** Realistic and tactical: lure it over a block or portcullis plate; a fallen block stuns it and seals the way; it never vanishes down a trapdoor.

## Q16. Fixtures
- A. No effect. B. It puts out non-eternal lit fixtures within one tile of its path (back to unlit, relightable); eternal camp and burial braziers stay.

**Picked: B.** A telltale of where it walked and a real threat to your fixed light, without permanent loss.

## Q17. Sand
**Picked:** it wades ×1.8 like you, cannot pass blocked sand, is pushed to an open neighbour when its tile fills; a follower whose landing is sand-blocked is sealed out (`gone`). One rule set for both bodies; the collapse can save you from a follower.

## Q18. Memory
- A. Nothing. B. A silhouette where you last saw it, fading with the memory clock; the live guardian is drawn only on lit tiles.

**Picked: B.** You remember what you saw (plan 03 Q17's principle) and memory never leaks its live position.

## Q19. Following down the stairs
- A. Always from a set floor. B. From floor 22, only a guardian that is hunting/investigating/listening when you descend; it arrives after a gap from its path distance to the stairs (5–25 s, burning time), with a footsteps event 3 s before; it then tracks you once; never through a trapdoor, never into the basement.

**Picked: B.** "Late on, it follows you" with cause and warning; the trapdoor gains a second reward.

## Q20. Determinism of the AI
- A. `createRng` closures. B. A mulberry32 state stored in `GuardianRun.rng` (`nextRandom`), BFS ties in `DIRS` order, time only from `tick`.

**Picked: B.** Replays and hashes can include the AI state; same actions → same guardian.

## Q21. Data placement
**Picked:** guardian rows and `escapeCap` live in `egypt.ts` rows (reached through new `ArchProfile.guardian?`, `escapeCap?`, `falseDoor`); generic/black set them off explicitly. One table for all tuning, the other pyramids unchanged until 07–09.

## Q22. Noise plumbing
- A. `traps.ts` imports `guardian.ts`. B. A `noise(s, at, r)` queue in `runtime.ts`, consumed by `tickGuardian`.

**Picked: B.** No import cycle (plan 01 I1's TDZ lesson); one tick of latency (≤ 16 ms) is inaudible.

## Q23. Events for sound and haptics (task 05)
- A. Per-frame derived values only. B. Events gain `at` (tile) and new guardian/escape types, `EVENT_LOG` 16, plus `guardianCue(s)` (offset, path distance, visibility, mode) for continuous stereo.

**Picked: B.** Footsteps are discrete sounds (events), proximity is continuous (cue); both deterministic.

## Q24. Warning before task 05 exists
- A. Nothing. B. Placeholder haptics on the existing event loop, captions for follow/touch, and a render-only flame gutter when it is within 8 path steps unseen.

**Picked: B.** Playable now; the gutter (a cold draught) is a realistic visual cue that stays after task 05.

## Q25. Escape win condition
**Picked:** step into the open false door → `escaped`; the screen waits 0.3 s, shows the side view climbing the shaft to daylight (overview kind `'escape'`), then the artifact screen; `takeArtifact` is written when the overview ends. Basements without an exit (other pyramids for now) keep today's instant win.

## Q26. Records
- A. Nothing until task 05. B. Progress v4 `records[id] = { escapes, bestEscape (s from the Scarab to the door), untouched }`, shown as one line on the artifact screen.

**Picked: B.** The task asks to update records; task 05 builds stars on the same data.

## Q27. Run clocks
**Picked:** `s.floorTime` (burning seconds per floor) and `s.escape.t`; no whole-descent clock (retries from camps make it ambiguous). Task 05 decides star timing from these.

## Q28. Sprite style
- A. Pixel sprite now. B. Tidy layered vector art (linen bands, gilded mask, poses) behind `drawGuardian`, swapped in task 12.

**Picked: B.** Consistent with tasks 01–03 and Q0; no placeholder box.

## Q29. Guardian visibility
**Picked:** drawn inside the masked layer after the sand (seen only in light, standing in sand) and only when its tile is lit now. It carries no light and has no glowing eyes (realism over horror cliché).

## Q30. False door art
**Picked:** baked into the floor art on the door's wall face (stepped jambs, cavetto cornice, torus roll, central slab, faint ochre paint, abstract strokes, no real inscription); the opening is a per-frame sprite (slab sinks 1.5 s, dust, shaft mouth, cool draught haze).

## Q31. Daylight from the shaft
- A. Render-only glow. B. A real fixed light (radius 2.5) in core once open, seen through line of sight.

**Picked: B.** It must guide you through the mask, and core light stays the single truth.

## Q32. The Golden Scarab on the board
**Picked:** replace the diamond placeholder with a gold scarab on an alabaster plinth; empty plinth after taking; a glint in your hand while carried; a scarab glyph on the light strip.

## Q33. Side-view escape
**Picked:** a narrow shaft from the basement chamber at 26° (the real descending passages' angle) to a mouth on the ground outside the base, daylight glow, marker climbs it. Tasks 13/15 redo the art.

## Q34. Leaving or failing mid-escape
**Picked:** as any run: leaving, burning out, being buried or caught returns you to camp 25 (the basement start) with the Scarab back on its plinth. No special save state; camps stay the only checkpoint.

## Implementation decisions

Entries by the implementation agent (task 04), against the real code of tasks 01-03.

### I1. The escape sand cannot be a longer cut of the same order
- A. As planned: `sandOrder(layout, {..., cap: escapeCap})` with the same 40 % keep rule. On the basement this gives the same order as the plain collapse: the order is a BFS from the arrival stairwell, the burial chamber is the farthest room, and as soon as the sand reaches its door the stairs' side keeps far less than 40 %, so the rule always lowers the cap back (fixed seed: cap 115, escape order 145 = capLen).
- B. A weaker keep rule (25 %): same result, the burial door still ends the order.
- C. Keep the tiles between the artifact and the false door out of the sand by construction. `placeExit` runs on the plain order, picks the door, and computes `protect` = one shortest way artifact -> exitFront on the worst-case mask (static + plain sand + traps + ports); `extendSandOrder` then runs the BFS to `escapeCap` (60 %) skipping `protect`. The first `capLen` entries stay identical to the plain order (checked at generation, else the plain order stays). `Collapse.protect` is also honoured by `rebuildRank` (a block that falls later may not re-rank the route into the sand).

**Picked: C.** It is the only way the sand can really cover more of the floor, and the exit is reachable by construction instead of by a statistical keep rule. Fixed seed: capLen 145, escape order 610 of about 930 open tiles. The `egypt:24:feat` hash changes because of it (deliberate, as the plan said); every other `egypt:*`, `maya/cambodia/china/black:*` key is unchanged. The checks assert: `capLen <= order.length`, the 40 % rule on the first `capLen` entries, `protect` never in the order, and artifact -> exitFront reachable with the whole order and all trap tiles solid.

### I2. `ESCAPE_TARGET` is 30 s, not 60 s
The bot walks 0.3 s per tile (a hesitant player; a hurried one needs 0.15 s) and the false door sits at 0.65 of the farthest candidate (about 80-110 tiles on a 58-tile floor). The informed bot's median is 25 s; 60 s would need a 200-tile walk. The warn range 0.5-1.5 x target is kept, so 30 s means [15 s, 45 s]. A real player also has to find the door, so a human median is higher; tune from playtests, not from the bot.

### I3. Sentinel post fallbacks
On a handful of fuzz seeds the burial chamber is 3 tiles wide and the door's room offers no tile that is both off the main path and clear of the braziers' neighbours. Added two last tiers after the planned ones: any free tile within 3 steps of the door off the main path, then on it (still `fair`: connectivity, the way to the stairs and artifact -> exit on the worst-case mask). The check allows the sentinel to stand next to an eternal brazier (never on a fixture), and forbids it only next to traps and items. Fuzz seeds 1..100: every basement has a sentinel.

### I4. Who may wake or hear what
- The sentinel ignores noise and close sight while dormant (it must stay a statue until the Scarab is lifted); `noise()` is not queued while the guardian is `arriving` or `gone`.
- `recoilGuardian` lives in `runtime.ts` (target = the route waypoint farthest from you by Manhattan distance) so `traps.ts` can drive a guardian back without importing `guardian.ts`; `hitGuardian` in `traps.ts` pushes it to its previous tile (or any open neighbour) when a block or portcullis seals the tile it stands on.
- A guardian never steps on trapdoor tiles; armed plates only while hunting (or when the target is unreachable otherwise).
- `g.cooldown` is clamped at -0.1 and at most 3 steps happen per tick, so a long `dt` (the check scripts tick 1 s) cannot teleport it.
- The "felt before it is seen" `guardianNear` and the render-only flame gutter use `guardianCue`; the gutter modulates the flame and the light flicker (`handF`), never the lit set.

### I5. UI details
- The artifact screen gets this run's time through the route param `out` (the record keeps only the best), so the line reads "Out in m:ss · best m:ss".
- The Scarab glyph on the light strip sits just left of the bag (the strip's right end is the bag itself).
- `LIGHT_STYLE` is now `Record<LightKind | 'daylight', LightStyle>` (the plan's `LIGHT_STYLE.daylight`); `FloorTheme` gained `linen`, `linenDark`, `linenLight`, `mask`, `maskLight` (derived themes use the Egypt values).
- The side view's shaft starts at the chamber's east wall and rises at 26 degrees to a mouth on the ground right of the base; `FloorOverview` kind `escape` lasts 3.2 s (a floor change 2.4 s).
- The false door is baked on the south face of its rock tile; opening is a per-frame sprite (slab sinks, dust, then a shaft-mouth sprite over the whole tile and a daylight glow).

### I6. Checks
- `scripts/check-guardian.ts` runs inside `npm run check:floors`: placement and fairness on the fixed seeds and the 100 fuzz seeds, then the rule tests on scripted states (a straight corridor is carved along row 1 of the run's own grid copy so distances and cones are exact), plus timing. Snapshot keys added: `egypt:17..24:g`, `replay:17/21/24`; changed on purpose: `egypt:24:feat`, `replay:23` (guardian on floor 24); nothing else moved.
- The deep bot walks to the false door after the Scarab (informed), keeps off the guardian's tile and neighbours, and reports caught %, median touches and escape success and time. `BOT_NAIVE=1` lets it walk through the guardian: touches median 1-2 and caught 0-5 % on floors 18-24, so the guardian is a threat but not a wall. The default run: caught 0 %, touches 0-1, escape 65 % at 25 s.
- `tickGuardian` costs 0.02 ms on average on floor 24 (BFS per guardian step); `addFeatures` of the basement with the false door and sentinel takes about 4 ms.

### Not verified
No device or browser run: the guardian and escape visuals were rendered headlessly to PNG (canvaskit-wasm harness in the scratchpad, not committed): guardian poses at 120 px per tile, the false door closed, opening and open, the Scarab on its plinth and the empty plinth, the side view with the shaft. Touch feel with the guardian, 60 fps on a Redmi 9, haptics (placeholders) and the full-screen flow (caught panel, escape overview to artifact screen) are unverified.
