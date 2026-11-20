# Labyrinthium design doc (text copy)

Source of truth: https://claude.ai/artifact/GJv23F6drqxG6GQt6fpSD9 (copied 2026-11-21).


 Game design document · working draft

# Labyrinthium

You wake at the top of an ancient pyramid. Every floor below is a dark labyrinth, wider than the one above, with one way down. Carry your torch to the basement, take the artifact, and get out.

Mobile · Android + iOS2D top-downExpo SDK 58 + SkiaDraft of 20 Nov 2026

 01 · Pitch

## The idea in one minute

- Goal: descend from the top of a pyramid to its basement, floor by floor, and escape.

- Every pyramid starts at the top. You wake on its top floor and must clear every floor, one after another, to reach the basement, where the pyramid's sacred artifact is kept.

- Each floor is a labyrinth with a single way down. Floors get wider toward the base, so difficulty grows with the shape of the building.

- The torch is your light and your clock. You see only what it lights, and it burns down as you move.

- Four pyramids (Egypt, Maya, Cambodia, China) can be played in any order. Each basement keeps a sacred artifact.

- Four artifacts open the sealed fifth pyramid, where the last artifact, the Builder's Heart, and the end of the story wait.

- The Drowned City (optional, after the ending). Taking the Builder's Heart cracks the Black Pyramid's basement floor. Below it is the flooded city of the builders, and the reason the five pyramids were built: to keep something sealed down there. Collecting the artifacts broke the seals.

Name check. “Labyrinthium” is a working title. A Steam game called Labyrinthum is one letter away; check store search and trademarks before committing. The English spelling is “Labyrinth”, not “Labirynth”.

 02 · Try it

## A floor in torchlight

A rough playable sketch of the core loop: five floors that grow from 5×5 to 13×13 cells, fog of war, a torch that walls block and that burns out in 45 seconds, oil jars in dead ends that refill it completely, stairs down. The torch carries over between floors. Light only travels along corridors: walls stop it and are never lit themselves. Corridors you've walked stay brighter than ones you've only seen.

Keyboard: arrow keys or WASD work while the board is on screen. On a phone, swipe on the board or use the buttons.

Floor
1 / 5

Choose floor

 12345

Torch

45 s left

Steps
0

 ↑
 ←
 ↓
 →

You wake on the top floor. Find the stairs down. The torch starts burning when you move.
 Start the descent again

youstairs downoil jarwalked corridor (stays brighter)

 03 · Floors

## How a floor is built

Every floor is generated from a fixed seed, so every player gets the same pyramid: floors can have records, and players can trade tips about “floor 17”. Random floors are kept for the daily descent and endless mode.

- Carve a labyrinth (depth-first “recursive backtracker”) starting from the arrival point at the center of the floor, where the stairs from above come down.

- Put the stairs down on the cell farthest from the arrival point, so every floor is a real search.

- On deeper floors, knock out a few extra walls to create loops. A labyrinth with loops is harder to solve by always following one wall.

- Place oil jars, treasure and secrets in dead ends: detours that cost torch.

 Floor 1 · 5×5 · no loops
 Floor 10 · 15×15 · few loops
 Floor 25 (basement) · 25×25 · more loops

 New seeds
 Show the way down

arrival (center)stairs downoil jarway down

### Floor size grows fast at first, then slows

If every floor were wider by the same amount, the basement would take an hour. Size follows a curve instead: early floors teach fast, the last floors are big but still a few minutes each. Later floors get harder through rules, not only size.

| Floor (of 25) | Size, cells | Approx. time | Feels like | 

| 1 | 5×5 | 15 s | tutorial: one corridor and a turn | 

| 2 | 7×7 | 25 s | first dead end | 

| 5 | 11×11 | 45 s | torch starts to matter; first camp | 

| 10 | 15×15 | 1.5 min | loops appear | 

| 15 | 19×19 | 2 min | pyramid's own rule in full | 

| 20 | 23×23 | 3 min | guardian territory | 

| 25 | 25×25 | 4 min | basement: the artifact and the escape | 

 04 · Structure

## Four pyramids, five artifacts

- Open from the start. All four pyramids are available. Each one starts easy and gets hard toward its basement, so any of them works as a first choice.

- The escape. Taking the artifact opens the exit and wakes the pyramid: collapse speeds up and the guardian appears. You still have to get out with it.

- Artifacts are tools. Each gives a power that helps most in another pyramid, so the order becomes a strategy (table below).

- The Black Pyramid sits sealed on the world map with four empty slots in its door. Each of its zones needs one artifact's power. Nobody knows who built it; its stone is black and older than the other four.

- The Drowned City is the optional last phase, under the Black Pyramid's basement. It isn't needed to finish the story, and it's built to be the scariest part of the game (details in the table below).

- Camps every 5 floors: progress is saved, the torch is refilled, coins are spent on tools. Between camps the torch carries over, so each stretch is a small tense run. A burnt-out torch sends you back to the last camp.

 05 · Between floors and pyramids

## Where am I in the pyramid?

Every pyramid starts on its top floor. To reach the basement and its sacred artifact, the player clears every floor in order. Between floors, a short overview (about two seconds, a tap skips it) shows the pyramid from the side: the floors already cleared, where you are now, and the basement where the artifact is kept. It gives a sense of progress and a breath before the next dark floor. The playable sketch above shows it when you take the stairs.

- Floor cleared. You step onto the stairs.

- Overview. The pyramid in profile; your torch slides down one tier. It shows the floor number, how many floors are left, and the artifact waiting in the basement.

- Next floor. You arrive in the middle of a wider, darker floor.

- Basement. You take the artifact and escape. The world map then shows it set into one of the seals on the Black Pyramid's door.

### Sketch: between floors

Egypt · floor 8 of 25. 17 floors to the basement, where the Golden Scarab is kept.

 EgyptMayaCambodiaChinaThe Black Pyramid

↑ Floor aboveNext floor ↓

### Sketch: between pyramids

After a basement, the world map. The four pyramids can be played in any order, and each artifact taken fills one of the four seals on the Black Pyramid's door. When all four are filled, the door opens. After the Black Pyramid, the map gets one more place, under it: the Drowned City.

Golden Scarab taken from Egypt. 1 of 4 seals on the Black Pyramid's door is filled.

Artifacts collected:
 01234

 06 · Pyramids

## Each culture brings its own rule

Every pyramid changes how the labyrinth behaves, not only how it looks.

| Pyramid | Look | Signature rule | Hunter | Artifact and power | 

| Egypt | sandstone, hieroglyphs, gold | sand pours in and floors collapse; pressure-plate traps | mummy guardian | Golden Scarab: briefly points to the stairs. Best in Cambodia. | 

| Maya | jungle, stepped stone, glyphs | calendar wheels turn chambers 90°; flooded cenotes | jaguar spirit, hunts by sound | Obsidian Mirror: reflects the torch for wide light. Best in China. | 

| Cambodia (Koh Ker) | grey Khmer stone, giant roots, moats | roots grow and close or break walls over time; water levels change | stone naga statues | Naga Amulet: pass through water, swim longer. Best in Maya. | 

| China (imperial tomb) | red lacquer, bronze, clay soldiers | statues move only in darkness; mercury channels | clay soldiers | Jade Seal: freezes guardians and mechanisms. Best in Egypt. | 

| The Black Pyramid | fictional; black stone, older than all others | every rule, one zone per artifact | the builders' guardian | Builder's Heart: the ending, and a crack in the basement floor | 

| The Drowned City (optional) | a sunken city of the builders: flooded streets, pale glowing stone, silence | no oil: the only light is the Builder's Heart, and it dims the deeper you go. Water rises in waves, and streets shift while you're not lit | your own echo: a shape that walks exactly the path you walked, a few seconds behind. Stop, and it catches up | no artifact: an endless descent scored by depth, and the last pieces of the story | 

Respect the real cultures. Maya, Khmer and Chinese heritage belongs to living cultures, and some sites are sacred. Base art on real architecture and patterns, avoid caricature, don't make real deities into monsters, and present the pyramids as fictional places inspired by real ones. Get research or a reviewer from each culture before building its pyramid.

 07 · Mechanics

## What the player deals with

core · from floor 1

### Torch

The torch burns by time, not by steps, and its light shrinks as it burns. An oil jar refills it completely. Jars sit in dead ends: take the stairs now or detour for oil. When the torch dies, a few seconds of near-darkness remain to reach oil or the stairs.

core · from floor 1

### Fog of war

Walls block the light. Seen corridors stay faintly on the map as memory, unseen ones are black. You can't solve the floor by looking at it.

later floors

### Collapse

After you arrive, the floor above caves in and sand pours down the stairwell, filling cells outward from your arrival point. Lingering near where you came in is the worst choice.

optional rule · Maya

### Rotating chambers

A lever turns a 3×3 chamber by 90°, opening one path and closing another. Introduced in one pyramid; used more only if playtests show it's fun.

deep floors

### Guardian

Wakes at a set depth and roams. Heard through stereo sound and felt through vibration before it's seen. Your torch lets it spot you. Late on, it follows you down the stairs.

any floor

### Trapdoors and secrets

A trapdoor drops you a floor early but skips that floor's oil and treasure. Hidden burial chambers hold treasure and story fragments.

tools · bought at camps

### Tools

Chalk marks walls. A flare lights a whole area. A hammer breaks one wall. Limited charges, so skill still decides most floors.

every floor

### Stars

One for escaping, two for escaping fast, three for finding every secret. Stars give old floors a reason to be replayed.

 08 · Coming back

## Reasons to open it tomorrow

### Daily descent

A short seeded pyramid (4–5 floors), the same for everyone each day. One attempt, a leaderboard, and a shareable result card. The strongest single retention feature, and cheap to build.

### Streaks and weekly challenges

“Escape without a flare”, “find 3 secrets”. Small goals that bring players back for a few minutes.

### Ghost races

Race a friend's best run, or the world record, on the same fixed floor.

### After the ending

The Drowned City (an endless descent scored by depth, with its own leaderboard), New Game+ (night: less light, guardians everywhere), and all stars to collect.

### Seasons

A later update opens a new set of pyramids, such as Nubia and Mesopotamia, with a new sealed pyramid. The world map grows and the story continues.

### Story

The same builder's symbol appears in every pyramid. Hidden chambers hold pieces of who built them and why you woke at the top.

 09 · Look and tech

## 2D, Expo, no Mac needed

View: 2D top-down at a slight angle, so walls show a front face and look tall. The torch sets the mood: near-black outside its light, a warm flickering circle inside. Each pyramid has its own palette and tileset. The prototype uses plain shapes; lighting and movement decide whether it's fun.

| Need | Tool | 

| Drawing, lighting, shaders | @shopify/react-native-skia | 

| Game loop at 60 fps | react-native-reanimated (useFrameCallback) | 

| Swipe or stick controls | react-native-gesture-handler | 

| Sound, vibration | expo-audio, expo-haptics | 

| Interface animations: streak flame, celebrations, artifact reveal | Rive (rive-react-native), GPU-rendered; Lottie as the older alternative | 

| 3D pyramid view between floors (later) | react-three-fiber (three.js through expo-gl); 2.5D in Skia first | 

| Particles: sand, dust, embers, confetti | Skia Atlas: thousands of sprites in one GPU call | 

| Progress save | Zustand with persist | 

| Floors, line of sight, guardian AI | plain TypeScript, seeded random generator | 

| iOS build without a Mac | EAS Build in the cloud → TestFlight | 

| Android build without Android Studio | EAS Build → APK / AAB | 

The project uses the latest Expo SDK (58) with a development build from EAS, because Rive, Skia shaders and the 3D view need native modules beyond Expo Go.

### Why animation will look better than in SpinBook

SpinBook's confetti came from react-native-confetti-cannon, which makes every piece a separate React Native view and moves it with the old Animated API. Hundreds of views moved every frame stutter on budget phones, and SVG or PNG flames have the same problem. The game avoids that completely:

- One Skia canvas draws the whole game on the GPU: labyrinth, light, player, particles. No view per object.

- Animation runs on the UI thread through Reanimated, so a busy JavaScript thread doesn't cause stutter.

- Light and fire are shaders: small GPU programs, smooth and cheap, instead of image frames.

- Interface animations use Rive, designed in Rive's free editor and played on the GPU.

- Performance is judged only on a release APK. Development builds run JavaScript several times slower.

### The between-floors pyramid view

Three ways to show it, from richest to simplest: real low-poly 3D with react-three-fiber (stepped tiers, the current floor glowing, the camera diving down one tier); 2.5D in Skia (an isometric pyramid with shading and zoom); or a pre-rendered video. Start with 2.5D in the prototype and try 3D in the performance test. A few hundred polygons for a few seconds between floors is light even for a budget phone.

### Performance test first: one day, Redmi 9, release APK

- A 15×15 Skia floor with the torch shader and 500 ember particles.

- A react-three-fiber pyramid scene with a camera dive, as the floor transition.

- One Rive animation, such as a flame.

If all three hold 60 fps, the stack is settled. If not, Godot is the fallback: a ~100 MB editor that runs on integrated graphics, with 2D lights and simple 3D. Its iOS builds need a cloud Mac, the same as Unity.

### Engines considered

| Option | Strengths | Problems for this project | Verdict | 

| Expo + Skia | TypeScript you already know; EAS builds iOS without a Mac and Android without Android Studio; small disk use (~1 GB of packages) | light, particles and effects are written by hand, not ready-made | chosen | 

| Unity | built-in 2D lights with shadow casters (the torch in an afternoon), particles, tilemaps, editor, ads; proven on cheap phones; free under $200k revenue a year | 15–25 GB of disk; slow editor on integrated graphics; C#; iOS needs a cloud Mac pipeline (GitHub Actions + GameCI, or Codemagic) | doesn't fit this laptop | 

| Godot | free, ~100 MB editor, 2D lights with occluders, simple 3D | iOS needs a cloud Mac; weaker mobile ads and store tooling | fallback | 

The Unity Editor runs on the laptop (the Windows version, not inside WSL2); the phone only runs builds or mirrors Play mode through the Unity Remote app.

 10 · Art and assets

## Who draws what

Claude can't generate images. It writes code, and in this game a lot of the art can be code. Image-generating AI covers the rest.

code-made art · Claude

### Made from code

- Stone, sand, wood and water textures as Skia shaders: tile endlessly, recolor per pyramid, almost no download size

- Torch, flicker, darkness, glow, fog, dust and embers

- Small tiles, items and icons as pixel grids in code (like Vershyna's cross-stitch motifs)

- Procedural ornaments inspired by each culture, not copies of real inscriptions

- SVG icons and logo drafts, UI layouts, the world map

- The low-poly 3D pyramid, built from geometry in three.js

image AI · plus your cleanup

### Made with image generators

- Player character, guardians, artifacts

- Key art, app icon, store screenshots

- Concept art: Midjourney, ChatGPT image generation, Adobe Firefly

- Game assets: PixelLab (pixel-art sprites, tilesets, walk cycles), Scenario (trained on your style for consistency)

- Weak points: one style across dozens of assets, consistent animation frames, seamless tiles

- Check each tool's commercial-use terms before release

Style: simple pixel art with rich lighting. The darkness hides detail anyway, the torch is the visual star, and small inconsistencies between AI-made sprites show less at low resolution. The prototype uses only code-made art.

 11 · Multiplayer

## Playing with and against others

| Level | What it is | Technology | When | 

| Asynchronous | ghost races against a friend's best run or the world record (their torch is a faint glow in the dark); daily descent leaderboard; challenge a friend with a seed | Cloudflare Workers + D1; a ghost is just a short list of moves on a seeded floor | first release | 

| Real-time | race: 2–4 players on one floor, first down the stairs wins, rivals' torches visible from afar. Co-op “one torch, two explorers”: only one carries the light | Cloudflare Durable Objects with WebSockets, one room per match; grid moves need only a few small messages per second | after launch | 

| Asymmetric | one player escapes with the torch, another plays the guardian: sees the whole floor, moves slowly, hunts by sound | same as real-time | experiment; hardest to balance | 

Decide now: keep the game logic deterministic (seeded floors and one step(state, move) function). Ghosts, replays, anti-cheat checks and real-time races all build on it later without a rewrite.

 12 · Money

## Ads, roughly

Ad money comes from players who keep playing, not from downloads: revenue per download = daily ad revenue per active player × days an average player plays (typically 3–6 days for a casual game). All figures are rough industry ranges and change by year, country and network. AdMob pays out once you reach $100.

| Scenario | Downloads for $100, mixed ads | Downloads for $100, rewarded only | 

| Mostly Ukraine / Eastern Europe | ~5,000 | ~15,000 | 

| Global mix, average retention | ~1,250 | ~5,000 | 

| Global mix, good retention and strong reward hooks | ~500–700 | ~1,200 | 

| Mostly USA, good retention | ~200 | ~600 | 

- Rewarded ads fit the game: relight a dead torch and continue from this floor instead of the last camp, a second chance after the guardian, a free flare before a hard floor, double treasure, one more daily attempt. Players choose to watch, so retention doesn't suffer.

- Interstitials: at most one after each completed pyramid, never on every floor transition.

- No banners: almost worthless, and they cover the labyrinth.

- “Remove ads” as a one-time purchase (about $2–4).

- Tech: react-native-google-mobile-ads in the dev or release build; GDPR consent in the EU, Apple's tracking prompt on iOS. Later, mediation (AppLovin MAX or AdMob mediation with Unity Ads and others) for about 10–30% more.

- The hard part is downloads. A strong store page, the shareable daily result card and short videos of the torch in the dark matter more than tuning ads.

 13 · App size

## How big the download will be

Rough estimate for the full game. Stores deliver Android apps as per-device splits from the AAB, so the download is much smaller than a universal APK.

| Part | Android download, approx. | 

| Expo + React Native + Hermes base | 12–18 MB | 

| Skia | 5–7 MB | 

| Reanimated, worklets, gesture handler, audio, haptics | 2–3 MB | 

| Rive runtime | 3–4 MB | 

| three.js + react-three-fiber (JavaScript) | ~1 MB | 

| Game code, floor data (generated from seeds, so almost nothing) | < 1 MB | 

| Pixel-art sprites and tiles, Rive files | 2–5 MB | 

| Sound effects | ~2 MB | 

| Music: one or two tracks per pyramid, compressed | 8–12 MB | 

| Total | ~35–50 MB | 

Installed on the phone it takes roughly 90–140 MB. The iOS download is usually somewhat bigger, about 50–70 MB. Music is the biggest single part: shorter loops or streaming extra tracks after install keep the first download small.

 14 · Plan

## What to build, in order

- Performance test (one day). Skia torch and particles, a 3D pyramid transition and one Rive animation, as a release APK on the Redmi 9. Project: ~/server/game.

- Prototype: Egypt, floors 1–10. Floor generator, fog of war, torch with line of sight, oil, stairs, a camp at floor 5 and 10, swipe controls. Simple shapes. Question to answer: is moving through the dark fun?

- Egypt complete. 25 floors, collapse, traps, the mummy guardian, the artifact escape, stars, sound and haptics, real art.

- World map and the other three pyramids, one at a time, each with its rule and artifact power.

- The Black Pyramid and the ending.

- The Drowned City: the optional endless phase. It can also ship as the first big update after launch.

- Daily descent, leaderboards, ghosts (needs a small backend).

- Seasons after launch.

 15 · Open questions

## Still to decide

- Final name and spelling.

- Names for the last two places. Working names: the Black Pyramid and the Drowned City. Alternatives: the Nameless Pyramid, the Hollow Pyramid; Atlantis, the Sunken Below, the Abyss.

- Controls: swipe per cell, hold to keep walking, or a virtual stick. Decide in the prototype.

- Art style: pixel art or flat hand-drawn; made yourself or commissioned.

- Floors per pyramid: 25 is a starting guess.

- Whether rotating chambers stay after playtests.

- Money: rewarded ads only, rewarded plus one interstitial per pyramid, or a free first pyramid with a one-time unlock.

 16 · Market

## Similar games

“New maze every level, gets harder” is common. None of these combine a descent through a pyramid, a torch that carries between floors, and artifacts that unlock a final pyramid. Every link below was checked on 20 Nov 2026 and opens a live App Store or Google Play page.

| Game | Stores | What it does | What to learn from it | 

| Mazes & More | App Store · Google Play | 450 retro 2D labyrinths with modes: Classic, Enemies, Ice Floor, Darkness, Traps, Time Trial | the genre's big hit (tens of millions of Android installs); modes keep plain mazes fresh | 

| Maze CrazE | App Store | 1,000+ hand-made mazes in 6 difficulty levels | 4.5★ from 8,200 ratings: a calm, classic maze audience exists | 

| Mazey (WayOut) | App Store | offline maze adventure with fog of war, power-ups, medal ranks, no ads | closest to the torch and fog idea; small and new | 

| Stone Labyrinth: Maze Puzzle | Google Play | 3D stone maze where the fog lifts as you explore and shows your path; hidden clues, limited hints | fog plus a visible explored path, as in the sketch above | 

| 3D Maze / Labyrinth | App Store · Google Play | 12 first-person labyrinths, no map; climb a tower or pyramid to look down at the exit | first-person mazes get disorienting fast, one reason to stay top-down | 

| Tilt Maze | App Store | tilt to roll a ball; generated mazes, each a little harder, no ads | nearly the original one-line idea, in store since 2009 | 

| Maze Go | Google Play | random maze generator, offline, hints | generated mazes alone are a commodity | 

| Labyrizza | App Store | generated mazes, arcade and endless modes, items, traps, characters | endless mode and traps | 

| Mazeskalation | App Store | endless generated mazes against a timer, score-based | time pressure as the main tension | 

| Maze One | App Store | 3D labyrinths with lurking monsters and a glowing exit portal | a hunter in the maze | 

| The Dungeon – Get Out (Lite) | App Store | first-person dungeon crawler: mazes, traps, teleporters | dungeon theme; old-school RPG audience | 

| Maze: Puzzle and Relaxing Game | Google Play | swipe to guide a light through the maze | light as the player character, relaxed tone | 

Two of the strongest examples, Maze Machina (run-based roguelike maze) and Unmaze (story labyrinth by ARTE), are no longer listed in the stores.

