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
                            -> carvers -> niches -> hooks -> masks, main path, oil; floorFor(pyramid, i) (memoised, world-aligned)
  carvers.ts                one carver per room kind (passage, chamber, hall, gallery, magazines, shrine, antechamber, stairs, burial)
  vision.ts                 torch light: line of sight over the `opaque` mask, walls never lit
  game.ts                   GameState + step(state, action): move / tick / continue / retry; camps (isCampFloor, lastCamp)
  pyramids.ts               PYRAMIDS (rules + display data), SEALS (door order)
src/game/render/            imperative Skia drawing: drawGame (board), floorArt (baked architecture image per floor),
                            lightMask (per-frame light image), themes (floor palettes), drawPyramidSide (between floors),
                            drawWorldMap, drawRelic (artifact, title torch), art.ts (shared helpers)
scripts/check-floors.ts     generator checks (npm run check:floors), floors.snapshot.json = per-floor hashes
src/screens/GameScreen.tsx  play screen: input, game clock, HUD, overlays (overview, camp, pause, burnt out)
src/screens/play/           FloorOverview (the "where am I" side view between floors)
src/state/                  zustand + AsyncStorage persist: progress.ts (artifacts, camps, records), settings.ts
src/ui/                     theme tokens, Button, Screen/TopBar, Panel (in-screen overlay), ArtCanvas/useTicker
```

## Journey

Title → map → pyramid → play. Egypt has 10 floors (floor 10 is the basement: a burial chamber, the artifact sits in front of the sarcophagus), the other pyramids 5 (the artifact sits where the stairs would be). A camp is every floor whose 1-based number divides by `campEvery` (5): Egypt floors 5 and 10, the others floor 5. A camp saves the checkpoint and refills the torch; a burnt-out torch sends you back to the last camp (or the top). Floors are architecture (halls, galleries, chambers, storerooms, thick walls), world-aligned: you arrive under the previous floor's stairs. Leaving a run mid-way resumes from the last camp. Four artifacts open the Black Pyramid (also playable); finishing it shows the ending. In `__DEV__`, Settings → Developer grants 0–4 artifacts to test the seals and the door, and starts Egypt at camp 5 or 10.

## Rules

- **Game logic stays deterministic and UI-free** in `src/game/core`: same seed + same actions = same result. Ghosts, replays, server checks and multiplayer depend on it. No `Math.random`, no `Date.now` in core; time comes in through `tick` actions.
- A floor has two masks: `solid` (movement) and `opaque` (light); pillars/benches/sarcophagus differ between them. Never read tiles for logic where a mask exists. Generator math is integer-only (no `Math.pow/hypot/sin`) with separate rng streams (layout, rooms, items, one per hook); changing floor k changes floors after it (world-aligned arrival), so re-run `npm run check:floors -- --update` and review the diff.
- Rendering the board: the architecture is baked once per floor into one image (`bakeFloor`, hidden by the overview), each frame draws that image, sprites, a 2x2-px-per-tile light mask (DstIn) and the torch tint; the camera follows the player (15 tiles across).
- Floors are generated from fixed seeds (`floorSeed(pyramid, floorIndex)`): every player gets the same pyramid. Random seeds only for daily/endless modes.
- Torch burns by time (`TORCH_SECONDS`), not steps; an oil jar refills it completely.
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
