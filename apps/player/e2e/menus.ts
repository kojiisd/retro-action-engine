// Since M3-6a the gear and the menu button open the game menu, and the settings open from its
// "settings" item (ADR-0020). Helpers for the tests that work in the settings. No imports, so
// that the dependency rules treat this file like the tests that use it.

/** The parts of Playwright's `Page` the helpers use. */
interface MenuPage {
  evaluate<R>(fn: () => R): Promise<R>;
  waitForFunction(fn: () => unknown): Promise<unknown>;
  readonly keyboard: { press(key: string): Promise<void> };
  getByRole(role: 'button', options: { name: string }): { click(): Promise<void> };
}

export const menuOpen = (page: MenuPage): Promise<boolean> =>
  page.evaluate(() => (window.__engine?.getStats().menu ?? null) !== null);

/** Opens the settings through the game menu: the gear, then the settings item. */
export async function openSettings(page: MenuPage, gearLabel: string): Promise<void> {
  await page.getByRole('button', { name: gearLabel }).click();
  await page.waitForFunction(() => (window.__engine?.getStats().menu ?? null) !== null);
  // The settings are the fourth item of the top list (party, items, map, settings, close).
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('KeyZ');
}

/** Closes the game menu with the menu button (Enter), back to the game. */
export async function closeGameMenu(page: MenuPage): Promise<void> {
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => (window.__engine?.getStats().menu ?? null) === null);
}
