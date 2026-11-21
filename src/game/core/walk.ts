import { DIRS, TILE, type Floor, type Grid } from './floor';
import type { Direction } from './game';

/**
 * Auto-walk helpers: pure functions of a grid (a `Floor` or the run's `s.grid`). The UI issues
 * plain `move` actions with the directions these return, so a replay stays a list of moves.
 * `avoid` (armed trap tiles, covered sand) is a predicate so this file never sees `GameState`.
 */

const BACK: Record<Direction, Direction> = { 0: 1, 1: 0, 2: 3, 3: 2 };

type Open = Pick<Grid, 'size' | 'solid'>;

function openAt(grid: Open, pos: number, dir: Direction): number {
  const { size, solid } = grid;
  const x = (pos % size) + DIRS[dir][0];
  const y = Math.floor(pos / size) + DIRS[dir][1];
  if (x < 0 || y < 0 || x >= size || y >= size) return -1;
  const i = y * size + x;
  return solid[i] ? -1 : i;
}

/** Open orthogonal exits of a tile. */
export function exits(grid: Open, pos: number): Direction[] {
  const out: Direction[] = [];
  for (let d = 0; d < 4; d++) if (openAt(grid, pos, d as Direction) >= 0) out.push(d as Direction);
  return out;
}

/** A corridor tile has exactly two open orthogonal neighbours. */
export function isCorridor(grid: Open, pos: number): boolean {
  return exits(grid, pos).length === 2;
}

/**
 * Direction to keep walking while the finger holds `dir`: straight on if open; at a
 * corridor tile with a wall ahead, follow the single other exit unless it is an `avoid` tile
 * (straight on stays the player's choice); otherwise stop (null).
 */
export function holdDir(grid: Open, pos: number, dir: Direction, avoid?: (tile: number) => boolean): Direction | null {
  if (openAt(grid, pos, dir) >= 0) return dir;
  const ex = exits(grid, pos);
  if (ex.length === 2 && ex.includes(BACK[dir])) {
    // a bend: the exit that is not the way we came from
    const turn = ex.find((d) => d !== BACK[dir]);
    if (turn === undefined) return null;
    if (avoid && avoid(openAt(grid, pos, turn))) return null;
    return turn;
  }
  return null;
}

/**
 * Next direction of a flick-run, or null to stop on `pos`. Stops on the stairs, junctions
 * (3+ exits), dead ends, doors, where `interesting(pos)` (an item or an unlit fixture next to
 * the tile) and before an `avoid` tile. The first step of a run is taken with holdDir by the caller.
 */
export function runDir(
  floor: Pick<Floor, 'stairs' | 'tiles'>,
  grid: Open,
  pos: number,
  dir: Direction,
  interesting: (tile: number) => boolean,
  avoid?: (tile: number) => boolean,
): Direction | null {
  if (pos === floor.stairs || floor.tiles[pos] === TILE.DOOR) return null;
  if (exits(grid, pos).length !== 2) return null;
  if (interesting(pos)) return null;
  const d = holdDir(grid, pos, dir, avoid);
  if (d !== null && avoid && avoid(openAt(grid, pos, d))) return null;
  return d;
}
