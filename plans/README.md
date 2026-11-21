# Plans

The roadmap from the user's brief (2026-11-21), split into tasks. Each task gets a plan (`plan_NN.md`) and a question log (`plan_NN_question.md`), written by its own planning agent.

**Process (changed 2026-11-21): one task at a time.** Plan task N → implement task N (its own isolated agent in a git worktree, Sonnet 5.5) → merge → only then plan task N+1 against the real code. A commit closes every task and every phase. Plans 01–03 were written before this change; plan 03 is re-checked against the code before it is implemented.

Inputs every agent reads first: `CLAUDE.md`, `AGENTS.md`, this file, and every earlier plan.

**The design doc is an entry point only, not a spec.** `plans/design-doc.md` (text copy) gives the game idea, the world, and the mechanic names. Do not follow it literally: its prototype look, sizes, numbers and simple-shapes style are superseded. The end result must be far more realistic and better looking than the doc describes. Where the doc and this file disagree, this file and the user's requirements win.

## Cross-cutting requirements (from the user, apply to every task)

1. **Professional look.** The app must look like a modern, polished commercial mobile game, never like an 80s minigame: rich lighting, materials, depth, considered typography and motion, no flat placeholder boxes in the final result.
2. **Real cultures, real architecture.** Every pyramid looks like the real thing: Egypt like Giza-era Egyptian pyramids (smooth limestone casing, sandstone, gold capstone), Maya like a Classic Maya stepped temple-pyramid (talud-tablero tiers, central stairway, roof-comb temple, jungle), Cambodia like Koh Ker's Prasat Thom (seven-tier grey sandstone/laterite step pyramid, roots, moats), China like an imperial mausoleum (truncated earthen pyramid with red lacquer, bronze, glazed tiles, clay soldiers). This holds for the in-floor tiles, the side view between levels, the world map and the 3D view. Ornaments are inspired by each culture, never copies of real inscriptions; no caricature, no real deities as monsters. The Black Pyramid is fictional: black stone, older than all.
3. **The labyrinth is architecture, not a grid of squares.** Floors read like real buildings: corridors, halls, chambers, pillared rooms, side niches, stairwells, varied room sizes and shapes, walls with thickness. Logic may still sit on a grid (determinism, step()), but what the player sees and walks must feel like a real place built for use.
4. **Many light sources.** Along the paths the player can find light: small torch, big torch, oil lamp, candles, oil jar, etc., each lasting a reasonable, different time (all deterministic, placed by seed).
5. **Memory fades.** Walked/seen path is shown dimmed only for the most recent ~20 cells; older cells fall back into complete darkness as if never visited (the player forgets).
6. **Rules from CLAUDE.md stay:** deterministic UI-free core, one Skia canvas, no RN view per object, Reanimated UI-thread animation, `tsc --noEmit` and `expo-doctor` before finishing, judge performance only on release APK.

## Phases and tasks

| # | Phase | Task |
|---|---|---|
| 01 | 1 · Prototype (Egypt 1–10) | Architectural floor generator: halls, chambers, corridors, pillared rooms; Egypt floors 1–10; camps at 5 and 10 |
| 02 | 1 · Prototype | Light sources (small/big torch, lamp, candles, oil), fading memory (~20 cells), swipe + hold-to-walk controls |
| 03 | 2 · Egypt complete | Egypt to 25 floors (size curve), collapse (sand pours in), pressure-plate traps, trapdoors |
| 04 | 2 · Egypt complete | Mummy guardian (sound/vibration warning, follows downstairs late) and the artifact escape |
| 05 | 2 · Egypt complete | Stars, records, secrets; sound (code-generated) and haptics |
| 06 | 3 · World and pyramids | World map rework, artifact powers (each helps in another pyramid), pyramid select flow |
| 07 | 3 · World and pyramids | Maya: rotating chambers, flooded cenotes, jaguar spirit, Obsidian Mirror |
| 08 | 3 · World and pyramids | Cambodia (Koh Ker): growing roots, water levels, naga statues, Naga Amulet |
| 09 | 3 · World and pyramids | China (imperial tomb): statues move in darkness, mercury channels, clay soldiers, Jade Seal |
| 10 | 4 · Code-made art | Material shaders: stone, sand, wood, water; tile endlessly, recolor per pyramid |
| 11 | 4 · Code-made art | Torch light, flicker, darkness, glow, fog, dust and embers (shaders + Atlas particles) |
| 12 | 4 · Code-made art | Pixel-grid tiles, items, light sources, player and icons in code |
| 13 | 4 · Code-made art | Culture ornaments + realistic architecture: floors, walls, and the between-levels side view per pyramid |
| 14 | 4 · Code-made art | SVG icons, logo, professional UI layouts, the world map art |
| 15 | 4 · Code-made art | Low-poly 3D pyramid (three.js / react-three-fiber) for the between-floors transition |

Note: phase 2 lists "real art"; it is delivered by phase 4 for all pyramids at once (see `plan_03_question.md`). Every earlier task must still avoid making things look worse and keep draw code ready for phase 4.

## Question logs

`plan_NN_question.md`: every open question or decision for that task, the options, and the answer picked (best for the end user in graphics and realism, most accurate technically, unless that makes the app too heavy or slow on a budget phone like the Redmi 9). Implementation agents append to the same file.

## Status

| Phase | State |
|---|---|
| 1 · Prototype (tasks 01–02) | done 2026-11-21 (`996fb66`, `788b670`); device feel and FPS not yet checked on a phone |
