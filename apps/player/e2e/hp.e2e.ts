import { expect, type Page, test } from '@playwright/test';
import {
  createWorld,
  Recorder,
  runReplayHeadless,
  type StartState,
  script,
  step,
} from '@retro-action-engine/core';
import type { ReplayResult } from '../src/engine-hooks';
import { loadSamplePack } from '../src/test-support';
import { decodePng } from './png';

// HP in the browser (M2-5, ADR-0016): the explorer stays in the water until its HP runs out,
// the diver takes over in place, the HUD cells show it, and the hashes still match Node.

/** The HP cell colors of the renderer (renderer-phaser game.ts). */
const FULL = [0xff, 0x6b, 0x6b] as const;

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

/** Pixels of the canvas close to `rgb` (the canvas is scaled with whole pixels). */
async function countColor(page: Page, rgb: readonly [number, number, number]): Promise<number> {
  const { rgba } = decodePng(await page.locator('canvas').screenshot());
  let count = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (
      Math.abs((rgba[i] as number) - rgb[0]) <= 2 &&
      Math.abs((rgba[i + 1] as number) - rgb[1]) <= 2 &&
      Math.abs((rgba[i + 2] as number) - rgb[2]) <= 2
    ) {
      count++;
    }
  }
  return count;
}

/**
 * Walks right (jumping over the step) until the body is in the water, then waits there until
 * the explorer's HP is gone and a little more. Built against the Node simulation, so it follows
 * the pack's data rather than fixed tile positions.
 */
async function drownReplay() {
  const runtime = await loadSamplePack();
  const entry = runtime.entry as { roomId: string; spawnId: string };
  const start: StartState = { ...entry, seed: 1, feelProfile: 'retro' };
  const world = createWorld(runtime, start);
  const walk = (ticks: number) => {
    const s = script().hold('right', ticks);
    for (let at = 0; at < ticks; at += 32) s.press('jump', { at, ticks: 12 });
    return s.build(ticks);
  };
  let inWater = 0;
  for (const frame of walk(600)) {
    step(world, frame, runtime);
    inWater++;
    if (world.party.hazardId !== '') break;
  }
  const hazard = runtime.rules.hazards?.[world.party.hazardId];
  const hp = runtime.characters.explorer?.hp?.max ?? 0;
  if (hazard === undefined || hp === 0) throw new Error('the explorer did not reach the water');
  const recorder = new Recorder();
  for (const frame of [...walk(inWater), ...script().build(hazard.intervalTicks * (hp + 1))]) {
    recorder.push(frame);
  }
  const file = recorder.toFile(runtime, start);
  const node = runReplayHeadless(file, runtime);
  return { file, node, runtime };
}

test('the explorer runs out of HP in the water and the diver takes over', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = await open(page);
  const { file, node, runtime } = await drownReplay();
  const fullBefore = await countColor(page, FULL);
  // Every member starts with all its cells full.
  const cells = runtime.rules.party.members.reduce(
    (sum, id) => sum + (runtime.characters[id]?.hp?.max ?? 0),
    0,
  );
  expect(fullBefore).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__engine?.getStats().party)).toEqual(
    runtime.rules.party.members.map((id) => ({
      id,
      hp: runtime.characters[id]?.hp?.max,
      hpMax: runtime.characters[id]?.hp?.max,
      alive: true,
    })),
  );

  const result = (await page.evaluate(
    (replay) => window.__engine?.runReplay(replay as never),
    file,
  )) as ReplayResult;
  // The same end as Node, through the damage and the switch.
  expect(result.final.tick).toBe(node.world.tick);
  expect([...result.final.hash]).toEqual([...node.hash]);

  const stats = await page.evaluate(() => window.__engine?.getStats());
  expect(stats?.activeCharacter).toBe('diver');
  expect(stats?.party[0]).toMatchObject({ id: 'explorer', hp: 0, alive: false });
  expect(stats?.party[1]?.alive).toBe(true);
  // The HUD shows fewer full cells: all of the explorer's are gone (each cell is a few pixels).
  const fullAfter = await countColor(page, FULL);
  expect(fullAfter).toBeLessThan(fullBefore);
  const perCell = fullBefore / cells;
  const lostCells = cells - (stats?.party ?? []).reduce((sum, m) => sum + m.hp, 0);
  expect(fullAfter).toBeCloseTo(fullBefore - lostCells * perCell, -1);
  expect(errors).toEqual([]);
});
