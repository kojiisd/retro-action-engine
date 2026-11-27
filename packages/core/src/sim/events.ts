import type { EventAction, EventCondition, PackRuntime } from '../runtime/pack';
import type { World } from '../world/world';
import { flagSet } from './blocking';
import { bodyRect, type Notice } from './gimmicks';
import { giveItem, takeItem } from './items';

function holds(world: World, condition: EventCondition): boolean {
  if ('flag' in condition) {
    const value = world.flags[condition.flag] ?? false;
    return typeof condition.is === 'boolean'
      ? flagSet(world, condition.flag) === condition.is
      : value === condition.is;
  }
  if ('hasItem' in condition)
    return (world.inventory[condition.hasItem] ?? 0) >= (condition.count ?? 1);
  return (world.inventory[condition.notItem] ?? 0) === 0;
}

function run(world: World, runtime: PackRuntime, action: EventAction, notices: Notice[]): void {
  if ('setFlag' in action) {
    world.flags[action.setFlag] = action.value ?? true;
  } else if ('giveItem' in action) {
    const count = giveItem(world, runtime, action.giveItem, action.count ?? 1);
    if (count > 0) notices.push({ kind: 'pickup', itemId: action.giveItem, count });
  } else {
    takeItem(world, action.takeItem, action.count ?? 1);
  }
}

/**
 * The `events` system (ADR-0021): event zones of the room, in their order. A zone fires on the
 * tick the body goes in (`onZoneEnter`) or out (`onZoneExit`), when all its conditions hold.
 */
export function eventStep(world: World, runtime: PackRuntime, notices: Notice[]): void {
  const zones = runtime.rooms[world.roomId]?.zones;
  if (zones === undefined || zones.length === 0) {
    world.zonesInside = [];
    return;
  }
  const body = bodyRect(world);
  const inside: number[] = [];
  zones.forEach((zone, index) => {
    const r = zone.rect;
    const now =
      body.x < r.x + r.w && r.x < body.x + body.w && body.y < r.y + r.h && r.y < body.y + body.h;
    if (now) inside.push(index);
    const was = world.zonesInside.includes(index);
    const fires = zone.trigger === 'onZoneEnter' ? now && !was : was && !now;
    if (fires && zone.conditions.every((c) => holds(world, c))) {
      for (const action of zone.actions) run(world, runtime, action, notices);
    }
  });
  world.zonesInside = inside;
}
