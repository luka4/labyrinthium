# CLAUDE.md

Read `AGENTS.md` first (Expo's own agent notes: fetch versioned docs, never trust memory for Expo APIs).

## Project

**Labyrinthium** (working title): a mobile labyrinth game. You wake at the top of a pyramid and descend floor by floor, by torchlight, to its basement, where a sacred artifact is kept. Four pyramids (Egypt, Maya, Cambodia, China) in any order; their four artifacts open the Black Pyramid; under it, the optional endless Drowned City.

Design doc (an entry point only, not binding; the end result must be far more realistic and better looking than it describes): https://claude.ai/artifact/GJv23F6drqxG6GQt6fpSD9. The working roadmap and decisions are in `plans/`.

Status: prototype with the full screen journey (Egypt 10 floors, the other pyramids 5). Next step is the one-day performance test on a budget Android phone (Redmi 9) with a release APK: Skia torch shader + 500 particles, a react-three-fiber pyramid transition, one Rive animation.

## Stack

- Expo SDK 58 (latest), React Native 0.88, React 19.3, TypeScript strict. Development build via EAS (`expo-dev-client`); no Expo Go.
- Rendering: `@shopify/react-native-skia` — the whole game is ONE canvas. Never a React Native view per tile, particle or effect (SpinBook's confetti stuttered for exactly that reason).
- Animation: Reanimated 4 + worklets on the UI thread. Interface animations later with Rive; 3D pyramid view later with react-three-fiber.
- Haptics `expo-haptics`, audio `expo-audio`, state `zustand` + AsyncStorage persist.
- Node >= 24 (`.nvmrc`), run `nvm use` first. Install native packages with `npx expo install <pkg>`.

## Layout

```
index.ts / index.web.ts     entries: Expo Router (web loads CanvasKit first, then src/web-root.ts)
src/app/                    routes only (Expo Router stack)
  index.tsx                 title
  map.tsx                   world map: 4 pyramids + the sealed Black Pyramid (?filled=<id> animates a seal)
  pyramid/[id].tsx          pyramid detail: side view, artifact, enter / continue from camp
  play/[id].tsx             a descent (?from=camp resumes at the saved camp)
  artifact/[id].tsx         basement reveal → map (or → ending for the Black Pyramid)
  ending.tsx, settings.tsx
src/game/core/              deterministic game logic, plain TypeScript, no React/Skia
  rng.ts                    seeded PRNG
  floor.ts                  Floor data model: TILE kinds + SOLID/OPAQUE flag tables, rooms, links, spots, DIRS, distancesFrom
  architecture.ts           ArchProfile per culture (sites per floor, room quotas, loops, niches), ROOM_CARVERS registry, hooks
  generate.ts               architectural generator: site lattice -> spanning tree + loops -> merged halls/galleries -> room kinds
                            -> carvers -> niches -> hooks -> brazier tiles -> masks, main path -> light sources; floorFor(pyramid, i) (memoised, world-aligned)
  carvers.ts                one carver per room kind (passage, chamber, hall, gallery, magazines, shrine, antechamber, stairs, burial)
  vision.ts                 light: computeLight(origin, radius, falloff) with line of sight over `opaque`, walls never lit; clearLine
  lights.ts                 light-source tables (CARRY, FIXTURE, EMBER, BAG_SIZE, STEP_SECONDS), radiusOf/radiusQ
  placeLights.ts            generator steps: braziers (solid tiles, connectivity-guarded), items by light budget, sconces, shrine candles
  memory.ts                 fading memory (last 20 moves): MEMORY_STEPS, memoryLevel
  walk.ts                   holdDir / runDir: corridor following and run-to-junction, pure
  game.ts                   GameState + step(state, action): move / tick / swap / continue / retry; hand + bag, fixtures, cadence (cooldown), trail stamps; camps
  pyramids.ts               PYRAMIDS (rules + display data), SEALS (door order)
  egypt.ts                  the 25-floor table and camp list
  traps.ts, collapse.ts     plate traps/trapdoors (placement + rules), sand collapse (+ the basement's escape sand); graph.ts BFS/articulation points; runtime.ts shared state helpers (emit with a tile, noise queue, recoil)
  guardian.ts               the tomb guardian: placeGuardian (lair, sentinel post, route), tickGuardian (AI, senses, noise, contact, follow), guardianCue
  escape.ts                 the basement escape: placeExit (false door + protected route), takeArtifact, tickEscape
src/game/render/            imperative Skia drawing: drawGame (board), floorArt (baked architecture image per floor),
                            lightMask (per-frame light + memory image), drawItems (light-source sprites, flames, glows), lightStyle (colour and flicker per source), drawLightHud (strip above the board), themes (floor palettes), drawPyramidSide (between floors),
                            drawWorldMap, drawRelic (artifact, title torch), art.ts (shared helpers); floorArt.ts records the floor as an SkPicture and rasterises 8-tile chunks on demand (LRU by bytes); drawTraps.ts, drawSand.ts,
                            drawGuardian.ts (the Keeper sprite, memory ghost), drawEscape.ts (Golden Scarab and plinth, false door opening, shaft mouth, pointer motes, smoke wisps)
scripts/check-floors.ts     generator + placement checks (npm run check:floors), floors.snapshot.json = per-floor hashes;
                            check-light-rules.ts = rules, memory, walk, replay determinism and the light-budget bot; check-guardian.ts = false door / guardian placement and fairness, guardian and escape rules
src/screens/GameScreen.tsx  play screen: input, game clock, HUD, overlays (overview, camp, pause, burnt out)
src/screens/play/           FloorOverview (the "where am I" side view), Board (the one canvas: light strip + board), LightHud (text and bag buttons over the strip),
                            walker (press / hold / flick into move actions), useKeyboard (web)
src/state/                  zustand + AsyncStorage persist: progress.ts (artifacts, camps, records), settings.ts
src/ui/                     theme tokens, Button, Screen/TopBar, Panel (in-screen overlay), ArtCanvas/useTicker
```

## Journey

Title → map → pyramid → play. Egypt has 25 floors (`src/game/core/egypt.ts` table: size, halls, loops, light, traps, collapse, target time; floor 25 is the basement: a burial chamber, the artifact sits in front of the sarcophagus), the other pyramids 5 (the artifact sits where the stairs would be). Camps are listed in `Pyramid.camps` (0-based): Egypt floors 5, 10, 14, 17, 20, 22, 24, 25; the others floor 5. Egypt traps: pressure plates (ceiling block, granite portcullis, sand released over tomb goods) and trapdoors that drop you to the next floor; from floor 11 the collapse: after the first move plus a delay, sand pours down the stairwell you came by and spreads (burying passages, items, lit fixtures; wading is slower; sealed in = `buried`, retry from camp). Core reads `s.grid`, never the floor's static masks, during a run. From floor 18 a tomb guardian (the Keeper, a mummified priest-guardian) stands dormant in a lair and wakes after a while or on a noise; it sees you by your own light (a bigger flame is seen from further, candle and embers hide you), hears your steps along the corridors (slow steps are quiet), trips plates when it rushes, wades in sand and puts out the fixtures it passes; contact smothers your hand light (a spare lights itself) and on embers it takes you (`caught`, back to the last camp); from floor 22 a guardian that is hunting you follows you down the stairs. In the basement a sentinel stands beside the burial chamber's door; lifting the Golden Scarab wakes the pyramid: the sand pours again 2.5x faster over more of the floor (never over the route to the exit), the sentinel rises, and a false door grinds open onto the workmen's escape shaft; step in to climb out (side-view overview, then the artifact screen). Escapes are recorded in `progress.records`. A camp saves the checkpoint and relights the better of your source and a torch, full (an eternal brazier burns beside the landing); with no light left (6 s of embers) you are sent back to the last camp (or the top). Floors are architecture (halls, galleries, chambers, storerooms, thick walls), world-aligned: you arrive under the previous floor's stairs. Light: you hold one burning source (torch 60 s at the start) and carry up to 3 spares in a bag; found along the way are small torches, big torches, oil lamps, candles and oil jars (refill), and you light wall sconces, braziers and shrine candles with your flame. When the hand source burns out the spare with most time lights itself. Memory: only what you saw during your last 20 moves stays dimly visible. Controls: swipe moves, holding keeps walking (follows corridor bends), a flick runs to the next junction (setting), web keyboard arrows/WASD, Shift runs, Esc pauses. Leaving a run mid-way resumes from the last camp. Four artifacts open the Black Pyramid (also playable); finishing it shows the ending. In `__DEV__`, Settings → Developer grants 0–4 artifacts to test the seals and the door, and starts Egypt at any floor 1-25 (stepper).

## Rules

- **Game logic stays deterministic and UI-free** in `src/game/core`: same seed + same actions = same result. Ghosts, replays, server checks and multiplayer depend on it. No `Math.random`, no `Date.now` in core; time comes in through `tick` actions.
- The guardian is core state (`s.guardian`, `s.escape`), tick-driven with a stored mulberry32 state (`nextRandom`), BFS ties in `DIRS` order, time only through `tick`. Sound and haptics read `GameEvent`s (they carry `at`, the tile) and `guardianCue(s)`; nothing else leaks the guardian's position (memory shows a silhouette where you last saw it).
- A floor has two masks: `solid` (movement) and `opaque` (light); pillars/benches/sarcophagus differ between them. Never read tiles for logic where a mask exists. Generator math is integer-only (no `Math.pow/hypot/sin`) with separate rng streams (layout, rooms, items, one per hook); changing floor k changes floors after it (world-aligned arrival), so re-run `npm run check:floors -- --update` and review the diff.
- Rendering the board: the architecture is baked once per floor into one image (`bakeFloor`, hidden by the overview), each frame draws that image, light-source sprites, a 2x2-px-per-tile light mask (DstIn; hand light, visible fixed lights, fading memory, cross-faded between steps), one coloured glow per light and the player; the `Board` component owns the picture state so a redraw never re-renders the screen; the camera follows the player (15 tiles across).
- Floors are generated from fixed seeds (`floorSeed(pyramid, floorIndex)`): every player gets the same pyramid. Random seeds only for daily/endless modes.
- Light burns by time per source (`lights.ts`), not steps; an oil jar refills the hand light completely. The move cadence (0.15 s per tile) is enforced in core by `cooldown`, so replays cannot walk faster than players. The core never reads colours or flicker (`lightStyle.ts` is render only). Light radius is quantised to 1/8 tile and the lit test is an exact comparison of squares, so engines agree.
- Judge performance only on a release (`preview`) APK on a real budget device, never in a dev build.
- Skia objects may be created at module scope (`drawGame.ts`, `art.ts`), so on web nothing may import Skia before `LoadSkiaWeb` resolves: `index.web.ts` imports `expo` (sets up the dynamic-import loader), loads CanvasKit, then imports `src/web-root.ts`. Keep `package.json` `main` as `index` so `index.web.ts` is picked.
- UI text and touch targets are React Native views over the Skia art (no Skia fonts). Skia's web `Canvas` needs a flattened style object, not an array.
- Every exit to the map goes back to the existing map screen (`router.dismissTo('/map')`), so back never lands on a finished run. Animations on screens that can sit under others are timed with `useTicker`, which counts only running time.
- Project skills live in `.claude/skills/` (Software Mansion RN best practices, Callstack performance, Skia, Reanimated+Skia); the Expo plugin is enabled in `.claude/settings.json`.
- Before finishing a change: `npx tsc --noEmit` and `npx expo-doctor`.

## Commands

| Command | What it does |
|---|---|
| `npm start` | Metro for the dev client over a tunnel (`expo start --dev-client --tunnel`; the WSL2 IP is unreachable from the phone) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run check:floors` | floor generator assertions and metrics; `-- --ascii egypt 10` dumps a floor, `-- --update` rewrites the snapshot |
| `npm run web` | browser preview at localhost:8081 (`index.web.ts` loads CanvasKit from `public/canvaskit.wasm` before App). A design and logic check only: web performance says nothing about phones |
| `npx expo-doctor` | dependency/config check |
| `npx expo export --platform android --output-dir <scratch>` | bundling check |
| `eas build -p android --profile development` | dev client APK |
| `eas build -p android --profile preview` | release-like APK for performance testing |

App identifiers `com.labyrinthium.app` are placeholders; change them before the first EAS build if needed.
