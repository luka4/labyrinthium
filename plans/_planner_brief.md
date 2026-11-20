# Brief for planning agents

You write a plan only; do NOT change any source code.

Read first: `CLAUDE.md`, `AGENTS.md`, `plans/README.md` (the task list and the user's cross-cutting requirements, which override everything), `plans/design-doc.md` (an entry point only, NOT a spec: the end result must be far more realistic and better looking than it describes), and every earlier `plans/plan_NN.md` and `plans/plan_NN_question.md`. Earlier tasks are planned but NOT yet implemented: plan on top of the code as the earlier plans will leave it (their data models, hooks, extension points), and reuse rather than duplicate. Then read the current code your task touches.

Write two files:
1. `plans/plan_NN.md`: goal; scope (in/out); design (core data model and rules, number tables, rendering, UI); exact files to add/change; step-by-step implementation order; verification (tsc, expo-doctor, deterministic checks extending the `check:floors` script from plan 01, web preview check); performance budget for a Redmi 9 class phone; risks.
2. `plans/plan_NN_question.md`: every open question/decision, the options, and the answer you PICKED with a one-line reason. Pick what is best for the end user in graphics and realism and most accurate technically, unless it makes the app too heavy or slow. Never leave a question unanswered. If the file already exists, keep its entries and add yours.

Be concrete and implementable by another agent with no other context. Keep it tight, no filler. End your final message with a 5-line summary of the plan and key decisions.
