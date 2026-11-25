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

// Rooms and the camera in the browser (M3-1, M3-2): a replay that goes round the sample pack's
// rooms (a door down at the far end of the large room, then a warp back) gives the same hash every
// tick as Node, and live keys make the view scroll after the party.

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
 * Records a run round the rooms in Node: from the spawn past the rock (no pickaxe needed), walk to
 * the exit of each room (hitting the switch of a closed gate first, ADR-0021), press up on a
 * door, and wait out each change. Returns the replay and the rooms on the way.
 */
function roundTrip(runtime: PackRuntime): { file: ReplayFile; rooms: string[] } {
  const start: StartState = {
    roomId: 'hub',
    spawnId: 'door',
    seed: 1,
    feelProfile: runtime.feelDefault as string,
  };
  const world = createWorld(runtime, start);
  const recorder = new Recorder();
  const slot = world.entities.slotOf(world.party.entityId);
  const play = (frames: readonly InputFrame[]) => {
    for (const frame of frames) {
      recorder.push(frame);
      step(world, frame, runtime);
    }
  };
  const x = () => world.entities.x[slot] as number;
  const rooms = [world.roomId];
  /** Walks until the body is within 2 px of `target`, or a room change starts. */
  const walkTo = (target: number, onArrival?: () => void) => {
    // Where a step stops the body on the ground, back off and take a run-up (the retro profile
    // cannot steer in the air).
    let backOff = 0;
    let runUp = 0;
    let still = 0;
    let lastX = x();
    for (let i = 0; i < 3000 && world.transition.phase === 'none'; i++) {
      const dir =
        x() < target - fromPx(2) ? 'right' : x() > target + fromPx(2) ? 'left' : undefined;
      if (dir === undefined) {
        if (onArrival === undefined) return;
        onArrival();
        continue;
      }
      const back = dir === 'right' ? 'left' : 'right';
      if (backOff > 0) {
        backOff--;
        play(script().hold(back, 1).build(1));
        if (backOff === 0) runUp = 30;
      } else if (runUp > 0) {
        runUp--;
        play(
          script()
            .hold(runUp < 22 ? [dir, 'jump'] : dir, 1)
            .build(1),
        );
      } else {
        play(script().hold(dir, 1).build(1));
        still = x() === lastX ? still + 1 : 0;
        if (still >= 3) backOff = 12;
      }
      lastX = x();
    }
  };
  for (let leg = 0; leg < 2; leg++) {
    const room = runtime.rooms[world.roomId];
    for (const g of room?.gimmicks ?? []) {
      if (g.type !== 'switch' || world.flags[g.flag] !== undefined) continue;
      // Just left of it, facing right: within the sword's reach.
      walkTo(g.rect.x - fromPx(8));
      play(script().tap('attack').wait(30).build());
    }
    const exit = room?.exits?.[0];
    if (exit === undefined) throw new Error(`no way on from ${world.roomId}`);
    walkTo(exit.rect.x + (exit.rect.w >> 1), () =>
      play(script().wait(30).tap('up', { at: 0 }).build(1)),
    );
    play(script().build((runtime.roomTransition?.lockTicks ?? 0) + 10));
    rooms.push(world.roomId);
  }
  expect(world.flags['cellar-gate-open']).toBe(true);
  return { file: recorder.toFile(runtime, start), rooms };
}

test('Determinism (c): a run round the rooms gives the same hash every tick as Node', async ({
  page,
}) => {
  const errors = await open(page);
  const runtime = await loadSamplePack();
  const { file, rooms } = roundTrip(runtime);
  expect(rooms).toEqual(['hub', 'cellar', 'hub']);
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

test('live keys make the view scroll after the party', async ({ page }) => {
  const errors = await open(page);
  const before = await page.evaluate(() => window.__engine?.getStats().camera);
  expect(before?.x).toBe(0);
  await page.keyboard.down('ArrowRight');
  await expect
    .poll(() => page.evaluate(() => window.__engine?.getStats().camera.x), { timeout: 10_000 })
    .toBeGreaterThan(0);
  await page.keyboard.up('ArrowRight');
  expect(await page.evaluate(() => window.__engine?.getStats().room)).toBe('hub');
  expect(errors).toEqual([]);
});
