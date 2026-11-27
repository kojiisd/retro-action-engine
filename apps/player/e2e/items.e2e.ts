import { expect, type Page, test } from '@playwright/test';
import {
  createWorld,
  type InputFrame,
  Recorder,
  runReplayHeadless,
  type StartState,
  script,
  step,
} from '@retro-action-engine/core';
import type { ReplayResult } from '../src/engine-hooks';
import type { MenuState } from '../src/menu';
import { loadSamplePack } from '../src/test-support';

// Items (M3-3, ADR-0021): picking up the pickaxe in the browser gives the same hash every tick as
// Node, the message shows at the bottom for a while, and the menu's items page lists it.

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

const stats = (page: Page) => page.evaluate(() => window.__engine?.getStats());
const menu = (page: Page): Promise<MenuState | null> =>
  page.evaluate(() => window.__engine?.getStats().menu ?? null);

/** Screenshots for the owner's check (only when MENU_SHOT_DIR is set). */
async function shot(page: Page, name: string) {
  const dir = process.env.MENU_SHOT_DIR;
  if (dir === undefined) return;
  await page.locator('canvas').screenshot({ path: `${dir}/${name}.png` });
}

test.describe('items', () => {
  test.use({ locale: 'ja-JP' });

  test('picks up the pickaxe: the same hashes as Node, the message, and the items page', async ({
    page,
  }) => {
    const errors = await open(page);
    const runtime = await loadSamplePack();
    // From the spawn on the top shelf, walk right until the pickaxe is picked up.
    const start: StartState = {
      roomId: 'hub',
      spawnId: 'top-shelf',
      seed: 1,
      feelProfile: runtime.feelDefault as string,
    };
    const world = createWorld(runtime, start);
    const recorder = new Recorder();
    const play = (frames: readonly InputFrame[]) => {
      for (const frame of frames) {
        recorder.push(frame);
        step(world, frame, runtime);
      }
    };
    for (let i = 0; i < 300 && world.inventory.pickaxe === undefined; i++) {
      play(script().hold('right', 1).build(1));
    }
    play(script().build(10));
    expect(world.inventory).toEqual({ pickaxe: 1 });
    const file = recorder.toFile(runtime, start);
    const expected = runReplayHeadless(file, runtime, { checkpointEvery: 1 }).checkpoints.map(
      ({ tick, hash }) => ({ tick, hash: [...hash] }),
    );
    const result = (await page.evaluate(
      (replay) => window.__engine?.runReplay(replay as never),
      file as unknown,
    )) as ReplayResult;
    expect(result.ticks.map(({ tick, hash }) => ({ tick, hash: [...hash] }))).toEqual(expected);

    // The message, at the bottom of the screen.
    await expect.poll(async () => (await stats(page))?.toast).toBe('つるはし を てにいれた');
    expect((await stats(page))?.inventory).toEqual([{ id: 'pickaxe', count: 1 }]);
    await shot(page, 'item-toast');

    // The items page: the second line of the menu. The message waits while the menu is open.
    await page.keyboard.press('Enter');
    await expect.poll(() => menu(page)).toEqual({ level: 'top', top: 0, member: 0 });
    await page.keyboard.press('ArrowDown');
    await expect.poll(async () => (await menu(page))?.top).toBe(1);
    await shot(page, 'menu-items');
    // Confirm does nothing there: the items are only to look at.
    await page.keyboard.press('KeyZ');
    await page.waitForTimeout(200);
    expect(await menu(page)).toEqual({ level: 'top', top: 1, member: 0 });
    await page.waitForTimeout(2500);
    expect((await stats(page))?.toast).toBe('つるはし を てにいれた');
    await page.keyboard.press('Enter');
    await expect.poll(() => menu(page)).toBeNull();
    // Back in the game, the message goes after about two seconds.
    await expect.poll(async () => (await stats(page))?.toast, { timeout: 5000 }).toBeNull();
    expect(errors).toEqual([]);
  });
});
