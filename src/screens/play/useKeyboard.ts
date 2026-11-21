import { useEffect } from 'react';
import { Platform } from 'react-native';

import type { Direction } from '../../game/core/game';
import type { Walker } from './walker';

const KEYS: Record<string, Direction> = {
  ArrowRight: 0,
  d: 0,
  D: 0,
  ArrowLeft: 1,
  a: 1,
  A: 1,
  ArrowDown: 2,
  s: 2,
  S: 2,
  ArrowUp: 3,
  w: 3,
  W: 3,
};

/**
 * Web keyboard: arrows or WASD (hold to keep walking, the last key pressed wins),
 * Shift + direction runs, Escape or P pauses. Listeners live on `window`.
 */
export function useKeyboard(walker: Walker, enabled: boolean, onPause: () => void) {
  useEffect(() => {
    if (Platform.OS !== 'web' || !enabled || typeof window === 'undefined') return;
    const stack: Direction[] = [];
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
        if (!e.repeat) onPause();
        return;
      }
      const dir = KEYS[e.key];
      if (dir === undefined) return;
      e.preventDefault();
      if (e.repeat) return; // the walker repeats by itself
      const at = stack.indexOf(dir);
      if (at >= 0) stack.splice(at, 1);
      stack.push(dir);
      walker.press(dir);
      if (e.shiftKey) walker.flick(dir);
    };
    const up = (e: KeyboardEvent) => {
      const dir = KEYS[e.key];
      if (dir === undefined) return;
      const at = stack.indexOf(dir);
      if (at >= 0) stack.splice(at, 1);
      if (stack.length) walker.press(stack[stack.length - 1]);
      else walker.release();
    };
    const blur = () => {
      stack.length = 0;
      walker.reset();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      walker.reset();
    };
  }, [walker, enabled, onPause]);
}
