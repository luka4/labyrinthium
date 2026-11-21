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
