import { hashWorld, type WorldHash } from '../hash/hash';
import type { InputFrame } from '../input/frame';
import { DEFAULT_LOOP_CONFIG, type LoopConfig } from '../loop/advance';
import { LoopDriver } from '../loop/driver';
import { checkReplayPack, Player, Recorder, type ReplayFile, startOf } from '../replay/replay';
import type { PackRuntime, StartState } from '../runtime/pack';
import { type RenderSnapshot, renderSnapshot } from '../sim/output';
import { activeCharacter, canSwitch } from '../sim/party';
import { createWorld, step, type UiState, uiParty } from '../sim/sim';
import type { World } from '../world/world';

/** Where live input comes from. `InputBuffer` (package `input`) fits this shape. */
export interface InputSource {
  /** The frame for the next tick. */
  nextFrame(): InputFrame;
  /** The loop threw time away: resync the edges (ADR-0008 (c)). */
  droppedTime?(): void;
}

/** What one display frame produced: the last two snapshots to draw between, and the HUD state. */
export interface FrameView {
  readonly prev: RenderSnapshot;
  readonly curr: RenderSnapshot;
  /** 0 <= alpha < 1, between `prev` and `curr`. */
  readonly alpha: number;
  /** Ticks run in this frame. */
  readonly ticks: number;
  readonly ui: UiState;
}

/**
 * One game in progress (docs/architecture.md 4.2): the World, the frame loop, the input source,
 * the recorder, and the last two render snapshots. Pure TypeScript with no clock: the app passes
 * the frame time. Either live input (recorded) or a replay (input ignored) drives it.
 */
export class GameSession {
  private world: World;
  private start: StartState;
  private driver: LoopDriver;
  private recorder = new Recorder();
  private player: Player | undefined;
  private replayTicks = 0;
  private prev: RenderSnapshot;
  private curr: RenderSnapshot;
  private ui: UiState;
  private observer: ((tick: number, hash: WorldHash) => void) | undefined;
  private dropped = 0;

  constructor(
    private readonly runtime: PackRuntime,
    start: StartState,
    private readonly input: InputSource,
    private readonly config: LoopConfig = DEFAULT_LOOP_CONFIG,
  ) {
    this.start = start;
    this.world = createWorld(runtime, start);
    this.driver = this.newDriver();
    this.curr = renderSnapshot(this.world, runtime);
    this.prev = this.curr;
    this.ui = this.initialUi();
  }

  /** Runs the ticks this frame time allows. */
  frame(frameMs: number): FrameView {
    const result = this.driver.frame(frameMs);
    return {
      prev: this.prev,
      curr: this.curr,
      alpha: result.alpha,
      ticks: result.ticks,
      ui: this.ui,
    };
  }

  /** Starts over from `start` with live input; the recording starts over too. */
  restart(start: StartState = this.start): void {
    this.player = undefined;
    this.reset(start);
  }

  /** Plays a replay from its start. Live input is ignored until `restart`. */
  replay(file: ReplayFile): void {
    checkReplayPack(file, this.runtime);
    this.player = new Player(file.frames);
    this.replayTicks = this.player.length;
    this.reset(startOf(file));
  }

  /** True while a replay is loaded (also after it has ended). */
  get replaying(): boolean {
    return this.player !== undefined;
  }

  /** True when a loaded replay has run all its ticks. */
  get replayDone(): boolean {
    return this.player !== undefined && this.world.tick >= this.replayTicks;
  }

  get tick(): number {
    return this.world.tick;
  }

  /** Frames whose time the loop clamped (ADR-0003), since the session was created. */
  get droppedFrames(): number {
    return this.dropped;
  }

  /** The start of the current run (live or replay). */
  get startState(): StartState {
    return this.start;
  }

  /**
   * Calls `observer` after every tick with the tick number and the World hash (test hooks:
   * Determinism (c)). Hashing every tick costs time, so pass `undefined` to stop.
   */
  observeTicks(observer: ((tick: number, hash: WorldHash) => void) | undefined): void {
    this.observer = observer;
  }

  hash(): WorldHash {
    return hashWorld(this.world);
  }

  /** The live input since the last start, as a replay. */
  recording(): ReplayFile {
    return this.recorder.toFile(this.runtime, this.start);
  }

  private reset(start: StartState): void {
    this.start = start;
    this.world = createWorld(this.runtime, start);
    this.recorder = new Recorder();
    this.driver = this.newDriver();
    this.curr = renderSnapshot(this.world, this.runtime);
    this.prev = this.curr;
    this.ui = this.initialUi();
  }

  private newDriver(): LoopDriver {
    return new LoopDriver(
      {
        tick: () => this.tick1(),
        dropped: () => {
          this.dropped++;
          if (this.player === undefined) this.input.droppedTime?.();
        },
      },
      this.config,
    );
  }

  private tick1(): void {
    let frame: InputFrame;
    if (this.player !== undefined) {
      if (this.world.tick >= this.replayTicks) return;
      frame = this.player.next();
    } else {
      frame = this.input.nextFrame();
      this.recorder.push(frame);
    }
    const out = step(this.world, frame, this.runtime);
    this.prev = this.curr;
    this.curr = out.render;
    this.ui = out.ui;
    this.observer?.(this.world.tick, hashWorld(this.world));
  }

  /** The HUD state after the last tick (or at the start). */
  get uiState(): UiState {
    return this.ui;
  }

  private initialUi(): UiState {
    return {
      activeCharacterId: activeCharacter(this.world, this.runtime).id,
      canSwitch: canSwitch(this.world, this.runtime),
      party: uiParty(this.world, this.runtime),
    };
  }
}
