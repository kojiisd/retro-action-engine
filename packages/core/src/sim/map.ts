import type { PackRuntime, RoomData } from '../runtime/pack';
import type { World } from '../world/world';
import { viewSize } from './camera';

/**
 * The map (ADR-0020, M3-6b): a room cut into screens, the size of the play area (the whole room
 * without a camera), counting a part screen at the right or bottom edge as a screen.
 */

/** A room's screens: their size in px, and how many across and down. */
export function screenGrid(
  runtime: PackRuntime,
  room: RoomData,
): { w: number; h: number; cols: number; rows: number } {
  const roomW = room.widthTiles * runtime.tileSize;
  const roomH = room.heightTiles * runtime.tileSize;
  const view = viewSize(runtime) ?? { w: roomW, h: roomH };
  return {
    w: view.w,
    h: view.h,
    cols: Math.max(1, Math.ceil(roomW / view.w)),
    rows: Math.max(1, Math.ceil(roomH / view.h)),
  };
}

/** The screen a point (room px) is in, clamped to the room. */
function screenAt(grid: ReturnType<typeof screenGrid>, x: number, y: number): number {
  const col = Math.min(grid.cols - 1, Math.max(0, Math.floor(x / grid.w)));
  const row = Math.min(grid.rows - 1, Math.max(0, Math.floor(y / grid.h)));
  return row * grid.cols + col;
}

/** The screen the center of the active body is in, in the room the party is in. */
function bodyScreen(world: World, runtime: PackRuntime): number | undefined {
  const room = runtime.rooms[world.roomId];
  if (room === undefined || world.party.members.length === 0) return undefined;
  const s = world.entities;
  const slot = s.slotOf(world.party.entityId);
  const cx = (s.x[slot] as number) + (s.colOx[slot] as number) + ((s.colW[slot] as number) >> 1);
  const cy = (s.y[slot] as number) + (s.colOy[slot] as number) + ((s.colH[slot] as number) >> 1);
  return screenAt(screenGrid(runtime, room), cx >> 8, cy >> 8);
}

/** Records the screen the body is in as visited (after `camera`, and on entering a room). */
export function markVisited(world: World, runtime: PackRuntime): void {
  const cell = bodyScreen(world, runtime);
  if (cell === undefined) return;
  const cells = world.visited[world.roomId] ?? [];
  if (cells.includes(cell)) return;
  // Kept ascending, so the hash does not depend on the order of the visits.
  let at = cells.length;
  while (at > 0 && (cells[at - 1] as number) > cell) at--;
  cells.splice(at, 0, cell);
  world.visited[world.roomId] = cells;
}

/** What the menu's map shows of the room the party is in. Integers and strings only. */
export interface RoomMap {
  readonly roomId: string;
  readonly cols: number;
  readonly rows: number;
  /** Screens visited, ascending (`row * cols + col`). */
  readonly visited: readonly number[];
  /** Whether the screens not visited show too (an item with `revealsMap` is held). */
  readonly revealed: boolean;
  /** The screen the body is in, or -1. */
  readonly here: number;
  /** Screens with an exit (the center of its box), ascending, without repeats. */
  readonly exits: readonly number[];
}

/** The map of the room the party is in (ADR-0020, M3-6b). Reads the World, never writes. */
export function roomMap(world: World, runtime: PackRuntime): RoomMap {
  const room = runtime.rooms[world.roomId];
  if (room === undefined) {
    throw new RangeError(`room "${world.roomId}" is not defined`);
  }
  const grid = screenGrid(runtime, room);
  const exits = new Set<number>();
  for (const exit of room.exits ?? []) {
    exits.add(
      screenAt(
        grid,
        (exit.rect.x + (exit.rect.w >> 1)) >> 8,
        (exit.rect.y + (exit.rect.h >> 1)) >> 8,
      ),
    );
  }
  const items = runtime.items ?? {};
  return {
    roomId: room.id,
    cols: grid.cols,
    rows: grid.rows,
    visited: [...(world.visited[room.id] ?? [])],
    revealed: Object.keys(world.inventory).some((id) => items[id]?.revealsMap === true),
    here: bodyScreen(world, runtime) ?? -1,
    exits: [...exits].sort((a, b) => a - b),
  };
}
