import type { CollisionContext } from '../collision/grid';
import type { PackRuntime } from '../runtime/pack';
import type { World } from '../world/world';
import { activeTags } from './items';

/**
 * The cells closed gimmicks fill (ADR-0021): a `breakable` until broken, a `gate` until its flag
 * is set. Row-major indices; undefined when none is closed.
 */
export function closedCells(
  world: World,
  runtime: PackRuntime,
  roomId: string = world.roomId,
): ReadonlySet<number> | undefined {
  const room = runtime.rooms[roomId];
  const gimmicks = room?.gimmicks;
  if (room === undefined || gimmicks === undefined) return undefined;
  const size = runtime.tileSize * 256;
  let cells: Set<number> | undefined;
  for (const g of gimmicks) {
    if (g.type !== 'breakable' && g.type !== 'gate') continue;
    if (flagSet(world, g.flag)) continue;
    cells ??= new Set<number>();
    const col0 = Math.floor(g.rect.x / size);
    const row0 = Math.floor(g.rect.y / size);
    const cols = Math.floor(g.rect.w / size);
    const rows = Math.floor(g.rect.h / size);
    for (let r = row0; r < row0 + rows; r++) {
      for (let c = col0; c < col0 + cols; c++) cells.add(r * room.widthTiles + c);
    }
  }
  return cells;
}

/** The collision context of the active character's body now: its tags and the closed cells. */
export function bodyContext(
  world: World,
  runtime: PackRuntime,
  extra: { readonly ignoreOneway?: boolean; readonly roomId?: string } = {},
): CollisionContext {
  const blocked = closedCells(world, runtime, extra.roomId);
  return {
    abilityTags: activeTags(world, runtime),
    ...(extra.ignoreOneway === true ? { ignoreOneway: true } : {}),
    ...(blocked === undefined ? {} : { blocked }),
  };
}

/** Whether a flag is set (true, or a number other than 0). */
export function flagSet(world: World, name: string): boolean {
  const value = world.flags[name];
  return value !== undefined && value !== false && value !== 0;
}
