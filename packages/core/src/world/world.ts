import type { Fx } from '../fx/fx';
import { seedRng } from '../fx/rng';
import { EntityStore } from './entity-store';

/** "Never happened" for tick fields. Far enough back that any age comparison is false. */
export const NEVER = -0x7fffffff;

export interface PartyState {
  /** Character ids, in switch order. */
  members: string[];
  activeIndex: number;
  /** Ticks until the next switch is allowed. */
  cooldownTicks: number;
  /** The entity the active character drives. */
  entityId: number;
  /**
   * Where `placement: 'spawn'` puts the character, and where the party comes back when everyone
   * is down: the spawn the room was entered at.
   */
  spawnX: Fx;
  spawnY: Fx;
  /** HP per member, in `members` order. Empty when the pack has no HP rules (ADR-0016). */
  hp: number[];
  /** The kind of HP-draining tile the body is in ('' for none). */
  hazardId: string;
  /** Ticks in a row in that kind of tile since the last damage. */
  hazardTicks: number;
}

/** Per-tick memory of the character controller (docs/input-and-feel.md 6, 8.4). */
export interface ControllerState {
  feelProfileId: string;
  /** -1 or 1. */
  facing: number;
  /** Last tick that ended on the ground. */
  lastGroundedTick: number;
  /** A jump has been made since the last time on the ground (disables coyote time). */
  jumpedSinceGrounded: boolean;
  /** Last tick with a jump press not yet used (jump buffer). */
  jumpPressedTick: number;
  /** Ticks since take-off; NEVER-based while not in a jump. */
  jumpStartTick: number;
  /** The variable-jump cut has been applied to the current jump. */
  jumpCut: boolean;
  /** oneway tiles are ignored while tick < this. */
  dropThroughUntilTick: number;
  /** No control while tick < this. */
  landingLagUntilTick: number;
  /** Ticks of the last left and right presses (SOCD lastWins). */
  leftPressedTick: number;
  rightPressedTick: number;
  /** Attacking while tick < this (ADR-0017); NEVER when not attacking. */
  attackUntilTick: number;
}

/** Animation of the party entity's sprite. Advanced by the `timers` system, one tick at a time. */
export interface AnimationState {
  /** Animation name in the active character's sprite ('' before the first tick). */
  name: string;
  /** Frame index in that animation. */
  frame: number;
  /** Ticks spent on the current frame so far. */
  ticks: number;
}

/**
 * Mutable simulation state (docs/architecture.md). Fields are added together with the systems
 * that use them, and `hashWorld` covers each in the order ADR-0002 fixes. Camera and inventory
 * come later (M2, M3).
 */
export interface World {
  tick: number;
  /** xorshift32 state, a non-zero uint32. Only `fx/rng` touches it. */
  rng: number;
  roomId: string;
  party: PartyState;
  controller: ControllerState;
  animation: AnimationState;
  flags: Record<string, number | boolean>;
  entities: EntityStore;
}

export interface WorldInit {
  readonly seed: number;
  readonly roomId: string;
}

export function newControllerState(feelProfileId: string): ControllerState {
  return {
    feelProfileId,
    facing: 1,
    lastGroundedTick: NEVER,
    jumpedSinceGrounded: false,
    jumpPressedTick: NEVER,
    jumpStartTick: NEVER,
    jumpCut: false,
    dropThroughUntilTick: NEVER,
    landingLagUntilTick: NEVER,
    leftPressedTick: NEVER,
    rightPressedTick: NEVER,
    attackUntilTick: NEVER,
  };
}

/** A World with no party member and no entity. `sim.createWorld` builds a playable one. */
export function newWorld(init: WorldInit): World {
  return {
    tick: 0,
    rng: seedRng(init.seed),
    roomId: init.roomId,
    party: {
      members: [],
      activeIndex: 0,
      cooldownTicks: 0,
      entityId: 0,
      spawnX: 0,
      spawnY: 0,
      hp: [],
      hazardId: '',
      hazardTicks: 0,
    },
    controller: newControllerState(''),
    animation: { name: '', frame: 0, ticks: 0 },
    flags: {},
    entities: new EntityStore(),
  };
}

/** Deep copy. */
export function cloneWorld(world: World): World {
  return {
    tick: world.tick,
    rng: world.rng,
    roomId: world.roomId,
    party: { ...world.party, members: [...world.party.members], hp: [...world.party.hp] },
    controller: { ...world.controller },
    animation: { ...world.animation },
    flags: { ...world.flags },
    entities: world.entities.clone(),
  };
}
