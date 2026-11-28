import type { SwitchCheck, UiMember } from '@retro-action-engine/core';
import type { LoadedRuntime } from '@retro-action-engine/pack';
import { localize, textWidth } from '@retro-action-engine/pack';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  itemLook,
  type MenuContext,
  type MenuState,
  menuStep,
  menuView,
  openMenu,
  TOP_ITEMS,
} from './menu';
import { MENU_STRINGS } from './menu-strings';
import { loadSamplePack } from './test-support';

let runtime: LoadedRuntime;
beforeAll(async () => {
  runtime = await loadSamplePack();
});

const party = (hp: readonly number[]): UiMember[] =>
  hp.map((h, i) => ({ id: `m${i}`, hp: h, hpMax: 120, alive: h > 0 }));

function context(
  checks: readonly SwitchCheck[],
  activeIndex = 0,
  items: MenuContext['items'] = [],
  map: MenuContext['map'] = MAP,
): MenuContext {
  return {
    members: runtime.rules.party.members,
    activeIndex,
    party: party([120, 84]),
    switchCheck: (i) => checks[i] ?? 'never',
    items,
    map,
  };
}

/** A room five screens wide and three high, as the sample hub; fictional visits. */
const MAP: MenuContext['map'] = {
  roomId: 'hub',
  cols: 5,
  rows: 3,
  visited: [10, 11, 12],
  revealed: false,
  here: 11,
  exits: [12, 14],
};

const walk = (state: MenuState, ctx: MenuContext, buttons: Parameters<typeof menuStep>[1][]) => {
  let s = state;
  const effects = [];
  for (const b of buttons) {
    const r = menuStep(s, b, ctx);
    s = r.state;
    if (r.effect !== undefined) effects.push(r.effect);
  }
  return { state: s, effects };
};

describe('game menu (ADR-0020)', () => {
  it('moves up and down the top list, round the ends', () => {
    const ctx = context(['active', 'ok']);
    const start = openMenu(ctx);
    expect(start).toEqual({ level: 'top', top: 0, member: 0 });
    expect(walk(start, ctx, ['up']).state.top).toBe(TOP_ITEMS.length - 1);
    expect(
      walk(
        start,
        ctx,
        TOP_ITEMS.map(() => 'down'),
      ).state.top,
    ).toBe(0);
  });

  it('closes with cancel at the top, with menu anywhere, and with the close item', () => {
    const ctx = context(['active', 'ok']);
    const start = openMenu(ctx);
    expect(walk(start, ctx, ['cancel']).effects).toEqual([{ kind: 'close' }]);
    expect(walk(start, ctx, ['confirm', 'menu']).effects).toEqual([{ kind: 'close' }]);
    const close = TOP_ITEMS.indexOf('close');
    expect(walk({ ...start, top: close }, ctx, ['confirm']).effects).toEqual([{ kind: 'close' }]);
    const settings = TOP_ITEMS.indexOf('settings');
    expect(walk({ ...start, top: settings }, ctx, ['confirm']).effects).toEqual([
      { kind: 'openSettings' },
    ]);
  });

  it('switches to a member who can take over, and only to one', () => {
    const ctx = context(['active', 'ok']);
    const inParty = walk(openMenu(ctx), ctx, ['confirm']).state;
    expect(inParty).toMatchObject({ level: 'party', member: 0 });
    // The active member: nothing happens.
    expect(walk(inParty, ctx, ['confirm']).effects).toEqual([]);
    expect(walk(inParty, ctx, ['down', 'confirm']).effects).toEqual([
      { kind: 'switch', member: 1 },
    ]);
    // Cannot switch now: nothing happens, the help line says why.
    for (const check of ['airborne', 'cooldown', 'down', 'never'] as const) {
      const blocked = context(['active', check]);
      expect(walk(inParty, blocked, ['down', 'confirm']).effects).toEqual([]);
    }
    // Cancel goes back to the top list.
    expect(walk(inParty, ctx, ['cancel']).state.level).toBe('top');
  });

  it('draws within the screen, names and HP included, with the help line of the choice', () => {
    const ui = runtime.ui;
    if (ui === undefined) throw new Error('the sample pack has no menu');
    const { width, height } = runtime.display;
    for (const lang of ['ja', 'en'] as const) {
      const strings = MENU_STRINGS[lang];
      for (const check of ['ok', 'active', 'down', 'never', 'airborne', 'cooldown'] as const) {
        const ctx = context(['active', check]);
        const state: MenuState = { level: 'party', top: 0, member: 1 };
        const view = menuView(state, ctx, { runtime, ui, strings, language: lang, width, height });
        for (const r of view.rects) {
          expect(r.x >= 0 && r.y >= 0 && r.x + r.w <= width && r.y + r.h <= height).toBe(true);
        }
        for (const t of view.texts) {
          expect(t.x + textWidth(ui.font, t.text), t.text).toBeLessThanOrEqual(width);
          expect(t.y + ui.font.cellH).toBeLessThanOrEqual(height);
        }
        const shown = view.texts.map((t) => t.text);
        expect(shown).toContain(strings.switch[check]);
        for (const id of runtime.rules.party.members) {
          expect(shown).toContain(localize(runtime, runtime.characters[id]?.name as string, lang));
        }
        expect(shown).toContain('84/120');
        expect(view.sprites).toHaveLength(runtime.rules.party.members.length);
      }
    }
  });

  it('has every character of its text and of the names in the sample pack font', () => {
    const glyphs = new Set(runtime.ui?.font.glyphs.map(([ch]) => ch));
    const texts: string[] = [];
    const collect = (v: unknown): void => {
      if (typeof v === 'string') texts.push(v);
      else if (v !== null && typeof v === 'object') Object.values(v).forEach(collect);
    };
    collect(MENU_STRINGS);
    for (const lang of Object.keys(runtime.strings ?? {})) {
      for (const id of runtime.rules.party.members) {
        texts.push(localize(runtime, runtime.characters[id]?.name as string, lang));
      }
      // The items, in the menu and in the message when one is picked up (ADR-0021).
      for (const id of Object.keys(runtime.items ?? {})) {
        const name = itemLook(runtime, id, lang).name;
        texts.push(name, MENU_STRINGS[lang as 'ja' | 'en'].got(name));
      }
    }
    texts.push('0123456789/x');
    const missing = [...new Set(texts.join(''))].filter((ch) => !glyphs.has(ch));
    expect(missing).toEqual([]);
  });

  it('shows the items held while its line is chosen, and does nothing on confirm (ADR-0021)', () => {
    const ui = runtime.ui;
    if (ui === undefined) throw new Error('the sample pack has no menu');
    const { width, height } = runtime.display;
    const itemsLine = TOP_ITEMS.indexOf('items');
    const state: MenuState = { level: 'top', top: itemsLine, member: 0 };
    const ids = Object.keys(runtime.items ?? {});
    expect(ids.length).toBeGreaterThan(0);
    for (const lang of ['ja', 'en'] as const) {
      const strings = MENU_STRINGS[lang];
      const look = { runtime, ui, strings, language: lang, width, height };
      // Nothing held.
      const empty = menuView(state, context(['active', 'ok']), look);
      const emptyTexts = empty.texts.map((t) => t.text);
      expect(emptyTexts).toContain(strings.noItems);
      expect(emptyTexts).toContain(strings.help.items);
      expect(empty.sprites).toEqual([]);
      // Held: the picture and the name, and the count when more than one.
      const held = ids.map((id, i) => ({ id, count: i + 2 }));
      const view = menuView(state, context(['active', 'ok'], 0, held), look);
      const texts = view.texts.map((t) => t.text);
      for (const { id, count } of held) {
        expect(texts).toContain(itemLook(runtime, id, lang).name);
        expect(texts).toContain(`x${count}`);
      }
      expect(texts).not.toContain(strings.noItems);
      expect(view.sprites.map((s) => s.frame)).toEqual(
        ids.map((id) => runtime.items?.[id]?.sprite?.frame),
      );
      for (const r of view.rects) {
        expect(r.x >= 0 && r.y >= 0 && r.x + r.w <= width && r.y + r.h <= height).toBe(true);
      }
      for (const t of view.texts) {
        expect(t.x + textWidth(ui.font, t.text), t.text).toBeLessThanOrEqual(width);
      }
      const one = menuView(
        state,
        context(['active', 'ok'], 0, [{ id: ids[0] as string, count: 1 }]),
        look,
      );
      expect(one.texts.map((t) => t.text)).not.toContain('x1');
    }
    const ctx = context(['active', 'ok']);
    expect(walk(state, ctx, ['confirm'])).toEqual({ state, effects: [] });
  });

  it('draws the map of the room while its line is chosen (ADR-0020, M3-6b)', () => {
    const ui = runtime.ui;
    if (ui === undefined || ui.colors.map === undefined) throw new Error('no map colors');
    const colors = ui.colors.map;
    const { width, height } = runtime.display;
    const state: MenuState = { level: 'top', top: TOP_ITEMS.indexOf('map'), member: 0 };
    const look = { runtime, ui, strings: MENU_STRINGS.ja, language: 'ja', width, height };
    const cells = (map: MenuContext['map']) => {
      const view = menuView(state, context(['active', 'ok'], 0, [], map), look);
      expect(view.texts.map((t) => t.text)).toContain(MENU_STRINGS.ja.help.map);
      for (const r of view.rects) {
        expect(r.x >= 0 && r.y >= 0 && r.x + r.w <= width && r.y + r.h <= height).toBe(true);
      }
      return view.rects.filter((r) => r.color === colors.visited || r.color === colors.revealed);
    };
    // Only the screens visited, all the same size, twice as wide as high.
    const visited = cells(MAP);
    expect(visited).toHaveLength(MAP.visited.length);
    expect(visited.every((r) => r.color === colors.visited)).toBe(true);
    const [first] = visited;
    expect(visited.every((r) => r.w === first?.w && r.h === first?.h)).toBe(true);
    expect(((first?.w as number) + 1) / ((first?.h as number) + 1)).toBe(2);
    // The mark of where the party is, and exit marks only on screens that show (12, not 14).
    const view = menuView(state, context(['active', 'ok'], 0, [], MAP), look);
    expect(view.rects.filter((r) => r.color === colors.here)).toHaveLength(1);
    expect(view.rects.filter((r) => r.color === colors.exit && r.w === 2)).toHaveLength(1);
    // Revealed: every screen shows, the ones not visited in the dimmer color.
    const all = cells({ ...MAP, revealed: true });
    expect(all).toHaveLength(MAP.cols * MAP.rows);
    expect(all.filter((r) => r.color === colors.revealed)).toHaveLength(
      MAP.cols * MAP.rows - MAP.visited.length,
    );
    // A one-screen room fits too, no larger than the cap.
    const one = cells({ ...MAP, cols: 1, rows: 1, visited: [0], here: 0, exits: [] });
    expect(one).toHaveLength(1);
    expect((one[0]?.w as number) + 1).toBeLessThanOrEqual(32);
    // Confirm does nothing there.
    expect(walk(state, context(['active', 'ok']), ['confirm'])).toEqual({ state, effects: [] });
  });
});
