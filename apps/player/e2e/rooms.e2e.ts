import { expect, type Page, test } from '@playwright/test';
import {
  createWorld,
  fromPx,
  type InputFrame,
  type PackRuntime,
  Recorder,
  type ReplayFile,
  runReplayHeadless,
  type StartState,
  script,
  step,
} from '@retro-action-engine/core';
import type { ReplayResult } from '../src/engine-hooks';
import { loadSamplePack } from '../src/test-support';

// Rooms in the browser (M3-1, ADR-0018): a replay that goes round the sample pack's rooms (an
// edge, a door, then a warp back) gives the same hash every tick as Node, and live keys take the
// party through the east edge.

async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
  await page.waitForFunction(() => window.__engine !== undefined);
  return errors;
}

/**
 * Records a run round the rooms in Node: walk to the next exit of each room (hopping over steps),
 * press up on a door, and wait out each change. Returns the replay and the rooms on the way.
 */
function roundTrip(runtime: PackRuntime): { file: ReplayFile; rooms: string[] } {
  const entry = runtime.entry as { roomId: string; spawnId: string };
  const start: StartState = { ...entry, seed: 1, feelProfile: runtime.feelDefault as string };
  const world = createWorld(runtime, start);
  const recorder = new Recorder();
  const slot = world.entities.slotOf(world.party.entityId);
  const play = (frames: readonly InputFrame[]) => {
    for (const frame of frames) {
      recorder.push(frame);
      step(world, frame, runtime);
    }
  };
  const rooms = [world.roomId];
  for (let leg = 0; leg < 3; leg++) {
    const exit = runtime.rooms[world.roomId]?.exits?.find((e) => e.kind !== 'edge' || e.rect.x > 0);
    if (exit === undefined) throw new Error(`no way on from ${world.roomId}`);
    const center = exit.rect.x + (exit.rect.w >> 1);
    for (let i = 0; i < 1200 && world.transition.phase === 'none'; i++) {
      const x = world.entities.x[slot] as number;
      const dir = x < center - fromPx(2) ? 'right' : x > center + fromPx(2) ? 'left' : undefined;
      if (dir === undefined) play(script().wait(30).tap('up', { at: 0 }).build(1));
      else
        play(
          script()
            .hold(i % 30 < 20 ? [dir, 'jump'] : dir, 1)
            .build(1),
        );
    }
    play(script().build((runtime.roomTransition?.lockTicks ?? 0) + 10));
    rooms.push(world.roomId);
  }
  return { file: recorder.toFile(runtime, start), rooms };
}

test('Determinism (c): a run round the rooms gives the same hash every tick as Node', async ({
  page,
}) => {
  const errors = await open(page);
  const runtime = await loadSamplePack();
  const { file, rooms } = roundTrip(runtime);
  expect(rooms).toEqual(['hub', 'hall', 'cellar', 'hub']);
  const expected = runReplayHeadless(file, runtime, { checkpointEvery: 1 }).checkpoints.map(
    ({ tick, hash }) => ({ tick, hash: [...hash] }),
  );
  const result = (await page.evaluate(
    (replay) => window.__engine?.runReplay(replay as never),
    file as unknown,
  )) as ReplayResult;
  expect(result.ticks.map(({ tick, hash }) => ({ tick, hash: [...hash] }))).toEqual(expected);
  expect(await page.evaluate(() => window.__engine?.getStats().room)).toBe('hub');
  expect(errors).toEqual([]);
});

test('live keys take the party through the east edge into the next room', async ({ page }) => {
  const errors = await open(page);
  const runtime = await loadSamplePack();
  const edge = runtime.rooms.hub?.exits?.find((e) => e.kind === 'edge');
  await page.keyboard.down('ArrowRight');
  // Hop now and then to get over the step and through the water.
  const hopping = (async () => {
    for (let i = 0; i < 40; i++) {
      const room = await page.evaluate(() => window.__engine?.getStats().room);
      if (room !== 'hub') return;
      await page.keyboard.down('KeyZ');
      await page.waitForTimeout(200);
      await page.keyboard.up('KeyZ');
      await page.waitForTimeout(150);
    }
  })();
  await expect
    .poll(() => page.evaluate(() => window.__engine?.getStats().room), { timeout: 15_000 })
    .toBe(edge?.toRoomId);
  await hopping;
  await page.keyboard.up('ArrowRight');
  await expect.poll(() => page.evaluate(() => window.__engine?.getStats().transition)).toBe('none');
  expect(errors).toEqual([]);
});
