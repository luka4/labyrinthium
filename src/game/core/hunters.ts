import type { GameState } from './game';
import { guardianCue } from './guardian';
import { ruleCues, type HunterCue } from './plugins';
import { isFrozen } from './powers';

/**
 * Everything that hunts you on this floor, as cues for sound, heartbeat and the renderer: the built-in
 * guardian (id 'guardian', its sprite from `floor.guardian.kind`) and the cues of every plug-in hunter.
 * The director and the renderer read this instead of `guardianCue` directly.
 */
export function hunterCues(s: GameState): HunterCue[] {
  const out: HunterCue[] = [];
  const g = guardianCue(s);
  if (g) out.push({ id: 'guardian', dx: g.dx, dy: g.dy, path: g.path, visible: g.visible, mode: g.mode, frozen: s.powers.length > 0 && isFrozen(s) });
  out.push(...ruleCues(s));
  return out;
}
