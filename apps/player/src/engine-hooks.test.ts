import {
  GameSession,
  type InputFrame,
  type InputSource,
  runReplayHeadless,
  type StartState,
  script,
} from '@retro-action-engine/core';
import type { LoadedRuntime } from '@retro-action-engine/pack';
import { beforeAll, describe, expect, it } from 'vitest';
import { createEngineHooks } from './engine-hooks';
import { loadSamplePack } from './test-support';

const TICK_MS = 1000 / 60;

function source(frames: readonly InputFrame[]): InputSource {
  let i = 0;
  return { nextFrame: () => frames[i++] ?? { held: 0, pressed: 0, released: 0 } };
}

describe('window.__engine hooks', () => {
  let runtime: LoadedRuntime;
  let start: StartState;

  beforeAll(async () => {
    runtime = await loadSamplePack();
    start = { ...runtime.entry, seed: 1, feelProfile: runtime.feelDefault };
  });

  function recorded() {
    const frames = script()
      .hold('right', 50)
      .tap('jump', { at: 20 })
      .tap('switch', { at: 60 })
      .wait(20)
      .build();
    const live = new GameSession(runtime, start, source(frames));
    while (live.tick < frames.length) live.frame(TICK_MS);
    return live.recording();
  }

  it('runReplay resolves with the hash of every tick, the same as runReplayHeadless', async () => {
    const file = recorded();
    const session = new GameSession(runtime, start, source([]));
    const hooks = createEngineHooks({
      session,
      feelProfiles: ['retro', 'modern'],
      resyncCount: () => 0,
    });
    const result = hooks.runReplay(file);
    // The renderer would call frame() once per display frame; uneven times on purpose.
    const times = [16, 33, 7, 50, 0];
    for (let i = 0; !session.replayDone; i++) session.frame(times[i % times.length] as number);
    const { ticks, final } = await result;
    const headless = runReplayHeadless(file, runtime, { checkpointEvery: 1 });
    expect(ticks).toEqual(headless.checkpoints);
    expect(final).toEqual({ tick: headless.tick, hash: headless.hash });
    expect(hooks.getStats()).toMatchObject({ replaying: true, tick: headless.tick });
  });

  it('a second runReplay rejects the first one', async () => {
    const session = new GameSession(runtime, start, source([]));
    const hooks = createEngineHooks({ session, feelProfiles: ['modern'], resyncCount: () => 0 });
    const first = hooks.runReplay(recorded());
    const second = hooks.runReplay(recorded());
    await expect(first).rejects.toThrow(/replaced/);
    while (!session.replayDone) session.frame(TICK_MS * 4);
    await expect(second).resolves.toBeDefined();
  });

  it('setFeelProfile restarts with a profile of the pack and rejects others', () => {
    const session = new GameSession(runtime, start, source([]));
    const hooks = createEngineHooks({
      session,
      feelProfiles: Object.keys(runtime.feel),
      resyncCount: () => 3,
    });
    session.frame(TICK_MS * 3);
    hooks.setFeelProfile('retro');
    expect(hooks.getStats()).toEqual({
      tick: 0,
      resyncCount: 3,
      droppedFrames: 0,
      replaying: false,
      feelProfile: 'retro',
    });
    expect(() => hooks.setFeelProfile('turbo')).toThrow(/not in the pack/);
  });
});
