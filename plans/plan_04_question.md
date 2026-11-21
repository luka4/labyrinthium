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
