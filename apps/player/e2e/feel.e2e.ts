import { expect, type Page, test } from '@playwright/test';
import { runReplayHeadless } from '@retro-action-engine/core';
import type { ReplayResult } from '../src/engine-hooks';
import { representativeReplay } from '../src/golden/replays';
import { loadSamplePack } from '../src/test-support';
import { decodePng } from './png';

// M2-3: switching the feel profile in the settings, motion smoothing on and off, and the debug
// display (dev builds and PR previews only; the e2e build counts as one).

test.use({ locale: 'en-US' });

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

async function settings(page: Page) {
  await page.getByRole('button', { name: 'Open settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
}

async function close(page: Page) {
  await page.getByRole('button', { name: 'Close' }).click();
}

/** Every tick's hash of the representative replay, in the browser and in Node. */
async function sameAsNode(page: Page, profile: string) {
  const runtime = await loadSamplePack();
  const file = representativeReplay(runtime, profile);
  const node = runReplayHeadless(file, runtime, { checkpointEvery: 1 }).checkpoints.map(
    ({ tick, hash }) => ({ tick, hash: [...hash] }),
  );
  const browser = await page.evaluate(
    (replay) => window.__engine?.runReplay(replay as never) as Promise<ReplayResult>,
    file,
  );
  expect(browser.ticks.map(({ tick, hash }) => ({ tick, hash: [...hash] }))).toEqual(node);
}

test('switching the feel starts the room over with that profile, and is kept', async ({ page }) => {
  const errors = await open(page);
  expect(await page.evaluate(() => window.__engine?.getStats().feelProfile)).toBe('modern');
  await page.waitForTimeout(300);
  await settings(page);
  await page.getByRole('radio', { name: 'Retro' }).check();
  expect(await page.evaluate(() => window.__engine?.getStats())).toMatchObject({
    feelProfile: 'retro',
    tick: 0,
  });
  await close(page);

  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
  await page.waitForFunction(() => window.__engine !== undefined);
  expect(await page.evaluate(() => window.__engine?.getStats().feelProfile)).toBe('retro');
  await settings(page);
  await expect(page.getByRole('radio', { name: 'Retro' })).toBeChecked();
  await close(page);
  expect(errors).toEqual([]);
});

for (const smoothing of ['Smooth', 'Off (frame by frame)']) {
  test(`Determinism with motion smoothing "${smoothing}": the same hashes as Node`, async ({
    page,
  }) => {
    const errors = await open(page);
    await settings(page);
    await page.getByRole('radio', { name: smoothing }).check();
    await close(page);
    await sameAsNode(page, 'modern');
    await sameAsNode(page, 'retro');
    expect(errors).toEqual([]);
  });
}

/** Pixels of the play area in the collision box color (debug display). */
async function boxPixels(page: Page): Promise<number> {
  const png = await page.locator('canvas').screenshot();
  const { width, height, rgba } = decodePng(png);
  let count = 0;
  for (let i = 0; i < width * height; i++) {
    const [r, g, b] = [rgba[i * 4] as number, rgba[i * 4 + 1] as number, rgba[i * 4 + 2] as number];
    if (Math.abs(r - 0x40) < 24 && g > 0xd8 && Math.abs(b - 0x90) < 24) count++;
  }
  return count;
}

test('the debug display draws the collision boxes and the latency stats', async ({ page }) => {
  const errors = await open(page);
  expect(await boxPixels(page)).toBe(0);
  await expect(page.locator('.debug-overlay')).toBeHidden();

  await settings(page);
  await page.getByRole('checkbox', { name: 'Show collision boxes' }).check();
  await page.getByRole('checkbox', { name: 'Show latency and frame stats' }).check();
  await close(page);
  await page.waitForTimeout(200);
  expect(await boxPixels(page)).toBeGreaterThan(20);

  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(200);
  await page.keyboard.up('ArrowRight');
  await page.waitForTimeout(300);
  await expect(page.locator('.debug-overlay')).toBeVisible();
  await expect(page.locator('.debug-overlay')).toContainText(/input→draw ms last \d+\.\d/);
  expect(errors).toEqual([]);
});
