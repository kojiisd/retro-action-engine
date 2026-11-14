import { type CollisionGrid, createCollisionGrid } from '../collision/grid';
import { moveBody } from '../collision/move';
import type { InputFrame } from '../input/frame';
import { type FeelProfile, resolveFeel } from '../runtime/feel';
import type { PackRuntime, RoomData, StartState } from '../runtime/pack';
import { newControllerState, newWorld, type World } from '../world/world';
import { controllerStep } from './controller';
import { inputIntent } from './intent';
import { activeCharacter, canSwitch, partyStep } from './party';
import { effectiveTags } from './tags';

/** The part of `UiState` (docs/architecture.md 6) available as of M1-3. */
export interface UiState {
  readonly activeCharacterId: string;
  /** False with one member or `mode: 'never'`: the renderer shows no switch UI. */
  readonly canSwitch: boolean;
}

/** The part of `StepOutput` available as of M1-3. Render, audio and transitions come later. */
export interface StepOutput {
  readonly ui: UiState;
}

const grids = new WeakMap<RoomData, CollisionGrid>();

/** Collision grid of a room, validated once and cached per RoomData object. */
export function roomGrid(runtime: PackRuntime, roomId: string): CollisionGrid {
  const room = runtime.rooms[roomId];
  if (room === undefined) {
    throw new RangeError(`room "${roomId}" is not defined`);
  }
  let grid = grids.get(room);
  if (grid === undefined) {
    grid = createCollisionGrid({ ...room, tileSize: runtime.tileSize });
    grids.set(room, grid);
  }
  return grid;
}

/** Active feel profile with the active character's overrides. */
export function currentFeel(world: World, runtime: PackRuntime): FeelProfile {
  const profile = runtime.feel[world.controller.feelProfileId];
  if (profile === undefined) {
    throw new RangeError(`feel profile "${world.controller.feelProfileId}" is not defined`);
  }
  return resolveFeel(profile, activeCharacter(world, runtime).feelOverrides);
}

/** Builds the World for a new game: the party entity stands at the start spawn. */
export function createWorld(runtime: PackRuntime, start: StartState): World {
  const world = newWorld({ seed: start.seed, roomId: start.roomId });
  const spawn = runtime.rooms[start.roomId]?.spawns[start.spawnId];
  if (spawn === undefined) {
    throw new RangeError(`spawn "${start.spawnId}" is not defined in room "${start.roomId}"`);
  }
  const members = [...(start.party ?? runtime.rules.party.members)];
  if (members.length === 0) {
    throw new RangeError('the party needs at least one member');
  }
  world.party.members = members;
  world.party.spawnX = spawn.x;
  world.party.spawnY = spawn.y;
  world.controller = newControllerState(start.feelProfile);
  const character = activeCharacter(world, runtime);
  currentFeel(world, runtime); // fail early on an unknown profile
  world.party.entityId = world.entities.create({
    x: spawn.x,
    y: spawn.y,
    collider: character.collider,
  });

  // Start with the contact flags of the spawn position, so that a character placed on a floor
  // starts grounded.
  const slot = world.entities.slotOf(world.party.entityId);
  const s = world.entities;
  s.contact[slot] = moveBody(
    roomGrid(runtime, world.roomId),
    {
      x: spawn.x,
      y: spawn.y,
      vx: 0,
      vy: 0,
      w: character.collider.w,
      h: character.collider.h,
      ox: character.collider.ox,
      oy: character.collider.oy,
    },
    { abilityTags: effectiveTags(character) },
  );
  return world;
}

/** Switches the feel profile; it applies from the next tick (docs/input-and-feel.md 8.1). */
export function setFeelProfile(world: World, runtime: PackRuntime, profileId: string): void {
  if (runtime.feel[profileId] === undefined) {
    throw new RangeError(`feel profile "${profileId}" is not defined`);
  }
  world.controller.feelProfileId = profileId;
}

/**
 * One simulation tick. The system order is fixed (docs/architecture.md 4.3); systems that do not
 * exist yet are skipped: inputIntent, party, controller, movement, timers, output.
 */
export function step(world: World, input: InputFrame, runtime: PackRuntime): StepOutput {
  const intent = inputIntent(world, input, currentFeel(world, runtime));
  partyStep(world, intent, runtime);
  const feel = currentFeel(world, runtime);
  controllerStep(world, intent, feel);

  // movement: only the party entity exists as of M1-3.
  const s = world.entities;
  const slot = s.slotOf(world.party.entityId);
  const character = activeCharacter(world, runtime);
  const body = {
    x: s.x[slot] as number,
    y: s.y[slot] as number,
    vx: s.vx[slot] as number,
    vy: s.vy[slot] as number,
    w: s.colW[slot] as number,
    h: s.colH[slot] as number,
    ox: s.colOx[slot] as number,
    oy: s.colOy[slot] as number,
  };
  s.contact[slot] = moveBody(roomGrid(runtime, world.roomId), body, {
    abilityTags: effectiveTags(character),
    ignoreOneway: world.tick < world.controller.dropThroughUntilTick,
  });
  s.x[slot] = body.x;
  s.y[slot] = body.y;
  s.vx[slot] = body.vx;
  s.vy[slot] = body.vy;

  // timers
  if (world.party.cooldownTicks > 0) {
    world.party.cooldownTicks--;
  }

  world.tick++;
  return { ui: { activeCharacterId: character.id, canSwitch: canSwitch(world, runtime) } };
}
