import {
  type CharacterDef,
  type CollisionGrid,
  hashWorld,
  type PackRuntime,
  Recorder,
  type ReplayFile,
  runReplayHeadless,
  type StartState,
  type World,
} from '@retro-action-engine/core';
import { type FootholdIndex, standingOn } from './footholds';

/** Thrown when a path the search found does not replay: a solver bug, never a report entry. */
export class WitnessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WitnessError';
  }
}

/** Turns held masks into a replay, with press and release edges as a device would produce. */
export function replayFromHelds(
  runtime: PackRuntime,
  start: StartState,
  helds: readonly number[],
): ReplayFile {
  const recorder = new Recorder();
  let previous = 0;
  for (const held of helds) {
    recorder.push({ held, pressed: held & ~previous, released: previous & ~held });
    previous = held;
  }
  return recorder.toFile(runtime, start);
}

/**
 * The soundness gate (ADR-0015): replays the inputs from the start with `runReplayHeadless` and
 * checks that the run ends standing on the foothold, in exactly the state the search saw.
 * Nothing is reported as reached without passing here.
 */
export function verifyWitness(
  runtime: PackRuntime,
  grid: CollisionGrid,
  footholds: FootholdIndex,
  character: CharacterDef,
  replay: ReplayFile,
  foothold: number,
  expected: World,
): void {
  const result = runReplayHeadless(replay, runtime);
  if (!standingOn(grid, footholds, result.world, character).includes(foothold)) {
    throw new WitnessError(
      `the replay does not end on foothold ${footholds.all[foothold]?.id ?? foothold}`,
    );
  }
  const [hi, lo] = result.hash;
  const [expectedHi, expectedLo] = hashWorld(expected);
  if (hi !== expectedHi || lo !== expectedLo) {
    throw new WitnessError('the replay ends in a different state than the search reached');
  }
}
