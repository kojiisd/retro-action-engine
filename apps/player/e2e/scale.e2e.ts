import { devices, expect, type Page, test } from '@playwright/test';

// How the game screen fills the page (ADR-0010, revision 2026-11-21): on a PC, a whole zoom of
// the pack's display size up to 3x; on a touch screen, stretched to fit.

const W = 320;
const H = 180;

/** A device preset without its browser choice (the project already runs Chromium). */
function phone(name: string) {
  const { defaultBrowserType: _browser, ...options } = devices[name] as (typeof devices)[string];
  return options;
}

async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
  return errors;
}

const canvasBox = async (page: Page) => page.locator('canvas').boundingBox();

test.describe('PC', () => {
  test('a large window shows the screen at 3x, centered, with the gear on its corner', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    const errors = await open(page);
    await expect.poll(async () => (await canvasBox(page))?.width).toBe(W * 3);
    const canvas = await canvasBox(page);
    expect(canvas?.height).toBe(H * 3);
    // Centered in the window.
    expect(Math.abs((canvas?.x ?? 0) * 2 + (canvas?.width ?? 0) - 1920)).toBeLessThanOrEqual(1);
    // The gear is inside the screen's top-right corner (the HUD band), not the window's.
    const gear = await page.getByRole('button', { name: 'Open the menu' }).boundingBox();
    if (canvas === null || gear === null) throw new Error('not shown');
    expect(gear.x + gear.width).toBeLessThanOrEqual(canvas.x + canvas.width);
    expect(gear.x).toBeGreaterThan(canvas.x + canvas.width / 2);
    expect(gear.y).toBeGreaterThanOrEqual(canvas.y);
    expect(gear.y).toBeLessThan(canvas.y + canvas.height / 4);
    expect(errors).toEqual([]);
  });

  test('a smaller window takes the largest whole zoom that fits, also after a resize', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await open(page);
    await expect.poll(async () => (await canvasBox(page))?.width).toBe(W * 3);
    await page.setViewportSize({ width: 800, height: 600 });
    await expect.poll(async () => (await canvasBox(page))?.width).toBe(W * 2);
    expect((await canvasBox(page))?.height).toBe(H * 2);
    await page.setViewportSize({ width: 500, height: 400 });
    await expect.poll(async () => (await canvasBox(page))?.width).toBe(W);
  });
});

test.describe('touch screen', () => {
  // A screen where fitting (about 2.2x) and a whole zoom (2x) give different sizes.
  test.use({
    ...phone('Pixel 7 landscape'),
    viewport: { width: 900, height: 400 },
    locale: 'en-US',
  });

  test('stretches the screen to fit, not by a whole zoom', async ({ page }) => {
    const errors = await open(page);
    const viewport = page.viewportSize() as { width: number; height: number };
    const fit = Math.min(viewport.width / W, viewport.height / H);
    await expect.poll(async () => (await canvasBox(page))?.height).toBeCloseTo(H * fit, 0);
    expect(Math.floor(fit)).toBeLessThan(fit);
    expect(errors).toEqual([]);
  });
});
