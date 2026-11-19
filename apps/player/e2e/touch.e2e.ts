import { type BrowserContext, devices, expect, type Page, test } from '@playwright/test';
import { actionMask } from '@retro-action-engine/core';

// The virtual pad (M2-1, docs/input-and-feel.md 9) on an emulated phone: shown on a touch
// screen, over the game in landscape, below it in portrait, and its touches reach the game.

type Box = { x: number; y: number; width: number; height: number };

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
  await page.waitForFunction(() => window.__engine !== undefined);
  return errors;
}

async function box(page: Page, selector: string): Promise<Box> {
  const b = await page.locator(selector).boundingBox();
  if (b === null) throw new Error(`${selector} is not shown`);
  return b;
}

const center = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/** Raw touch events, so that two fingers can be down at once. */
async function touches(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  return (
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    points: Array<{ x: number; y: number; id: number }>,
  ) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
}

/** Every action held at some tick of the live input so far. */
async function heldSoFar(page: Page): Promise<number> {
  return page.evaluate(() => {
    let mask = 0;
    for (const [, held] of window.__engine?.recording().frames ?? []) mask |= held;
    return mask;
  });
}

test.describe('landscape phone', () => {
  test.use(phone('Pixel 7 landscape'));

  test('shows the pad over the game, and two fingers move and jump', async ({ page, context }) => {
    const errors = await open(page);
    await expect(page.locator('body')).toHaveClass(/touch/);
    const canvas = await box(page, 'canvas');
    const dpad = await box(page, '.touch-dpad');
    const jump = await box(page, '.touch-button[data-action="jump"]');
    await expect(page.locator('.touch-button[data-action="switch"]')).toBeVisible();
    // Over the game screen (landscape).
    expect(dpad.y + dpad.height).toBeGreaterThan(canvas.y);
    expect(dpad.y).toBeLessThan(canvas.y + canvas.height);

    const send = await touches(context, page);
    const right = { x: dpad.x + dpad.width * 0.85, y: center(dpad).y, id: 1 };
    const tap = { ...center(jump), id: 2 };
    const knobX = () => page.locator('.touch-knob').evaluate((el) => Number(el.getAttribute('cx')));
    expect(await knobX()).toBe(0);
    await send('touchStart', [right]);
    await page.waitForTimeout(200);
    // The stick's knob follows the finger to the right.
    expect(await knobX()).toBeGreaterThan(0);
    await send('touchStart', [right, tap]);
    await page.waitForTimeout(200);
    await send('touchEnd', [right]);
    await page.waitForTimeout(100);
    await send('touchEnd', []);
    await page.waitForTimeout(100);
    expect(await knobX()).toBe(0);

    const held = await heldSoFar(page);
    expect(held & actionMask('right', 'jump')).toBe(actionMask('right', 'jump'));
    expect(held & actionMask('left', 'up', 'down')).toBe(0);
    // Everything is let go at the end.
    const last = await page.evaluate(() => window.__engine?.recording().frames.at(-1));
    expect(last?.[1]).toBe(0);
    expect(errors).toEqual([]);
  });
});

test.describe('portrait phone', () => {
  test.use(phone('Pixel 7'));

  test('moves the game up and puts the pad below it, inside the screen', async ({ page }) => {
    const errors = await open(page);
    const canvas = await box(page, 'canvas');
    const viewport = page.viewportSize() as { width: number; height: number };
    // The pad area itself starts below the game screen: nothing of the pad covers the game.
    const area = await box(page, '.touch-area');
    expect(area.y).toBeGreaterThanOrEqual(Math.floor(canvas.y + canvas.height));
    await expect(page.locator('.touch-pad')).toHaveCSS('opacity', '1');
    for (const selector of ['.touch-dpad', '.touch-button[data-action="jump"]']) {
      const b = await box(page, selector);
      expect(b.y).toBeGreaterThanOrEqual(canvas.y + canvas.height);
      expect(b.x).toBeGreaterThan(0);
      expect(b.x + b.width).toBeLessThan(viewport.width);
      expect(b.y + b.height).toBeLessThan(viewport.height);
    }
    expect(errors).toEqual([]);
  });
});

test.describe('desktop', () => {
  test('does not show the pad with a mouse', async ({ page }) => {
    await open(page);
    await expect(page.locator('body')).not.toHaveClass(/touch/);
    await expect(page.locator('.touch-pad')).toBeHidden();
  });
});
