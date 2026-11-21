import { type BrowserContext, devices, expect, type Page, test } from '@playwright/test';
import { actionMask } from '@retro-action-engine/core';

// The virtual pad layout editor (M2-4, docs/input-and-feel.md 9.5): drag and resize a button,
// the new place works in the game, it is kept after a reload, each orientation keeps its own,
// and reset goes back to the pack's layout.

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
  await ready(page);
  return errors;
}

async function ready(page: Page) {
  await expect(page.locator('body')).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
  await page.waitForFunction(() => window.__engine !== undefined);
}

async function box(page: Page, selector: string): Promise<Box> {
  const b = await page.locator(selector).boundingBox();
  if (b === null) throw new Error(`${selector} is not shown`);
  return b;
}

/** The box once it is drawn (the pad is placed on the first frames after loading). */
const boxSoon = (page: Page, selector: string) => page.locator(selector).boundingBox();

/**
 * The box once the pad has settled: two reads in a row give the same box. The pad's elements
 * are drawn again after a resize, so a single read can land on one that was just replaced (and
 * has no box). With `unlike`, also waits until the box differs from it in y.
 */
async function settledBox(page: Page, selector: string, unlike?: Box): Promise<Box> {
  let last: Box | null = null;
  let settled: Box | undefined;
  await expect
    .poll(
      async () => {
        const b = await boxSoon(page, selector);
        const same = b !== null && last !== null && JSON.stringify(b) === JSON.stringify(last);
        last = b;
        if (same && b !== null && (unlike === undefined || b.y !== unlike.y)) settled = b;
        return settled !== undefined;
      },
      { intervals: [100] },
    )
    .toBe(true);
  return settled as Box;
}

const center = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const JUMP = '.touch-button[data-action="jump"]';

/** Raw touch events (one finger, id 1). */
async function finger(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }],
    });
  return {
    async drag(from: { x: number; y: number }, to: { x: number; y: number }) {
      await send('touchStart', from.x, from.y);
      for (let i = 1; i <= 5; i++) {
        await send(
          'touchMove',
          from.x + ((to.x - from.x) * i) / 5,
          from.y + ((to.y - from.y) * i) / 5,
        );
      }
      await send('touchEnd', to.x, to.y);
    },
    async tap(at: { x: number; y: number }, holdMs = 0) {
      await send('touchStart', at.x, at.y);
      if (holdMs > 0) await page.waitForTimeout(holdMs);
      await send('touchEnd', at.x, at.y);
    },
  };
}

async function openEditor(page: Page) {
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Edit layout' }).click();
}

const LANDSCAPE = phone('Pixel 7 landscape').viewport;
const PORTRAIT = phone('Pixel 7').viewport;

test.describe('landscape phone', () => {
  test.use({ ...phone('Pixel 7 landscape'), locale: 'en-US' });

  test('moves and resizes a button, keeps it per orientation, and resets it', async ({
    page,
    context,
  }) => {
    const errors = await open(page);
    const touch = await finger(context, page);
    await expect(page.locator(JUMP)).toBeVisible();
    const jump0 = await settledBox(page, JUMP);
    // The portrait layout before anything is edited.
    await page.setViewportSize(PORTRAIT);
    const portrait0 = await settledBox(page, JUMP, jump0);
    await page.setViewportSize(LANDSCAPE);
    await expect.poll(() => boxSoon(page, JUMP)).toEqual(jump0);

    await openEditor(page);
    const editor = page.getByRole('dialog', { name: 'Pad layout (landscape)' });
    await expect(editor).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden();
    // The game stays stopped while editing.
    const tick = await page.evaluate(() => window.__engine?.getStats().tick);

    // Drag the jump button left and up.
    const from = center(jump0);
    const to = { x: from.x - 300, y: from.y - 40 };
    await touch.drag(from, to);
    await expect
      .poll(async () => {
        const b = await boxSoon(page, JUMP);
        return b === null ? null : center(b).x;
      })
      .toBeCloseTo(to.x, 0);
    expect(center(await settledBox(page, JUMP)).y).toBeCloseTo(to.y, 0);

    // Tap it to select it, then make it 150 % of the pack's size.
    await touch.tap(to);
    await expect(page.locator(`${JUMP}[data-selected="true"]`)).toHaveCount(1);
    await editor.getByRole('slider', { name: 'Size (Jump)' }).fill('150');
    // The box is the circle and its 2 px stroke.
    await expect
      .poll(async () =>
        Math.abs(((await boxSoon(page, JUMP))?.width ?? 0) - 2 - (jump0.width - 2) * 1.5),
      )
      .toBeLessThan(1.5);
    expect(await page.evaluate(() => window.__engine?.getStats().tick)).toBe(tick);

    // Done goes back to the settings; closing them plays again.
    await editor.getByRole('button', { name: 'Done' }).click();
    await expect(editor).toBeHidden();
    await page
      .getByRole('dialog', { name: 'Settings' })
      .getByRole('button', { name: 'Close' })
      .click();
    const moved = await settledBox(page, JUMP);

    // The button works where it now is.
    await touch.tap(center(moved), 200);
    await expect
      .poll(() =>
        page.evaluate(() => {
          let mask = 0;
          for (const [, held] of window.__engine?.recording().frames ?? []) mask |= held;
          return mask;
        }),
      )
      .toBe(actionMask('jump'));

    // Kept after a reload.
    // Saving is asynchronous: let it finish before the page goes away.
    await page.evaluate(() => window.__engine?.settingsSaved());
    await page.reload();
    await ready(page);
    await expect.poll(() => boxSoon(page, JUMP)).toEqual(moved);
    // Portrait keeps its own layout.
    await page.setViewportSize(PORTRAIT);
    await expect.poll(() => boxSoon(page, JUMP)).toEqual(portrait0);
    await page.setViewportSize(LANDSCAPE);
    await expect.poll(() => boxSoon(page, JUMP)).toEqual(moved);

    // Reset goes back to the pack's layout, and stays after a reload.
    await openEditor(page);
    await page.getByRole('button', { name: 'Reset this layout' }).click();
    await expect.poll(() => boxSoon(page, JUMP)).toEqual(jump0);
    // Saving is asynchronous: let it finish before the page goes away.
    await page.evaluate(() => window.__engine?.settingsSaved());
    await page.reload();
    await ready(page);
    await expect.poll(() => boxSoon(page, JUMP)).toEqual(jump0);
    expect(errors).toEqual([]);
  });

  test('keeps a drag on its own after a reload', async ({ page, context }) => {
    const errors = await open(page);
    const touch = await finger(context, page);
    await expect(page.locator(JUMP)).toBeVisible();
    const from = center(await settledBox(page, JUMP));
    await openEditor(page);
    await touch.drag(from, { x: from.x - 150, y: from.y });
    await expect
      .poll(async () => {
        const b = await boxSoon(page, JUMP);
        return b === null ? null : center(b).x;
      })
      .toBeCloseTo(from.x - 150, 0);
    const moved = await settledBox(page, JUMP);
    // Saving is asynchronous: let it finish before the page goes away.
    await page.evaluate(() => window.__engine?.settingsSaved());
    await page.reload();
    await ready(page);
    await expect.poll(() => boxSoon(page, JUMP)).toEqual(moved);
    expect(errors).toEqual([]);
  });

  test('swaps left and right, and the opacity follows the slider', async ({ page }) => {
    const errors = await open(page);
    const dpad0 = await box(page, '.touch-dpad');
    await openEditor(page);
    const editor = page.getByRole('dialog', { name: 'Pad layout (landscape)' });
    await editor.getByRole('checkbox', { name: 'Swap left and right' }).check();
    const viewport = page.viewportSize() as { width: number };
    await expect
      .poll(async () => {
        const b = await boxSoon(page, '.touch-dpad');
        return b === null ? 0 : center(b).x;
      })
      .toBeGreaterThan(viewport.width / 2);
    await editor.getByRole('slider', { name: 'Opacity' }).fill('80');
    await expect(page.locator('.touch-pad')).toHaveCSS('opacity', '0.8');
    // Esc closes the editor too.
    await page.keyboard.press('Escape');
    await expect(editor).toBeHidden();
    expect(center(dpad0).x).toBeLessThan(viewport.width / 2);
    expect(errors).toEqual([]);
  });
});

test.describe('portrait phone', () => {
  test.use({ ...phone('Pixel 7'), locale: 'ja-JP' });

  test('edits the portrait layout, without an opacity (the pad is not over the game)', async ({
    page,
  }) => {
    const errors = await open(page);
    await page.getByRole('button', { name: '設定を開く' }).click();
    await page.getByRole('button', { name: '配置を変える' }).click();
    const editor = page.getByRole('dialog', { name: 'パッドの配置（縦向き）' });
    await expect(editor).toBeVisible();
    await expect(editor.getByRole('slider', { name: '濃さ' })).toHaveCount(0);
    await expect(
      editor.getByRole('checkbox', { name: 'スティックを触れた位置に出す' }),
    ).toBeVisible();
    await editor.getByRole('button', { name: '完了' }).click();
    await expect(page.getByRole('dialog', { name: '設定' })).toBeVisible();
    expect(errors).toEqual([]);
  });
});
