import { inflateSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { runReplayHeadless } from '@retro-action-engine/core';
import type { ReplayResult } from '../src/engine-hooks';
import { representativeReplay } from '../src/golden/replays';
import { loadSamplePack } from '../src/test-support';

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

/** A small PNG decoder (8-bit RGB or RGBA, not interlaced): enough for Chromium screenshots. */
function decodePng(png: Buffer): { width: number; height: number; rgba: Uint8Array } {
  let pos = 8;
  let width = 0;
  let height = 0;
  let channels = 4;
  const idat: Buffer[] = [];
  while (pos < png.length) {
    const length = png.readUInt32BE(pos);
    const type = png.toString('ascii', pos + 4, pos + 8);
    const data = png.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error('unsupported PNG');
      channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      if (channels === 0) throw new Error(`unsupported PNG color type ${data[9]}`);
    } else if (type === 'IDAT') {
      idat.push(data);
    }
    pos += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] as number;
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x] as number;
      const a = x >= channels ? (cur[x - channels] as number) : 0;
      const b = prev[x] as number;
      const c = x >= channels ? (prev[x - channels] as number) : 0;
      let pred = 0;
      if (filter === 1) pred = a;
      else if (filter === 2) pred = b;
      else if (filter === 3) pred = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = (v + pred) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      for (let k = 0; k < 3; k++) out[(y * width + x) * 4 + k] = cur[x * channels + k] as number;
      out[(y * width + x) * 4 + 3] = channels === 4 ? (cur[x * channels + 3] as number) : 255;
    }
    prev.set(cur);
  }
  return { width, height, rgba: out };
}
