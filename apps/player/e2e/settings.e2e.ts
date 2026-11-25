import { expect, type Page, test } from '@playwright/test';
import { actionMask } from '@retro-action-engine/core';
import { closeGameMenu, menuOpen, openSettings } from './menus';

// The key config (M2-2, docs/input-and-feel.md 4.3): assign a key → it works in the game →
// it is kept after a reload → reset to the pack's defaults. Since M3-6a the settings open from
// the game menu (ADR-0020), and closing them goes back to it.

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

/** Every action held at some tick since the game (re)started. */
async function heldSoFar(page: Page): Promise<number> {
  return page.evaluate(() => {
    let mask = 0;
    for (const [, held] of window.__engine?.recording().frames ?? []) mask |= held;
    return mask;
  });
}

async function hold(page: Page, key: string) {
  await page.keyboard.down(key);
  await page.waitForTimeout(150);
  await page.keyboard.up(key);
  await page.waitForTimeout(100);
}

const jumpRow = (page: Page) => page.locator('.settings-row[data-action="jump"]');
const chip = (page: Page, code: string) =>
  jumpRow(page).locator(`.settings-chip[data-input="${code}"]`);

test.describe('Japanese browser', () => {
  test.use({ locale: 'ja-JP' });

  test('assigns a key, uses it in the game, keeps it, and resets it', async ({ page }) => {
    const errors = await open(page);
    expect(await heldSoFar(page)).toBe(0);

    await openSettings(page, 'メニューを開く');
    const dialog = page.getByRole('dialog', { name: '設定' });
    await expect(dialog).toBeVisible();
    // The game stops while the settings are open.
    const before = await page.evaluate(() => window.__engine?.getStats().tick);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__engine?.getStats().tick)).toBe(before);

    // Esc while waiting for a key cancels; nothing is added.
    await jumpRow(page).getByRole('button', { name: '追加' }).click();
    await expect(jumpRow(page)).toContainText('キーかボタンを押してください');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(chip(page, 'Escape')).toHaveCount(0);

    await jumpRow(page).getByRole('button', { name: '追加' }).click();
    await page.keyboard.press('KeyX');
    await expect(chip(page, 'KeyX')).toHaveText(/X/);
    await page.getByRole('button', { name: '閉じる' }).click();
    await expect(dialog).toBeHidden();
    await closeGameMenu(page);

    await hold(page, 'KeyX');
    expect((await heldSoFar(page)) & actionMask('jump')).toBe(actionMask('jump'));

    // Kept after a reload (IndexedDB).
    // Saving is asynchronous: let it finish before the page goes away.
    await page.evaluate(() => window.__engine?.settingsSaved());
    await page.reload();
    await expect(page.locator('body')).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
    await openSettings(page, 'メニューを開く');
    await expect(chip(page, 'KeyX')).toBeVisible();

    // Reset to the pack's defaults: X is gone, Z is still there, and X no longer jumps.
    await page.getByRole('button', { name: '既定に戻す' }).click();
    await expect(chip(page, 'KeyX')).toHaveCount(0);
    await expect(chip(page, 'KeyZ')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await closeGameMenu(page);
    const jumpBefore = (await heldSoFar(page)) & actionMask('jump');
    await hold(page, 'KeyX');
    expect((await heldSoFar(page)) & actionMask('jump')).toBe(jumpBefore);
    expect(errors).toEqual([]);
  });

  test('removes a key from an action', async ({ page }) => {
    await open(page);
    await openSettings(page, 'メニューを開く');
    await chip(page, 'KeyZ').getByRole('button', { name: 'Z を外す' }).click();
    await expect(chip(page, 'KeyZ')).toHaveCount(0);
    await page.getByRole('button', { name: '閉じる' }).click();
    await closeGameMenu(page);
    await hold(page, 'KeyZ');
    expect((await heldSoFar(page)) & actionMask('jump')).toBe(0);
  });
});

test.describe('English browser', () => {
  test.use({ locale: 'en-US' });

  test('opens from the game menu, in English, and closes with Esc back to it', async ({ page }) => {
    const errors = await open(page);
    // The menu key opens the game menu; its settings item opens the settings.
    await page.keyboard.press('Enter');
    await expect.poll(() => menuOpen(page)).toBe(true);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('KeyZ');
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog).toBeVisible();
    await expect(jumpRow(page)).toContainText('Jump');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect(await menuOpen(page)).toBe(true);

    // While open, keys belong to the page: Space activates the focused close button (it is
    // also the jump key, which must not swallow it).
    await page.keyboard.press('KeyZ');
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close' })).toBeFocused();
    await page.keyboard.press('Space');
    await expect(dialog).toBeHidden();
    await closeGameMenu(page);
    // Nothing pressed in the menu reaches the game, and the game runs again.
    const before = await page.evaluate(() => window.__engine?.getStats().tick ?? 0);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.__engine?.getStats().tick ?? 0)).toBeGreaterThan(
      before,
    );
    expect(errors).toEqual([]);
  });
});

test.describe('gamepad', () => {
  test.use({ locale: 'en-US' });

  test('opens the menu with button 8, the settings from it, and assigns a button', async ({
    page,
  }) => {
    // A fake standard-mapping pad the test presses through window.__pad.
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
    const dialog = page.getByRole('dialog', { name: 'Settings' });

    // Button 8 opens the game menu; down (13) twice and button 0 (jump, also confirm) open the
    // settings.
    await press(8);
    await expect.poll(() => menuOpen(page)).toBe(true);
    await press(13);
    await press(13);
    await press(0);
    await expect(dialog).toBeVisible();
    await jumpRow(page).getByRole('button', { name: 'Add' }).click();
    await press(3);
    await expect(jumpRow(page).locator('.settings-chip[data-input="button3"]')).toHaveText(
      /Button 3/,
    );
    // Button 8 closes the settings back to the game menu, then the game menu.
    await press(8);
    await expect(dialog).toBeHidden();
    expect(await menuOpen(page)).toBe(true);
    await press(8);
    await expect.poll(() => menuOpen(page)).toBe(false);

    await press(3);
    expect((await heldSoFar(page)) & actionMask('jump')).toBe(actionMask('jump'));
    expect(errors).toEqual([]);
  });
});
