import {
  actionMask,
  CONTACT_GROUNDED,
  CONTACT_ONEWAY,
  type FeelProfile,
  FX_ONE,
  type PackRuntime,
  step,
  type World,
} from '@retro-action-engine/core';

/** -1 left, 0 none, 1 right. */
export type Dir = -1 | 0 | 1;

/**
 * A bundle of inputs that takes a standing character to its next landing (ADR-0015). Macros only
 * choose inputs; every position and velocity comes from running `step`.
 */
export type Macro =
  | { readonly kind: 'walk'; readonly dir: Dir }
  | { readonly kind: 'stop' }
  /** Jump held for `hold` ticks; steer `before` the apex and `after` it. */
  | { readonly kind: 'jump'; readonly hold: number; readonly before: Dir; readonly after: Dir }
  /** Walk off the edge, then fall while steering. */
  | { readonly kind: 'walkOffFall'; readonly dir: Dir; readonly steer: Dir }
  /** Walk off the edge, keep going for `delay` ticks, then jump (coyote time). */
  | {
      readonly kind: 'walkOffJump';
      readonly dir: Dir;
      readonly delay: number;
      readonly hold: number;
      readonly before: Dir;
      readonly after: Dir;
    }
  /** Down + jump on a oneway floor, then fall while steering. */
  | { readonly kind: 'drop'; readonly steer: Dir }
  /** Wait until the switch cooldown is over, switch to the next member, then land. */
  | { readonly kind: 'switch' };

const JUMP = actionMask('jump');
const DOWN = actionMask('down');
const SWITCH = actionMask('switch');
const DIR_MASK: Record<Dir, number> = {
  [-1]: actionMask('left'),
  0: 0,
  1: actionMask('right'),
};

/** Counts every `step` of a `solveRoom` call and stops the work at the limit. */
export interface Budget {
  steps: number;
  readonly maxSteps: number;
  exhausted: boolean;
}

/** A simulation in progress: the world, the buttons held on the last tick, the inputs so far. */
export interface Sim {
  readonly world: World;
  readonly runtime: PackRuntime;
  held: number;
  /** Held mask of every tick run so far; pressed and released follow from the changes. */
  readonly helds: number[];
  readonly budget: Budget;
  readonly maxTicks: number;
}

export type MacroOutcome =
  /** Ended standing on something. `leftGround`: a walk went over an edge on the way. */
  | { readonly status: 'landed'; readonly leftGround: boolean }
  /** The macro does not apply here, or changed nothing. */
  | { readonly status: 'skipped' }
  /** No landing within the tick limit. */
  | { readonly status: 'timeout' }
  /** The step budget ran out. */
  | { readonly status: 'budget' };

class Stop extends Error {
  constructor(readonly outcome: MacroOutcome) {
    super(outcome.status);
  }
}

const slotOf = (world: World) => world.entities.slotOf(world.party.entityId);
export const xOf = (world: World) => world.entities.x[slotOf(world)] as number;
export const yOf = (world: World) => world.entities.y[slotOf(world)] as number;
export const vxOf = (world: World) => world.entities.vx[slotOf(world)] as number;
const vyOf = (world: World) => world.entities.vy[slotOf(world)] as number;
const contactOf = (world: World) => world.entities.contact[slotOf(world)] as number;
export const isGrounded = (world: World) => (contactOf(world) & CONTACT_GROUNDED) !== 0;

/** Runs one tick with these buttons held. Edges follow from the previous tick, as on a device. */
function tick(sim: Sim, held: number): void {
  if (sim.budget.steps >= sim.budget.maxSteps) {
    sim.budget.exhausted = true;
    throw new Stop({ status: 'budget' });
  }
  if (sim.helds.length >= sim.maxTicks) {
    throw new Stop({ status: 'timeout' });
  }
  step(sim.world, { held, pressed: held & ~sim.held, released: sim.held & ~held }, sim.runtime);
  sim.budget.steps++;
  sim.held = held;
  sim.helds.push(held);
}

function fall(sim: Sim, steer: Dir): void {
  while (!isGrounded(sim.world)) {
    tick(sim, DIR_MASK[steer]);
  }
}

/** A jump needs a fresh press: let go first if the button is still down from the last macro. */
function releaseJump(sim: Sim, dir: Dir): void {
  if ((sim.held & JUMP) !== 0) {
    tick(sim, DIR_MASK[dir]);
  }
}

function jumpAndLand(sim: Sim, hold: number, before: Dir, after: Dir): void {
  releaseJump(sim, before);
  let pastApex = false;
  for (let i = 0; ; i++) {
    tick(sim, (i < hold ? JUMP : 0) | DIR_MASK[pastApex ? after : before]);
    if (isGrounded(sim.world)) {
      return;
    }
    if (vyOf(sim.world) >= 0) {
      pastApex = true;
    }
  }
}

/**
 * Walks until the position bucket changes, the body stops moving, or the ground ends.
 * Returns true when it walked off an edge (the body is then in the air).
 */
function walk(sim: Sim, dir: Dir, bucketOf: (x: number) => number): boolean {
  const startBucket = bucketOf(xOf(sim.world));
  for (;;) {
    const before = xOf(sim.world);
    tick(sim, DIR_MASK[dir]);
    if (!isGrounded(sim.world)) {
      return true;
    }
    const x = xOf(sim.world);
    if (bucketOf(x) !== startBucket || x === before) {
      return false;
    }
  }
}

/** Runs a macro on the sim, in place. The caller passes a copy of the node's world. */
export function runMacro(sim: Sim, macro: Macro, bucketOf: (x: number) => number): MacroOutcome {
  const startTicks = sim.helds.length;
  try {
    let leftGround = false;
    switch (macro.kind) {
      case 'walk':
        leftGround = walk(sim, macro.dir, bucketOf);
        if (leftGround) {
          fall(sim, macro.dir);
        }
        break;
      case 'stop':
        while (vxOf(sim.world) !== 0 && isGrounded(sim.world)) {
          tick(sim, 0);
        }
        fall(sim, 0);
        break;
      case 'jump':
        jumpAndLand(sim, macro.hold, macro.before, macro.after);
        break;
      case 'walkOffFall':
        if (!walk(sim, macro.dir, () => 0)) {
          return { status: 'skipped' };
        }
        leftGround = true;
        fall(sim, macro.steer);
        break;
      case 'walkOffJump':
        if (!walk(sim, macro.dir, () => 0)) {
          return { status: 'skipped' };
        }
        leftGround = true;
        for (let i = 0; i < macro.delay && !isGrounded(sim.world); i++) {
          tick(sim, DIR_MASK[macro.dir]);
        }
        if (!isGrounded(sim.world)) {
          jumpAndLand(sim, macro.hold, macro.before, macro.after);
        }
        break;
      case 'drop':
        if ((contactOf(sim.world) & CONTACT_ONEWAY) === 0) {
          return { status: 'skipped' };
        }
        releaseJump(sim, macro.steer);
        tick(sim, DOWN | JUMP | DIR_MASK[macro.steer]);
        fall(sim, macro.steer);
        break;
      case 'switch': {
        const before = sim.world.party.activeIndex;
        // Let go of everything while the cooldown runs (it ends on its own), and of a switch
        // button still down, so that the press is a fresh one.
        while (sim.world.party.cooldownTicks > 0 || (sim.held & SWITCH) !== 0) {
          tick(sim, 0);
        }
        tick(sim, SWITCH);
        if (sim.world.party.activeIndex === before) {
          // The rules refused (for example, not on the ground any more).
          return { status: 'skipped' };
        }
        fall(sim, 0);
        break;
      }
    }
    return sim.helds.length === startTicks
      ? { status: 'skipped' }
      : { status: 'landed', leftGround };
  } catch (error) {
    if (error instanceof Stop) {
      return error.outcome;
    }
    throw error;
  }
}

const DIRS: readonly Dir[] = [-1, 0, 1];

/** Steering choices in the air: constant, plus one change at the apex when the air is steerable. */
function steerings(feel: FeelProfile): Array<readonly [Dir, Dir]> {
  const list: Array<readonly [Dir, Dir]> = DIRS.map((d) => [d, d] as const);
  if (feel.airControl !== 0) {
    for (const before of DIRS) {
      for (const after of DIRS) {
        if (before !== after) {
          list.push([before, after]);
        }
      }
    }
  }
  return list;
}

/**
 * Jump hold lengths to try. Without a variable jump the length does not matter, so one is
 * enough. Otherwise: evenly spaced from the shortest effective hold to the full rise. The full
 * rise is always included, and so is `highest`, the hold that rises highest (from
 * `measureHighestJump`; it is not always the full one). A hold of 0 cannot be made from the
 * ground and is left out.
 */
export function jumpHolds(
  feel: FeelProfile,
  riseTicks: number,
  samples: number,
  highest?: number,
): number[] {
  if (feel.jumpCutScale >= FX_ONE) {
    return [1];
  }
  const shortest = Math.max(1, feel.minJumpTicks);
  const longest = Math.max(shortest, riseTicks);
  const holds = new Set<number>([longest]);
  if (highest !== undefined && highest >= 1) {
    holds.add(highest);
  }
  const count = Math.max(2, samples);
  for (let i = 0; i < count; i++) {
    holds.add(shortest + Math.floor(((longest - shortest) * i) / (count - 1)));
  }
  return [...holds].sort((a, b) => a - b);
}

/**
 * The macros tried from every standing state, in a fixed order. `switching`: the party can
 * switch, so the switch macro is tried too (last).
 */
export function groundMacros(
  feel: FeelProfile,
  holds: readonly number[],
  switching = false,
): Macro[] {
  const macros: Macro[] = [{ kind: 'walk', dir: -1 }, { kind: 'walk', dir: 1 }, { kind: 'stop' }];
  for (const hold of holds) {
    for (const [before, after] of steerings(feel)) {
      macros.push({ kind: 'jump', hold, before, after });
    }
  }
  for (const steer of DIRS) {
    macros.push({ kind: 'drop', steer });
  }
  if (switching) {
    macros.push({ kind: 'switch' });
  }
  return macros;
}

/** The macros tried when a walk in `dir` went over an edge: other falls and coyote jumps. */
export function edgeMacros(feel: FeelProfile, holds: readonly number[], dir: Dir): Macro[] {
  const macros: Macro[] = [];
  for (const steer of DIRS) {
    if (steer !== dir) {
      macros.push({ kind: 'walkOffFall', dir, steer });
    }
  }
  // Every tick of the coyote window, and one past it (which the controller must refuse).
  for (let delay = 0; delay <= feel.coyoteTicks; delay++) {
    for (const hold of holds) {
      for (const [before, after] of steerings(feel)) {
        macros.push({ kind: 'walkOffJump', dir, delay, hold, before, after });
      }
    }
  }
  return macros;
}
