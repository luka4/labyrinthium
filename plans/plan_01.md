# Plan 01 · Architectural floor generator (Egypt floors 1–10)

Decisions and their reasons are in `plan_01_question.md` (Q-numbers below).

## Goal

Floors must look and play like real buildings built for use, not a grid of square cells: passages of different lengths, halls, chambers of varied size and shape, pillared halls, a Grand-Gallery-style gallery, storerooms, niches, stairwells, thick walls. Egypt gets 10 floors (floor 10 = basement for now), camps at floors 5 and 10. Logic stays deterministic, grid-based and UI-free; the renderer derives continuous architecture (thick walls with visible faces, paving per room, pillars, doorways) from the grid and bakes it once per floor.

## Scope

In:
- New generator in `src/game/core` (site lattice → graph → rooms → tiles), per-pyramid architecture profile with room-kind registry and hooks for later tasks.
- `Floor` data model: tile kinds, separate `solid` (movement) and `opaque` (light) masks, rooms, links, item spots, main path.
- Egypt: 10 floors, explicit size table, camps at 5 and 10; camp rule becomes "1-based floor number divisible by `campEvery`".
- Arrival under the previous floor's stairs (world-aligned floors).
- Renderer: per-floor baked architecture image + per-frame light mask + camera following the player. Egypt limestone/sandstone theme; other pyramids get a palette-only fallback.
- Deterministic check script (`npm run check:floors`) with snapshot hashes and ASCII dumps.
- Save migration (progress version 2), dev shortcuts to start at Egypt camps 5/10, CLAUDE.md update.

Out (later tasks): light-source types and fading memory (02; this plan only exposes `spots`), swipe/hold-to-walk and smooth player motion (02), traps/collapse/trapdoors/25 floors (03), guardian (04), other cultures' architecture (07–09, 13), material and light shaders (10, 11), final art (12–14). Board layout stays a square panel (14 reworks UI).

## Design

### Coordinates and lattice (Q2, Q3)

- Floors are square tile grids, `size × size`, index `i = y*size + x`. Tile scale is identical on all floors; floors share their centre, so world coordinates are `(x - (size>>1), y - (size>>1))`.
- A floor is `n × n` **sites**. Each column band `c` has an interior width `colSpan[c]` drawn from `profile.span = [min,max]` (Egypt `[3,5]`); row spans are a shuffled copy of the column spans (keeps the floor square). Bands are separated by 1-tile boundary lines; the outer border is a boundary line too. `colX[c]` = x of the boundary left of band `c`; band interior is `colX[c]+1 .. colX[c]+colSpan[c]`; `size = colX[n] + 1`.
- Each band has an **axis**: `axisX[c] = colX[c] + 1 + (colSpan[c] >> 1)` (same for rows). All ports between sites sit on axes, so chains of passages are straight and rooms are axial, as in Egyptian architecture.
- Port between horizontally adjacent sites (c,r)-(c+1,r): tile `(colX[c+1], axisY[r])`; vertical: `(axisX[c], rowY[r+1])`.

### Data model (`src/game/core/floor.ts`)

```ts
export const TILE = { ROCK: 0, FLOOR: 1, DOOR: 2, PILLAR: 3, NICHE: 4, STAIRS_DOWN: 5, STAIRS_UP: 6,
  BENCH: 7, SARCOPHAGUS: 8 } as const;           // extendable by later tasks (WATER, ROOTS, PLATE...)
export type TileKind = (typeof TILE)[keyof typeof TILE];
// per-kind flags table: SOLID = ROCK, PILLAR, STAIRS_UP, BENCH, SARCOPHAGUS; OPAQUE = ROCK, PILLAR
export const TILE_SOLID: Uint8Array; export const TILE_OPAQUE: Uint8Array;

export type RoomKind = 'passage' | 'chamber' | 'hall' | 'gallery' | 'magazines' | 'shrine'
  | 'antechamber' | 'stairsUp' | 'stairsDown' | 'burial';   // string union, extended per culture
export type Room = { id: number; kind: RoomKind; x: number; y: number; w: number; h: number; // carved rect
  sites: number[]; doors: number[]; leaf: boolean; main: boolean; depth: number };          // depth = BFS steps from start
export type SpotKind = 'deadEnd' | 'store' | 'niche' | 'shrine';
export type Spot = { tile: number; kind: SpotKind; room: number; dist: number; main: boolean };

export type Floor = {
  size: number;
  tiles: Uint8Array;  solid: Uint8Array;  opaque: Uint8Array;   // derived from tiles via the flag tables
  room: Int16Array;   rooms: Room[];   links: Array<{ a: number; b: number; door: number }>;
  start: number;      // arrival landing tile (next to STAIRS_UP)
  stairs: number;     // goal: STAIRS_DOWN tile, or the artifact tile in the basement
  oil: number[];      spots: Spot[];   mainPath: Int32Array;   // tiles start → stairs
  lattice: { n: number; colX: number[]; rowY: number[]; axisX: number[]; axisY: number[] };
  profile: ArchProfileId;  seed: number;
};
```

`walls` and `n` disappear; every user switches to `solid` (movement, BFS) or `opaque` (vision).

### Architecture profile (`src/game/core/architecture.ts`) (Q20, Q21)

```ts
export type ArchProfile = {
  id: ArchProfileId;                    // 'egypt' | 'generic' now; 'maya' | 'khmer' | 'china' | 'black' later
  sites: readonly number[];             // sites per side for floor index 0..k (explicit table)
  span: readonly [number, number];      // site interior tiles
  straightness: number;                 // 0..1 chance the tree walk keeps its direction
  loops: { fromFloor: number; maxRate: number; atFloor: number }; // linear ramp of loop edges / possible edges
  halls: (floorIndex: number) => number;     // quota of merged pillared halls
  galleries: (floorIndex: number) => number; // quota of 1×3 galleries on the tree
  leafRooms: Partial<Record<RoomKind, number>>; // weights for dead-end rooms
  junctionRoom: number;                 // chance a degree≥3 site becomes a chamber
  nicheRate: number;                    // chance per eligible straight passage tile
  oilPerTiles: number;                  // one oil jar per N open tiles (min 1)
  basementRoom: RoomKind;               // 'burial'
  hooks?: Array<(ctx: GenContext) => void>; // post-carve passes (traps 03, light sources 02, culture features 07–09)
};
export const ROOM_CARVERS: Record<string, (ctx: GenContext, room: RoomDraft) => void>; // registry, culture tasks add kinds
export function profileFor(id: ArchProfileId): ArchProfile;
```

Egypt values: `sites [3,4,5,5,6,6,7,7,8,8]`, `span [3,5]`, `straightness 0.55`, loops `{fromFloor: 3, maxRate: 0.12, atFloor: 9}` (0 on floors 1–3), halls `i<2 ? 0 : i<6 ? 1 : 2`, galleries `i<3 ? 0 : 1`, leafRooms `{chamber: 5, magazines: 3, shrine: 2}`, junctionRoom 0.3, nicheRate 0.06, oilPerTiles 70. `generic` = Egypt values with `sites [3,4,5,6,7]` (5-floor pyramids) and Black `[4,5,6,7,8]` via an override.

`Pyramid` (game.ts) loses `firstCells/lastCells`, gains `architecture: ArchProfileId`; `floorCount` stays the source of the floor count and must be ≤ `profile.sites.length` (check script asserts).

### Algorithm (`src/game/core/generate.ts`, `generateFloor(spec)`) (Q2–Q16)

`spec = { seed, floorIndex, basement, profile, arrivalWorld: {x,y} | null }`. Three RNG streams so later changes stay local: `layout = createRng(seed)`, `rooms = createRng(seed ^ 0x9e3779b9)`, `items = createRng(seed ^ 0x85ebca6b)`. Integer math only (no `Math.pow/hypot/sin`) so Hermes and V8 agree.

1. **Lattice** (layout rng): spans, `colX/rowY/axisX/axisY`, `size`.
2. **Arrival site**: floor 0 → centre site `(n>>1, n>>1)`. Otherwise project `arrivalWorld` into this floor's tiles, clamp inside, take the site containing it.
3. **Spanning tree** (layout rng): randomized DFS backtracker over sites from the arrival site; at each step, if the previous direction is open and `rng() < straightness`, continue straight, else pick uniformly. Store adjacency as edge flags `edgeH[c,r]`, `edgeV[c,r]`.
4. **Stairs site**: weighted tree distance from arrival (edge weight = `(span_a + span_b)/2 + 1`); stairs site = leaf with max distance (ties → lowest index). Never equal to arrival (n ≥ 3 guarantees it).
5. **Merges** (rooms rng), excluding arrival and stairs sites and their direct tree neighbours:
   - galleries: straight 1×3 or 3×1 runs whose 2 internal edges are tree edges and whose cross span ≥ 3; up to quota.
   - halls: 2×2, 3×2, 2×3 rects whose induced subgraph (tree edges) is connected; up to quota; prefer rects with total interior ≥ 5×5.
   Contraction of a connected induced subgraph keeps the graph a tree (no accidental loops on early floors).
6. **Loops** (layout rng): candidate edges = adjacent site pairs not connected, both outside arrival/stairs sites, not internal to one merged room. Count = `round(candidates × rate(floorIndex))`. Add in shuffled order.
7. **Kinds**: arrival → `stairsUp`; stairs site → `stairsDown` or `profile.basementRoom` on the basement; tree parent of the stairs site, if single and degree 2 → `antechamber`; merged → `hall`/`gallery`; other leaves → weighted `leafRooms` (gated: magazines need interior ≥ 3×3); degree ≥ 3 → `chamber` with `junctionRoom` chance else `passage`; degree 2 → `passage`.
8. **Carve** (rooms rng) via `ROOM_CARVERS[kind]`, writing `tiles` and `room`. Shared rules: a room's rect lies inside its sites' interiors (merged rooms also cover the boundaries between members), and its rect must contain every axis line it has a port on; the gap from rect edge to the port is carved as FLOOR (a passage through thick wall); the port tile is DOOR if either side is a non-passage room, else FLOOR.
   - `passage`: FLOOR from the site's axis crossing to each port (straight, L, T or + shapes).
   - `chamber`/`antechamber`/`shrine`: rect `w,h ∈ [2, interior]` (antechamber square ≥ 3 if possible); `shrine` adds a NICHE in the wall opposite its door (spot `shrine`).
   - `hall`: full union rect, shrunk to odd `w,h`; if both ≥ 5, PILLAR at `(x-x0, y-y0)` both odd (hypostyle grid; perimeter ring stays open so connectivity is preserved).
   - `gallery`: long rect, cross width 3 centred on the axis: centre line FLOOR, both flanks BENCH (the ramps, solid but not opaque); flank tiles in front of side ports become FLOOR.
   - `magazines`: spine FLOOR from the port along the axis to the far wall; perpendicular 1-wide dead-end cells every 2nd tile off the spine on one or both sides, depth up to `interior/2`; cell ends are spots `store`.
   - `stairsUp`: small rect (≥ 2×3); STAIRS_UP flight (2 tiles, solid) on the side farthest from the ports; `start` = the open tile in front of it.
   - `stairsDown`: rect ≥ 3×3; STAIRS_DOWN on the tile farthest (BFS inside the room) from its door; that tile is `stairs`.
   - `burial`: full interior; SARCOPHAGUS (2×1 along the long axis, solid, not opaque) in the back half; `stairs` = open tile between door and sarcophagus on the axis (the artifact sits there).
9. **Niches** (rooms rng): for each straight passage tile with ROCK on a side, if every tile in the 3×3 around the candidate except the passage tile is ROCK and the candidate is not on the outer border, carve NICHE with chance `nicheRate`, at most one per 3 passage tiles. Spot `niche`.
10. **Derive** `solid`/`opaque` from `tiles`; tile BFS from `start` over `!solid` → `dist`; `mainPath` via BFS parents to `stairs`; `room.depth`, `room.main`, `spot.dist`, `spot.main`.
11. **Spots → oil** (items rng): spots = niches, store ends, shrine niches, and for every leaf `chamber` the tile farthest from its door (`deadEnd`). Exclude arrival/stairs rooms and `main` spots. Shuffle, greedily pick with Manhattan spacing ≥ 6, count `max(1, round(openTiles / oilPerTiles))`.
12. **Hooks**: `profile.hooks` run last with their own rng (`seed ^ hookIndex*0x27d4eb2d`), may add tile kinds/spots/features; must not break connectivity (check script verifies).

`floorFor(pyramid, floorIndex)` (in `floor.ts`): memoised by `pyramid.id + index`; for index > 0 it takes `floorFor(index-1).stairs` world coords as `arrivalWorld`. Generating the chain to floor 10 costs ~10 small generations, memo makes it once per session.

### Game rules (`game.ts`, `vision.ts`, `pyramids.ts`)

- `isCampFloor(p, i) = p.campEvery > 0 && i > 0 && (i + 1) % p.campEvery === 0`; `lastCamp(p, i)`: largest camp index ≤ i, else 0. Egypt: `floorCount 10, campEvery 5` → camps at indices 4 and 9 (floor 10 is basement and camp). Others: `floorCount 5, campEvery 5` (camp on the basement). `campFloorNumbers` includes the basement.
- `startFloor` uses `floorFor`; arrays sized `size*size`; `step` move tests `solid`; vision `clearLine` and lit-tile test use `opaque` (benches and the sarcophagus are lit, pillars cast shadows). `torchRadius`, `TORCH_SECONDS` unchanged.
- `floorSeed` unchanged.

### Rendering (Q17–Q19, Q24)

- `src/game/render/themes.ts`: `FloorTheme` per pyramid id (rock, rock dark, wall face light/dark, cap, joint, floor stone per room kind, pillar, gold accent, sand dust). Egypt: Tura-limestone walls, warm sandstone paving, granite for burial/antechamber, gold accent; others: derived from `PyramidInfo.color`.
- `src/game/render/floorArt.ts` `bakeFloor(floor, theme, tilePx, scale): SkImage` — CPU raster surface `Skia.Surface.Make(size*px, size*px)`, `px = tilePx*scale`, `scale = min(PixelRatio.get(), 2)`, capped so the side ≤ 2048. Drawn once per floor (hidden under the FloorOverview), result `makeImageSnapshot()`; previous image `dispose()`d on floor change. Contents, all derived from tiles and rooms:
  - rock mass: dark stone with hashed block coursing (decor hash only, not core rng);
  - paving per room: flagstones laid on the room rect (passages: long slabs along the axis; halls: large squares; burial/antechamber: granite), never a per-tile checkerboard;
  - 3/4 oblique walls: for each open tile whose north neighbour is opaque, a wall face (0.55 tile tall, inside the north tile) with ashlar joints in runs merged along the wall (one path per run, staggered joints); east/west/south edges get a cap line and a 0.25-tile contact shadow (baked ambient occlusion); convex/concave corners resolved by neighbour masks;
  - pillars: round papyrus columns, shaded disc + cast shadow south-east; benches with stepped corbel outlines (gallery); sarcophagus; door jambs + lintel shadow (antechamber doors with portcullis grooves); niches with a recessed back; stairs as descending treads with darkening gradient; STAIRS_UP as ascending treads.
- `src/game/render/lightMask.ts`: reused `Uint8Array` RGBA at 2 px per tile; pixel = 255 × `max(light×flicker, memory)` (memory constants from the current `drawGame`); opaque tiles take, per half-tile, the value of the open neighbour they face (so wall faces are lit from the player's side only and nothing behind a wall is revealed; walls are ≥ 1 tile thick, so linear filtering never spills onto the far floor). Built into an `SkImage` (`Skia.Image.MakeImage`, RGBA_8888 premul) each frame; keep the last two, dispose older.
- `drawGame.ts` (rewritten): `drawGame(canvas, s, art, view, flicker)` where `view = {camX, camY, tilePx, viewTiles}`: `saveLayer` → `drawImageRectOptions(art, srcWindow, board, Linear)` → mask image with `BlendMode.DstIn`, Linear → warm torch radial gradient around the player with `SrcATop` → `restore`; then sprites at tile positions (oil jars, stairs glow, artifact on its plinth, camp brazier on the arrival landing of camp floors using `flame()`, player). No `Skia.XYWHRect` per tile; only a handful of objects per frame.
- Camera (`GameScreen.tsx`): `viewTiles = min(size, 15)`, `tilePx = boardSize / viewTiles`; target = player tile centre clamped to the floor; `cam += (target - cam) × (1 - 0.0001^dt)` in the existing rAF loop; redraw every frame while `|cam - target| > 0.01` tiles, else at `IDLE_FPS`. Snap the camera on floor start. Bake on floor change (`useMemo` on `s.floor` + `tilePx`).

## Files

Add:
- `src/game/core/architecture.ts` — profiles, room-kind registry, `profileFor`.
- `src/game/core/generate.ts` — `generateFloor` (steps 1–12) and carvers.
- `src/game/render/themes.ts`, `src/game/render/floorArt.ts`, `src/game/render/lightMask.ts`.
- `scripts/check-floors.ts` — assertions, metrics table, `--ascii <pyramid> <floor>`, `--update` snapshot.
- `scripts/floors.snapshot.json` — FNV-1a hash of `tiles + start + stairs + oil` per pyramid/floor.

Change:
- `src/game/core/floor.ts` — new types, flag tables, `DIRS`, `distancesFrom(solid, size, from)`, `floorFor`; old backtracker and `floorCells` removed.
- `src/game/core/game.ts` — `Pyramid` fields, camp rules, `startFloor`, `step` on `solid`.
- `src/game/core/vision.ts` — `opaque`.
- `src/game/core/pyramids.ts` — Egypt `floorCount 10, campEvery 5, architecture 'egypt'`; others `floorCount 5, campEvery 5, architecture 'generic'` (Black with its size override); `campFloorNumbers` includes basement.
- `src/game/render/drawGame.ts` — rewritten as above.
- `src/screens/GameScreen.tsx` — camera, bake, new `drawGame` call.
- `src/state/progress.ts` — `version: 2`, `migrate` drops `camp` and clamps `deepest` to `floorCount-1`.
- `src/app/settings.tsx` — `__DEV__` buttons: "Egypt: camp at floor 5" / "floor 10" (`reachCamp('egypt', 4|9)`).
- `package.json` — devDependency `tsx`, script `"check:floors": "tsx scripts/check-floors.ts"`.
- `CLAUDE.md` — Layout (new files), Journey (Egypt 10 floors, camps 5 & 10; others 5), floor.ts description.

## Implementation order

1. `floor.ts` types + flag tables; `architecture.ts` with Egypt and generic profiles.
2. `generate.ts` steps 1–11 (hooks array wired, empty).
3. `npm i -D tsx`; `scripts/check-floors.ts`; iterate on the generator until all assertions pass for every pyramid floor and for seeds 1..300 on Egypt floors 1–10; read the ASCII dumps of Egypt floors 1, 5, 10 and fix anything that reads as a grid.
4. `game.ts`, `vision.ts`, `pyramids.ts` (camps, `floorFor`), `progress.ts` migration; `npx tsc --noEmit`.
5. `themes.ts`, `floorArt.ts`, `lightMask.ts`, `drawGame.ts`, `GameScreen.tsx` camera.
6. Dev buttons; CLAUDE.md.
7. Verification below; write the snapshot (`--update`) last.

## Verification

- `npx tsc --noEmit`, `npx expo-doctor`, `npx expo export --platform android --output-dir <scratchpad>`.
- `npm run check:floors` asserts, for every pyramid floor and Egypt seeds 1..300:
  - determinism (generate twice → equal hash) and snapshot match for the fixed floors;
  - every non-solid tile reachable from `start`; exactly one STAIRS_DOWN (none on the basement, where `stairs` is the artifact tile) and `stairs` reachable;
  - stairs room is a leaf with exactly one door; `dist(stairs) ≥ 0.6 × max dist`;
  - no oil on `mainPath`; oil count ≥ 1; oil spacing ≥ 6;
  - loop edges = 0 on Egypt floors 1–3, > 0 on at least 2 of floors 8–10;
  - Egypt floors 5–10 contain ≥ 1 hall with pillars, floors 4–10 a gallery when the lattice allows it (report, not fail, if not), ≥ 3 distinct room kinds per floor from floor 3;
  - "not a grid" metrics printed per floor: mean straight passage run length (target ≥ 4 tiles on floor 10), share of open tiles inside rooms vs passages (rooms 35–65 %), mean rock thickness between parallel passages (≥ 2);
  - camps: `isCampFloor` true exactly for Egypt indices 4, 9; `lastCamp(egypt, 3) = 0`, `(6) = 4`, `(9) = 9`;
  - generation time per floor < 2 ms average on the desktop (warn above).
- Metrics table printed: size, open tiles, rooms by kind, main path length, loops, oil.
- Web preview (`npm run web`): Egypt from the top through floor 10 (dev buttons for camps 5/10): walls show faces and thickness, halls with pillar shadows, gallery benches lit, no tile checkerboard, light never shows what is behind a wall, camera smooth, artifact in the burial chamber ends the run, camp panel on floors 5 and 10, burn-out returns to the right camp. Old save loads without crash (migration).
- Device: release `preview` APK on the Redmi 9 (part of the planned performance test) — judge FPS there only.

## Performance budget (Redmi 9 class: Helio G80, Mali-G52, Hermes)

- Generation: < 2 ms/floor on desktop Node, < 20 ms on device; chain to floor 10 < 150 ms once per session, behind the overview.
- Bake: ≤ 2048² px RGBA (≤ 16 MB, floor 10 at 24 px × 2 ≈ 1970²), < 120 ms on device, once per floor, hidden by the 2.4 s overview.
- Per frame JS: relight + mask (82² px) + picture record < 4 ms; ≤ 10 draw calls; zero per-tile allocations.
- GPU: one image blit + one layer + one mask + ≤ 30 sprites; 60 fps while the camera moves, 20 fps idle.

## Risks

- Large halls and galleries make floors easier (the torch reveals much); tune quotas and `span` from the metrics, keep halls off the main path's last third if playtests confirm.
- Pillar lattice can look grid-like; mitigate with round columns, shadows and paving aligned to the room, not tiles.
- `Skia.Surface.Make` / `MakeImage` behaviour on web (CanvasKit) and native differs; verify both early (step 5 first thing); fallback `MakeOffscreen` + `makeNonTextureImage()`.
- 2048 px cap: 25-floor Egypt (task 03) will need lower bake scale or chunked bakes; `bakeFloor` takes `scale` already.
- Per-frame image creation churn; ring of 2 with explicit `dispose()`; task 11 replaces the mask with a shader uniform/texture.
- World-aligned arrival couples floors; any change to floor k changes floors > k (snapshot shows it; acceptable while prototyping).
- Save migration resets camps once; acceptable in prototype.
