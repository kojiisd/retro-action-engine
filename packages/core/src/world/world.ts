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
  /** The spawn (in `World.roomId`) the room was entered at: `spawnX`, `spawnY` (ADR-0018). */
  spawnId: string;
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
  /** Holding on to a ladder (ADR-0019). */
  climbing: boolean;
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

/** The camera (ADR-0009): the view's top-left in room px, and the screen-flip state. */
export interface CameraState {
  x: number;
  y: number;
  /** screenFlip: the screen the view is on. */
  screenX: number;
  screenY: number;
  /** screenFlip `scroll`: the move to the next screen; `ticks` is 0 when none. */
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  tick: number;
  ticks: number;
}

export function newCamera(): CameraState {
  return {
    x: 0,
    y: 0,
    screenX: 0,
    screenY: 0,
    fromX: 0,
    fromY: 0,
    toX: 0,
    toY: 0,
    tick: 0,
    ticks: 0,
  };
}

/** A room change in progress (ADR-0018). `phase: 'none'` when there is none. */
export interface TransitionState {
  phase: 'none' | 'out' | 'in';
  /** Ticks spent in the phase so far. */
  tick: number;
  outTicks: number;
  inTicks: number;
  toRoomId: string;
  spawnId: string;
  kind: '' | 'edge' | 'door' | 'warp';
  effect: '' | 'cut' | 'fade';
}

export function noTransition(): TransitionState {
  return {
    phase: 'none',
    tick: 0,
    outTicks: 0,
    inTicks: 0,
    toRoomId: '',
    spawnId: '',
    kind: '',
    effect: '',
  };
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
  camera: CameraState;
  party: PartyState;
  controller: ControllerState;
  animation: AnimationState;
  /** Room change in progress (ADR-0018). */
  transition: TransitionState;
  /** Indices of the room's exits the body was on when it arrived: closed until it leaves them. */
  disarmedExits: number[];
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
    climbing: false,
  };
}

/** A World with no party member and no entity. `sim.createWorld` builds a playable one. */
export function newWorld(init: WorldInit): World {
  return {
    tick: 0,
    rng: seedRng(init.seed),
    roomId: init.roomId,
    camera: newCamera(),
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
      spawnId: '',
    },
    controller: newControllerState(''),
    animation: { name: '', frame: 0, ticks: 0 },
    transition: noTransition(),
    disarmedExits: [],
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
    camera: { ...world.camera },
    party: { ...world.party, members: [...world.party.members], hp: [...world.party.hp] },
    controller: { ...world.controller },
    animation: { ...world.animation },
    transition: { ...world.transition },
    disarmedExits: [...world.disarmedExits],
    flags: { ...world.flags },
    entities: world.entities.clone(),
  };
}
