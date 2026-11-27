import type { LoadedRuntime } from '@retro-action-engine/pack';
import { textWidth } from '@retro-action-engine/pack';
import { beforeAll, describe, expect, it } from 'vitest';
import { MENU_STRINGS } from './menu-strings';
import { loadSamplePack } from './test-support';
import { NO_TOAST, TOAST_MS, toastsAfter, toastView } from './toast';

let runtime: LoadedRuntime;
beforeAll(async () => {
  runtime = await loadSamplePack();
});

describe('messages at the bottom of the screen (ADR-0021)', () => {
  it('shows one message for TOAST_MS of screen time, then the next', () => {
    let s = toastsAfter(NO_TOAST, ['a', 'b'], 0);
    expect(s.current).toEqual({ text: 'a', leftMs: TOAST_MS });
    s = toastsAfter(s, [], TOAST_MS - 1);
    expect(s.current?.text).toBe('a');
    s = toastsAfter(s, [], 1);
    expect(s.current).toEqual({ text: 'b', leftMs: TOAST_MS });
    s = toastsAfter(s, [], TOAST_MS);
    expect(s).toEqual(NO_TOAST);
  });

  it('does not move on while no time passes (a menu is open)', () => {
    let s = toastsAfter(NO_TOAST, ['a'], 0);
    for (let i = 0; i < 100; i++) s = toastsAfter(s, [], 0);
    expect(s.current).toEqual({ text: 'a', leftMs: TOAST_MS });
  });

  it('draws a window inside the screen, centered at the bottom', () => {
    const ui = runtime.ui;
    if (ui === undefined) throw new Error('the sample pack has no menu');
    const { width, height } = runtime.display;
    for (const lang of ['ja', 'en'] as const) {
      const text = MENU_STRINGS[lang].got('Pickaxe');
      const view = toastView(text, ui, width, height);
      expect(view.dim).toBe(0);
      const [frame] = view.rects;
      if (frame === undefined) throw new Error('no window');
      expect(frame.x).toBe((width - frame.w) >> 1);
      expect(frame.y + frame.h).toBeLessThanOrEqual(height);
      expect(frame.y).toBeGreaterThan(height / 2);
      const [t] = view.texts;
      expect(t?.text).toBe(text);
      expect((t?.x as number) + textWidth(ui.font, text)).toBeLessThanOrEqual(frame.x + frame.w);
    }
  });
});
