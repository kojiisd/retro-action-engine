import type { SwitchCheck, UiMember } from '@retro-action-engine/core';
import type { LoadedRuntime } from '@retro-action-engine/pack';
import { localize, textWidth } from '@retro-action-engine/pack';
import { beforeAll, describe, expect, it } from 'vitest';
import { type MenuContext, type MenuState, menuStep, menuView, openMenu, TOP_ITEMS } from './menu';
import { MENU_STRINGS } from './menu-strings';
import { loadSamplePack } from './test-support';

let runtime: LoadedRuntime;
beforeAll(async () => {
  runtime = await loadSamplePack();
});

const party = (hp: readonly number[]): UiMember[] =>
  hp.map((h, i) => ({ id: `m${i}`, hp: h, hpMax: 120, alive: h > 0 }));

function context(checks: readonly SwitchCheck[], activeIndex = 0): MenuContext {
  return {
    members: runtime.rules.party.members,
    activeIndex,
    party: party([120, 84]),
    switchCheck: (i) => checks[i] ?? 'never',
  };
}

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
    expect(walk(start, ctx, ['down', 'down', 'down']).state.top).toBe(0);
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
    }
    texts.push('0123456789/');
    const missing = [...new Set(texts.join(''))].filter((ch) => !glyphs.has(ch));
    expect(missing).toEqual([]);
  });
});
