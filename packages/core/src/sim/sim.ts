import { type CollisionGrid, createCollisionGrid } from '../collision/grid';
import { moveBody } from '../collision/move';
import type { InputFrame } from '../input/frame';
import { type ActiveFeel, activeFeel } from '../runtime/feel';
import type { PackRuntime, RoomData, StartState } from '../runtime/pack';
import { newControllerState, newWorld, type World } from '../world/world';
import { animationStep, attackTicks } from './anim';
import { bodyContext } from './blocking';
import { cameraHoldsSimulation, cameraStep, flipProgress } from './camera';
import { controllerStep } from './controller';
import { eventStep } from './events';
import { enterRoom, exitStep, type TransitionView, transitionStep, transitionView } from './exits';
import { gimmickStep, type Notice } from './gimmicks';
import { hpStep, initialHp, tileAtBodyCenter } from './hp';
import { inputIntent } from './intent';
import { climbAfterMove, climbStep } from './ladder';
import { type RenderSnapshot, renderSnapshot } from './output';
import { activeCharacter, canSwitch, isAlive, partyStep } from './party';

/** One party member in the HUD (ADR-0016). */
export interface UiMember {
  readonly id: string;
  readonly hp: number;
  readonly hpMax: number;
  readonly alive: boolean;
}

/** The part of `UiState` (docs/architecture.md 6) available as of M2-5. */
export interface UiState {
  readonly activeCharacterId: string;
  /** False with one member or `mode: 'never'`: the renderer shows no switch UI. */
  readonly canSwitch: boolean;
  /** Every member in `members` order; empty when the pack has no HP rules. */
  readonly party: readonly UiMember[];
  /** The items held, in `items.json` order (ADR-0021). */
  readonly inventory: readonly UiItem[];
}

/** One held item for the menu (ADR-0021). */
export interface UiItem {
  readonly id: string;
  readonly count: number;
}

/** The part of `StepOutput` available as of M3-1. Audio comes later. */
export interface StepOutput {
  readonly ui: UiState;
  readonly render: RenderSnapshot;
  /** The room change in progress, for the renderer's fade (ADR-0018); null when none. */
  readonly transition: TransitionView | null;
  /** What happened this tick that the screen tells the player about (ADR-0021). */
  readonly notices: readonly Notice[];
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

/**
 * The feel in effect now: the profile, the active character's overrides, and the medium under
 * the body's center (ADR-0016).
 */
export function currentFeel(world: World, runtime: PackRuntime): ActiveFeel {
  const profile = runtime.feel[world.controller.feelProfileId];
  if (profile === undefined) {
    throw new RangeError(`feel profile "${world.controller.feelProfileId}" is not defined`);
  }
  const medium =
    profile.media === undefined ? undefined : tileAtBodyCenter(world, runtime, roomGrid)?.medium;
  return activeFeel(profile, activeCharacter(world, runtime).feelOverrides, medium);
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
  world.party.hp = initialHp(runtime, members);
  world.controller = newControllerState(start.feelProfile);
  const character = activeCharacter(world, runtime);
  if (runtime.feel[start.feelProfile] === undefined) {
    throw new RangeError(`feel profile "${start.feelProfile}" is not defined`);
  }
  world.party.entityId = world.entities.create({
    x: spawn.x,
    y: spawn.y,
    collider: character.collider,
  });

  // Enter the start room as through any exit: contact flags of the spawn position (a character
  // placed on a floor starts grounded), and the exits it stands on stay closed until it leaves.
  enterRoom(world, runtime, roomGrid, start.roomId, start.spawnId, false);
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
 * exist yet are skipped: inputIntent, party, controller, movement, interaction (HP, exits),
 * timers, output. During a room change only the change moves on (ADR-0018).
 */
export function step(world: World, input: InputFrame, runtime: PackRuntime): StepOutput {
  // A room change stops the simulation: only its phase moves on, and the input is dropped.
  if (world.transition.phase !== 'none') {
    const moved = transitionStep(world, runtime, roomGrid);
    world.tick++;
    return output(world, runtime, moved);
  }
  // So does a screen-flip scroll with `pauseSimulation` (ADR-0009): only the camera moves.
  if (cameraHoldsSimulation(world, runtime)) {
    flipProgress(world);
    world.tick++;
    return output(world, runtime, false);
  }
  const intent = inputIntent(world, input, currentFeel(world, runtime));
  const activeBefore = world.party.activeIndex;
  partyStep(world, intent, runtime);
  const teleported =
    world.party.activeIndex !== activeBefore && runtime.rules.party.switch.placement === 'spawn';
  const feel = currentFeel(world, runtime);
  const swing = attackTicks(activeCharacter(world, runtime));
  // A character on a ladder is driven by the ladder, not by the controller (ADR-0019).
  const grid = roomGrid(runtime, world.roomId);
  if (!climbStep(world, intent, feel, grid, runtime.tileSize, swing)) {
    controllerStep(world, intent, feel, swing);
  }

  // movement: only the party entity exists as of M1-3.
  const s = world.entities;
  const slot = s.slotOf(world.party.entityId);
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
  s.contact[slot] = moveBody(
    roomGrid(runtime, world.roomId),
    body,
    bodyContext(world, runtime, {
      ignoreOneway: world.tick < world.controller.dropThroughUntilTick || world.controller.climbing,
    }),
  );
  s.x[slot] = body.x;
  s.y[slot] = body.y;
  s.vx[slot] = body.vx;
  s.vy[slot] = body.vy;

  climbAfterMove(world, runtime, grid);

  // interaction: gimmicks (ADR-0021), HP-draining tiles and a character whose HP reached 0
  // (ADR-0016); then the exits, unless the character was just put back (ADR-0018).
  const notices: Notice[] = [];
  gimmickStep(world, runtime, notices);
  const placed = hpStep(world, runtime, roomGrid);
  const entered = !placed && exitStep(world, runtime, roomGrid, intent);

  // events: event zones of the room (ADR-0021). Not in a room just left: the new room's zones
  // are looked at once the change is over.
  if (world.transition.phase === 'none') eventStep(world, runtime, notices);

  // camera (a room just entered has its camera in place already)
  if (!entered && world.transition.phase === 'none') cameraStep(world, runtime);

  // timers
  if (world.party.cooldownTicks > 0) {
    world.party.cooldownTicks--;
  }
  const active = activeCharacter(world, runtime);
  animationStep(world, active);

  world.tick++;
  return output(world, runtime, teleported || placed || entered, notices);
}

/** The `output` system. */
function output(
  world: World,
  runtime: PackRuntime,
  teleported: boolean,
  notices: readonly Notice[] = [],
): StepOutput {
  return {
    ui: {
      activeCharacterId: activeCharacter(world, runtime).id,
      canSwitch: canSwitch(world, runtime),
      party: uiParty(world, runtime),
      inventory: uiInventory(world, runtime),
    },
    notices,
    render: renderSnapshot(world, runtime, teleported),
    transition: transitionView(world),
  };
}

/** The items held for `UiState`, in the pack's item order. */
export function uiInventory(world: World, runtime: PackRuntime): UiItem[] {
  const items = runtime.items;
  if (items === undefined) return [];
  return Object.keys(items)
    .filter((id) => (world.inventory[id] ?? 0) > 0)
    .map((id) => ({ id, count: world.inventory[id] as number }));
}

/** The party for `UiState`: every member's HP, or none without HP rules. */
export function uiParty(world: World, runtime: PackRuntime): UiMember[] {
  if (world.party.hp.length === 0) return [];
  return world.party.members.map((id, index) => ({
    id,
    hp: world.party.hp[index] as number,
    hpMax: runtime.characters[id]?.hp?.max ?? 0,
    alive: isAlive(world, index),
  }));
}
