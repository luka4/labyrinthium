# Plan 02 · Questions and decisions

Each answer: picked option and a one-line reason. Implementation agents append below.

## Q1. Which light sources exist in an Egyptian pyramid
- A. Torch and oil jar only. B. Small torch, torch, big (pitch) torch, clay oil lamp, single candle, oil jar, plus fixed wall sconces, braziers and shrine candles. C. B plus glass lanterns, mirrors reflecting sunlight, glowing minerals.

**Picked: B.** All are attested or plausible for Old Kingdom work and tomb lighting (linen-wick torches soaked in fat, salted oil in clay saucer lamps, tallow candles, bronze braziers); lanterns are anachronistic and mirror-sunlight is myth, and both would break the darkness.

## Q2. How many lights can you carry
- A. One; a pickup replaces it. B. One burning in hand + a bag of 3 spares. C. Unlimited stack of seconds.

**Picked: B.** Gives real choices (long dim lamp vs short bright torch) and forgiveness without making light infinite; a stack of seconds would erase the differences between sources.

## Q3. What happens on pickup
- A. Best source automatically goes to the hand. B. Into the bag; lit in hand only if you are on embers; bag full → item stays on the floor. C. Prompt to choose.

**Picked: B.** Predictable, no modal UI while walking, and the player keeps control through swap (Q4).

## Q4. Can the player switch lights
- A. No. B. Tap a bag slot to swap hand ↔ spare; the doused source keeps its seconds.

**Picked: B.** Lets you light the big torch for a dark hall and go back to the lamp; one tap, deterministic `swap` action.

## Q5. When the hand light dies
- A. Embers immediately. B. The spare with the most seconds lights automatically; embers only with an empty bag.

**Picked: B.** Nobody should burn out with spares in the bag; most seconds maximises survival and is deterministic (ties → lowest slot).

## Q6. Oil jar behaviour
- A. Refills the hand completely, always taken. B. Refills the hand; if the hand is nearly full it refills the spare with the largest deficit; left on the floor if it would add < 5 s; rescues embers.

**Picked: B.** Keeps CLAUDE.md's "oil jar refills completely", never wastes a jar, keeps the design-doc embers rescue.

## Q7. Burn times and radii
- A. All sources same time, different radius. B. Distinct trade-offs: torches bright and short (40/60/100 s, radius 4.2/5/6 shrinking linearly), lamp dim and long (150 s, 3.4 steady), candle smallest and long (90 s, 2.4 steady).

**Picked: B (table in plan 02).** Real behaviour (torches flare and burn fast, oil lamps give a small steady pool) and meaningful choices.

## Q8. Starting light, camps, retries
- A. Old 45 s torch. B. A 60 s torch at the start, at retries and when resuming; a camp gives a full copy of the better of your hand source and a torch; bag carries between floors, empty after retry.

**Picked: B.** Floors are larger after plan 01; no save-format change, camp stays a reward.

## Q9. Placement source
- A. Random open tiles. B. Plan 01 spots (niche, store, shrine, dead end) + "wayside" corridor tiles, weighted kinds per spot, items rng stream, spacing ≥ 5.

**Picked: B.** Lamps in niches and torches in storerooms read as real; deterministic by seed; detours stay meaningful.

## Q10. Density curve
- A. Fixed count per floor. B. Budget of found light-seconds = open tiles × `secPerTile`, from 0.30 (floor 1) to 0.14 (floor 10); ≥ 1 oil jar; bot report to tune.

**Picked: B.** Scales with floor size, gets tighter with depth, and is tunable in one table.

## Q11. Items on the main path
- A. Never (plan 01 rule). B. Never, except one teaching item on floors 1–2 (small torch, candle).

**Picked: B.** Teaches the bag and HUD without a detour; later floors keep detours meaningful.

## Q12. Wall sconces and braziers: carried or fixed
- A. Take the torch out of the sconce. B. Fixed; unlit until your flame passes them; then they burn 180 s (brazier 300 s) and light their area. Camp landing and burial chamber braziers are eternal and pre-lit.

**Picked: B.** Mortared bronze brackets stay put; lighting them leaves landmarks that survive fading memory, a real reason to pass them, and the camp and goal rooms glow.

## Q13. What is a memory "cell"
- A. A site (plan 01 room/junction). B. A walked tile: memory unit = one successful move; you remember what you saw from your last 20 moves. C. Seconds of time.

**Picked: B, 20 steps.** Matches the user's "~20 cells" at plan 01's tile scale (20 tiles ≈ the 15-tile view plus the light), is integer and deterministic; standing still does not make you forget.

## Q14. Does walking back refresh memory
- A. LRU of distinct tiles. B. Stamp per tile with the move counter; re-seeing refreshes.

**Picked: B.** Same result in practice, two `Int32Array`s and no list maintenance.

## Q15. Fade curve
- A. Hard cut at 20. B. Full memory for 6 steps, smoothstep to 0 at 20, evaluated with a continuous age from the step progress, plus a light crossfade between steps.

**Picked: B.** Smooth on screen, exact in core.

## Q16. Do lit sconces count as memory
- A. Yes, always visible. B. Visible only while in line of sight (≤ 12 tiles).

**Picked: B.** Correct optically and never reveals the map through rock.

## Q17. Gesture technology
- A. Gesture Handler 3 with worklets. B. RN responder system on the JS thread (already used). C. Reanimated-driven virtual stick.

**Picked: B.** The game logic is on JS anyway, so this is the shortest path (no worklet → JS hop) and identical on web; RNGH 3 is the documented fallback if device tests show lag.

## Q18. Swipe, hold and cadence
- A. Swipe on release (current). B. Move fires as soon as the finger passes 14 dp; holding keeps walking at 0.15 s/tile; 1-deep input queue; direction changes with a trailing anchor and 1.3× hysteresis.

**Picked: B.** Movement starts within one frame of the gesture and quick double swipes are never lost.

## Q19. Corridor auto-walk
- A. None. B. Hold follows corridor bends, stops at T-junctions and dead ends. C. B plus a flick that runs to the next junction/door/item (setting `autoRun`, default on).

**Picked: C.** Removes the tedium of long Egyptian passages while hold stays fully in control; the setting covers players who mis-flick.

## Q20. Who enforces walk speed
- A. UI timer. B. Core `cooldown` decremented by `tick`, move rejected while > 0, carry-over keeps an exact 0.15 s cadence.

**Picked: B.** One source of truth for the UI, and replays/server checks cannot walk faster than players.

## Q21. Smooth movement
- A. Jump per tile. B. Interpolated sprite and light (linear while walking, ease-out for a single step), camera from plan 01.

**Picked: B.** Required for a modern feel; free given the step progress from `cooldown`.

## Q22. Per-source colour and flicker
- A. One warm tint. B. Per-kind colour, tint strength, flicker amplitude/frequencies; flicker is render-only.

**Picked: B.** The differences are visible at a glance and core stays deterministic.

## Q23. Multiple light colours with one mask
- A. Per-light colour mask (RGB). B. One brightness mask + one SrcATop radial gradient per visible light (≤ 11).

**Picked: B.** Looks right at a fraction of the cost; task 11's shader can do coloured light properly.

## Q24. Should memory look different from light
- A. Same, just dimmer. B. Desaturated/cool memory.

**Picked: A for now.** B needs a second pass; task 11's shader adds desaturation cheaply.

## Q25. Frame delivery
- A. React state per frame (current). B. `Picture` via Reanimated shared value set from the rAF loop.

**Picked: B.** No React re-render of the screen at 60 fps; fallback is a memoised board component.

## Q26. Item art now
- A. Coloured dots. B. Tidy vector sprites per kind via `art.ts` (shaft + wrapped head, clay saucer, amphora, bronze bracket, tripod brazier), glints when lit.

**Picked: B.** The user forbids placeholder look; task 12 swaps them for pixel-grid art.

## Q27. Where the light HUD lives
- A. RN views (text bar). B. Overlay in a board corner. C. A 64 dp strip above the board, inside the same canvas, with RN text and Pressables over it.

**Picked: C.** One canvas, nothing hides the maze, and the medallion/flame can be animated art.

## Q28. HUD content
- A. Seconds and a bar. B. Medallion with arc in source colour, live flame icon, name + m:ss, 3 bag slots with time bars, low-light red pulse, event captions, haptics.

**Picked: B.** Reads at a glance, looks commercial, and explains every rule change (pickup, bag full, sconce lit).

## Q29. Brazier blocks movement
- A. Walk through it. B. Solid (`TILE.BRAZIER`), placed only where connectivity survives (checked, reverted otherwise).

**Picked: B.** Walking through a fire bowl looks wrong; the guard keeps every floor solvable.

## Q30. Other Egyptian light ideas (sun shafts, mirrors, glowing paint)
- A. Add now. B. Out.

**Picked: B.** Not historically grounded for interior pyramid lighting and they would undercut the torch tension.

## Q31. Keyboard on web
- A. Arrows only. B. Arrows/WASD with hold (ignoring OS repeat), Shift+dir run, Esc/P pause.

**Picked: B.** Same feel as touch, standard bindings.

## Implementation decisions

Each: options and the pick. Plan 02 was written before task 01 was implemented; these adapt it to the real code.

### I1. Brazier tiles before the masks, other lights after
- A. Everything in one `placeLights` after the main path (plan). B. `placeBraziers` right after the hooks (before `solid`/`opaque`/`dist`/main path are derived), `placeLights` (items, sconces, shrine candles) after the main path.
**Picked: B.** A brazier is a solid tile: placing it after `dist` and the main path would invalidate the stairs-distance invariant and the path. Placed early, a BFS guard reverts any brazier that cuts the floor, and everything downstream (spots, items) sees the final masks.

### I2. Camp information in the generator
- A. Generator learns `pyramid.campEvery` via the hook context. B. `GenSpec.camp?: boolean`, set by `floorFor` (inlined the camp rule; `game.ts` imports `generate.ts`, so importing `isCampFloor` back would be a cycle).
**Picked: B.** The check script passes `camp` too.

### I3. Guaranteed oil jar placed first
- A. Fill the budget, then swap an item into a jar if none (plan). B. Place one jar first (a real spot if possible), then fill the budget.
**Picked: B.** With A a single big torch could cover the budget and be converted, leaving floor 10 with one jar and nothing else.

### I4. Where the shrine fixture lives
Task 01's shrine spot tile is the open niche tile, which is a plain FLOOR tile (not `TILE.NICHE`). Shrine candles use the spot tile; from floor 3 the shrine spot gets no item.

### I5. Sconces
Only in horizontal runs (north wall is ROCK), middle of a >= 6 tile passage run or the first tile inside a door of a hall/gallery/chamber. Vertical passages therefore get none; fine, sconces stay landmarks. Sprite sits on the wall face (the rock tile above), flame and soot above it.

### I6. Brazier placement details
Hall: even-offset tile nearest the hall centre with 4 open FLOOR neighbours. Camp landing: first orthogonal neighbour of `start` that keeps connectivity. Burial: two eternal braziers flanking the far sarcophagus tile (falling back to the near one). The old render-only camp brazier in `drawGame` is gone (it is a fixture now).

### I7. Frame delivery
- A. `Picture` fed by a Reanimated shared value (plan). B. The fallback named in the plan: a memoised `Board` component with its own `picture` state, redrawn from the screen's rAF loop.
**Picked: B.** Sharing a Skia host object through Reanimated is unverifiable here (no device/browser); B is the known-good path and still avoids re-rendering `GameScreen` per frame (only `Board`, which is a Canvas and a Picture). HUD text is a separate small state at <= 4 Hz.

### I8. Smooth motion
Player and light slide linearly over the 0.15 s step (no separate ease-out for an isolated step). Camera easing from task 01 unchanged. Redraw: every frame while walking or the camera moves, 30 fps when standing still (flames), nothing while an overlay is up.

### I9. Idle redraw rate
Plan said 60 fps while playing; picked 30 fps when idle because the picture and mask upload cost JS time on a Redmi 9 and flames read fine at 30. Walking and camera motion are full rate.

### I10. runDir signature
`runDir(floor, pos, dir, interesting)` takes a predicate for "item or unlit fixture next to this tile" instead of the whole state (keeps `walk.ts` independent of `GameState`). The walker supplies it. The first step of a run is the swipe's own move.

### I11. Embers carry across floors
`continue` carries the `ember` counter when the hand source is dead; a camp always relights.

### I12. Check script additions and what was not done
Added `scripts/check-light-rules.ts` (rules, memory, walk, replay on Egypt floors 1/5/10, bot report) and placement asserts in `check-floors.ts` (items, spacing, minFloor, main-path teaching items on floors 1-2 only, oil jar per floor, sconce wall and spacing, eternal braziers on camps and the burial chamber, shrine candles). Not asserted: the plan's "found seconds within [budget, budget + 100]" (the budget is a soft target; the jar and teaching items add to it). The bot (walks 0.3 s per tile, explores until the stairs are seen, takes useful items within 8 steps, never swaps) never burns out on floors 1-7, ends floors 1-3 with 95-170 s, and burns out on floors 8-10 in some of 16 seeds; `secPerTile` left as in the plan table.

### I13. Headless render check
`drawGame`, `drawLightHud`, the sprites and the light mask were rendered to PNG in Node with canvaskit-wasm behind the RN-Skia web bindings (throwaway harness in the scratchpad, not committed): camp brazier with the torch bearer, a wall sconce, all sprites at 120 px per tile, the strip. No device or browser run: touch feel, hold/flick tuning, 60 fps on a Redmi 9 and the web keyboard are unverified.
