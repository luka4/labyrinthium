/**
 * The shared infrastructure of plan 06 (profile registry, tables, rule plug-ins), called from check-floors.ts.
 * Registers its own test plug-ins and profiles; nothing here is part of the game.
 */
import { profileFor, registerProfile, allProfiles, type ArchProfile } from '../src/game/core/architecture';
import { EGYPT_TABLE } from '../src/game/core/egypt';
import { DIRS, TILE, type Floor } from '../src/game/core/floor';
import { startFloor, step, type Direction, type GameState, type Pyramid } from '../src/game/core/game';
import { floorFor } from '../src/game/core/generate';
import { hasRule, hashRules, registerRule, ruleFor, type RulePlugin } from '../src/game/core/plugins';
import { PYRAMIDS } from '../src/game/core/pyramids';
import { freshPowers, POWER_ORDER } from '../src/game/core/powers';
import { profileFromTable } from '../src/game/core/tables';
import { SWIM, waterFairness } from '../src/game/core/water';
import { nextRandom } from '../src/game/core/rng';
import { featHash } from './check-traps';
import { placementHash } from './check-guardian';
import { secretsHash } from './check-secrets';
import { randomRun } from './check-powers';

type Report = { fail: (m: string) => void; warn: (m: string) => void; fnv: (f: Floor) => string };

/** what the probe plug-in keeps per run */
type ProbeRun = { frozenSeen: boolean[]; noises: number[][]; carriedIn: unknown; blockTile: number; ticks: number; moves: number; rng: number };
declare module '../src/game/core/plugins' {
  interface RunExt {
    'test.probe': ProbeRun;
  }
  interface FloorExt {
    'test.pools': { flooded: number[]; deep: number[] };
  }
}

const egypt = PYRAMIDS.egypt;
const tick = (s: GameState, seconds: number) => step(s, { type: 'tick', seconds });
const FLOODED_LEVEL = 240;
const DEEP_LEVEL = 170;

const pools: RulePlugin = {
  id: 'test.pools',
  place({ floor, layout, rng }) {
    const { size } = floor;
    const water = new Uint8Array(size * size);
    const onPath = new Uint8Array(size * size);
    for (const p of floor.mainPath) onPath[p] = 1;
    const flooded: number[] = [];
    const deep: number[] = [];
    // doorways of up to 2 leaf side rooms: the door and up to 2 passage tiles before it
    const leaves = layout.rooms.filter((r) => r.leaf && !r.main && r.doors.length === 1 && (r.kind === 'chamber' || r.kind === 'magazines' || r.kind === 'shrine'));
    for (let k = 0; k < 2 && leaves.length; k++) {
      const room = leaves.splice(Math.floor(rng() * leaves.length), 1)[0];
      const door = room.doors[0];
      let frontier = [door];
      water[door] = FLOODED_LEVEL;
      flooded.push(door);
      for (let d = 0; d < 2; d++) {
        const next: number[] = [];
        for (const t of frontier) {
          const x = t % size;
          const y = (t - x) / size;
          for (const [dx, dy] of DIRS) {
            const q = (y + dy) * size + (x + dx);
            if (floor.solid[q] || floor.room[q] === room.id || onPath[q] || water[q]) continue;
            water[q] = FLOODED_LEVEL;
            flooded.push(q);
            next.push(q);
          }
        }
        frontier = next;
      }
    }
    // deep water on one off-path passage
    const passages = layout.rooms.filter((r) => r.kind === 'passage' && !r.main);
    if (passages.length) {
      const room = passages[Math.floor(rng() * passages.length)];
      let n = 0;
      for (let q = 0; q < size * size && n < 4; q++) {
        if (floor.room[q] === room.id && !floor.solid[q] && !onPath[q] && !water[q]) {
          water[q] = DEEP_LEVEL;
          deep.push(q);
          n++;
        }
      }
    }
    // keep the fixed things dry
    const clear = (t: number, to: number) => {
      if (t >= 0 && water[t] > to) water[t] = to;
    };
    for (const it of floor.items) clear(it.tile, SWIM - 1);
    for (const f of floor.fixtures) clear(f.tile, SWIM - 1);
    clear(floor.start, 0);
    clear(floor.stairs, 0);
    clear(floor.exitFront, 0);
    for (const t of floor.traps) clear(t.tile, 0);
    for (const k of floor.secrets) clear(k.front, 0);
    if (floor.guardian) clear(floor.guardian.lair, 0);
    floor.water = water;
    floor.ext['test.pools'] = { flooded, deep };
  },
};

const probe: RulePlugin = {
  id: 'test.probe',
  listens: true,
  start(s, carried) {
    s.ext['test.probe'] = { frozenSeen: [], noises: [], carriedIn: carried, blockTile: -1, ticks: 0, moves: 0, rng: 12345 };
  },
  blocks(s, to) {
    return s.ext['test.probe']!.blockTile === to;
  },
  moved(s) {
    s.ext['test.probe']!.moves++;
  },
  tick(s, _dt, frozen, noises) {
    const p = s.ext['test.probe']!;
    p.ticks++;
    nextRandom(p);
    p.frozenSeen.push(frozen);
    if (noises.length) p.noises.push([...noises]);
  },
  carry(s) {
    return { ticks: s.ext['test.probe']!.ticks };
  },
  hash(s, mix) {
    const p = s.ext['test.probe']!;
    for (const v of [p.ticks, p.moves, p.rng]) for (let b = 0; b < 4; b++) mix((v >> (8 * b)) & 255);
  },
};

function openDirs(s: GameState): Array<{ dir: Direction; tile: number }> {
  const { size, solid } = s.grid;
  const out: Array<{ dir: Direction; tile: number }> = [];
  for (let d = 0; d < 4; d++) {
    const x = (s.pos % size) + DIRS[d][0];
    const y = Math.floor(s.pos / size) + DIRS[d][1];
    const i = y * size + x;
    if (x >= 0 && y >= 0 && x < size && y < size && !solid[i]) out.push({ dir: d as Direction, tile: i });
  }
  return out;
}

export function runPluginChecks({ fail, warn, fnv }: Report) {
  void warn;
  // ---- registries ----------------------------------------------------------------------------------------
  registerRule(pools);
  registerRule(probe);
  let threw = false;
  try {
    registerRule({ id: 'test.pools' });
  } catch {
    threw = true;
  }
  if (!threw) fail('plugins: registerRule accepted a duplicate id');
  threw = false;
  try {
    ruleFor('nope');
  } catch {
    threw = true;
  }
  if (!threw) fail('plugins: ruleFor accepted an unknown id');
  threw = false;
  try {
    profileFor('nope');
  } catch {
    threw = true;
  }
  if (!threw) fail('plugins: profileFor accepted an unknown id');
  const egyptProfile = profileFor('egypt');
  registerProfile({ ...egyptProfile, id: 'egypt-bad', rules: ['nope.rule'] });
  threw = false;
  try {
    profileFor('egypt-bad');
  } catch {
    threw = true;
  }
  if (!threw) fail('plugins: a profile with an unknown rule id was accepted');
  threw = false;
  try {
    registerProfile({ ...egyptProfile });
  } catch {
    threw = true;
  }
  if (!threw) fail('plugins: registerProfile accepted a duplicate id');
  for (const p of allProfiles()) {
    if (p.id === 'egypt-bad') continue;
    for (const r of p.rules ?? []) if (!hasRule(r)) fail(`plugins: profile ${p.id} lists rule ${r}, which nobody registered`);
  }

  // ---- profileFromTable reproduces Egypt ---------------------------------------------------------------------
  const shape = {
    span: egyptProfile.span,
    straightness: egyptProfile.straightness,
    loops: egyptProfile.loops,
    leafRooms: egyptProfile.leafRooms,
    junctionRoom: egyptProfile.junctionRoom,
    nicheRate: egyptProfile.nicheRate,
    basementRoom: egyptProfile.basementRoom,
    falseDoor: egyptProfile.falseDoor,
  };
  registerProfile(profileFromTable('egypt-t', EGYPT_TABLE, shape));
  const pyrT: Pyramid = { ...egypt, id: 'egypt-t', architecture: 'egypt-t' };
  for (let i = 0; i < egypt.floorCount; i++) {
    const a = floorFor(egypt, i);
    const b = floorFor(pyrT, i);
    const ha = [fnv(a), featHash(a), a.guardian ? placementHash(a) : '', secretsHash(a)].join('/');
    const hb = [fnv(b), featHash(b), b.guardian ? placementHash(b) : '', secretsHash(b)].join('/');
    if (ha !== hb) fail(`tables: profileFromTable('egypt-t') differs from Egypt on floor ${i + 1} (${ha} vs ${hb})`);
  }

  // ---- the test pools plug-in ------------------------------------------------------------------------------------
  registerProfile({ ...egyptProfile, id: 'egypt-p', rules: ['test.pools', 'test.probe'] });
  const pyrP: Pyramid = { ...egypt, id: 'egypt-p', architecture: 'egypt-p' };
  let floodedFloors = 0;
  let deepFloors = 0;
  for (let i = 0; i < egypt.floorCount; i++) {
    const a = floorFor(egypt, i);
    const p = floorFor(pyrP, i);
    const ha = [fnv(a), featHash(a), a.guardian ? placementHash(a) : '', secretsHash(a)].join('/');
    const hp = [fnv(p), featHash(p), p.guardian ? placementHash(p) : '', secretsHash(p)].join('/');
    if (ha !== hp) fail(`plugins: the plug-in changed Egypt's hashes on floor ${i + 1}`);
    const why = waterFairness(p);
    if (why) fail(`plugins: egypt-p floor ${i + 1} is not fair (${why})`);
    if (!p.water || !p.ext['test.pools']) fail(`plugins: egypt-p floor ${i + 1} got no water`);
    else {
      if (p.ext['test.pools'].flooded.length) floodedFloors++;
      if (p.ext['test.pools'].deep.length) deepFloors++;
    }
    if (i < 8) {
      // two generations equal, ext included (the layout chain is memoised, so compare a fresh feature pass)
      const twice = floorFor({ ...pyrP, id: 'egypt-p2' }, i);
      if (JSON.stringify(twice.ext) !== JSON.stringify(p.ext) || Buffer.compare(Buffer.from(twice.water ?? []), Buffer.from(p.water ?? [])) !== 0) fail(`plugins: egypt-p floor ${i + 1} not deterministic`);
    }
  }
  if (floodedFloors < 10) fail(`plugins: only ${floodedFloors} of 25 floors got a flooded doorway`);
  if (deepFloors < 10) fail(`plugins: only ${deepFloors} of 25 floors got deep water`);
  for (let seed = 1; seed <= 30; seed++) {
    const pyr: Pyramid = { ...egypt, id: `egypt-pf${seed}`, seed, architecture: 'egypt-p' };
    for (let i = 0; i < 25; i += 3) {
      const f = floorFor(pyr, i);
      const why = waterFairness(f);
      if (why) fail(`plugins: fuzz seed ${seed} floor ${i + 1} is not fair (${why})`);
    }
  }

  // ---- runtime: start, tick, frozen, noises, blocks, carry, hash ---------------------------------------------------------
  {
    let s = startFloor(pyrP, 2, { kind: 'bigTorch', left: 100 }, [], 0, 0, { powers: freshPowers('egypt', POWER_ORDER) });
    const ext = () => s.ext['test.probe']!;
    if (!ext() || !s.listening) fail('plugins: start did not run or the floor is not listening');
    s = tick(s, 0.2);
    s = step(s, { type: 'move', dir: openDirs(s)[0].dir });
    if (s.noises.length === 0) fail('plugins: a listening floor did not queue the step noise');
    s = tick(s, 0.1);
    if (!ext().noises.length || ext().noises[0].length < 2) fail('plugins: tick did not get the noises of the move');
    if (s.noises.length) fail('plugins: the noise queue was not cleared after the tick');
    if (ext().frozenSeen.some(Boolean)) fail('plugins: frozen true without the Jade Seal');
    s = step(s, { type: 'power', power: 'jade' });
    const before = ext().frozenSeen.length;
    for (let k = 0; k < 70; k++) s = tick(s, 0.1);
    const seen = ext().frozenSeen.slice(before);
    const jadeTicks = seen.findIndex((f) => !f);
    if (jadeTicks < 59 || jadeTicks > 61 || seen.slice(jadeTicks).some(Boolean) || !seen.slice(0, jadeTicks).every(Boolean)) fail(`plugins: frozen was true for ${jadeTicks} ticks, want 60 (exactly while the Jade is active, give or take float error)`);
    // blocks: a bump, no trail increment
    s = tick(s, 0.5);
    const o = openDirs(s)[0];
    ext().blockTile = o.tile;
    const trail = s.trail;
    const pos = s.pos;
    s = step(s, { type: 'move', dir: o.dir });
    if (s.pos !== pos || s.trail !== trail) fail('plugins: blocks did not make a bump');
    ext().blockTile = -1;
    // carry reaches the next floor
    const t = ext().ticks;
    s.status = 'descending';
    const n = step(s, { type: 'continue' });
    const got = n.ext['test.probe']?.carriedIn as { ticks: number } | undefined;
    if (!got || got.ticks !== t) fail('plugins: carry did not reach the next floor start');
    // hashRules mixes
    const mixed: number[] = [];
    hashRules(s, (v) => mixed.push(v));
    if (!mixed.length) fail('plugins: hashRules mixed nothing');
  }
  // without the plug-in, an Egypt floor is not listening and has no ext
  {
    const s = startFloor(egypt, 2);
    if (s.listening || Object.keys(s.ext).length || s.water) fail('plugins: plain Egypt run has plug-in state');
  }
  // determinism: 3000 random actions, twice
  for (const fi of [2, 11, 19]) {
    const start = () => startFloor(pyrP, fi, { kind: 'bigTorch', left: 100 }, [{ kind: 'lamp', left: 150 }], 0, 0, { powers: freshPowers('egypt', POWER_ORDER) });
    if (randomRun(start, 99 + fi, true) !== randomRun(start, 99 + fi, true)) fail(`plugins: egypt-p floor ${fi + 1} replay diverged`);
  }
  void TILE;
  void (null as ArchProfile | null);
}
