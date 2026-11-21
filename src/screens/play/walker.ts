import { step, type Direction, type GameState } from '../../game/core/game';
import { holdDir, runDir } from '../../game/core/walk';

/**
 * Turns presses, holds and flicks into plain `move` actions, one per frame at most (the core
 * enforces the 0.15 s cadence with its cooldown). A plain object driven by the screen's
 * frame loop: no timers, no React, so a move is dispatched in the frame that asks for it.
 *
 *  - press(dir): move now (or as soon as the cooldown ends: one deep, latest wins) and keep
 *    walking while held; a held corridor follows its bends and stops at junctions it cannot read.
 *  - flick(dir): run on from the current tile until a junction, door, dead end, the stairs, or
 *    something worth stopping for next to the way.
 */
export type Walker = {
  press: (dir: Direction) => void;
  release: () => void;
  flick: (dir: Direction) => void;
  cancelRun: () => void;
  reset: () => void;
  /** call once per frame after `tick`; returns the (possibly new) state */
  update: (s: GameState) => GameState;
  /** true while a hold, run or queued move is pending (the screen redraws at full rate) */
  busy: () => boolean;
};

export function createWalker(onBump: () => void): Walker {
  let held: Direction | null = null;
  let queued: Direction | null = null;
  let run: Direction | null = null;
  /** the last press has not moved yet: a wall bump is feedback only for it */
  let fresh = false;

  const interesting = (s: GameState) => {
    const { size } = s.floor;
    const near = (a: number, b: number) => {
      const dx = Math.abs((a % size) - (b % size));
      const dy = Math.abs(Math.floor(a / size) - Math.floor(b / size));
      return dx + dy <= 1;
    };
    return (tile: number) => {
      for (const i of s.items.keys()) if (near(i, tile)) return true;
      for (let k = 0; k < s.floor.fixtures.length; k++) if (s.fixtureLeft[k] === -1 && near(s.floor.fixtures[k].tile, tile)) return true;
      return false;
    };
  };

  return {
    press(dir) {
      held = dir;
      queued = dir;
      run = null;
      fresh = true;
    },
    release() {
      held = null;
    },
    flick(dir) {
      run = dir;
    },
    cancelRun() {
      run = null;
    },
    reset() {
      held = null;
      queued = null;
      run = null;
      fresh = false;
    },
    busy: () => held !== null || queued !== null || run !== null,
    update(s) {
      if (s.status !== 'playing' || s.cooldown > 0) return s;
      let dir: Direction | null = null;
      if (queued !== null) {
        dir = queued;
        queued = null;
      } else if (run !== null) {
        dir = runDir(s.floor, s.pos, run, interesting(s));
        run = dir;
      } else if (held !== null) {
        dir = holdDir(s.floor, s.pos, held);
        held = dir;
      }
      if (dir === null) return s;
      const before = s.pos;
      const next = step(s, { type: 'move', dir });
      if (next.pos === before && next === s) {
        if (fresh) onBump();
        // a wall stops hold and run alike
        held = null;
        run = null;
      }
      fresh = false;
      return next;
    },
  };
}
