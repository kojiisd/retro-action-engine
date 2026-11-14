import { seedRng } from '../fx/rng';
import { EntityStore } from './entity-store';

/**
 * Mutable simulation state (docs/architecture.md). This step holds the fields the movement code
 * needs; camera, party, inventory and transition lock are added with the systems that use them
 * (M1-3 and later), each also added to `hashWorld` in the order ADR-0002 fixes.
 */
export interface World {
  tick: number;
  /** xorshift32 state, a non-zero uint32. Only `fx/rng` touches it. */
  rng: number;
  roomId: string;
  flags: Record<string, number | boolean>;
  entities: EntityStore;
}

export interface WorldInit {
  readonly seed: number;
  readonly roomId: string;
}

export function createWorld(init: WorldInit): World {
  return {
    tick: 0,
    rng: seedRng(init.seed),
    roomId: init.roomId,
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
    flags: { ...world.flags },
    entities: world.entities.clone(),
  };
}
