# Roadmap process and hand-off

How the roadmap in this folder is run, what is done, and how to pick it up again. Read with `README.md` (the user's cross-cutting requirements and the task table), `_planner_brief.md` and `_implementer_brief.md`.

## The user's instructions (2026-11-21)

- Split the roadmap (phases 1–4 below) into tasks; plan each task with its own agent; implement each with a separate, isolated agent.
- Every question or decision goes into `plan_NN_question.md` with the answer picked by Claude as a temporary solution: best for the end user in graphics and realism, most accurate technically, unless that makes the app too heavy or slow (budget phone: Redmi 9). Show which answer was picked.
- All pyramids look like the real thing (Egypt like Egypt, Maya like Maya, Cambodia like Koh Ker, China like an imperial tomb), including the view between levels.
- The labyrinth is not squares: it reads like a real building made for use.
- Light sources along the paths: small and big torches, lamps, candles, etc., each lasting a reasonably different time.
- Memory fades: only about the last 20 cells stay dimmed; older ones go back to complete darkness.
- The app looks professional, not like an 80s minigame.
- The design doc (https://claude.ai/artifact/GJv23F6drqxG6GQt6fpSD9, text copy `design-doc.md`) is an entry point only, not a spec: the end result must be far more realistic and better looking.
- Commit everything before starting (done: `22578a7`); commit when each phase completes.

## Process (one task at a time)

Changed during the session from "plan everything first": plans written far ahead go stale once code drifts. Now:

1. **Plan task N** with a planning agent (`general-purpose`, Opus), against the real merged code. Prompt: "You are the PLANNING agent for task NN … Follow plans/_planner_brief.md exactly", plus the task description below and the hooks left by earlier tasks (read them from the previous task's report / question log). Output: `plan_NN.md`, `plan_NN_question.md`.
2. **Orchestrator review**: read the summary; if the plan needs something agents can't do here (device builds, EAS, listening, a phone), add an orchestrator entry (`## QNN (orchestrator)`) with the picked workaround. Commit the plan (`Plan NN: …`).
3. **Implement task N** with an implementation agent (`general-purpose`, model `sonnet` = Sonnet 5.5, `isolation: worktree`). Prompt: "You are the IMPLEMENTATION agent for task NN … Follow plans/_implementer_brief.md exactly, then implement plans/plan_NN.md (…summary…) using plans/plan_NN_question.md." It symlinks `node_modules`, logs its own decisions under `## Implementation decisions`, verifies (tsc, expo-doctor, check scripts, android + web export), and makes ONE commit on its worktree branch.
4. **Merge** on master: check no `node_modules` in the branch tree; `git merge --no-edit <branch>`; `npm install` (new devDependencies such as `tsx` don't reach the main `node_modules` through the agent's symlink otherwise); `npx tsc --noEmit`; `npm run check:floors`; remove the worktree and branch.
5. If an agent is cut off (rate limit), resume it with SendMessage instead of starting a new one; its worktree is kept.
6. After the last task of a phase, add a row to the Status table in `README.md` and commit `Phase N complete: …`.
7. Only then plan task N+1.

## Status

| Task | Plan | Implementation | Notes |
|---|---|---|---|
| 01 Architectural floors | done | done `996fb66` | Egypt floor 3 room share 72% (warning, tuning) |
| 02 Lights, memory, controls | done | done `788b670` | board redraw via memoised `Board`, not Reanimated shared value |
| 03 Egypt 25 floors, collapse, traps | done, revised after 01–02 | done `e8bd339` | collapse on floors 11–13, 17 too gentle (bot never sealed in) |
| 04 Guardian, artifact escape | done | done `3dfcdb0` | guardian numbers not tuned beyond plan |
| 05 Stars, secrets, sound, haptics | done | done `76eb0fb` | 91 code-made sounds unheard; audio-api needs one device check (Q39); 10 lax par warnings (tuning) |
| 06 World map, powers, pyramid infrastructure | done | done `49dd590` | globe land path 2.5 ms on desktop (unmeasured on phone); power and water sounds unheard |
| 07–15 | not started | not started | NEXT: plan task 07 |

Phase 1 complete (`601f342`). Phase 2 complete (commit `Phase 2 complete`). `check:floors` prints ~60 warnings: 41 are tiny fuzz floors with no rock for a secret (expected), the rest are tuning notes (lax pars, collapse sealed-in rates, collapse caps, floor 3 room share).

### Checks only the user can do (pending)

- Dev build on a phone (`eas build -p android --profile development`): touch feel (swipe 14 dp, hold, flick), the guardian, haptics, and that sound plays with left/right panning (`react-native-audio-api`, plan 05 Q39). If the native audio module fails, the app falls back to `expo-audio` (no panning).
- Release APK (`--profile preview`) on the Redmi 9: 60 fps on floor 24 with chunked floor art, light mask and sand.
- Listen to the sounds: `npm run sounds -- --wav <dir>` writes WAVs; agents only checked them objectively (peaks, seams, spectra).
- After the device build confirms audio-api: remove `src/audio/engineExpo.ts`, the `expo-audio` dependency and its plugin entry.
- Task 06, release APK on the Redmi 9: the globe turning (drag, coast, card fling) at >= 50 fps (the land projector is 2 ms on a desktop, unmeasured on the phone); floor 24 with the Mirror active (radius 9.5) + collapse + guardian at 60 fps.
- Task 06, listen: `npm run sounds -- --wav <dir>` for the new `power.*`, `water.*`, `breath.low`, `drowned` ids; the Jade's world-bus muffling (`setBusFilter`) needs a device build of audio-api.
- Web preview (`npm run web`): task 05's agent drove it in Chromium (secrets, replay floor, sound); the descent overview with the star pop and the guardian/basement floors were checked by scripts only.

## Remaining task descriptions (what each planner gets)

Each planner also gets: "Tasks 01–(N-1) are IMPLEMENTED and merged; plan against the real code (their Implementation decisions and src/)", plus the hooks the previous tasks left.

**06 · World map, artifact powers, pyramid flow (phase 3).** Rework the world map (realistic geography/placement of the four pyramids and the sealed Black Pyramid, professional look; final art comes in task 14, but layout and flow are final). Artifact powers as tools, each best in another pyramid: Golden Scarab briefly points to the stairs (best in Cambodia), Obsidian Mirror reflects the torch for wide light (best in China), Naga Amulet lets you pass through water / swim longer (best in Maya), Jade Seal freezes guardians and mechanisms (best in Egypt). How powers are used (charges, cooldown, deterministic core actions), how they show in the HUD, the seals on the Black Pyramid door, pyramid select and detail flow, progress migration. Shared pyramid infrastructure the next three tasks reuse (per-pyramid floor tables like `egypt.ts`, profile, guardian and rule plug-ins).

**07 · Maya (phase 3).** A Classic Maya stepped temple-pyramid: realistic architecture profile for floors (corbel-vaulted passages, talud-tablero, stairways, stucco, jungle roots). Its rule: calendar wheels turn 3×3 chambers by 90° (a lever), opening one path and closing another; flooded cenotes. Hunter: a jaguar spirit that hunts by sound. Artifact: Obsidian Mirror. Floor table, camps, secrets, sounds and ambience (reuse task 05's synth), checks. Respect the living culture: no caricature, no real deity as a monster, ornaments inspired by, not copied from, real glyphs.

**08 · Cambodia, Koh Ker (phase 3).** Prasat Thom-style seven-tier sandstone/laterite step pyramid: architecture profile (laterite galleries, sandstone lintels, moats). Rule: roots grow and close or break walls over time; water levels change. Hunter: stone naga statues. Artifact: Naga Amulet. Same deliverables as 07.

**09 · China, imperial tomb (phase 3).** Imperial mausoleum (truncated earthen pyramid; inside red lacquer, bronze, glazed tiles, clay soldiers). Rule: statues move only in darkness; mercury channels. Hunter: clay soldiers. Artifact: Jade Seal. Same deliverables as 07. After this task phase 3 is complete (the Black Pyramid itself keeps its current playable state unless a plan decides otherwise).

**10 · Material shaders (phase 4).** Stone, sand, wood and water textures as Skia runtime shaders: tile endlessly, recolour per pyramid, almost no download size; realistic (ashlar, limestone, laterite, stucco, lacquer, bronze patina, wet stone, sand ripples, flowing water). Integrate with the chunked floor art (task 03) and keep the Redmi 9 budget.

**11 · Light and atmosphere (phase 4).** Torch light, flicker, darkness, glow, fog, dust and embers: a coloured light shader per source kind (task 02's sources and fixtures), soft shadows along walls, volumetric dust, sand haze (task 03), embers and dust as Skia `Atlas` particles (500+ on a Redmi 9).

**12 · Sprites and icons in code (phase 4).** Small tiles, items, light sources, the player, the guardians and icons drawn from code (pixel grids or procedural vectors; decide what looks most professional and realistic at phone resolution, the user wants realism over retro) replacing the current vector sprites.

**13 · Culture ornaments and real architecture (phase 4).** Procedural ornaments inspired by each culture (not copies of real inscriptions) on walls, friezes, doors, columns; per-pyramid architecture in the floor art; the between-levels side view of every pyramid looking like the real building (Giza casing and capstone; Maya stairway and roof comb; Koh Ker seven tiers; Chinese mausoleum mound and spirit way; the fictional Black Pyramid).

**14 · UI, icons, logo, world map art (phase 4).** SVG icon set, logo drafts and app icon, professional UI layouts for every screen (title, map, pyramid, play HUD, overlays, settings, artifact, ending), typography and motion; the world map's final art.

**15 · Low-poly 3D pyramid (phase 4).** react-three-fiber / three.js (expo-gl) low-poly 3D model of each pyramid built from geometry, used for the between-floors transition (camera dive one tier, current floor glowing); fallback to the 2.5D Skia view if too heavy. Part of the original performance test (with Skia torch + 500 particles and one Rive animation).

## How to resume

Tell Claude in this repo: "Continue the roadmap in plans/PROCESS.md." It should read this file, `README.md`, the briefs and the latest question logs, check the Status table and `git log`, and go on with the next step of the process (next: plan task 07).
