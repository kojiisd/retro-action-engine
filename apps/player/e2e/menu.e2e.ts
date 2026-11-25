import { devices, expect, type Page, test } from '@playwright/test';
import { actionMask, runReplayHeadless } from '@retro-action-engine/core';
import type { ReplayResult } from '../src/engine-hooks';
import type { MenuState } from '../src/menu';
import { loadSamplePack } from '../src/test-support';

// The in-game menu (M3-6a, ADR-0020): the game stops while it is open, it is worked with the
// keyboard, a gamepad and the touch pad, and a switch chosen in it is an input like any other
// (the replay is the same in the browser and in Node).

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

const menu = (page: Page): Promise<MenuState | null> =>
  page.evaluate(() => window.__engine?.getStats().menu ?? null);
const stats = (page: Page) => page.evaluate(() => window.__engine?.getStats());

/** Screenshots for the owner's check of the wording (only when MENU_SHOT_DIR is set). */
async function shot(page: Page, name: string) {
  const dir = process.env.MENU_SHOT_DIR;
  if (dir === undefined) return;
  await page.locator('canvas').screenshot({ path: `${dir}/${name}.png` });
}

test.describe('keyboard', () => {
  test.use({ locale: 'ja-JP' });

  test('stops the game, moves with the arrows, and switches to the chosen member', async ({
    page,
  }) => {
    const errors = await open(page);
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await expect.poll(() => menu(page)).toEqual({ level: 'top', top: 0, member: 0 });
    // No time passes in the game.
    const tick = (await stats(page))?.tick;
    await page.waitForTimeout(300);
    expect((await stats(page))?.tick).toBe(tick);
    await shot(page, 'menu-top');

    await page.keyboard.press('ArrowDown');
    await expect.poll(async () => (await menu(page))?.top).toBe(1);
    await page.keyboard.press('ArrowUp');
    await expect.poll(async () => (await menu(page))?.top).toBe(0);
    // Into the party; the active member cannot be chosen, the other one can.
    await page.keyboard.press('KeyZ');
    await expect.poll(async () => (await menu(page))?.level).toBe('party');
    await page.keyboard.press('KeyZ');
    expect((await menu(page))?.level).toBe('party');
    await page.keyboard.press('ArrowDown');
    await expect.poll(async () => (await menu(page))?.member).toBe(1);
    await shot(page, 'menu-party');
    await page.keyboard.press('KeyZ');
    await expect.poll(() => menu(page)).toBeNull();
    await expect.poll(async () => (await stats(page))?.activeCharacter).toBe('diver');

    // Nothing pressed in the menu reaches the game: the arrows and Z were never held in a tick.
    let held = 0;
    for (const [, h] of (await page.evaluate(() => window.__engine?.recording().frames)) ?? []) {
      held |= h;
    }
    expect(held & actionMask('up', 'down', 'jump')).toBe(0);

    // The switch is in the recording as a command, and replays the same here and in Node.
    const file = await page.evaluate(() => window.__engine?.recording());
    if (file === undefined) throw new Error('no recording');
    expect(file.frames.filter((f) => f.length === 5)).toHaveLength(1);
    const runtime = await loadSamplePack();
    const node = runReplayHeadless(file, runtime, { checkpointEvery: 1 }).checkpoints.map(
      ({ tick: t, hash }) => ({ tick: t, hash: [...hash] }),
    );
    const browser = await page.evaluate(
      (replay) => window.__engine?.runReplay(replay as never) as Promise<ReplayResult>,
      file,
    );
    expect(browser.ticks.map(({ tick: t, hash }) => ({ tick: t, hash: [...hash] }))).toEqual(node);
    expect(errors).toEqual([]);
  });

  test('starts the game again from "everything released" after closing', async ({ page }) => {
    const errors = await open(page);
    await page.waitForTimeout(300);
    // Right is held while the menu opens and closes, and only let go afterwards.
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(100);
    await page.keyboard.press('Enter');
    await expect.poll(() => menu(page)).not.toBeNull();
    await page.keyboard.press('Enter');
    await expect.poll(() => menu(page)).toBeNull();
    const closedAt = (await stats(page))?.tick ?? 0;
    await page.waitForTimeout(200);
    await page.keyboard.up('ArrowRight');
    await page.waitForTimeout(100);
    // After the menu, right is released at once and is not held again in any tick.
    const frames = (await page.evaluate(() => window.__engine?.recording().frames)) ?? [];
    let tick = 0;
    let heldAfter = 0;
    for (const [count, held] of frames) {
      if (tick + count > closedAt + 1) heldAfter |= held;
      tick += count;
    }
    expect(heldAfter & actionMask('right')).toBe(0);
    expect(errors).toEqual([]);
  });
});

test.describe('gamepad', () => {
  test.use({ locale: 'en-US' });

  test('opens with button 8, moves with the d-pad, goes in with A and back with X', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
      const pad = {
        index: 0,
        id: 'Test pad (STANDARD GAMEPAD)',
        connected: true,
        mapping: 'standard',
        buttons,
        axes: [0, 0, 0, 0],
        timestamp: 0,
      };
      (window as unknown as { __pad: (b: number, down: boolean) => void }).__pad = (b, down) => {
        (buttons[b] as { pressed: boolean }).pressed = down;
      };
      Object.defineProperty(navigator, 'getGamepads', { value: () => [pad, null, null, null] });
    });
    const errors = await open(page);
    const press = async (button: number) => {
      await page.evaluate(
        (b) => (window as unknown as { __pad: (b: number, d: boolean) => void }).__pad(b, true),
        button,
      );
      await page.waitForTimeout(120);
      await page.evaluate(
        (b) => (window as unknown as { __pad: (b: number, d: boolean) => void }).__pad(b, false),
        button,
      );
      await page.waitForTimeout(120);
    };
    await press(8);
    await expect.poll(() => menu(page)).toEqual({ level: 'top', top: 0, member: 0 });
    await shot(page, 'menu-top-en');
    await press(13);
    await expect.poll(async () => (await menu(page))?.top).toBe(1);
    await press(12);
    await expect.poll(async () => (await menu(page))?.top).toBe(0);
    await press(0);
    await expect.poll(async () => (await menu(page))?.level).toBe('party');
    await press(2);
    await expect.poll(async () => (await menu(page))?.level).toBe('top');
    await press(8);
    await expect.poll(() => menu(page)).toBeNull();
    expect(errors).toEqual([]);
  });
});

test.describe('touch', () => {
  const { defaultBrowserType: _browser, ...phone } = devices[
    'Pixel 7 landscape'
  ] as (typeof devices)[string];
  test.use({ ...phone, locale: 'ja-JP' });

  test('opens with the gear, moves with the pad, goes in with jump and back with attack', async ({
    page,
    context,
  }) => {
    const errors = await open(page);
    const cdp = await context.newCDPSession(page);
    const touch = async (
      selector: string,
      at: (b: { x: number; y: number; width: number; height: number }) => { x: number; y: number },
    ) => {
      const b = await page.locator(selector).boundingBox();
      if (b === null) throw new Error(`${selector} is not shown`);
      const p = at(b);
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ ...p, id: 1 }],
      });
      await page.waitForTimeout(120);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(120);
    };
    const middle = (b: { x: number; y: number; width: number; height: number }) => ({
      x: b.x + b.width / 2,
      y: b.y + b.height / 2,
    });
    await page.getByRole('button', { name: 'メニューを開く' }).tap();
    await expect.poll(() => menu(page)).not.toBeNull();
    // The lower part of the d-pad is down.
    await touch('.touch-dpad', (b) => ({ x: b.x + b.width / 2, y: b.y + b.height * 0.85 }));
    await expect.poll(async () => (await menu(page))?.top).toBe(1);
    await touch('.touch-dpad', (b) => ({ x: b.x + b.width / 2, y: b.y + b.height * 0.15 }));
    await expect.poll(async () => (await menu(page))?.top).toBe(0);
    await touch('.touch-button[data-action="jump"]', middle);
    await expect.poll(async () => (await menu(page))?.level).toBe('party');
    await touch('.touch-button[data-action="attack"]', middle);
    await expect.poll(async () => (await menu(page))?.level).toBe('top');
    await page.getByRole('button', { name: 'メニューを開く' }).tap();
    await expect.poll(() => menu(page)).toBeNull();
    expect(errors).toEqual([]);
  });
});
