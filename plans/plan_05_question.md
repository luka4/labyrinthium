# Plan 05 · Questions and decisions

Planner entries for `plan_05.md`. Each: options, picked answer, one-line reason. Implementation agents append below under `## Implementation decisions`.

## Q1. What counts as a secret
- A. Treasure items in dead ends. B. Story text on existing walls. C. Hidden chambers behind a sealed doorway holding a grave good, eight of them also a painted story fragment.

**Picked: C.** The design doc's "hidden burial chambers hold treasure and story fragments"; one mechanic covers all three, and plastered doorways with stamped seal impressions are real Egyptian tomb practice.

## Q2. How a secret is opened
- A. Walk into it once. B. A hammer tool (not built yet). C. Push twice from the floor tile in front: the first push sounds hollow, the second breaks the plaster (0.6 s), each makes noise the guardian can hear.

**Picked: C.** Discoverable without tools, a small cost in time and noise, and no accidental openings from a single wall bump.

## Q3. Which wall faces get seals
- A. Any face. B. Only the south face of a rock tile (the wall north of the floor tile), the face the 3/4 view shows.

**Picked: B.** The telltale must be visible to be fair; the false door uses the same rule.

## Q4. How the chamber is stored
- A. Carve it into `floor.tiles` at generation. B. Keep it ROCK in the floor and open it only in the run's `grid`.

**Picked: B.** Every generation invariant, `dist`, the sand order, trapdoor landings and all committed hashes stay unchanged; the art bakes the carved version on demand.

## Q5. How many secrets per floor
- A. One everywhere. B. 1 on floors 1–6, 2 on 7–16, 3 on 17–24, 2 in the basement (50 in Egypt); at least one on every floor so every floor has a third star.

**Picked: B.** Grows with floor size (measured: 3–180 candidates on floors 3–25), keeps the early floors short.

## Q6. When a secret counts as found
- A. When the seal opens. B. When you take the grave good inside. Found secrets persist across runs.

**Picked: B.** You have to enter the chamber (a real detour); persistence makes the third star cumulative, so a burnt-out run still keeps what it found.

## Q7. Story fragments
- A. One per floor. B. Eight for Egypt (floors 3, 6, 9, 12, 15, 18, 21 and the basement), each on the floor's first secret; text in `src/game/story.ts`, shown in a panel that stops the clock; other pyramids get theirs in 07–09.

**Picked: B.** Enough to tell a thread (the builders' mark, the sleeper, the other who woke) without padding; fiction only, no real inscriptions or deities.

## Q8. What the three stars are
- A. A ladder (1, 2, 3 cumulative). B. Three independent stars: cleared, fast, every secret.

**Picked: B.** The doc lists three goals; fast and every secret pull in opposite directions, which gives separate reasons to replay.

## Q9. How par is set
- A. The row `target` (first-play design time). B. A fixed % of the bot's median. C. From the floor itself: `ceil5(2.0 × route steps × 0.15 s + 8 s (+10 s on guardian floors))`, route = start → stairs (basement: + artifact → false door) on the static mask.

**Picked: C.** Deterministic per floor, explainable ("walk the known way at half your top speed"), beatable by a player who has learned the floor, checked by an informed bot (must clear under 0.8 × par).

## Q10. Which clock counts
**Picked:** `s.floorTime` (burning seconds from the first move; pauses and overviews excluded); in the basement it runs until you step into the false door.

## Q11. Trapdoors and stars
- A. A fall counts as clearing. B. The floor left by a trapdoor is not cleared (its secrets still count); a floor entered by a fall can be cleared but not fast.

**Picked: B.** The trapdoor skips the search; a landing deep in the floor would make the fast star free.

## Q12. Are stars earned in the descent, in replays, or both
**Picked:** both; records keep the best ever per star.

## Q13. Persistence
- A. A separate store. B. Progress v5 `floors[id][i] = { s, t, f, n }` (star bits, best time, secrets bitmask, secret count); fragments and treasures derived from `f`; migration grants the cleared star to floors above `deepest` and to a taken basement.

**Picked: B.** One save, compact JSON, no duplicated facts; `n` lets the pyramid page show the third star without generating 25 floors.

## Q14. Testing the migration
**Picked:** move the migrate function into `src/state/migrateProgress.ts` (pure, no AsyncStorage) and test v3/v4 → v5 in the check script.

## Q15. How old floors are replayed
- A. Only by descending again from the top (which resets the camp). B. "Replay floor n" from the pyramid page for any floor reached (the basement once the artifact is taken): fresh torch, no camp/deepest/artifact side effects, stars and secrets recorded, a result panel with Again / Next floor / Back.

**Picked: B.** Stars exist to make old floors replayable; A would cost the player their checkpoint.

## Q16. Where stars show
**Picked:** the between-floors overview (stars pop with chimes, time vs par, best, secrets x/y), the replay result panel, the pyramid page (total, floor grid, floor panel), the pause panel (par and secrets of the current floor), the artifact screen (pyramid total).

## Q17. Records UI
**Picked:** pyramid page records card (best escape, untouched escapes from v4 `records`) and a Story card listing the fragments read; no separate records screen until there is more to show.

## Q18. Seal telltale
- A. An obvious marker. B. A plastered panel lighter and smoother than the masonry, joints stopping at its edge, hairline cracks, faint stamped oval seal impressions; plus a draught (flame leans, a faint whistle in stereo) within a few tiles.

**Picked: B.** Realistic and fair for sharp eyes and ears; no glow, no map icon.

## Q19. Showing the opened chamber
- A. Per-frame sprite over the rock. B. Re-record the whole floor art. C. Record a carved copy of the floor once (at the first break) and draw it clipped to opened chambers when rasterising chunks.

**Picked: C.** Same quality as baked art (walls, caps, faces), one recording per floor at most, only the touched chunks re-rasterised.

## Q20. Audio library
- A. `expo-audio` (installed): file players with volume and rate only; no stereo pan, no filters, no reverb, per-play latency, and its plugin defaults add `RECORD_AUDIO` and background playback. B. `react-native-audio-api` 1.0.1 (Software Mansion; Web Audio API on Oboe/AVAudioEngine, web via Web Audio): buffer sources, StereoPanner, Biquad, Convolver, gains with ramps, low latency.

**Picked: B.** The task needs stereo positioning, occlusion, reverb, ducking and many short overlapping sounds; only a real audio graph does that well. Gated by a dev build in Step 1, with an `expo-audio` fallback behind the same engine interface.

## Q21. Synthesis at build time or at runtime
- A. Runtime in JS (createBuffer): seconds of Hermes DSP at startup on a Redmi 9. B. Runtime with `OfflineAudioContext` (native, fast, but only the Web Audio node set). C. Build time: a committed Node script renders physically modelled sounds and encodes them with ffmpeg into small AAC files; runtime adds space (pan, occlusion, reverb).

**Picked: C.** Best quality (any DSP, iterated by ear), zero startup synthesis, ≈ 1.6 MB; deterministic and regenerable (`npm run sounds`, lock file checked).

## Q22. File format
- A. WAV (big). B. MP3 (encoder gaps at loops). C. Ogg Opus (needs extra asset-extension setup for bundled requires). D. AAC in `.m4a` (bundled-asset format supported by audio-api by default, decodes on Android, iOS and browsers), 64 kbps mono, 96 kbps stereo for beds/IRs.

**Picked: D.** Small, supported everywhere without config; loop seams handled by padded loops with explicit loop points.

## Q23. Reverb
- A. Baked into each file. B. Runtime convolution with two baked IRs (0.9 s passage, 2.4 s hall/burial), send level by distance, crossfaded by the room you stand in.

**Picked: B.** Every sound sits in the same space and changes with the room (a corridor vs. the burial chamber); two FFT convolvers are within budget on the Redmi 9 (fallback: one).

## Q24. iOS session and Android behaviour
**Picked:** iOS category `ambient` with `mixWithOthers` (respects the silent switch, never stops the player's music); no background audio; context suspended in background and on long pauses; interruptions pause the run.

## Q25. Positioning model
- A. Euclidean distance and pan. B. Distance along open tiles (sound travels down corridors), pan from the direction, a lowpass when the line of sight is blocked, more reverb when far.

**Picked: B.** Matches the guardian's own hearing rule (plan 04 Q12) and makes "it is behind that wall" audible.

## Q26. Which sounds
**Picked:** footsteps by surface (limestone, granite, grit, sand; quiet steps softer), hand flame by source, braziers/sconces positioned, ignitions, pickups, traps (plate, block, portcullis, sandfall, trapdoor), collapse rumble and pour, guardian (steps, wake, spotted, lost, touch, caught, follow, gone, a proximity dread layer), escape (artifact, door grind, shaft air, the climb out), secrets (knock, break, open, draught, fragment), stars and overview, UI, ambience per pyramid, two IRs (about 95 ids).

## Q27. Guardian audio character
- A. Horror growls and stingers. B. Physical sounds of a wrapped, resin-stiff body (linen drag, heavy soft feet, creaks, dust) plus a low, melody-free dread layer by proximity and one dissonant swell when it spots you.

**Picked: B.** Realism over cliché (as plan 04 Q29: no glowing eyes); the dread layer is the "felt before it is seen".

## Q28. Ambience
- A. One long music loop. B. Two co-prime loops per pyramid (room tone, wind in the air shafts) mixed by depth, plus random spot sounds (settling stone, sand trickles) at random pan; title/map get a night desert wind; other pyramids use a generic bed until 07–09.

**Picked: B.** Non-repeating for ~11 min from 53 s of audio, depth-aware, cheap.

## Q29. Music
**Picked:** none beyond the guardian dread layer, the escape pad and the star chimes; silence and the torch carry the mood (and a score is a separate task).

## Q30. Memory of decoded audio
**Picked:** groups loaded per screen (core / game / bed per pyramid), beds decoded at 24 kHz when the API honours it, cap 32 MB decoded.

## Q31. Who triggers sounds
- A. Core emits sound ids. B. A UI-side director reads events (with `at`), footsteps from `trail`, continuous loops from state and `guardianCue`, through one table (`feedback.ts`) shared with haptics.

**Picked: B.** Core stays UI-free and deterministic; one table keeps sound, haptics and captions in step.

## Q32. Mixing and ducking
**Picked:** buses ambience / world / guardian / ui → master → soft clip; fixed levels per sound class (table in the plan); ducks on impacts, the artifact, and while the guardian hunts in view (the tomb goes quiet); overlays fade the world out.

## Q33. Volume settings
- A. Sliders (no slider component installed). B. The existing Sound toggle as mute plus two `Segmented` rows (Effects, Ambience: Low/Medium/High), settings v2.

**Picked: B.** Uses the existing UI kit, three steps are enough on a phone.

## Q34. Variation and randomness in audio
**Picked:** `Math.random` is allowed in the director (UI layer, not core) for variant choice, ±4 % rate and ±1.5 dB gain; core determinism is untouched.

## Q35. Web preview
**Picked:** the same engine through Web Audio; the context resumes on the first tap; assets loaded by URI through `expo-asset`.

## Q36. Haptic patterns
- A. Single impacts per event. B. Pattern table (pulses with offsets and styles) played by a sequencer on the game clock: heartbeat with rate by guardian distance, rolling quake, block impact, portcullis slam, decaying door grind, star pops; min 50 ms between pulses, limited queue.

**Picked: B.** Readable on budget ERM motors, pauses with the game, distinct per event.

## Q37. Haptics setting
**Picked:** the existing "Vibration" toggle (with a short note); no intensity setting (expo-haptics has no amplitude control).

## Q38. The `skipped` hook from plan 03
**Picked:** not shown as a number; its meaning is carried by the rules (a floor left by a trapdoor is not cleared; a floor entered by a fall cannot be fast).

## Q39 (orchestrator). Plan step 1 needs a device dev build, which agents cannot run here

The plan gates the audio stack on an EAS dev build playing a panned tone on a phone. Implementation agents cannot run EAS builds or use a device.

- A. Block the task until the user builds.
- B. Use `react-native-audio-api` as the primary engine behind the plan's engine interface, verified as far as possible without a device: install with `npx expo install`, its config plugin set as the plan says, `expo-doctor`, `npx expo prebuild --platform android --no-install` into a scratch copy (native config generates cleanly), android + web export, and a real run on web (the package implements the Web Audio API there). Keep a thin `expo-audio` fallback engine chosen at startup if the native module is missing, so a failed native build degrades to unpanned sound instead of silence. Remove the fallback once the user confirms the device build.
- C. Ship only `expo-audio` now.

**Picked: B.** It gets the realistic spatial sound the user wants, keeps the work going, and limits the risk to one device check the user does later (listed in the phase report). C would lose panning, muffling and reverb for good.

## Implementation decisions

Task 05 implementation (Sonnet 5.5, 2026-11-21). Each: options, pick, reason.

**D1. Chamber spacing rule.** Plan text "expanded rect expanded again by 1" (3 rock tiles) vs its own check "two rock tiles apart". Picked the check: the rect expanded by 1 of a new chamber must not overlap the rect expanded by 1 of an earlier one (gap >= 2 rock tiles). Reason: the stated intent, more candidates.

**D2. Seal exit-pocket rule.** Implemented literally on the expanded rect: neither the exit nor any of its 4 neighbours may lie in it. The check script tests the same tiles.

**D3. Fixed seed count.** 52 secrets on Egypt (6x1 + 10x2 + 8x3 + basement 2), not 50 as the plan's sum says. 96 % are off the main path (floors 3-25 and the others); every real floor gets its full count; fuzz seeds 1-100 over 25 floors (4500 floors): all reach the full count, except tiny early floors.

**D4. Tiny early floors in fuzz.** Fuzz seeds with a 13x13 floor 1 (and one floor 4) have no 3x3 block of solid rock beside a floor tile, so no sealed chamber fits. Options: carve against open tiles (visible holes in walls), or accept no third star on those fuzz floors. Picked: accept; the check warns (not fails) for floor index < 6, fails for any later floor. The real floors 1-6 all have their secret.

**D5. Replay hash.** `replay:4` (Egypt floor 5, light-only hash) changed `40b02f73 -> ab3e4b09`: the random walk presses "up" at the plastered doorway, which is now a knock (cooldown 0.3 s). No other existing snapshot key changed (floors, features, `egypt:i:g`, all `replay:*` except 4). `hashState(full)` mixes the secret fields only once a seal is touched, so older hashes stay. New keys `egypt:i:sec` (25).

**D6. Par.** No tuning: the plan's table is reproduced exactly (1:25, 2:35, 5:50, 10:45, 13:70, 18:65, 24:80, basement 75 for 174/175 steps). The informed bot clears every fixed-seed floor in <= 0.8 x par; 747 of 750 fuzz floors (99.6 %). It warns on ten floors where par is lax for the bot (< 0.35 x par): par is for humans, so the table stays.

**D7. Floors replay.** The result panel's "Next floor" shows only when floor + 1 <= deepest and the floor is not the basement; "Play again" restarts the same floor through the overview ("Floor n again, with a fresh torch"). Burnt out, buried and caught panels get "Try again" / "Back" in a replay. The basement replay records the escape time only (`recordEscape`).

**D8. Star states in the UI.** On the overview and the result panel: earned this run = filled gold, held before = gold outline, missing = dim outline (the plan). On the pyramid page every earned star is filled gold (it is a statement of what you hold, not of what changed).

**D9. Overview star timing.** The row animates in the overview with `useTicker` time; the chimes and the haptic are `setTimeout`s at the pop times (they are wall-clock, the overview never pauses).

**D10. Seal hint.** The seal tile is a wall, never lit, so "seal tile lit >= 0.3" can never hold. The hint fires when the tile in front of an unopened seal is lit >= 0.3.

**D11. Draught lean.** The flame leans along x only (towards the seal's side), 6 degrees at 1 tile and less farther; directly below the seal it only flickers more. Unopened seals within 3 tiles with a clear line to the tile in front.

**D12. Carved copy.** The carved recording sets chamber tiles FLOOR with room -1 (so no paving) and the seal tile FLOOR with the front's room, not DOOR: a DOOR tile would draw a jamb and, next to an antechamber, portcullis grooves. The opened region also covers the row of the tile in front (its contact shadow changes). `FloorArt.reset()` (new) closes the chambers again on a retry or a replay of the same floor (the floor object and its art are shared).

**D13. Audio library gate (Q39, option B).** Not verifiable on a device. Done instead: `react-native-audio-api` 1.0.1 pinned with the plugin options of the plan (`expo-doctor` 20/20, `expo prebuild --platform android --no-install` in a scratch copy generates cleanly: no RECORD_AUDIO, no foreground service, no background mode; the React Native CLI autolinks the package), android and web exports bundle all 91 `.m4a`, and the web build was driven in Chromium (Playwright): the engine creates its context, decodes the 91 files, plays the exterior wind, ui sounds, footsteps, the hand flame, beds, and the replay flow works end to end. Playwright's Chromium has no AAC decoder, so the harness serves the same files as WAV; a real browser decodes the AAC. `expo-audio` stays installed as the thin fallback (`engineExpo.ts`) with its plugin set to `recordAudioAndroid: false, enableBackgroundPlayback: false`; the engine is chosen at first use. Remove the fallback, the dependency and the plugin entry once a dev build of audio-api is confirmed on a phone.

**D14. Decode at the context's rate.** audio-api's `AudioBufferSourceNode` reads a buffer at the context rate and does not resample a buffer of another rate (its loop points and read index use the context rate), so "decode beds at 24 kHz" would shift pitch. Everything is decoded at the device rate through `ctx.decodeAudioData`. To stay under the 32 MB cap: flame, pour, draught and air loops are 4-5 s (plan: 7-9 s), beds are mono (the plan said stereo), `bed.egypt.room` 20 s + `bed.egypt.air` 17 s (LCM 340 s = 5.7 min before the pair repeats; plan 30 + 23 s, 11 min), `g.dread` 6 s. In a run decoded audio is 31.4 MB (core 9.9 + game 13.1 + egypt bed 8.4; the 3.7 MB exterior wind is freed); `check:sounds` enforces the cap. If a phone struggles: drop the 4 sand/grit steps to 2 variants and the flame loops to 3 s.

**D15. The sound set.** 91 ids (the plan said about 95; the variants are separate files `<id>.0..n-1`, `VARIANTS` in `src/audio/variants.ts`, generated apart from the manifest so Node tests can import it), 1.24 MB. All recipes are built from the physical kit in `scripts/sound/dsp.ts` and normalised to -3 dBFS; runtime `gain` in the manifest puts them at the plan's levels (peak dBFS at one tile = `level`). The strike excitation is a differentiated half-sine (a real impact has no net push; the first version rang as a dull thud with the DC feed-through) and noise beds are high-passed at 22-28 Hz. **Nobody has listened to any of it** (the implementation agent cannot): see the report. Checks are objective: spectral peaks and centroids per family (steps 100-1000 Hz body, ui 1-3 kHz, bronze bars on their pitches D4/F4/A4/D5/A2, dread 38 Hz, flames 60-1000 Hz), peaks, DC, loop seams, decoded duration, size.

**D16. Loop seam checks.** Plan: seam RMS within +-1.5 dB of the neighbouring 10 ms and no step > 0.05. On crackling or noisy loops those are not meaningful (a 10 ms window of 180 Hz noise holds one cycle; a crackle pop at the seam is a normal step). Implemented: the 50 ms around the seam must not be a level outlier among the loop's own 50 ms windows (fail > 3 dB, warn > 1.5 dB); the seam step (and the step into the pre-loop padding) must not exceed the larger of 0.1 and 1.2 x the largest step 2.5 ms to either side. Measured on the ffmpeg-decoded files.

**D17. Sound-lock hash.** The lock stores the sha1 of the 16-bit quantised samples, not of the float bytes, so last-bit differences between engines cannot flip it; a Node major change could still change `Math.sin` results, so the Node version in `.nvmrc` (24) is part of the lock.

**D18. Spatial details.** A tile in rock (the seal) is placed at the tile in front of it (clear line needs an open target). `gridStamp` (open seals, the door, trap phases, blocked sand tiles) invalidates the distance field. Loops are updated at 15 Hz with change thresholds.

**D19. Haptics.** `src/ui/hapticPatterns.ts` holds the table and the sequencer (pure, testable in Node); `src/ui/haptics.ts` adds the device calls and the self-driven shared sequencer (menus, the overview, wall bumps). A GameScreen run has its own sequencer, ticked with the game clock and cleared on overlays. `sandNear` and `guardianNear` have no haptic of their own (the heartbeat replaces the latter). The walker's wall bump is skipped when the push produced a secret event.

**D20. Settings volumes.** `sfx` and `ambience` map linearly to bus gain (0.35 / 0.65 / 1.0); old values snap to the nearest step in the UI only.

**D21. Exterior bed.** Started from `RootLayout` by pathname (everything except `/play/*` hears the night wind); a run loads `bed:egypt` (other pyramids borrow it with a low-pass until 07-09). Overlays dip ambience 10 dB; panels suspend the context after 30 s.

**D22. node_modules.** `npx expo install` replaced the worktree's `node_modules` symlink with a real directory (the main checkout is untouched). Not committed (gitignored).
