import type { Carried } from './lights';
import type { GameEvent, GameState } from './game';

/**
 * Small state helpers shared by game.ts, traps.ts and collapse.ts. They live here so the three
 * can import them without importing each other in a cycle.
 */

const EVENT_LOG = 16;

/** `at` is the tile the event happened on (sound and haptics read it), or -1. */
export function emit(s: GameState, type: GameEvent['type'], kind: GameEvent['kind'], at = -1) {
  s.events.push({ seq: ++s.eventSeq, type, kind, at });
  if (s.events.length > EVENT_LOG) s.events.shift();
}

const MAX_NOISES = 32;

/**
 * Something made a noise on tile `at` that carries `radius` path steps. The guardian listens in
 * `tickGuardian`; the queue lives here so traps.ts never imports guardian.ts.
 */
export function noise(s: GameState, at: number, radius: number) {
  const g = s.guardian;
  if (s.noises.length >= MAX_NOISES * 2) return;
  // plug-in hunters that listen (s.listening) get the queue too, even without a guardian
  if (!s.listening && (!g || g.mode === 'arriving' || g.mode === 'gone')) return;
  s.noises.push(at, radius);
}

/** A passage changed: the guardian's cached distance fields are stale. */
export function invalidatePaths(s: GameState) {
  const g = s.guardian;
  if (!g) return;
  g.distFrom = -1;
  g.toTargetFor = -1;
}

/**
 * The guardian is driven off (touching you, a block falling on it): it recoils for a few seconds
 * towards the waypoint farthest from you.
 */
export function recoilGuardian(s: GameState, seconds: number) {
  const g = s.guardian;
  const plan = s.floor.guardian;
  if (!g || !plan) return;
  g.mode = 'recoil';
  g.timer = seconds;
  const { size } = s.floor;
  const px = s.pos % size;
  const py = (s.pos - px) / size;
  let best = plan.lair;
  let bestD = -1;
  for (const w of plan.route) {
    const d = Math.abs((w % size) - px) + Math.abs(Math.floor(w / size) - py);
    if (d > bestD) {
      bestD = d;
      best = w;
    }
  }
  g.target = best;
  g.toTargetFor = -1;
}

export function setHand(s: GameState, hand: Carried) {
  s.hand = hand;
  s.ember = 0;
  s.lowWarned = false;
}

/** The hand source is dead: the spare with the most time lights itself, else you are on embers. */
export function lightSpare(s: GameState) {
  let best = -1;
  s.bag.forEach((b, i) => {
    if (best < 0 || b.left > s.bag[best].left) best = i;
  });
  if (best >= 0) {
    const next = s.bag.splice(best, 1)[0];
    setHand(s, next);
    emit(s, 'autoLight', next.kind);
  }
}

/** A trap knocks the light from your hand (the same path as a burn-out). */
export function loseHand(s: GameState) {
  if (s.hand.left <= 0) return;
  s.hand.left = 0;
  s.ember = 0;
  lightSpare(s);
}

/** An item lost under sand. */
export function buryItem(s: GameState, i: number) {
  if (!s.items.has(i)) return;
  s.items.delete(i);
  emit(s, 'buriedItem', null);
}

/** Sand puts out every fixture on the tile (lit, unlit or eternal). */
export function smotherFixture(s: GameState, i: number) {
  const { fixtures } = s.floor;
  for (let k = 0; k < fixtures.length; k++) {
    if (fixtures[k].tile !== i || s.fixtureLeft[k] === 0) continue;
    s.fixtureLeft[k] = 0;
    s.fixedDirty = true;
  }
}
