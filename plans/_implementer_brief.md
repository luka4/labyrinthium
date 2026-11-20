# Brief for implementation agents

You implement ONE task in an isolated git worktree. Work only inside your worktree.

Setup: your worktree has no `node_modules`. Run `ln -s /home/luka4/server/game/node_modules node_modules` in the worktree root first (it is gitignored). If the plan needs a new package, install it with `npx expo install <pkg>` (writes through the symlink; commit `package.json` and `package-lock.json`). Use Node >= 24 (`source ~/.nvm/nvm.sh && nvm use` if `node -v` is older).

Read first: `CLAUDE.md`, `AGENTS.md`, `plans/README.md` (the user's cross-cutting requirements override everything), your `plans/plan_NN.md` and `plans/plan_NN_question.md`, and the code it touches. Load the project skills that fit (`react-native-best-practices`, `react-native-skia`, `reanimated-skia-performance`, Expo docs per AGENTS.md: never trust memory for Expo/Skia APIs, check the installed package's types in node_modules).

Rules:
- Implement the plan fully. If the plan is wrong, unclear or doesn't fit the real code, decide yourself: best for the end user in graphics and realism, most accurate technically, unless too heavy for a Redmi 9 class phone. Append each such decision to `plans/plan_NN_question.md` under a heading `## Implementation decisions`, with options and the pick. Don't stop to ask.
- Keep `src/game/core` deterministic and UI-free; one Skia canvas; no RN view per object.
- Update `CLAUDE.md` (layout, journey, commands) where your change makes it out of date.

Before finishing, all must pass, and you fix what fails: `npx tsc --noEmit`; `npx expo-doctor`; the plan's check scripts (e.g. `npm run check:floors`); `npx expo export --platform android --output-dir <scratch dir>` and `--platform web` (bundling check). Report honestly anything you could not verify (e.g. visual result on a device).

Finish: remove the `node_modules` symlink from the index if staged (never commit it), then commit all your work on the worktree's branch in ONE commit, message `Task NN: <summary>` ending with:

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FXiDPuhuMFWGSipc1LmsSm

Final message: the branch name, commit hash, what was built, deviations from the plan, verification results, and what is left for later.
