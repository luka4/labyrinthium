# Plan 05 · Egypt complete: stars, secrets, records, sound and haptics

Decisions and reasons: `plan_05_question.md` (Q-numbers). Written 2026-11-21 against the merged code of tasks 01–04 (`3dfcdb0`): every name below is the real one or an explicit change to it. Q0 of plan 03 stands (real art arrives in phase 4): new art here is tidy vector art behind functions tasks 10–13 can swap. This is the last task of phase 2.

Reused, do not re-plan: `GameEvent { seq, type, kind, at }` + `emit(s, type, kind, at)` (`EVENT_LOG 16`), `noise(s, at, r)`, `invalidatePaths(s)`, `guardianCue(s)` (`dx, dy, path, visible, mode`), `s.floorTime`, `s.landing`, `s.skipped`, `s.escape.t`, `s.guardian.touches`, `progress.records` (v4), `progress.hints`, `addFeatures` order (`placeLights → placeTraps → buildSandOrder → placeExit → extendSandOrder → placeGuardian`), the rng-stream-per-stage rule, `floorArt.recordFloor` + chunk cache, `drawTelltales`, `Board` anim refs, `FloorOverview` kinds, `useTicker`, `haptic.*` (src/ui/haptics.ts), settings `haptics`/`sound` toggles, check scripts (`check-floors.ts` → `check-guardian.ts`, `check-light-rules.ts` with `hashState(full)` and the replay keys).

## Goal

Every floor gets three stars and a reason to come back: **cleared** (you found its way down), **fast** (under a par time a player who knows the floor can beat), **every secret** (all of its sealed chambers found, over any number of runs). Secrets are real tomb architecture: a doorway closed with plaster and stamped seal impressions (as real sealed tomb doors were), on a wall face; it sounds hollow when you push it, breaks on the second push, and opens a small hidden chamber with a grave good and, on eight floors, a painted story fragment about the builders' mark. A floor can be replayed alone from the pyramid page. Stars show between floors, on the pyramid page (floor grid, totals, records, story) and on the artifact screen.

The game gets its sound: a professional, physically modelled sound set synthesised in code at build time by a committed script into small AAC files, played by a real-time audio graph (`react-native-audio-api`) with stereo panning by direction, distance falloff along corridors, wall occlusion (muffling), room reverb by room size, buses, ducking and volume settings. Haptics become patterned (heartbeat as the guardian nears, rolling quake, impacts) through a sequencer on the game clock.

## Scope

In:
- Core: `secrets.ts` (placement, knock/break/open, finds), `stars.ts` (par, results), `Floor.secrets`, run fields, events, `EgyptRow`-driven counts and fragment floors, `ArchProfile.secrets?/fragment?`.
- Render: sealed doorway telltale (baked), breaking animation, the opened chamber baked into the art on demand, grave goods sprites, fragment wall painting, draught lean of the flame near a seal.
- UI: replay-a-floor mode, overview results with stars, pyramid page floor grid + floor panel + records + story list, pause panel floor line, fragment panel, artifact screen stars line, captions/hints, settings (volumes, mute, vibration).
- State: progress v5 `floors` (stars, best time, secrets), pure migration module; settings v2 (volumes).
- Audio: `scripts/sound/*` synthesis + `npm run sounds`, committed `assets/sounds/*.m4a` + generated `src/audio/manifest.ts`, `src/audio/*` engine, director, spatial, feedback table, ambience per pyramid (Egypt full, hooks for the rest), UI sounds.
- Haptics: pattern table + sequencer replacing the placeholders; settings toggle.
- Checks: `scripts/check-secrets.ts`, `scripts/check-stars.ts`, `scripts/check-sounds.ts`.

Out: coins/shops (treasure is counted, not spent: task 06+), artifact powers (06), other pyramids' story text, beds and culture sounds (07–09; hooks here), music score beyond the tension layer, Rive celebrations, leaderboards/ghosts, a visual sound-indicator accessibility mode (captions cover the key cues).

## Design

### 1. Secrets: data (`floor.ts`, `secrets.ts`, `egypt.ts`, `architecture.ts`) (Q1–Q7)

```ts
// secrets.ts
export type TreasureKind = 'amulet' | 'jar' | 'collar' | 'figurine';
export const TREASURE_NAME: Record<TreasureKind, string> = { amulet: 'Faience amulet', jar: 'Alabaster jar', collar: 'Broad collar', figurine: 'Shabti figurine' };
export type Secret = {
  seal: number;          // ROCK tile: the plastered doorway, on the north wall of `front`
  front: number;         // FLOOR tile south of it (you push north from here)
  tiles: Int32Array;     // chamber tiles, ROCK in floor.tiles/solid/opaque until opened (run grid only)
  rect: { x: number; y: number; w: number; h: number };  // chamber rect (tiles), for the art
  spot: number;          // chamber tile the grave good lies on (farthest from the seal, ties lowest index)
  treasure: TreasureKind;
  fragment: number;      // story fragment index in the pyramid, or -1
};
Floor.secrets: Secret[];             // generation order; index k is the bit k everywhere
Layout = Omit<Floor, … | 'secrets'>;
```
Chamber tiles stay ROCK in `floor.tiles/solid/opaque`, so every layout/feature invariant, `dist`, the sand order, trapdoor landings and all committed `egypt:*` hashes are unchanged; only the run's `grid` opens them.

Counts and story floors (new data, rows unchanged):
```ts
// egypt.ts
export const EGYPT_SECRETS = (i: number) => (i === 24 ? 2 : i < 6 ? 1 : i < 16 ? 2 : 3);   // 1·6, 2·10, 3·8, basement 2 = 50
export const EGYPT_FRAGMENT_FLOORS = [2, 5, 8, 11, 14, 17, 20, 24] as const;               // 0-based: floors 3,6,…,21, basement
// architecture.ts
ArchProfile.secrets?: (i) => number;     // egypt EGYPT_SECRETS, generic/black () => 1
ArchProfile.fragment?: (i) => number;    // egypt: index in EGYPT_FRAGMENT_FLOORS or -1; generic/black () => -1
```

### 2. Secrets: generation (`secrets.ts` `placeSecrets`) (Q3–Q5)

Runs last in `addFeatures` (after `placeGuardian`), own rng `createRng(spec.seed ^ 0x3c6ef372)`; nothing earlier changes.

Candidates per shape, shapes tried in order `3×2, 2×2, 2×1, 1×2, 1×1` (w×h; floors index < 6 start at `2×1`):
- `front F`: `tiles[F] === FLOOR`, room kind not `stairsUp | stairsDown | burial`, `y(F) ≥ h + 3`; F is not an item, fixture, trap, trap target (port) tile, not 4-adjacent to a trap tile, not `exitFront`, not the guardian lair/post or 4-adjacent to it, not a niche spot.
- seal `D = F − size`; chamber rect rows `y(F) − 1 − h … y(F) − 2`, columns any offset `x0 ∈ [x(F) − w + 1, x(F)]` (first offset that fits, lowest x0); the rect expanded by 1 tile (which contains `D` and its side neighbours) must be all ROCK, inside `[1, size − 2]`, contain neither `floor.exit` nor any tile 4-adjacent to it, and not overlap another chosen secret's expanded rect expanded again by 1 (two rock tiles between chambers).
- Selection: shuffle candidates with the rng, then stable-sort by (shape order, `onPath[F]` last, `collapse.rank[F] !== -1` last, `rooms[room[F]].leaf` first). Take the first; for the next secrets also require Manhattan(F, chosen F) ≥ `size / 4` (relax to 0 if nothing passes). Until `count` are placed or every shape is exhausted (then on-path, sand-ranked fronts are allowed: they are already in the sort, just last).
- `spot`: chamber tile with the largest Manhattan distance from `D`, ties lowest index. `treasure = ['amulet','jar','collar','figurine'][rng() * 4 | 0]`. `fragment`: profile `fragment(i)` on secret 0, else −1.
- Measured on the fixed seed: floors 3–25 have 3–180 candidates for `2×2` off the main path; floors 1–2 only `2×1/1×1`, sometimes on the path (fine for a tutorial floor). The check asserts the full count on every real pyramid and fails on fuzz seeds only when a floor gets 0.

### 3. Secrets: rules (`game.ts`, `secrets.ts`) (Q2, Q6)

```ts
GameState.secretPhase: Uint8Array;   // per secret: 0 sealed, 1 knocked (hollow), 2 breaking, 3 open
GameState.secretTimer: Float32Array; // breaking: seconds left
GameState.secretsFound: number;      // bitmask of secrets whose grave good you took this run
GameEvent.type += 'secretKnock' | 'secretBreak' | 'secretOpen' | 'treasure' | 'fragment';
GameEvent.kind += TreasureKind;
export const KNOCK_COOLDOWN = 0.3, BREAK_SECONDS = 0.6, NOISE_KNOCK = 4, NOISE_BREAK = 8;
```
- `move(dir)`: before `if (solid[next]) return s`: if `dir === 3` (up) and `k = secretAtSeal(s.floor, next) ≥ 0` and `s.pos === secret.front` → `pushSeal(s, k)`: phase 0 → 1, event `secretKnock` at seal, `noise(s, seal, NOISE_KNOCK)`; phase 1 → 2, `secretTimer = BREAK_SECONDS`, event `secretBreak`, `noise(s, seal, NOISE_BREAK)`; both set `cooldown = KNOCK_COOLDOWN` (break: `BREAK_SECONDS`), `burning = true`, `idle = 0`; return. Phases 2/3 fall through (solid / open).
- `tick`: `tickSecrets(s, dt)` after `tickEscape`: phase 2 counts down; at 0 → phase 3, `grid.solid = grid.opaque = 0` for `seal` and `tiles`, `opaqueDirty = true`, `invalidatePaths(s)`, event `secretOpen` at seal. Not reachable by the collapse (rank −1 by construction).
- After `pickUp` in `move`: `next === secret.spot` for an open secret with its bit unset → `secretsFound |= 1 << k`, event `treasure` (kind treasure, at spot), and `fragment` (at spot) when `fragment ≥ 0`; noise `pickup`.
- `startFloor`: arrays sized `floor.secrets.length`, `secretsFound = 0`. `continue`/`retry` start fresh (seals close again; finds are kept in progress).
- `wayDownLeft`, guardian, traps: unchanged (an open chamber is just open tiles; the guardian may walk in).

### 4. Stars and par (`stars.ts`) (Q8–Q12)

```ts
export const STAR = { CLEARED: 1, FAST: 2 } as const;        // stored bits; the secrets star is derived
export const PAR = { slack: 2.0, base: 8, guardian: 10, round: 5 } as const;
/** start → stairs steps (basement: + stairs → exitFront + 1) on the static mask */
export function routeSteps(floor: Floor): number;
export function parTime(floor: Floor): number;   // ceil5(slack·steps·STEP_SECONDS + base + (floor.guardian ? guardian : 0))
export type FloorResult = { floorIndex: number; cleared: boolean; time: number; fast: boolean; par: number; found: number; total: number };
export function floorResult(s: GameState): FloorResult;
export function starCount(rec: { s: number; f: number; n: number } | undefined): number;   // popcount(s & 3) + (n > 0 && f === (1 << n) − 1)
```
- Cleared: status `descending` (stairs) or `escaped` (basement). A trapdoor fall leaves the floor uncleared (secrets still count).
- Fast: cleared, `s.landing < 0` (you entered at the arrival, not by a fall), `floorTime ≤ par`. `floorTime` counts burning seconds only (from your first move; pauses and overviews excluded).
- Par on the fixed seed (steps → par s): 1: 50→25, 2: 74→35, 5: 127→50, 10: 107→45, 13: 192→70, 18: 143→65, 24: 197→80, basement 174 (70 + 104)→75. Tune only `PAR` from the informed bot (§Verification).

### 5. Persistence (`state/progress.ts`, new `state/migrateProgress.ts`) (Q13–Q14)

```ts
export type FloorRecord = { s: number; t: number | null; f: number; n: number };
// s: STAR bits ever; t: best cleared time not by a fall; f: secrets found ever (bitmask); n: secrets on the floor (written whenever the floor is played)
ProgressData.floors: Partial<Record<PyramidId, Record<number, FloorRecord>>>;   // key = 0-based floor index
actions: noteFloor(id, i, n); markSecret(id, i, k, n); recordFloor(id, r: FloorResult) (ORs bits, mins t, ORs f); recordEscape(id, seconds) (best only, for replays)
version 5; migrate v<5: floors = {}; every floor index < deepest[id] gets { s: CLEARED, t: null, f: 0, n: 0 }; an artifact taken adds the basement { s: CLEARED, … }.
```
`migrateProgress(persisted, version)` moves the whole existing `migrate` body into `src/state/migrateProgress.ts` (imports only core) so the check script can test it; `progress.ts` calls it. Fragments read and treasures are derived from `f` (secret 0 of a fragment floor holds the fragment) — no extra fields.

Selectors (`progress.ts`): `pyramidStars(id)` → `{ stars, max: 3 · floorCount }`, `fragmentsRead(id)` → indices.

### 6. Replay a floor (`app/play/[id].tsx`, `GameScreen.tsx`) (Q15)

- Route param `from=floor&floor=<1-based>`: allowed when `floor − 1 ≤ deepest[id]`; the basement only once the artifact is taken. `PlayRoute` passes `mode: 'replay'` and the start floor.
- Replay: `startFloor(pyramid, i)` (fresh torch, empty bag, no follower); `reachFloor`, `reachCamp`, `startDescent`, `takeArtifact` are never called; `noteFloor`, `markSecret`, `recordFloor`, `recordEscape` are.
- On `descending`, `escaped` (after the 0.3 s door step) or `falling`: phase `result` (Panel): eyebrow "Floor n", title "Cleared" / "Through the trapdoor", the three stars (earned this run filled gold, held before outlined gold, missing outlined dim), "0:48 · par 0:55 · best 0:44", "Secrets 1 of 2"; buttons "Play again" (`startFloor` same floor), "Next floor" (when `i + 1 ≤ deepest` and not the basement), "Back" (`router.back()`).
- Burnt out / buried / caught: the panels' primary button restarts the same floor ("Try again"); the secondary "Back".
- The pause panel shows "Floor n · par 0:55 · secrets 0 of 2 found here" in both modes.

### 7. Results between floors (`FloorOverview.tsx`) (Q16)

- New prop `result?: FloorResult & { best: number | null; newBest: boolean; held: number /*star bits held before*/ }` for kinds `descend`, `fall`, `escape`.
- Under the side view: a row of three 22 dp stars (vector, `drawStar` in `drawRelic.ts`'s style: faceted gold with a dark rim; unearned: hairline outline) with labels under them ("Cleared", "Under 0:55", "Secrets 1/2"), then "0:48 · best 0:44" (+ "New best" in gold). Stars pop at 800/1050/1300 ms (scale 0.6 → 1.08 → 1, 180 ms) each with the `star.n` chime and a `light` haptic; reduced motion: all shown at once, one chime. `SHOW_MS` 2400 → 3000 and `ESCAPE_MS` 3200 → 3800 when `result` exists; a tap still skips.
- GameScreen: on `descending` compute `floorResult(game.current)` before `continue`, `recordFloor`, pass it to the overview; same for `falling` (cleared false) and the basement `escaped`.

### 8. Pyramid page, records, story, artifact screen (Q17)

- Pyramid page (`pyramid/[id].tsx`): facts row gains "Stars 37 / 75". New section "Floors": a 5-column grid of 25 cells (min 56 dp, `Pressable`), each: floor number, three 7 dp star pips, a small camp tick on camp floors, dim when never reached. Tap → `Panel` "Floor 7": stars with their labels, "Best 0:48 · par 0:55" (par from `parTime(floorFor(p, i))`, computed on open, memoised), "Secrets 1 of 2", buttons "Replay floor 7" (when allowed), "Close". Records card (when any): "Best escape 0:41 · untouched 2 of 3". Story card: "Story 3 of 8" + "Read" → Panel listing the read fragments (title + text) in floor order.
- Artifact screen: line "Stars in Egypt: 37 of 75".
- Story text (`src/game/story.ts`, display data, no core import): `STORY: Partial<Record<PyramidId, readonly { title: string; text: string }[]>>`, Egypt's eight:
  1. "The mark" — "Painted on the plaster, older than the paint around it: a ring with a line falling through it. Beside it someone has scratched, in a careful hand: 'We were told to build down, not up.'"
  2. "The nameless gang" — "Workmen's tallies, like those on every block they hauled. One gang has no name, only the ring and the falling line. Its count runs off the edge of the wall."
  3. "A lid" — "'The pyramid is a lid,' the scratches say. 'The king's name is on the outside. On the inside, the mark of the ones who asked for it.'"
  4. "The plan" — "A builder's plan in red ochre, gridded like the real ones. It shows floors no one could see from outside, going down further than the base."
  5. "Every country" — "'They came with the mark to every country. The same stone, the same rule: carry no light that is not your own.'"
  6. "The sleeper" — "A figure lies at the top of a pyramid, asleep. Below it, many floors; below them, the mark. The figure has no face. The plaster around it is new."
  7. "Not by the stairs" — "'If you are reading this, you were woken too. So was I. I did not leave by the stairs.'"
  8. "Four lids" — "'Four lids, four seals, and one door older than all of them. Do not —' The rest has been scraped away, recently, by someone carrying a torch."
- Fragment found in play: phase `fragment` (Panel, clock stopped): eyebrow "A painted wall · Floor n", title, text, "Story n of 8", button "Continue".

### 9. Secrets in the board art (`floorArt.ts`, new `render/drawSecrets.ts`) (Q18–Q19)

- Baked telltale (`drawTelltales` → `sealedDoor(canvas, seal)`, south face of the seal tile): a doorway-sized panel of smooth gypsum plaster (`theme.plaster`: Egypt `#d9cdb4`, 4 % lighter and less textured than the masonry, joints stop at its edge), a few dark hairline cracks (deterministic from the tile), 3–5 faint stamped oval seal impressions in a loose row (abstract, no signs), and a thin shadow line under the lintel. Readable in torchlight, never glowing.
- Opening: `FloorArt.open(k)`: on the first call records `openedPicture = recordFloor(carved floor)` (a copy of `floor` whose `tiles` has every secret's `tiles` = FLOOR, `seal` = DOOR, `room` = the front's room, kind `chamber`); marks `rect(k) ∪ seal` expanded by 1 tile as opened; retires the cached chunks it overlaps. `raster(cx, cy)` draws the base picture, then for each opened region intersecting the chunk: `clipRect(region)` + `drawPicture(openedPicture)`. GameScreen calls `art.prepareOpened()` on `secretBreak` (records during the 0.6 s break) and `art.open(k)` on `secretOpen`. Carved chambers get rough-cut walls (`recordFloor` draws chamber kind `chamber` with a `secret` flag: unpaved bedrock floor `theme.bedrock`, no frieze); fragment chambers get a painted panel on the north wall face: ochre ground, a red ring with a falling line, small abstract figures (no real signs).
- Per frame (`drawSecrets(canvas, s, theme, t, time, win)` inside the masked layer after the sand): phase 1: a fresh crack line + 6 dust motes for 0.4 s; phase 2: cracks spread over 0.6 s, plaster chunks fall, dust puff; open + not taken: the grave good sprite on `spot` (amulet: small blue-green faience pendant on a cord; jar: white banded alabaster jar with lid; collar: gold-and-faience bead arcs; figurine: small mummiform figure in blue faience), a soft specular glint; taken: 0.6 s gold motes.
- Draught: render-only, like the guardian gutter: an unopened seal within Chebyshev 3 with a clear line → the hand flame leans 6° towards it and flickers slightly more.

### 10. Audio: engine choice and graph (`src/audio/engine.ts`) (Q20–Q24)

Dependency: `react-native-audio-api` **1.0.1** exact (Web Audio API on Oboe/AVAudioEngine; works on web through Web Audio). `app.json` plugin `["react-native-audio-api", { "iosBackgroundMode": false, "androidForegroundService": false, "androidPermissions": [] }]`. Remove `expo-audio` (dependency and plugin; its defaults add `RECORD_AUDIO` and background playback) once the audio-api dev build runs (Step 1 gate). CLAUDE.md Stack line updated.

Singleton `engine`:
```
AudioContext({ latencyHint: 'interactive' })      // device rate (48 kHz on the Redmi 9)
iOS: AudioManager.setSystemOptions({ ios: { category: 'ambient', options: ['mixWithOthers'] } })   // respects the silent switch, never stops the player's music
sources → [voice gain] → [lowpass biquad, only when occluded/muffled] → [StereoPanner] ─┬→ bus
                                                                                       └→ send gain → reverbSmall | reverbLarge (Convolver, baked IRs)
buses: ambience, world (in-game SFX), guardian, ui  → master gain → soft-clip WaveShaper (tanh above −3 dBFS) → destination
```
- API: `load(group)`, `play(id, { gain, pan, rate, lowpass, send, bus, priority }) → Voice | null`, `loop(id, opts) → LoopVoice { set(gain, pan, lowpass, send, ramp), stop(fade) }`, `duck(bus, dB, attack, hold, release)`, `setVolumes({ master, sfx, ambience, muted })`, `setRoom(size: 'small' | 'large', mix)`, `suspend()`, `resume()`.
- Voices: one-shots are new `AudioBufferSourceNode`s on cached `AudioBuffer`s (single-use nodes, reused buffers); random rate ±4 % and gain ±1.5 dB per play for variants. Cap 24 voices; stealing lowest `priority`, then oldest. Every param change via `setTargetAtTime(v, now, 0.03)` (never direct set: clicks).
- Loading: `core` group at app start (UI, footsteps, flames, pickups), `game` group when `GameScreen` mounts (under the overview), `bed:<pyramid>` when a run starts (previous bed freed). Native: `decodeAudioData(require(...))`; web: `decodeAudioData(Asset.fromModule(mod).uri)` (expo-asset). Beds decode with `sampleRate 24000` if honoured (memory), else device rate.
- Lifecycle: resume on the first touch (web needs a gesture; `uiSound` calls `engine.resume()`); `suspend()` when the app goes to background (AppState) and resume on active; `observeAudioInterruptions(true)`: an interruption pauses the run (phase `paused`) and suspends; `onerror` → `resume()` after 2 s.
- Fallback (only if the Step 1 gate fails): `engineExpo.ts` implements the same interface on `expo-audio` players (pool of 4 per one-shot id, no pan/filters/reverb, loops via `loop = true`); everything above the engine is unchanged.

### 11. Audio: spatial model (`src/audio/spatial.ts`) (Q25)

The director keeps `fromPlayer: Int32Array` = BFS over `grid.solid` from `s.pos`, rebuilt when `s.pos` or `opaqueDirty`-driven grid changes (≤ 7/s, ≈ 0.2 ms each on floor 24). For a sound at tile `a` (or `guardianCue`):
- `d` = path steps (`fromPlayer[a]`; −1 → Euclidean + 6), straight `e` = Euclidean tiles, `dx` = x offset.
- gain = `ref / (1 + (d / 3)^1.4)`, silent beyond 24 steps; pan = `clamp(dx / max(3, e), −1, 1) · 0.8` (direction, not distance); occluded (`!clearLine(grid, player, a)`) → lowpass `cutoff = 4000 / (1 + d / 4)` clamped 700–4000 Hz and −3 dB; otherwise no filter node.
- Reverb send rises with distance: `0.15 + 0.5 · min(1, d / 16)`; the room around the player picks the reverb: `hall | gallery | burial | antechamber` → large IR (2.4 s), `chamber | shrine | magazines | stairsUp | stairsDown` → large at 0.6 mix, `passage` → small IR (0.9 s); a room change crossfades the two send buses over 0.4 s.

### 12. Audio: the sound set (`scripts/sound/*`, `assets/sounds/`) (Q26–Q30)

Synthesis at build time: `npm run sounds` → `tsx scripts/make-sounds.ts` renders every sound deterministically (mulberry32 seeded by the id hash) as float32 at 48 kHz, writes WAVs to a temp dir, encodes with ffmpeg (`-c:a aac -b:a 64k -ac 1`, beds and IRs `-b:a 96k -ac 2`) to `assets/sounds/<id>.m4a`, writes `scripts/sound/sounds.lock.json` (WAV sha1, duration, peak, rms per id) and generates `src/audio/manifest.ts` (`SOUNDS: Record<SoundId, { src: number; loop?: [start, end]; group: 'core' | 'game' | 'bed:egypt' | … ; gain: number; variants?: number }>`). The `.m4a`, the lock and the manifest are committed; ffmpeg is needed only to regenerate.

DSP kit (`scripts/sound/dsp.ts`, plain TS, no deps): white/pink (Kellet)/brown noise; RBJ biquads (lp/hp/bp/peak/shelves) and time-varying SVF; one-pole; ADSR/exp-decay envelopes; **modal bank** (damped sinusoids: stone 80–900 Hz inharmonic, fast; ceramic/faience 1.2–6 kHz, 0.1–0.4 s; gold/bronze free-bar ratios 1, 2.76, 5.40, 8.93, long; wood 300–1200 Hz short); **granular scatter** (Poisson grains 1–4 ms, log-normal amplitude: sand, grit, debris); **stick–slip friction** (impulse train 30–80 Hz with jitter into resonators: stone grinding); **fire** (roar = brown noise lp 400–900 Hz with 1/f AM, crackle = Poisson pops of bandpassed noise 1–3 kHz, hiss = hp white with flicker AM); sweeps; soft clip; DC block; 3 ms fades; `seamlessLoop(x, xfade)` (equal-power crossfade of the tail into the head, then 100 ms pre/post padding copied from the cycle so `loop` points survive AAC priming); RMS/peak normalisation per category.

| Group | Ids (variants) | Recipe (all dry unless noted; runtime adds the room) |
|---|---|---|
| Steps | `step.stone` ×6, `step.granite` ×4, `step.grit` ×4, `step.sand` ×4 | heel transient (stone modal 120–600 Hz, 6 ms noise burst lp 3 kHz) + toe 90–140 ms later at −6 dB; leather sole scuff (bp noise 1.5 kHz, 40 ms); granite brighter (+modes 900–1400); grit adds 30 ms granular crunch; sand = heel/toe as grain bursts (300 grains, lp 5 kHz), no modal |
| Hand flame (loops 7–9 s) | `flame.smallTorch`, `flame.torch`, `flame.bigTorch`, `flame.lamp`, `flame.candle`, `flame.embers` | torch: roar lp 650 Hz + crackle 6/s + hiss −30 dB; big: roar lp 450, crackle 9/s, +3 dB; small: lp 900, 4/s, −3 dB; lamp: steady soft roar lp 300 + rare flutter; candle: barely audible flutter −12 dB; embers: faint hiss + ticks 1/s |
| Fixtures (loops) | `fire.brazier`, `fire.sconce` | brazier: wide roar lp 350 + deep crackle + coal ticks; sconce ≈ torch −4 dB |
| Light events | `ignite.small`, `ignite.brazier`, `ignite.candles`, `snuff`, `autoLight`, `swap` | ignite: bp-noise "fwoomp" sweep 300→1.5 kHz 250 ms + crackle onset; brazier: longer, lower whumph 600 ms; candles: 3 small ignitions 120 ms apart; snuff: short "pff" hp noise + smoke hiss; swap: cloth whoosh + ignite.small |
| Pickups | `pick.torch`, `pick.lamp`, `pick.candle`, `pick.oil`, `pick.treasure`, `bagFull` | torch: wood modal clatter + cloth; lamp: ceramic modal + metal handle tick; candle: wax tap (soft modal 800 Hz); oil: ceramic clink + 0.6 s glug (bp noise bursts at 9/s, falling pitch) + flame swell; treasure: faience/gold modal clinks; bagFull: soft dull thud |
| Traps | `plate.click`, `block.fall`, `portcullis.drop`, `sand.fall`, `trapdoor.open`, `hit` | plate: stone settle + deep resonant clunk 140 Hz; block: 0.2 s grind, impact (sine sweep 70→35 Hz 0.4 s + stone modal + debris grains 1.5 s); portcullis: 0.4 s friction slide then heavy slam; sand.fall: 3 s rising granular pour (lp opening 1→6 kHz); trapdoor: pivot creak (friction resonators 200–600 Hz) + drop whoosh; hit: impact + snuff |
| Collapse | `quake`, `sand.pour` (loop 6 s), `sealed` | quake: 3 s brown rumble lp 120 Hz with AM + crumble grains + 3 deep knocks; pour: dense granular hiss lp 4 kHz + low rush; sealed: muffled boom then silence tail |
| Guardian | `g.step` ×4, `g.wake`, `g.spotted`, `g.lost`, `g.touch`, `g.caught`, `g.follow`, `g.gone`, `g.dread` (loop 12 s) | step: dragged linen shuffle (bp noise 800–2 kHz, slow AM) + soft heavy foot (stone modal lp 400) + resin creak; wake: dust shell cracking (friction + grains) 1.5 s; spotted: sub thump + dissonant bowed-stone resonance swell (two detuned modal clusters 55/58 Hz + 7 harmonics, 2 s); lost: the same receding; touch: smother whoosh + linen + snuff; caught: dark sub swell + hush; follow: three slow steps on stone stairs, reverberant (baked distance); gone: distant muffled sand thud; dread: 38 Hz breath-like pulsing sub + faint linen rustles, no melody |
| Escape | `artifact.lift`, `exit.grind`, `exit.air` (loop 8 s), `escape.out` | lift: gold modal chime (D4) + deep pyramid groan (friction 40–90 Hz); grind: 1.5 s heavy slab friction descending in pitch; air: cool wind through a shaft (pink → bp 500/1200 Hz wandering, Q 5); out: 3.5 s rising air into open desert wind + warm low pad (D minor 9 voicing, soft) |
| Secrets | `seal.knock`, `seal.break`, `seal.open`, `seal.draught` (loop 7 s), `fragment` | knock: hollow plaster thunk (cavity resonance 180 Hz + plaster modal 700 Hz); break: plaster crumble grains + chunks falling 0.6 s; open: dusty air release whoosh lp 2 kHz; draught: faint whistle (bp 1.1 kHz Q 9 wandering ±80 Hz) + air; fragment: soft low bronze bowl note (A2) with long tail |
| Stars / overview | `star.1`, `star.2`, `star.3`, `newBest`, `descend`, `fall` | stars: bronze bar modal at D4, F4, A4 (one each), 1.2 s tail; newBest: D5 bright tap; descend: four stone stair steps receding + soft whoosh; fall: whoosh + landing thud on sand |
| UI | `ui.tap`, `ui.toggle`, `ui.back`, `ui.panel`, `ui.seal` | tap: small dry stone click (modal 1.8 kHz, 15 ms); toggle: two-tone click; back: lower click; panel: soft papyrus-like swish (bp noise 2 kHz 120 ms); seal (map): stone + gold clunk |
| Ambience | `bed.egypt.room` (loop 30 s), `bed.egypt.air` (loop 23 s), `spot.egypt.settle` ×4, `spot.egypt.trickle` ×3, `bed.exterior` (loop 26 s) | room: brown noise lp 180 Hz with slow drift + very low 45 Hz pressure tone (deep floors); air: wind in the air shafts (pink through 2 wandering bandpasses 300–900 Hz) — co-prime lengths, so the mix repeats only after ~11 min; spots: stone settling ticks/creaks, small sand trickles, played by the director every 6–20 s at random pan and distance; exterior (title/map): night desert wind, sparse sand gusts |
| IRs | `ir.small` (0.9 s), `ir.large` (2.4 s) | stereo, decorrelated exponentially decaying noise with decay faster at high frequencies (time-varying lp 9 kHz → 1.2 kHz), 6 early reflections 7–35 ms; limestone character: −3 dB shelf above 4 kHz |

Budget: ~95 ids, ≈ 210 s of audio, **≤ 2.5 MB** on disk (≈ 1.6 MB expected); decoded ≤ 32 MB (core + game ≈ 18 MB at 48 kHz mono float, bed ≈ 5 MB at 24 kHz).

### 13. Audio: the director and mix (`src/audio/director.ts`, `feedback.ts`, `ambience.ts`) (Q31–Q35)

`createSoundDirector(engine)` with `update(s, dt, playing: boolean)` called from the GameScreen frame loop (and `reset()` on a new floor). Reads state only, never writes core (except the `guardianCue` cache, as the renderer does).
- Events: new `seq`s (per floor, like the screen) → `FEEDBACK[type]` table (`feedback.ts`): `{ sound: id | (e, s) => id, at: true, bus, gain, priority, haptic, duck }`; positioned via `spatial` at `e.at` (−1 → centre, no reverb send). `guardianStep` only within 16 path steps (core already filters).
- Footsteps: when `s.trail` increases, the surface of `s.pos`: `sandLevel ≥ COVER` → `step.sand`; `> 0.05` → `step.grit`; room kind `burial | antechamber` → `step.granite`; else `step.stone`; quiet steps (`idle` was ≥ `QUIET_GAP` before the move: the director keeps `s.idle` from the previous frame) −8 dB; gain −18 dBFS.
- Continuous loops (updated at 15 Hz, a param sent only when it moved > 0.5 dB / 0.02 pan): hand flame by `hand.kind` (embers when out), gain `0.35 + 0.65 · radius fraction`, crossfade 0.25 s on a kind change; the 2 nearest lit fixtures within 6 path steps (`fire.brazier` / `fire.sconce`; shrine candles silent); collapse `sand.pour` at `order[min(floor(fill), limit − 1)]` while `fill < limit`; the false door's `exit.air` at `floor.exit` once open; `seal.draught` at the nearest unopened seal within 6 path steps; `g.dread` from `guardianCue`: gain `smoothstep(16, 3, path)` (−6 dB more while not hunting), pan from `dx`, muffled while `!visible`.
- Ambience (`ambience.ts`): `BEDS: Record<PyramidId, BedSpec>`; Egypt full; maya/cambodia/china/black → `BEDS.generic` (room + air at other EQ) until tasks 07–09. Depth: `air` gain falls `1 → 0.35` from floor 1 to 25, `room` rises `0.6 → 1`, the 45 Hz tone from floor 18; spots every 6–20 s (rate ×1.5 from floor 18). Title and map: `bed.exterior`. Crossfades 1.5 s between screens.
- Levels (dBFS at 1 tile, before user volume): steps −18 (quiet −26), hand flame −24, braziers −22, pickups −14, ignite −16, plate −14, block −6, portcullis −8, quake −6, guardian steps −14 (−20 muffled), spotted −10, dread up to −20, star chimes −14, UI −20, beds −30 (room) / −32 (air), spots −28 → −34.
- Ducking (`engine.duck`): quake / block / portcullis / trapFired sandfall: ambience −8 dB (attack 0.05, hold 1.2 s, release 1.5 s); `artifactTaken`: ambience −10 dB 2.5 s; hunting and visible: ambience −6 dB while it lasts (the tomb goes quiet); `exitOpened`: world −4 dB 1 s. Overlays (paused/camp/panels): world and guardian buses fade to 0 over 0.25 s, ambience −10 dB; the overview plays `descend`/`fall`/`escape.out` and the star chimes on the ui bus.
- Settings v2: `sfx: number` (0.8), `ambience: number` (0.7) — `master = sound ? 1 : 0` (the existing toggle is the mute), world/guardian/ui follow `sfx`, ambience follows `ambience`. Settings screen: "Sound" toggle (note removed) + two `Segmented` rows "Effects" and "Ambience" with Low 0.35 / Medium 0.65 / High 1.0 (snapped to the nearest on load), disabled while muted.
- UI sounds: `src/audio/ui.ts` `uiSound.tap()` etc.; `Button` and `IconButton` play `ui.tap` next to `haptic.tap()`; `Panel` mount `ui.panel`; settings toggles `ui.toggle`; map seal animation `ui.seal`.

### 14. Haptics (`src/ui/haptics.ts`) (Q36–Q37)

Pattern table, a pulse = `[ms offset, style]`; styles `selection | light | medium | heavy | soft | rigid | success | warning | error`; on Android, `selection` → `performAndroidHapticsAsync(Context_Click)` (API 23+), the rest via `impactAsync`/`notificationAsync`.

| Pattern | Pulses | Used by |
|---|---|---|
| `tap` | 0 selection | UI, swap |
| `step.sand` | 0 soft | first wading step after dry ground only |
| `pickup` | 0 light | pickup, treasure |
| `refill` | 0 soft, 90 light | refill |
| `ignite` | 0 soft | lit, autoLight |
| `plate` | 0 rigid | plate |
| `block` | 0 heavy, 70 rigid, 180 light | trapFired block, hit, guardianHit |
| `portcullis` | 0 rigid, 380 heavy | trapFired portcullis |
| `sandfall` | 0 light, 200 soft, 420 soft | trapFired sandfall |
| `trapdoor` | 0 medium · landing 0 heavy | fell / fall overview |
| `quake` | 0 heavy, 90 medium, 200 medium, 330 light, 500 light, 700 soft | quake |
| `heartbeat` | 0 medium, 140 light | repeated while the guardian is within 8 path steps and unseen: period 1.1 s at 8 → 0.6 s at 2 |
| `wake` | 0 heavy, 160 medium, 400 soft | guardianWake |
| `spotted` | 0 heavy, 120 heavy | guardianSpotted |
| `touch` | 0 error | guardianTouch |
| `caught` | 0 heavy, 180 medium, 380 light | caught |
| `lowLight` | 0 soft, 260 soft | lowLight |
| `artifact` | 0 success, 300 medium, 450 light, 600 light | artifactTaken |
| `grind` | every 150 ms for 1.5 s: medium → light → soft (decaying) | exitOpened |
| `knock` | 0 light | secretKnock |
| `break` | 0 heavy, 120 medium | secretBreak |
| `found` | 0 success | fragment |
| `star` | 0 light | each star pop |
| `wall` | 0 light | walker bump (unchanged) |

`createHapticSequencer()`: `play(pattern)`, `tick(dt)` (driven by the game clock in GameScreen's loop and by `useTicker`-time in the overview, so a pause freezes patterns), min 50 ms between pulses (ERM motors blur faster ones), at most 6 queued (drop the lowest priority), `heartbeat` never stacks. `haptic.tap/bump/heavy/success/warning` stay as aliases. Respects `settings.haptics` (the existing "Vibration" toggle, note: "Heartbeat of the guardian, traps, pickups"); web no-op.

### 15. GameScreen wiring

- Replace the placeholder haptic block with `director.update(g, dt, true)` + `feedback` haptics; the sequencer ticks in the same loop; `walker` bump → `haptic.play('wall')`.
- Floor change (`seenFloor !== g.floor`): `noteFloor(id, floorIndex, floor.secrets.length)`, `director.reset(g)`.
- Events: `secretBreak` → `art.prepareOpened()`; `secretOpen` → `art.open(k)` (k from `at`), caption "A hidden chamber"; `secretKnock` → caption "It sounds hollow."; `treasure` → `markSecret`, caption "+ {TREASURE_NAME}"; `fragment` → phase `fragment` after 0.4 s.
- Hint `secret` (once per save): when an unopened seal tile is lit ≥ 0.3: "This plaster is newer than the stone around it. Push it."
- Phases gain `result` (replay) and `fragment`; overlays stop the world buses (§13).

## Files

Add:
- `src/game/core/secrets.ts` — types, constants, `placeSecrets`, `secretAtSeal`, `pushSeal`, `tickSecrets`, `takeSecretAt`.
- `src/game/core/stars.ts` — `STAR`, `PAR`, `routeSteps`, `parTime`, `floorResult`, `starCount`.
- `src/game/story.ts` — `STORY` (Egypt's eight fragments).
- `src/game/render/drawSecrets.ts` — breaking, grave goods, motes; `drawStar` for UI canvases.
- `src/state/migrateProgress.ts` — pure migration v1–v5.
- `src/audio/engine.ts`, `engineExpo.ts` (fallback only if needed), `spatial.ts`, `director.ts`, `feedback.ts`, `ambience.ts`, `ui.ts`, `manifest.ts` (generated).
- `scripts/make-sounds.ts`, `scripts/sound/dsp.ts`, `scripts/sound/recipes.ts`, `scripts/sound/sounds.lock.json`, `assets/sounds/*.m4a`.
- `scripts/check-secrets.ts`, `scripts/check-stars.ts`, `scripts/check-sounds.ts`.

Change:
- `floor.ts` (`Floor.secrets`, `Layout` omit), `generate.ts` (`placeSecrets` last), `architecture.ts` (`secrets?`, `fragment?`, generic/black), `egypt.ts` (`EGYPT_SECRETS`, `EGYPT_FRAGMENT_FLOORS`), `game.ts` (events, state, `move` push/take, `tick`). `guardian.ts` is unchanged (the knock/break noise radii live in `secrets.ts` and go through `noise()`).
- `render/floorArt.ts` (`sealedDoor`, carved recording, `prepareOpened`, `open`, raster overlay), `render/drawGame.ts` (`drawSecrets`, draught lean), `render/themes.ts` (`plaster`, `bedrock`, `ochre`).
- `screens/GameScreen.tsx`, `screens/play/FloorOverview.tsx` (results), `screens/play/walker.ts` (`interesting` includes untaken grave goods), `app/play/[id].tsx` (replay), `app/pyramid/[id].tsx` (grid, panel, records, story), `app/artifact/[id].tsx` (stars line), `app/settings.tsx` (volumes), `app/_layout.tsx` (engine init, `bed.exterior` on title/map), `app/map.tsx` (`ui.seal`), `ui/Button.tsx`, `ui/Panel.tsx`, `ui/haptics.ts`.
- `state/progress.ts` (v5, `floors`, actions, selectors, `HintId` + `'secret'`), `state/settings.ts` (v2 `sfx`, `ambience`, migrate).
- `package.json` (`react-native-audio-api` 1.0.1, remove `expo-audio`, scripts `sounds`, `check:sounds`), `app.json` (plugins), `scripts/check-floors.ts` (call `runSecretChecks`, `runStarChecks`; ASCII `H` seal, `h` chamber tiles, `*` grave good; key `egypt:i:sec`), `scripts/check-light-rules.ts` (`hashState(full)` + secret fields), `scripts/floors.snapshot.json`.
- `CLAUDE.md` — Stack (audio-api), Layout (`src/audio`, `scripts/sound`, new core files), Journey (stars, secrets, replay a floor), Rules ("sound and haptics read state and events only; the sound set is generated by `npm run sounds`, never edited by hand; `.m4a` + lock are committed"), Commands (`npm run sounds`, `npm run check:sounds`). `plans/README.md` Status: phase 2 done.

## Implementation order

1. **Gate**: `npx expo install react-native-audio-api@1.0.1` (pin exact), plugin options, `npx expo-doctor`, `npx expo export -p android` and `-p web`; a dev build (`eas build -p android --profile development`, or `npx expo run:android` if an SDK is present) plays a test tone with a StereoPanner. If the native build fails, keep `expo-audio`, write `engineExpo.ts` and log it in the question file; otherwise remove `expo-audio`.
2. `npm run check:floors` on `3dfcdb0` passes; note the hashes.
3. `secrets.ts` placement + `Floor.secrets` + profile data; `check-secrets.ts` placement asserts; every existing snapshot key unchanged; add `egypt:i:sec`.
4. Secret rules in `game.ts`; rule tests; replay keys: update only those that change, and list which in the question file.
5. `stars.ts` + `check-stars.ts` (par table, informed bot); tune `PAR` only.
6. Progress v5 + `migrateProgress.ts` (+ tests in `check-stars.ts`), settings v2.
7. Art: sealed door, carved recording + `open`, `drawSecrets`, draught lean, grave goods, fragment panel painting (headless PNGs at 120 px/tile).
8. UI: replay mode, overview results, pyramid grid/panel/records/story, artifact line, fragment panel, pause line, hints/captions.
9. Sound kit + recipes + `make-sounds.ts`; listen to every sound (WAV in the scratchpad), iterate; `check-sounds.ts`; commit `.m4a` + lock + manifest.
10. Engine, spatial, director, feedback, ambience, UI sounds; settings screen.
11. Haptic patterns + sequencer; remove placeholders.
12. CLAUDE.md, README status; full verification.

## Verification

- `npx tsc --noEmit`, `npx expo-doctor`, `npx expo export --platform android --output-dir <scratchpad>` and `--platform web`.
- `npm run check:floors` (fixed seeds + fuzz 1..100):
  - snapshots: every existing `egypt:*`, `maya/cambodia/china/black:*`, `egypt:i:g` key unchanged; `egypt:i:sec` committed (hash of seal, front, tiles, spot, treasure, fragment).
  - secrets placement: count = `profile.secrets(i)` on every floor of every real pyramid (fail), fuzz: ≥ 1 per floor (fail) and full count (warn %); seal ROCK north of a FLOOR front; rect + margin ROCK in `floor.tiles`; chambers ≥ 2 rock tiles apart; front not item/fixture/trap/target/exitFront/lair/niche, not 4-adjacent to a trap or lair; not in `stairsUp/stairsDown/burial`; exit pocket untouched; `spot` inside the chamber; fragment on secret 0 exactly on `EGYPT_FRAGMENT_FLOORS`; fixed seed: ≥ 80 % of secrets off the main path on floors 3–25.
  - secret rules: at `front` facing up: move → `secretKnock`, phase 1, `cooldown 0.3`, noise 4 queued (guardian floor: a guardian within 4 path steps investigates); second move → phase 2; after 0.6 s of ticks → phase 3, seal and tiles open in `grid`, light reaches inside, `distancesFrom(grid.solid)` reaches `spot`; step onto `spot` → `treasure` (+ `fragment` on fragment floors), bit set, second visit nothing; moving into a seal from the side or below does nothing; `retry`/`continue` start sealed; the guardian can path into an open chamber; replay 3000 random actions twice equal (floors 3, 18, 25).
  - stars: `routeSteps`/`parTime` table printed; **informed bot** (BFS route on solid + armed trap tiles, falling back to traps allowed; full cadence; real `step`/`tick` at 1/60 s; basement: stairs, then `exitFront`, then the door): fixed seed every floor cleared with `floorTime ≤ 0.8 · par` (fail), `< 0.35 · par` warns (too lax); fuzz 1..30 ≥ 95 % (warn). `floorResult`: stairs → cleared; trapdoor → not cleared, found kept; landed by a fall → never fast; `starCount` cases.
  - migration: v3 and v4 sample saves → v5 with `floors` as specified, everything else equal.
  - timing (warn): `placeSecrets` < 5 ms on floor 24; `tickSecrets` negligible.
- `npm run check:sounds`: every manifest id has its file; re-rendered WAV sha1 equals the lock (the committed set matches the script); peaks ≤ −1 dBFS; |DC| < 0.001; loop seams: RMS of the 10 ms across the loop point within ±1.5 dB of the neighbouring 10 ms and no step > 0.05; ffmpeg-decoded duration within 60 ms of the render; total size ≤ 2.5 MB (fail), > 2.0 MB (warn).
- Headless render (canvaskit-wasm harness in the scratchpad): sealed doorway at 120 px/tile, breaking frames, opened chamber with each grave good, fragment painting, overview star row.
- Web preview: title/map exterior wind after the first tap; floor 3: hint at the plaster, knock "It sounds hollow", break, chamber opens in the art, take the amulet, fragment panel; descend → overview with three stars popping and chimes; pyramid page grid, floor panel, replay floor 3 → result panel → Play again / Back; footsteps change on sand and granite; panning when a sconce is left/right; walls muffle the guardian; volumes and mute in settings act live; a v4 save loads with cleared stars.
- Device (release `preview` APK, Redmi 9): floor 24 with guardian hunting, collapse pouring, 2 braziers, footsteps: 60 fps walking, no audio crackle/dropouts over 5 min; tap-to-sound latency ≤ 80 ms by ear/video; haptic heartbeat readable; APK size delta measured (audio-api native libs + sounds).

## Performance budget (Redmi 9: Helio G80, Mali-G52, Hermes)

- Audio thread (native): ≤ 24 voices + 2 convolvers (0.9 s / 2.4 s stereo, FFT-partitioned) + ~6 loops ≈ 10–15 % of one A75 core; if dropouts appear: one convolver (large IR at a lower send for passages), 16 voices.
- JS per frame: director ≤ 0.3 ms (event scan, ≤ 3 one-shots, 15 Hz loop params with thresholds), BFS from the player on each move ≈ 0.2 ms (≤ 7/s), haptic sequencer O(1). Node creation per one-shot: 3–4 JSI calls.
- Memory: decoded audio ≤ 32 MB; secrets add ≤ 3 small arrays per floor.
- Render: seal telltale baked (0 per frame); breaking/goods ≤ 25 ops when visible; the carved picture recorded once per floor at the first break (≈ the cost of one floor record, hidden by the 0.6 s break; move to the overview if > 30 ms on device); re-raster of ≤ 4 chunks on open.
- Startup: core sound group decode ≤ 250 ms on a background native thread, not blocking the splash; the game group under the overview.

## Risks

- `react-native-audio-api` 1.0.1 on RN 0.88 / SDK 58 is unverified here (released 2026-11-16, peer deps `*`): Step 1 gates it; the engine interface keeps the expo-audio fallback cheap (loses panning, filters, reverb).
- Procedural sound can sound synthetic: the recipes lean on physical models (modal, granular, friction) and real room reverb; budget time in Step 9 to listen and iterate; any sound that does not convince is simplified rather than shipped harsh.
- AAC priming at loop points: handled by padded loops with explicit `loopStart/loopEnd`; the seam check runs on the decoded files.
- Par too tight/lax for humans: the informed bot bounds it; tune `PAR` from playtests (one constant table).
- Players bumping every wall to find seals: two pushes, a 0.3/0.6 s cost and guardian noise make it a choice; the plaster telltale and the draught (sound and flame) reward looking.
- Opened-chamber re-raster: chunk retirement keeps the old image alive for 4 `ensure` calls (existing rule), so no flash.
- Battery: the context is suspended in background and on long pauses (> 30 s on a panel).
