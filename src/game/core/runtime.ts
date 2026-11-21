import type { Carried } from './lights';
import type { GameEvent, GameState } from './game';

/**
 * Small state helpers shared by game.ts, traps.ts and collapse.ts. They live here so the three
 * can import them without importing each other in a cycle.
 */

const EVENT_LOG = 8;

export function emit(s: GameState, type: GameEvent['type'], kind: GameEvent['kind']) {
  s.events.push({ seq: ++s.eventSeq, type, kind });
  if (s.events.length > EVENT_LOG) s.events.shift();
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
