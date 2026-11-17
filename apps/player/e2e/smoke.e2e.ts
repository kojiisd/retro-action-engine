import { expect, type Page, test } from '@playwright/test';
import { runReplayHeadless } from '@retro-action-engine/core';
import type { ReplayResult } from '../src/engine-hooks';
import { representativeReplay } from '../src/golden/replays';
import { loadSamplePack } from '../src/test-support';

/** Opens the game and waits until the first frame can be drawn. Collects console errors. */
async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('./');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
  await page.waitForFunction(() => window.__engine !== undefined);
  return errors;
}

/** The hash of every tick of a replay in Node, the way the golden test runs it. */
async function nodeTicks(profile: string) {
  const runtime = await loadSamplePack();
  const file = representativeReplay(runtime, profile);
  const result = runReplayHeadless(file, runtime, { checkpointEvery: 1 });
  return { file, ticks: result.checkpoints.map(({ tick, hash }) => ({ tick, hash: [...hash] })) };
}

/**
 * Plays the replay in the page; also counts the display frames it took. With `slowMs`, every
 * frame is held up that long, and every 30th frame stalls past the loop's clamp, so frames run
 * several ticks and some time is dropped (ADR-0003).
 */
async function browserTicks(page: Page, file: unknown, slowMs = 0) {
  const { result, frames } = await page.evaluate(
    async ({ replay, slowMs }) => {
      let frames = 0;
      let counting = true;
      const busy = (ms: number) => {
        const end = performance.now() + ms;
        while (performance.now() < end) {
          // Hold the main thread like a slow device would.
        }
      };
      const count = () => {
        frames++;
        if (slowMs > 0) busy(frames % 30 === 0 ? 300 : slowMs);
        if (counting) requestAnimationFrame(count);
      };
      requestAnimationFrame(count);
      const result = (await window.__engine?.runReplay(replay as never)) as ReplayResult;
      counting = false;
      return { result, frames };
    },
    { replay: file, slowMs },
  );
  return { ticks: result.ticks.map(({ tick, hash }) => ({ tick, hash: [...hash] })), frames };
}

test('starts, loads the sample pack and draws without console errors', async ({ page }) => {
  const errors = await open(page);
  await expect(page.locator('canvas')).toHaveCount(1);
  // Live input reaches the simulation: holding right for a while moves time forward.
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(300);
  await page.keyboard.up('ArrowRight');
  const stats = await page.evaluate(() => window.__engine?.getStats());
  expect(stats?.tick).toBeGreaterThan(0);
  expect(stats?.replaying).toBe(false);
  expect(errors).toEqual([]);
});

for (const profile of ['retro', 'modern']) {
  test(`Determinism (c): ${profile} replay gives the same hash every tick as Node`, async ({
    page,
  }) => {
    const errors = await open(page);
    const expected = await nodeTicks(profile);
    expect((await browserTicks(page, expected.file)).ticks).toEqual(expected.ticks);
    expect(errors).toEqual([]);
  });
}

test('Determinism (c): the same hashes with slow frames and dropped time', async ({ page }) => {
  const errors = await open(page);
  const before = await page.evaluate(() => window.__engine?.getStats().droppedFrames ?? 0);
  const expected = await nodeTicks('modern');
  const { ticks, frames } = await browserTicks(page, expected.file, 40);
  expect(ticks).toEqual(expected.ticks);
  // The slow page could not draw every tick, and the loop did drop time.
  expect(frames).toBeLessThan(ticks.length / 2);
  const after = await page.evaluate(() => window.__engine?.getStats().droppedFrames ?? 0);
  expect(after).toBeGreaterThan(before);
  expect(errors).toEqual([]);
});
