import { hashWorld, type WorldHash } from '../hash/hash';
import { EMPTY_FRAME, type InputFrame } from '../input/frame';
import type { PackRuntime, StartState } from '../runtime/pack';
import { createWorld, step } from '../sim/sim';
import type { World } from '../world/world';

/** A run of equal frames: [count, held, pressed, released, command?] (command absent when 0). */
export type ReplayRun =
  | readonly [number, number, number, number]
  | readonly [number, number, number, number, number];

/**
 * docs/input-and-feel.md 11.1. `frames` are run-length encoded. Version 2 adds the command
 * (ADR-0020); version 1 files are read with no commands.
 */
export interface ReplayFile {
  readonly version: 1 | 2;
  readonly packId: string;
  readonly packVersion: string;
  readonly feelProfile: string;
  readonly seed: number;
  readonly start: {
    readonly roomId: string;
    readonly spawnId: string;
    readonly party?: readonly string[];
  };
  readonly frames: ReadonlyArray<ReplayRun>;
  readonly checkpoints?: ReadonlyArray<{ readonly tick: number; readonly hash: WorldHash }>;
  readonly final?: { readonly tick: number; readonly hash: WorldHash };
}

/** Records the `InputFrame`s given to `step`, after the edge rules (ADR-0008 rule 6). */
export class Recorder {
  private readonly frames: Array<[number, number, number, number, number]> = [];
  private ticks = 0;

  get length(): number {
    return this.ticks;
  }

  push(frame: InputFrame): void {
    this.ticks++;
    const command = frame.command ?? 0;
    const last = this.frames.at(-1);
    if (
      last !== undefined &&
      last[1] === frame.held &&
      last[2] === frame.pressed &&
      last[3] === frame.released &&
      last[4] === command
    ) {
      last[0]++;
    } else {
      this.frames.push([1, frame.held, frame.pressed, frame.released, command]);
    }
  }

  toFile(
    runtime: PackRuntime,
    start: StartState,
    extra: Pick<ReplayFile, 'checkpoints' | 'final'> = {},
  ): ReplayFile {
    return {
      version: 2,
      packId: runtime.id,
      packVersion: runtime.version,
      feelProfile: start.feelProfile,
      seed: start.seed,
      start: {
        roomId: start.roomId,
        spawnId: start.spawnId,
        ...(start.party === undefined ? {} : { party: [...start.party] }),
      },
      frames: this.frames.map(
        ([count, held, pressed, released, command]): ReplayRun =>
          command === 0
            ? [count, held, pressed, released]
            : [count, held, pressed, released, command],
      ),
      ...extra,
    };
  }
}

/**
 * Plays the frames back one tick at a time. After the end it releases whatever was still held
 * once, then returns empty frames (held = 0).
 */
export class Player {
  private run = 0;
  private usedInRun = 0;
  private lastHeld = 0;
  private releasedAtEnd = false;

  constructor(private readonly frames: ReplayFile['frames']) {
    for (const [count] of frames) {
      if (!Number.isInteger(count) || count < 1) {
        throw new RangeError(`replay: run length ${count} is not a positive integer`);
      }
    }
  }

  /** Total ticks in the file. */
  get length(): number {
    return this.frames.reduce((sum, [count]) => sum + count, 0);
  }

  get done(): boolean {
    return this.run >= this.frames.length;
  }

  next(): InputFrame {
    const entry = this.frames[this.run];
    if (entry === undefined) {
      if (!this.releasedAtEnd && this.lastHeld !== 0) {
        this.releasedAtEnd = true;
        return { held: 0, pressed: 0, released: this.lastHeld };
      }
      return EMPTY_FRAME;
    }
    const [count, held, pressed, released, command = 0] = entry;
    if (++this.usedInRun >= count) {
      this.run++;
      this.usedInRun = 0;
    }
    this.lastHeld = held;
    return command === 0 ? { held, pressed, released } : { held, pressed, released, command };
  }
}

export function startOf(file: ReplayFile): StartState {
  return {
    roomId: file.start.roomId,
    spawnId: file.start.spawnId,
    seed: file.seed,
    feelProfile: file.feelProfile,
    ...(file.start.party === undefined ? {} : { party: file.start.party }),
  };
}

/** Throws unless the replay was recorded with this pack: other data would give other results. */
export function checkReplayPack(file: ReplayFile, runtime: PackRuntime): void {
  if (file.version !== 1 && file.version !== 2) {
    throw new RangeError(`replay: unsupported version ${String(file.version)}`);
  }
  if (file.packId !== runtime.id || file.packVersion !== runtime.version) {
    throw new RangeError(
      `replay: recorded with ${file.packId}@${file.packVersion}, ` +
        `but the runtime is ${runtime.id}@${runtime.version}`,
    );
  }
}

export interface HeadlessResult {
  readonly tick: number;
  readonly hash: WorldHash;
  readonly checkpoints: ReadonlyArray<{ readonly tick: number; readonly hash: WorldHash }>;
  readonly world: World;
}

/**
 * Runs a replay without rendering (docs/input-and-feel.md 11.2, `runReplayHeadless`).
 * `checkpointEvery` records the hash after every N ticks (1 = every tick); `until` stops early.
 */
export function runReplayHeadless(
  file: ReplayFile,
  runtime: PackRuntime,
  options: { readonly until?: number; readonly checkpointEvery?: number } = {},
): HeadlessResult {
  checkReplayPack(file, runtime);
  const world = createWorld(runtime, startOf(file));
  const player = new Player(file.frames);
  const total = Math.min(player.length, options.until ?? Number.POSITIVE_INFINITY);
  const every = options.checkpointEvery ?? 0;
  const checkpoints: Array<{ tick: number; hash: WorldHash }> = [];
  while (world.tick < total) {
    step(world, player.next(), runtime);
    if (every > 0 && world.tick % every === 0) {
      checkpoints.push({ tick: world.tick, hash: hashWorld(world) });
    }
  }
  return { tick: world.tick, hash: hashWorld(world), checkpoints, world };
}
