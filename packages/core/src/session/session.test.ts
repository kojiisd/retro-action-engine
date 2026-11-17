import { describe, expect, it } from 'vitest';
import type { InputFrame } from '../input/frame';
import { runReplayHeadless } from '../replay/replay';
import { script } from '../replay/script';
import { boxRoom, simRuntime } from '../test-support';
import { GameSession, type InputSource } from './session';

const runtime = simRuntime({
  rows: boxRoom(20, 10),
  spawn: [4, 8],
  members: ['walker', 'swimmer'],
});
const start = { roomId: 'room', spawnId: 'start', seed: 7, feelProfile: 'modern' };
const TICK_MS = 1000 / 60;

/** An input source that plays fixed frames, then nothing. */
function source(frames: readonly InputFrame[]): InputSource & { drops: number } {
  let i = 0;
  return {
    drops: 0,
    nextFrame: () => frames[i++] ?? { held: 0, pressed: 0, released: 0 },
    droppedTime() {
      this.drops++;
    },
  };
}

const frames = script()
  .hold('right', 40)
  .tap('jump', { at: 12 })
  .hold('left', 30)
  .tap('switch', { at: 50 })
  .hold(['right', 'jump'], 20)
  .wait(30)
  .build();

describe('GameSession', () => {
  it('records exactly the frames it was given', () => {
    const session = new GameSession(runtime, start, source(frames));
    while (session.tick < frames.length) session.frame(TICK_MS);
    const file = session.recording();
    const expanded = file.frames.flatMap(([count, held, pressed, released]) =>
      Array.from({ length: count }, () => ({ held, pressed, released })),
    );
    expect(expanded).toEqual(frames.slice(0, expanded.length));
    expect(expanded.length).toBe(session.tick);
  });

  it('plays a replay with the same hash as runReplayHeadless, tick by tick', () => {
    const live = new GameSession(runtime, start, source(frames));
    while (live.tick < frames.length) live.frame(TICK_MS);
    const file = live.recording();
    const headless = runReplayHeadless(file, runtime, { checkpointEvery: 1 });

    // One tick per frame: compare after every tick.
    const replay = new GameSession(runtime, start, source([]));
    replay.replay(file);
    for (const checkpoint of headless.checkpoints) {
      replay.frame(TICK_MS);
      expect(replay.tick).toBe(checkpoint.tick);
      expect(replay.hash()).toEqual(checkpoint.hash);
    }
    expect(replay.replayDone).toBe(true);
    expect(replay.hash()).toEqual(live.hash());
  });

  it('the result does not depend on how the frame times are split', () => {
    const file = (() => {
      const live = new GameSession(runtime, start, source(frames));
      while (live.tick < frames.length) live.frame(TICK_MS);
      return live.recording();
    })();
    const headless = runReplayHeadless(file, runtime);
    for (const pattern of [[7, 9, 40], [33.4], [250, 3, 16.7], [1000]]) {
      const session = new GameSession(runtime, start, source([]));
      session.replay(file);
      for (let i = 0; !session.replayDone; i++)
        session.frame(pattern[i % pattern.length] as number);
      expect(session.tick).toBe(headless.tick);
      expect(session.hash()).toEqual(headless.hash);
    }
  });

  it('stops at the end of a replay and ignores live input', () => {
    const live = new GameSession(runtime, start, source(frames.slice(0, 10)));
    for (let i = 0; i < 10; i++) live.frame(TICK_MS);
    const file = live.recording();
    const noisy = source(script().hold('left', 100).build());
    const session = new GameSession(runtime, start, noisy);
    session.replay(file);
    for (let i = 0; i < 50; i++) session.frame(TICK_MS);
    expect(session.tick).toBe(10);
    expect(session.hash()).toEqual(live.hash());
  });

  it('keeps the previous and the current snapshot for interpolation', () => {
    const session = new GameSession(runtime, start, source(script().hold('right', 30).build()));
    const first = session.frame(0);
    expect(first.ticks).toBe(0);
    expect(first.prev).toBe(first.curr);
    session.frame(TICK_MS * 10);
    const view = session.frame(TICK_MS);
    expect(view.ticks).toBe(1);
    expect(view.curr.tick).toBe(view.prev.tick + 1);
    expect(view.alpha).toBeGreaterThanOrEqual(0);
    expect(view.alpha).toBeLessThan(1);
    expect(view.ui.activeCharacterId).toBe('walker');
    expect(view.ui.canSwitch).toBe(true);
  });

  it('asks the live input to resync when time is dropped, but not during a replay', () => {
    const input = source([]);
    const session = new GameSession(runtime, start, input);
    session.frame(1000);
    expect(input.drops).toBe(1);
    session.replay(session.recording());
    session.frame(1000);
    expect(input.drops).toBe(1);
  });

  it('restart starts a new game and a new recording', () => {
    const session = new GameSession(runtime, start, source(frames));
    session.frame(TICK_MS * 5);
    session.restart({ ...start, feelProfile: 'retro' });
    expect(session.tick).toBe(0);
    expect(session.recording().frames).toEqual([]);
    expect(session.recording().feelProfile).toBe('retro');
    expect(session.replaying).toBe(false);
  });

  it('rejects a replay of another pack', () => {
    const session = new GameSession(runtime, start, source([]));
    expect(() => session.replay({ ...session.recording(), packId: 'other' })).toThrow(RangeError);
  });
});
