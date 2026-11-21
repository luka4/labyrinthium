import { DIRS, TILE, type Floor } from './floor';
import type { Direction } from './game';

/**
 * Auto-walk helpers: pure functions of the floor. The UI issues plain `move` actions with
 * the directions these return, so a replay stays a list of moves.
 */

const BACK: Record<Direction, Direction> = { 0: 1, 1: 0, 2: 3, 3: 2 };

function openAt(floor: Floor, pos: number, dir: Direction): number {
  const { size, solid } = floor;
  const x = (pos % size) + DIRS[dir][0];
  const y = Math.floor(pos / size) + DIRS[dir][1];
  if (x < 0 || y < 0 || x >= size || y >= size) return -1;
  const i = y * size + x;
  return solid[i] ? -1 : i;
}

/** Open orthogonal exits of a tile. */
export function exits(floor: Floor, pos: number): Direction[] {
  const out: Direction[] = [];
  for (let d = 0; d < 4; d++) if (openAt(floor, pos, d as Direction) >= 0) out.push(d as Direction);
  return out;
}

/** A corridor tile has exactly two open orthogonal neighbours. */
export function isCorridor(floor: Floor, pos: number): boolean {
  return exits(floor, pos).length === 2;
}

/**
 * Direction to keep walking while the finger holds `dir`: straight on if open; at a
 * corridor tile with a wall ahead, follow the single other exit; otherwise stop (null).
 */
export function holdDir(floor: Floor, pos: number, dir: Direction): Direction | null {
  if (openAt(floor, pos, dir) >= 0) return dir;
  const ex = exits(floor, pos);
  if (ex.length === 2 && ex.includes(BACK[dir])) {
    // a bend: the exit that is not the way we came from
    return ex.find((d) => d !== BACK[dir]) ?? null;
  }
  return null;
}

/**
 * Next direction of a flick-run, or null to stop on `pos`. Stops on the stairs, junctions
 * (3+ exits), dead ends, doors, and where `interesting(pos)` (an item or an unlit fixture
 * next to the tile). The first step of a run is taken with holdDir by the caller.
 */
export function runDir(floor: Floor, pos: number, dir: Direction, interesting: (tile: number) => boolean): Direction | null {
  if (pos === floor.stairs || floor.tiles[pos] === TILE.DOOR) return null;
  if (exits(floor, pos).length !== 2) return null;
  if (interesting(pos)) return null;
  return holdDir(floor, pos, dir);
}
