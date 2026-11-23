import type { CollisionGrid } from '../collision/grid';
import { CONTACT_GROUNDED, moveBody } from '../collision/move';
import type { ExitDef, PackRuntime } from '../runtime/pack';
import { NEVER, noTransition, type World } from '../world/world';
import { snapCamera } from './camera';
import type { Intent } from './intent';
import { activeCharacter } from './party';
import { effectiveTags } from './tags';

// `roomGrid` lives in sim.ts, which imports this module; take it as an argument instead.
type GridOf = (runtime: PackRuntime, roomId: string) => CollisionGrid;

/** What the renderer needs to draw a room change (ADR-0018). */
export interface TransitionView {
  readonly effect: 'cut' | 'fade';
  readonly phase: 'out' | 'in';
  /** Ticks spent in the phase so far: dark is `tick / ticks` going out, the rest coming in. */
  readonly tick: number;
  /** Length of the phase. */
  readonly ticks: number;
}

/** No room change unless the pack sets one. */
const NO_TRANSITION_DEF = { effect: 'cut', lockTicks: 0 } as const;

function overlaps(world: World, rect: ExitDef['rect']): boolean {
  const s = world.entities;
  const slot = s.slotOf(world.party.entityId);
  const left = (s.x[slot] as number) + (s.colOx[slot] as number);
  const top = (s.y[slot] as number) + (s.colOy[slot] as number);
  return (
    left < rect.x + rect.w &&
    rect.x < left + (s.colW[slot] as number) &&
    top < rect.y + rect.h &&
    rect.y < top + (s.colH[slot] as number)
  );
}

function exitsOf(runtime: PackRuntime, roomId: string): readonly ExitDef[] {
  return runtime.rooms[roomId]?.exits ?? [];
}

/**
 * Puts the party in a room at a spawn (ADR-0018): the room's entry point for respawns and
 * `placement: 'spawn'`, contact flags worked out again, attack and drop-through cut off. `edge`
 * keeps the velocity; the others stop the body.
 */
export function enterRoom(
  world: World,
  runtime: PackRuntime,
  gridOf: GridOf,
  roomId: string,
  spawnId: string,
  keepVelocity: boolean,
): void {
  const spawn = runtime.rooms[roomId]?.spawns[spawnId];
  if (spawn === undefined) {
    throw new RangeError(`spawn "${spawnId}" is not defined in room "${roomId}"`);
  }
  world.roomId = roomId;
  const s = world.entities;
  const slot = s.slotOf(world.party.entityId);
  s.x[slot] = spawn.x;
  s.y[slot] = spawn.y;
  if (!keepVelocity) {
    s.vx[slot] = 0;
    s.vy[slot] = 0;
  }
  const party = world.party;
  party.spawnX = spawn.x;
  party.spawnY = spawn.y;
  party.spawnId = spawnId;
  party.hazardId = '';
  party.hazardTicks = 0;
  world.controller.attackUntilTick = NEVER;
  world.controller.dropThroughUntilTick = NEVER;
  // What the body stands on there, without moving it.
  s.contact[slot] = moveBody(
    gridOf(runtime, roomId),
    {
      x: spawn.x,
      y: spawn.y,
      vx: 0,
      vy: 0,
      w: s.colW[slot] as number,
      h: s.colH[slot] as number,
      ox: s.colOx[slot] as number,
      oy: s.colOy[slot] as number,
    },
    { abilityTags: effectiveTags(activeCharacter(world, runtime)) },
  );
  world.disarmedExits = [];
  exitsOf(runtime, roomId).forEach((exit, index) => {
    if (overlaps(world, exit.rect)) world.disarmedExits.push(index);
  });
  snapCamera(world, runtime);
}

/**
 * Exits in the `interaction` system (ADR-0018), after movement: opens the exits the body has
 * left, then takes the first exit it may go through. Returns true when the room changed this
 * tick (the sprite moved without travelling).
 */
export function exitStep(
  world: World,
  runtime: PackRuntime,
  gridOf: GridOf,
  intent: Intent,
): boolean {
  const exits = exitsOf(runtime, world.roomId);
  if (exits.length === 0) return false;
  world.disarmedExits = world.disarmedExits.filter((index) => {
    const exit = exits[index];
    return exit !== undefined && overlaps(world, exit.rect);
  });
  const s = world.entities;
  const grounded = ((s.contact[s.slotOf(world.party.entityId)] as number) & CONTACT_GROUNDED) !== 0;
  const tags = effectiveTags(activeCharacter(world, runtime));
  const index = exits.findIndex(
    (exit, i) =>
      !world.disarmedExits.includes(i) &&
      overlaps(world, exit.rect) &&
      (exit.kind !== 'door' || (grounded && intent.upPressed)) &&
      (exit.requiresAnyTag === undefined || exit.requiresAnyTag.some((tag) => tags.has(tag))),
  );
  const exit = exits[index];
  if (exit === undefined) return false;
  const def = runtime.roomTransition ?? NO_TRANSITION_DEF;
  const outTicks = exit.effect === 'fade' ? def.lockTicks >> 1 : 0;
  world.transition = {
    phase: 'out',
    tick: 0,
    outTicks,
    inTicks: def.lockTicks - outTicks,
    toRoomId: exit.toRoomId,
    spawnId: exit.spawnId,
    kind: exit.kind,
    effect: exit.effect,
  };
  if (outTicks > 0) return false;
  arrive(world, runtime, gridOf);
  return true;
}

/** End of the dark phase: into the new room, then the light phase (or straight on). */
function arrive(world: World, runtime: PackRuntime, gridOf: GridOf): void {
  const tr = world.transition;
  enterRoom(world, runtime, gridOf, tr.toRoomId, tr.spawnId, tr.kind === 'edge');
  if (tr.inTicks > 0) {
    world.transition = { ...tr, phase: 'in', tick: 0 };
  } else {
    world.transition = noTransition();
  }
}

/**
 * One tick of a room change in progress: the simulation stands still and only the phase moves
 * on. Returns true when the room changed this tick.
 */
export function transitionStep(world: World, runtime: PackRuntime, gridOf: GridOf): boolean {
  const tr = world.transition;
  tr.tick++;
  if (tr.phase === 'out') {
    if (tr.tick < tr.outTicks) return false;
    arrive(world, runtime, gridOf);
    return true;
  }
  if (tr.tick >= tr.inTicks) {
    world.transition = noTransition();
  }
  return false;
}

/** The room change for the renderer, or null when there is none. */
export function transitionView(world: World): TransitionView | null {
  const tr = world.transition;
  if (tr.phase === 'none' || tr.effect === '') return null;
  return {
    effect: tr.effect,
    phase: tr.phase,
    tick: tr.tick,
    ticks: tr.phase === 'out' ? tr.outTicks : tr.inTicks,
  };
}
