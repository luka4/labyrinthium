/**
 * Artifact powers and water (plan 06), called from check-floors.ts. Pure core code: no Skia, no React.
 * Egypt carries Scarab, Mirror and Jade; the Naga is exercised on the water sandbox.
 */
import { DIRS } from '../src/game/core/floor';
import { startFloor, startOn, step, type Direction, type GameState, type Pyramid } from '../src/game/core/game';
import { floorFor } from '../src/game/core/generate';
import { CARRY, STEP_SECONDS, radiusQ } from '../src/game/core/lights';
import { PYRAMIDS } from '../src/game/core/pyramids';
import { EGYPT_ROWS } from '../src/game/core/egypt';
import { createRng } from '../src/game/core/rng';
import { POWERS, POWER_GAP, POWER_ORDER, MIRROR_CAP, carryPowers, freshPowers, handRadius, power, scarabPath, type PowerId } from '../src/game/core/powers';
import { BREATH, FLOODED, MAX_DEEP_RUN, SWIM, WATER_PACE, WET, band, setWater, waterFairness } from '../src/game/core/water';
import { waterSandbox } from '../src/game/core/sandbox';
import { sightRange } from '../src/game/core/guardian';
import { takeArtifact } from '../src/game/core/escape';
import { computeLight } from '../src/game/core/vision';
import { hashState } from './check-light-rules';

type Report = { fail: (m: string) => void; warn: (m: string) => void; snapshot: Record<string, string>; old: Record<string, string>; update: boolean };

const egypt = PYRAMIDS.egypt;
const tick = (s: GameState, seconds: number) => step(s, { type: 'tick', seconds });
const move = (s: GameState, dir: Direction) => step(s, { type: 'move', dir });
const use = (s: GameState, id: PowerId) => step(s, { type: 'power', power: id });
const ALL = freshPowers('egypt', POWER_ORDER);
const has = (s: GameState, type: string, kind?: string) => s.events.some((e) => e.type === type && (kind === undefined || e.kind === kind));
const lit = (s: GameState) => s.lightHand.reduce((n, v) => n + (v > 0 ? 1 : 0), 0);

/** Ticks `seconds` in steps of 0.1 (state stays the same object). */
function run(s: GameState, seconds: number, dt = 0.1): GameState {
  const n = Math.round(seconds / dt);
  for (let k = 0; k < n; k++) s = tick(s, dt);
  return s;
}

function openNeighbors(s: GameState, pos = s.pos): Array<{ dir: Direction; tile: number }> {
  const { size, solid } = s.grid;
  const out: Array<{ dir: Direction; tile: number }> = [];
  for (let d = 0; d < 4; d++) {
    const x = (pos % size) + DIRS[d][0];
    const y = Math.floor(pos / size) + DIRS[d][1];
    const i = y * size + x;
    if (x >= 0 && y >= 0 && x < size && y < size && !solid[i]) out.push({ dir: d as Direction, tile: i });
  }
  return out;
}

export const sandboxPyramid: Pyramid = { ...egypt };
export function sandboxRun(powers = freshPowers('sandbox', POWER_ORDER)): GameState {
  const floor = waterSandbox(floorFor(egypt, 2));
  return startOn(floor, egypt, 2, { kind: 'bigTorch', left: 100 }, [], 0, 0, { powers });
}

/** 3000 random actions (a power use 1 in 40), returns the full state hash. */
export function randomRun(start: () => GameState, seed: number, withPowers: boolean): string {
  const rng = createRng(seed);
  let s = start();
  for (let a = 0; a < 3000; a++) {
    if (s.status !== 'playing') break;
    if (a % 2 === 0) s = step(s, { type: 'tick', seconds: 0.1 });
    else if (withPowers && rng() < 1 / 20) s = step(s, { type: 'power', power: POWER_ORDER[Math.floor(rng() * 4)] });
    else {
      const opts = openNeighbors(s).filter((o) => o.tile !== s.floor.stairs);
      const dir = rng() < 0.75 && opts.length ? opts[Math.floor(rng() * opts.length)].dir : (Math.floor(rng() * 4) as Direction);
      s = step(s, { type: 'move', dir });
    }
  }
  return hashState(s, true);
}

/** A corridor along row 1 (like check-guardian's arena) for staging the guardian. */
function arena(floorIndex: number, powers: GameState['powers']) {
  const s = startFloor(egypt, floorIndex, { kind: 'torch', left: 1000 }, [], 0, 0, { powers });
  const { size } = s.floor;
  for (let x = 1; x < size - 1; x++) {
    s.grid.solid[size + x] = 0;
    s.grid.opaque[size + x] = 0;
  }
  s.burning = true;
  s.cooldown = 0;
  s.collapse = null;
  return { s, at: (x: number) => size + x };
}

export function runPowerChecks({ fail, warn, snapshot, old, update }: Report) {
  void warn;
  // ---- numbers -----------------------------------------------------------------------------------------
  {
    const f = (pid: string, id: PowerId) => freshPowers(pid, [id])[0];
    const a = f('cambodia', 'scarab');
    if (a.uses !== 3 || a.seconds !== 8 || a.strength !== 999 || !a.attuned) fail('powers: scarab in cambodia is not 3 uses / 8 s / 999');
    const b = f('egypt', 'jade');
    if (b.uses !== 2 || b.seconds !== 6 || !b.attuned) fail('powers: jade in egypt is not 2 uses / 6 s');
    const c = f('egypt', 'scarab');
    if (c.uses !== 2 || c.seconds !== 5 || c.strength !== 12 || c.attuned) fail('powers: scarab base numbers');
    if (f('china', 'mirror').strength !== 1.8 || f('maya', 'naga').seconds !== 16) fail('powers: mirror in china / naga in maya');
    if (freshPowers('egypt', []).length !== 0) fail('powers: none owned gives a list');
    if (freshPowers('egypt', ['jade', 'scarab']).map((p) => p.id).join() !== 'scarab,jade') fail('powers: not in POWER_ORDER');
    for (const id of POWER_ORDER) if (!(id in POWERS)) fail(`powers: no spec for ${id}`);
  }

  // ---- use, gap, empty, not owned, expiry -----------------------------------------------------------------
  {
    let s = startFloor(egypt, 9, { kind: 'bigTorch', left: 100 }, [], 0, 0, { powers: ALL });
    s = use(s, 'scarab');
    const sc = power(s, 'scarab')!;
    if (sc.uses !== 1 || sc.left !== 5 || !has(s, 'powerUsed', 'scarab') || !s.burning) fail('powers: a use did not take a charge, start the timer, emit and light the clock');
    const seq = s.eventSeq;
    s = use(s, 'scarab');
    if (power(s, 'scarab')!.uses !== 1 || s.eventSeq !== seq) fail('powers: a second use while active was not ignored');
    s = use(s, 'mirror');
    if (power(s, 'mirror')!.uses !== 2) fail('powers: the gap did not block a second power');
    s = tick(s, POWER_GAP + 0.01);
    s = use(s, 'mirror');
    if (power(s, 'mirror')!.uses !== 1 || power(s, 'mirror')!.left !== 8) fail('powers: a power after the gap did not work');
    // expiry
    s = run(s, 5);
    if (power(s, 'scarab')!.left !== 0 || !has(s, 'powerEnded', 'scarab')) fail('powers: the scarab did not end after its seconds');
    // empty
    const e = startFloor(egypt, 9, { kind: 'bigTorch', left: 100 }, [], 0, 0, { powers: ALL });
    power(e, 'naga')!.uses = 0;
    const before = { ...power(e, 'naga')! };
    const gap = e.powerGap;
    const burning = e.burning;
    const out = use(e, 'naga');
    if (!has(out, 'powerEmpty', 'naga') || power(out, 'naga')!.left !== before.left || out.powerGap !== gap || out.burning !== burning) fail('powers: an empty power changed something other than the event');
    // not owned: the state hash does not change
    const lone = startFloor(egypt, 9, { kind: 'bigTorch', left: 100 }, [], 0, 0, { powers: freshPowers('egypt', ['scarab']) });
    const h0 = hashState(lone, true);
    const seq0 = lone.eventSeq;
    use(lone, 'mirror');
    if (hashState(lone, true) !== h0 || lone.eventSeq !== seq0) fail('powers: a power you do not own changed the state');
    // time only counts while burning
    const idle = startFloor(egypt, 9, { kind: 'bigTorch', left: 100 }, [], 0, 0, { powers: ALL });
    power(idle, 'jade')!.left = 3;
    idle.burning = false;
    run(idle, 2);
    if (power(idle, 'jade')!.left !== 3) fail('powers: an active power counted down while the clock was not burning');
    // no powers: an action does nothing
    const none = startFloor(egypt, 9);
    const hn = hashState(none, true);
    use(none, 'jade');
    if (hashState(none, true) !== hn || none.powers.length) fail('powers: use without powers changed the state');
  }

  // ---- scarab ----------------------------------------------------------------------------------------------
  {
    const s = startFloor(egypt, 9, { kind: 'bigTorch', left: 100 }, [], 0, 0, { powers: ALL });
    const { size } = s.floor;
    const goal = s.floor.stairs;
    const dist = new Int32Array(size * size).fill(-1);
    const q = [goal];
    dist[goal] = 0;
    for (let h = 0; h < q.length; h++) for (const [dx, dy] of DIRS) {
      const nx = (q[h] % size) + dx;
      const ny = Math.floor(q[h] / size) + dy;
      const n = ny * size + nx;
      if (nx >= 0 && ny >= 0 && nx < size && ny < size && !s.grid.solid[n] && dist[n] < 0) {
        dist[n] = dist[q[h]] + 1;
        q.push(n);
      }
    }
    const d0 = dist[s.pos];
    for (const reach of [4, 12, 999]) {
      const path = scarabPath(s, reach);
      if (path.length !== Math.min(reach, d0)) fail(`scarab: path length ${path.length}, want ${Math.min(reach, d0)} (reach ${reach})`);
      let at = s.pos;
      let ok = true;
      for (let k = 0; k < path.length; k++) {
        const adj = Math.abs((path[k] % size) - (at % size)) + Math.abs(Math.floor(path[k] / size) - Math.floor(at / size)) === 1;
        if (!adj || s.grid.solid[path[k]] || dist[path[k]] !== d0 - 1 - k) ok = false;
        at = path[k];
      }
      if (!ok) fail(`scarab: path (reach ${reach}) is not an open 4-connected path with strictly falling distance`);
      if (reach >= d0 && path[path.length - 1] !== goal) fail('scarab: the whole way does not end at the stairs');
    }
    // basement: after the artifact it targets the false door's front
    const b = startFloor(egypt, 24, { kind: 'bigTorch', left: 100 }, [], 0, 0, { powers: ALL });
    const toArt = scarabPath(b, 999);
    if (!toArt.length || toArt[toArt.length - 1] !== b.floor.stairs) fail('scarab: in the basement it does not lead to the artifact first');
    b.pos = b.floor.stairs;
    takeArtifact(b);
    const toDoor = scarabPath(b, 999);
    if (!toDoor.length || toDoor[toDoor.length - 1] !== b.floor.exitFront) fail('scarab: after the artifact it does not lead to the false door');
    // blocked: every way out of your tile is closed (a fired portcullis on the only way)
    const sealed = startFloor(egypt, 9, { kind: 'bigTorch', left: 100 }, [], 0, 0, { powers: ALL });
    for (const n of openNeighbors(sealed)) sealed.grid.solid[n.tile] = 1;
    if (scarabPath(sealed, 999).length) fail('scarab: a path when every way is blocked');
  }

  // ---- mirror -------------------------------------------------------------------------------------------------
  {
    let s = startFloor(egypt, 9, { kind: 'torch', left: 60 }, [], 0, 0, { powers: ALL });
    const r0 = s.handR;
    // the widening shows in open space (the arrival stairwell is walled in): the open tile where it gains most
    const { size } = s.floor;
    const probeLight = new Float32Array(size * size);
    const count = (at: number, r: number) => computeLight(s.grid, at, r, 1.6, probeLight).reduce((n, v) => n + (v > 0 ? 1 : 0), 0);
    let spot = s.floor.start;
    let gain = 0;
    for (let at = 0; at < size * size; at++) {
      if (s.grid.solid[at]) continue;
      const g = count(at, radiusQ(8)) / Math.max(1, count(at, radiusQ(5)));
      if (g > gain) {
        gain = g;
        spot = at;
      }
    }
    s.pos = s.prevPos = spot;
    s.burning = true;
    s.handR = -1;
    s = tick(s, 0);
    const lit0 = lit(s);
    const sight0 = (s.burning = true, sightRange(s));
    s = use(s, 'mirror');
    const base = 5.0;
    const want = radiusQ(Math.min(MIRROR_CAP, base * 1.6));
    if (s.handR !== want) fail(`mirror: handR ${s.handR}, want ${want}`);
    if (lit(s) < 1.8 * lit0) fail(`mirror: lit tiles ${lit(s)} vs ${lit0} (want >= 1.8x)`);
    if (sightRange(s) <= sight0) fail('mirror: a wide light is not seen from farther');
    if (handRadius(s) > MIRROR_CAP) fail('mirror: over the cap');
    s = run(s, 8.2);
    if (power(s, 'mirror')!.left !== 0 || s.handR > r0 + 1e-9) fail(`mirror: radius did not return after expiry (${s.handR} vs ${r0})`);
    // the cap
    const big = startFloor(egypt, 9, { kind: 'bigTorch', left: 100 }, [], 0, 0, { powers: ALL });
    use(big, 'mirror');
    if (big.handR !== MIRROR_CAP) fail(`mirror: a big torch is not capped at ${MIRROR_CAP} (${big.handR})`);
  }

  // ---- jade ---------------------------------------------------------------------------------------------------
  {
    // the guardian on floor 18, forced awake by a noise at its lair
    let s = startFloor(egypt, 17, { kind: 'bigTorch', left: 1000 }, [], 0, 0, { powers: ALL });
    s.burning = true;
    s.collapse = null;
    const g = s.guardian!;
    s.noises.push(s.floor.guardian!.lair, 99);
    s = run(s, 3);
    if (g.mode === 'dormant') fail('jade: could not force the guardian awake');
    s = use(s, 'jade');
    const snap = () => `${g.pos}|${g.cooldown}|${g.timer}|${g.rng}|${g.mode}`;
    const before = snap();
    s.noises.push(s.floor.guardian!.lair, 99);
    s = run(s, 3);
    if (snap() !== before) fail('jade: the guardian moved or changed during the freeze');
    if (s.noises.length) fail('jade: a frozen guardian kept a noise queue');
    // ... and moves again afterwards
    s = run(s, 4);
    s = run(s, 5);
    if (snap() === before) fail('jade: the guardian never moved again');

    // a plate pressed during the freeze waits
    const p = startFloor(egypt, 17, { kind: 'bigTorch', left: 1000 }, [], 0, 0, { powers: ALL });
    p.burning = true;
    p.collapse = null;
    const k = p.floor.traps.findIndex((t) => t.kind === 'block' || t.kind === 'portcullis' || t.kind === 'sandfall');
    if (k < 0) fail('jade: floor 18 has no plate');
    else {
      const t = p.floor.traps[k];
      const from = openNeighbors(p, t.tile).find((o) => p.floor.trapAt[o.tile] < 0);
      if (from) {
        const dir = DIRS.findIndex(([dx, dy]) => from.tile + dy * p.floor.size + dx === t.tile) as Direction;
        use(p, 'jade');
        p.pos = p.prevPos = from.tile;
        p.cooldown = 0;
        move(p, dir);
        if (p.trapPhase[k] !== 1) fail('jade: the plate was not pressed');
        const timer = p.trapTimer[k];
        run(p, 3);
        if (p.trapPhase[k] !== 1 || p.trapTimer[k] !== timer) fail('jade: a plate fired or counted down during the freeze');
        run(p, 3.2);
        run(p, t.delay + 0.5);
        if (p.trapPhase[k] === 1 || p.trapPhase[k] === 0) fail('jade: the plate never fired after the freeze');
      }
    }

    // the collapse holds still
    let c = startFloor(egypt, 11, { kind: 'bigTorch', left: 1000 }, [], 0, 0, { powers: ALL });
    const first = openNeighbors(c)[0];
    c = move(c, first.dir);
    c = run(c, EGYPT_ROWS[11].collapse!.delay + 2);
    const col = c.collapse!;
    if (col.fill <= 0) fail('jade: the collapse had not started (test setup)');
    c = use(c, 'jade');
    const f0 = `${col.fill}|${col.covered}`;
    c = run(c, 4);
    if (`${col.fill}|${col.covered}` !== f0) fail('jade: the collapse moved during the freeze');

    // the false door still opens
    let b = startFloor(egypt, 24, { kind: 'bigTorch', left: 1000 }, [], 0, 0, { powers: ALL });
    b.burning = true;
    b.pos = b.floor.stairs;
    takeArtifact(b);
    b = use(b, 'jade');
    b = run(b, 2);
    if (!b.escape!.open) fail('jade: the false door did not open during the freeze');

    // noises made during the freeze are never heard
    const a = arena(17, freshPowers('egypt', ['jade']));
    const gg = a.s.guardian!;
    gg.pos = gg.prev = a.at(5);
    gg.mode = 'dormant';
    gg.distFrom = gg.toTargetFor = -1;
    a.s.pos = a.s.prevPos = a.at(9);
    a.s.idle = 0.1;
    use(a.s, 'jade');
    move(a.s, 1);
    run(a.s, 7);
    if (gg.mode !== 'dormant') fail('jade: a noise during the freeze woke the guardian later');

    // walking into a frozen guardian bumps, no touch
    const t2 = arena(17, freshPowers('egypt', ['jade']));
    const g2 = t2.s.guardian!;
    g2.pos = g2.prev = t2.at(6);
    g2.mode = 'patrol';
    g2.distFrom = g2.toTargetFor = -1;
    t2.s.pos = t2.s.prevPos = t2.at(5);
    use(t2.s, 'jade');
    move(t2.s, 0);
    if (t2.s.pos !== t2.at(5) || g2.touches !== 0) fail('jade: walking into a frozen guardian was not a bump with no touch');
  }

  // ---- charges across floors -------------------------------------------------------------------------------------
  {
    let s = startFloor(egypt, 3, { kind: 'bigTorch', left: 100 }, [], 0, 0, { powers: ALL });
    s = use(s, 'scarab');
    s = tick(s, 1);
    s.status = 'descending';
    const next = step(s, { type: 'continue' }); // floor 5 (index 4) is a camp
    if (next.floorIndex !== 4 || power(next, 'scarab')!.uses !== 2 || power(next, 'scarab')!.left !== 0) fail('charges: a camp floor did not refill the uses and end the active power');
    let t = startFloor(egypt, 5, { kind: 'bigTorch', left: 100 }, [], 0, 0, { powers: ALL });
    t = use(t, 'scarab');
    t.status = 'descending';
    const n2 = step(t, { type: 'continue' });
    if (n2.floorIndex !== 6 || power(n2, 'scarab')!.uses !== 1 || power(n2, 'scarab')!.left !== 0) fail('charges: a plain floor did not keep the uses (and end the active power)');
    let f = startFloor(egypt, 5, { kind: 'bigTorch', left: 100 }, [], 0, 0, { powers: ALL });
    f = use(f, 'jade');
    f.status = 'falling';
    const n3 = step(f, { type: 'continue' });
    if (power(n3, 'jade')!.uses !== 1 || power(n3, 'jade')!.left !== 0) fail('charges: falling refilled or kept an active power');
    let r = startFloor(egypt, 6, { kind: 'bigTorch', left: 100 }, [], 0, 0, { powers: ALL });
    r = use(r, 'scarab');
    r.status = 'burntOut';
    const n4 = step(r, { type: 'retry' });
    if (n4.floorIndex !== 4 || power(n4, 'scarab')!.uses !== 2 || n4.powers.length !== 4) fail('charges: retry did not go back to the camp with fresh powers');
    if (carryPowers(r, false).some((p) => p.left)) fail('charges: carryPowers kept an active timer');
  }

  // ---- water and the Naga (sandbox) ---------------------------------------------------------------------------------
  {
    const floor = waterSandbox(floorFor(egypt, 2));
    const fair = waterFairness(floor);
    if (fair) fail(`water: the sandbox is not fair (${fair})`);
    const w = floor.water!;
    let flooded = -1;
    for (let i = 0; i < w.length; i++) if (w[i] >= FLOODED) flooded = i;
    // a tile next to a flooded one that is not flooded itself and not solid
    const mk = (powers: GameState['powers']) => sandboxRun(powers);
    const st = mk(freshPowers('sandbox', POWER_ORDER));
    const nb = openNeighbors(st, flooded).find((o) => w[o.tile] < FLOODED && !st.floor.solid[o.tile]);
    if (flooded < 0 || !nb) fail('water: the sandbox has no flooded passage');
    else {
      const back = DIRS.findIndex(([dx, dy]) => nb.tile + dy * st.floor.size + dx === flooded) as Direction;
      let s = mk([]);
      s.pos = s.prevPos = nb.tile;
      s.cooldown = 0;
      s.burning = true;
      const trail = s.trail;
      s = move(s, back);
      if (s.pos !== nb.tile || !has(s, 'flooded') || s.trail !== trail) fail('water: a flooded tile did not block without the Naga');
      let n = mk(freshPowers('sandbox', POWER_ORDER));
      n.pos = n.prevPos = nb.tile;
      n.cooldown = 0;
      n = use(n, 'naga');
      n.cooldown = 0;
      n = move(n, back);
      if (n.pos !== flooded) fail('water: the Naga did not carry you into the flooded tile');
      if (Math.abs(n.cooldown - STEP_SECONDS * WATER_PACE.naga) > 1e-9) fail(`water: Naga pace ${n.cooldown}`);
      if (!has(n, 'dive')) fail('water: entering a flooded tile did not emit dive');
    }
    // pace values by band
    const probe = (level: number, powers: GameState['powers'], activate?: PowerId) => {
      let s = mk(powers);
      const o = openNeighbors(s)[0];
      setWater(s, o.tile, level);
      if (activate) s = use(s, activate);
      s.cooldown = 0;
      s = move(s, o.dir);
      return s.cooldown;
    };
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
    if (!near(probe(100, []), STEP_SECONDS * WATER_PACE.shallow)) fail('water: shallow pace');
    if (!near(probe(170, []), STEP_SECONDS * WATER_PACE.deep)) fail('water: deep pace');
    if (!near(probe(170, freshPowers('sandbox', POWER_ORDER), 'naga'), STEP_SECONDS * WATER_PACE.naga)) fail('water: deep pace with the Naga');
    if (!near(probe(0, []), STEP_SECONDS)) fail('water: dry pace');
    // breath
    const deepTile = (() => {
      for (let i = 0; i < w.length; i++) if (w[i] >= SWIM && w[i] < FLOODED) return i;
      return -1;
    })();
    const onDeep = (powers: GameState['powers']) => {
      const s = mk(powers);
      s.pos = s.prevPos = deepTile;
      s.burning = true;
      return s;
    };
    let d = onDeep([]);
    d = run(d, 1);
    if (Math.abs(d.breath - (BREATH.max - 1)) > 0.01) fail(`water: deep water drains ${BREATH.max - d.breath}/s, want 1`);
    d = run(d, 4.5);
    if (d.events.filter((e) => e.type === 'breathLow').length !== 1) fail('water: breathLow not emitted exactly once');
    d = run(d, 4);
    if (d.status !== 'drowned' || !has(d, 'drowned')) fail('water: 8 s in deep water did not drown you');
    const back = step(d, { type: 'retry' });
    if (back.floorIndex !== 0 || back.status !== 'playing') fail('water: retry from drowned did not go to the last camp');
    let nn = onDeep(freshPowers('sandbox', POWER_ORDER));
    nn = use(nn, 'naga');
    nn = run(nn, 5);
    if (nn.breath !== BREATH.max) fail('water: the Naga did not stop the drain');
    let dry = onDeep([]);
    dry = run(dry, 3);
    const breath = dry.breath;
    dry.pos = dry.prevPos = dry.floor.start;
    dry = run(dry, 1);
    if (Math.abs(dry.breath - (breath + BREATH.recover)) > 0.01) fail('water: breath did not recover 2/s on dry land');
    // the Naga expiring inside a flooded tile
    let ex = mk(freshPowers('sandbox', POWER_ORDER));
    ex.pos = ex.prevPos = flooded;
    ex = use(ex, 'naga');
    power(ex, 'naga')!.left = 1;
    ex = run(ex, 3);
    if (Math.abs(ex.breath - (BREATH.max - 4)) > 0.25) fail(`water: the Naga expiring in a flooded tile drained to ${ex.breath}, want ${BREATH.max - 4}`);
    if (band(0) !== 'dry' || band(WET) !== 'shallow' || band(SWIM) !== 'deep' || band(FLOODED) !== 'flooded') fail('water: band thresholds');
    // 12 tiles of deep water at the slowest pace (2.0 x 0.15 s) cost 3.6 s of breath: well inside the 8 s
    if (MAX_DEEP_RUN * STEP_SECONDS * WATER_PACE.deep * BREATH.drainDeep > BREATH.max / 2) fail('water: MAX_DEEP_RUN exceeds half the breath');
  }

  // ---- fairness on every real floor, and a broken sandbox is caught --------------------------------------------------
  for (const id of Object.keys(PYRAMIDS) as Array<keyof typeof PYRAMIDS>) {
    const p = PYRAMIDS[id];
    for (let i = 0; i < p.floorCount; i++) {
      const f = floorFor(p, i);
      const why = waterFairness(f);
      if (why) fail(`water: ${id} floor ${i + 1} is not fair (${why})`);
      if (f.water !== null || Object.keys(f.ext).length) fail(`water: ${id} floor ${i + 1} has water or ext without a plug-in`);
    }
  }
  {
    const bad = waterSandbox(floorFor(egypt, 2));
    bad.water![bad.stairs] = 200;
    if (!waterFairness(bad)) fail('water: waterFairness missed water on the stairs');
    const wall = waterSandbox(floorFor(egypt, 2));
    for (const p of wall.mainPath) wall.water![p] = 230;
    if (!waterFairness(wall)) fail('water: waterFairness missed a flooded route');
    const long = waterSandbox(floorFor(egypt, 2));
    for (let k = 3; k < long.mainPath.length - 3; k++) long.water![long.mainPath[k]] = 150;
    if (!waterFairness(long)) fail('water: waterFairness missed a deep run over the limit');
  }

  // ---- determinism, committed keys ------------------------------------------------------------------------------------
  const cases: Array<[string, () => GameState]> = [
    ['4', () => startFloor(egypt, 4, { kind: 'bigTorch', left: 100 }, [{ kind: 'lamp', left: 150 }], 0, 0, { powers: ALL })],
    ['17', () => startFloor(egypt, 17, { kind: 'bigTorch', left: 100 }, [{ kind: 'lamp', left: 150 }], 0, 0, { powers: ALL })],
    ['24', () => startFloor(egypt, 24, { kind: 'bigTorch', left: 100 }, [{ kind: 'lamp', left: 150 }], 0, 0, { powers: ALL })],
    ['sandbox', () => sandboxRun()],
  ];
  for (const [name, start] of cases) {
    const a = randomRun(start, 777, true);
    const b = randomRun(start, 777, true);
    if (a !== b) fail(`powers: replay on ${name} diverged between two runs`);
    snapshot[`powers:${name}`] = a;
    if (old[`powers:${name}`] && old[`powers:${name}`] !== a && !update) fail(`powers: replay hash ${name} changed ${old[`powers:${name}`]} -> ${a} (--update only if deliberate)`);
  }
}
