import { tileClassAt } from '../collision/grid';
import { moveBody } from '../collision/move';
import type { HazardDef, PackRuntime } from '../runtime/pack';
import type { TileClass } from '../runtime/tile';
import { newControllerState, type World } from '../world/world';
import { cancelAttack } from './attack';
import { bodyContext } from './blocking';
import { activeTags } from './items';
import { activeCharacter, applyCharacter, isAlive, nextAlive } from './party';

// `roomGrid` lives in sim.ts, which imports this module; take it as an argument instead.
type GridOf = (runtime: PackRuntime, roomId: string) => Parameters<typeof tileClassAt>[0];

/**
 * The tile under the center of the party entity's box (ADR-0016): media and HP-draining tiles
 * are judged at this one point. Undefined outside the room.
 */
export function tileAtBodyCenter(
  world: World,
  runtime: PackRuntime,
  gridOf: GridOf,
): TileClass | undefined {
  const s = world.entities;
  const slot = s.slotOf(world.party.entityId);
  const cx = (s.x[slot] as number) + (s.colOx[slot] as number) + ((s.colW[slot] as number) >> 1);
  const cy = (s.y[slot] as number) + (s.colOy[slot] as number) + ((s.colH[slot] as number) >> 1);
  const size = runtime.tileSize;
  // Fx to px with a floor (>>), then the cell (an exact integer floor division, as in movement).
  return tileClassAt(
    gridOf(runtime, world.roomId),
    Math.floor((cx >> 8) / size),
    Math.floor((cy >> 8) / size),
  );
}

/** HP of every member at the start of a game: the characters' maxima, or none without HP rules. */
export function initialHp(runtime: PackRuntime, members: readonly string[]): number[] {
  if (runtime.rules.hp === undefined) return [];
  return members.map((id) => {
    const max = runtime.characters[id]?.hp?.max;
    if (max === undefined || !Number.isInteger(max) || max < 1) {
      throw new RangeError(`party member "${id}" needs hp.max (a positive integer) with rules.hp`);
    }
    return max;
  });
}

/** A hazard's values for the active character: the first `byTag` entry that matches wins. */
function hazardFor(
  def: HazardDef,
  tags: ReadonlySet<string>,
): { damage: number; interval: number } {
  for (const entry of def.byTag ?? []) {
    if (entry.anyTag.some((tag) => tags.has(tag))) {
      return {
        damage: entry.damage ?? def.damage,
        interval: entry.intervalTicks ?? def.intervalTicks,
      };
    }
  }
  return { damage: def.damage, interval: def.intervalTicks };
}

/** Puts the active body at rest and works out what it stands on, as at the start of a game. */
export function settleBody(world: World, runtime: PackRuntime, gridOf: GridOf): void {
  const s = world.entities;
  const slot = s.slotOf(world.party.entityId);
  s.vx[slot] = 0;
  s.vy[slot] = 0;
  s.contact[slot] = moveBody(
    gridOf(runtime, world.roomId),
    {
      x: s.x[slot] as number,
      y: s.y[slot] as number,
      vx: 0,
      vy: 0,
      w: s.colW[slot] as number,
      h: s.colH[slot] as number,
      ox: s.colOx[slot] as number,
      oy: s.colOy[slot] as number,
    },
    bodyContext(world, runtime),
  );
}

/**
 * HP in the `interaction` system (ADR-0016): HP-draining tiles under the body's center, then
 * what happens when the active character's HP reaches 0 (switch to a living member, or everyone
 * back at the room's entry with full HP). Returns true when the body was moved without
 * travelling (do not interpolate its sprite).
 */
export function hpStep(world: World, runtime: PackRuntime, gridOf: GridOf): boolean {
  const rules = runtime.rules.hp;
  if (rules === undefined) return false;
  const party = world.party;

  // ---- HP-draining tiles ----
  const id = tileAtBodyCenter(world, runtime, gridOf)?.hazard ?? '';
  const def = id === '' ? undefined : runtime.rules.hazards?.[id];
  const touching = def === undefined ? '' : id;
  if (touching !== party.hazardId) {
    party.hazardId = touching;
    party.hazardTicks = 0;
  }
  if (def !== undefined) {
    const { damage, interval } = hazardFor(def, activeTags(world, runtime));
    party.hazardTicks++;
    if (party.hazardTicks >= interval) {
      party.hazardTicks = 0;
      const index = party.activeIndex;
      party.hp[index] = Math.max(0, (party.hp[index] as number) - damage);
    }
  }
  if (isAlive(world, party.activeIndex)) return false;

  // ---- Down ----
  party.hazardId = '';
  party.hazardTicks = 0;
  const next = rules.onDeath === 'switchToAlive' ? nextAlive(world) : undefined;
  const s = world.entities;
  const slot = s.slotOf(party.entityId);
  if (next !== undefined) {
    const switchRules = runtime.rules.party.switch;
    party.activeIndex = next;
    party.cooldownTicks = switchRules.cooldownTicks;
    cancelAttack(world.controller);
    world.controller.climbing = false;
    applyCharacter(world, activeCharacter(world, runtime));
    if (switchRules.placement === 'spawn') {
      s.x[slot] = party.spawnX;
      s.y[slot] = party.spawnY;
      settleBody(world, runtime, gridOf);
      return true;
    }
    return false;
  }
  // Everyone is down: back where the party entered the room, all at full HP (no save points yet).
  party.hp = initialHp(runtime, party.members);
  party.cooldownTicks = 0;
  s.x[slot] = party.spawnX;
  s.y[slot] = party.spawnY;
  world.controller = newControllerState(world.controller.feelProfileId);
  world.animation = { name: '', frame: 0, ticks: 0 };
  settleBody(world, runtime, gridOf);
  return true;
}
