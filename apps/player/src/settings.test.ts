import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GLOBAL,
  DEFAULT_PACK,
  effectiveInterpolation,
  type KeyValueStore,
  memoryStore,
  openStore,
  type PackSettings,
  parseGlobal,
  parsePack,
  SettingsStore,
  storageStore,
} from './settings';

/** A stand-in for window.localStorage. */
function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

const PACK: PackSettings = {
  settingsVersion: 1,
  bindings: {
    keyboard: { jump: ['KeyX', 'Space'], left: [] },
    gamepad: { standard: { jump: ['button1'] }, 'Retro pad (Vendor: 1234)': { left: ['axis6-'] } },
  },
  feelProfile: 'retro',
  // The virtual pad moved and resized in landscape only (docs/input-and-feel.md 9.5).
  touchLayouts: {
    landscape: {
      handedness: 'left',
      opacity: 0.35,
      dpad: { cx: 0.2, cy: 0.75, radius: 0.3, floating: true },
      buttons: {
        jump: { cx: 0.88, cy: 0.6, radius: 0.15 },
        switch: { cx: 0.7, cy: 0.8, radius: 0.08 },
      },
    },
    portrait: null,
  },
};

describe('SettingsStore', () => {
  it('starts from the defaults when nothing is saved', async () => {
    const settings = new SettingsStore(memoryStore(), 'sample', () => {});
    expect(await settings.load()).toEqual({ global: DEFAULT_GLOBAL, pack: DEFAULT_PACK });
  });

  it('round-trips global and pack settings, per pack id', async () => {
    const store = memoryStore();
    const a = new SettingsStore(store, 'sample', () => {});
    const global = {
      settingsVersion: 1 as const,
      touchPad: 'hide' as const,
      interpolation: 'none' as const,
      debug: { hitboxes: true, latency: false, desynchronized: true },
    };
    await a.saveGlobal(global);
    await a.savePack(PACK);
    expect(await new SettingsStore(store, 'sample', () => {}).load()).toEqual({
      global,
      pack: PACK,
    });
    // Another pack shares the global settings only.
    expect((await new SettingsStore(store, 'other', () => {}).load()).pack).toEqual(DEFAULT_PACK);
  });

  it('keeps the values in localStorage as JSON under settings:<key>', async () => {
    const storage = fakeStorage();
    const settings = new SettingsStore(storageStore(storage), 'sample', () => {});
    await settings.savePack(PACK);
    expect(JSON.parse(storage.data.get('settings:sample') as string)).toEqual(PACK);
    expect((await settings.load()).pack).toEqual(PACK);
  });

  it('uses the defaults, with a warning, for broken or other-version values', async () => {
    const warnings: string[] = [];
    const storage = fakeStorage({
      'settings:global': '{ not json',
      'settings:sample': JSON.stringify({ settingsVersion: 2, bindings: {} }),
    });
    const settings = new SettingsStore(storageStore(storage), 'sample', (w) => warnings.push(w));
    expect(await settings.load()).toEqual({ global: DEFAULT_GLOBAL, pack: DEFAULT_PACK });
    expect(warnings).toHaveLength(2);
    // Nothing is overwritten until the user changes something.
    expect(storage.data.get('settings:global')).toBe('{ not json');
  });
});

describe('parsePack', () => {
  it('drops entries that are not actions or inputs, keeps the rest', () => {
    const warnings: string[] = [];
    const parsed = parsePack(
      {
        settingsVersion: 1,
        bindings: {
          keyboard: { jump: ['KeyX', 'KeyX'], dash: ['KeyD'], left: 'ArrowLeft' },
          gamepad: { standard: { jump: ['button1', 'trigger'] }, other: 3 },
        },
      },
      (w) => warnings.push(w),
    );
    expect(parsed.bindings).toEqual({
      keyboard: { jump: ['KeyX'] },
      gamepad: { standard: {}, other: {} },
    });
    expect(warnings).toEqual([
      'bindings.keyboard.dash is not an action; ignored',
      'bindings.keyboard.left is not a list of inputs; ignored',
      'bindings.gamepad["standard"].jump is not a list of inputs; ignored',
      'bindings.gamepad["other"] is not an object; ignored',
    ]);
  });
});

describe('parseGlobal', () => {
  it('reads each field on its own, so one bad field keeps the others', () => {
    const warnings: string[] = [];
    const parsed = parseGlobal(
      {
        settingsVersion: 1,
        touchPad: 'sideways',
        interpolation: 'linear',
        debug: { hitboxes: true, latency: 'yes' },
      },
      (w) => warnings.push(w),
    );
    expect(parsed).toEqual({
      settingsVersion: 1,
      touchPad: 'auto',
      interpolation: 'linear',
      debug: { hitboxes: true, latency: false, desynchronized: false },
    });
    expect(warnings).toEqual(['settings:global touchPad "sideways" is unknown; using "auto"']);
  });

  it('fills fields added later (M2-3) from the defaults, without a warning', () => {
    const warnings: string[] = [];
    expect(parseGlobal({ settingsVersion: 1, touchPad: 'show' }, (w) => warnings.push(w))).toEqual({
      ...DEFAULT_GLOBAL,
      touchPad: 'show',
    });
    expect(warnings).toEqual([]);
  });
});

describe('parsePack feelProfile', () => {
  it('keeps a profile name, and drops anything else with a warning', () => {
    const warnings: string[] = [];
    expect(parsePack({ settingsVersion: 1, feelProfile: 'retro' }, () => {}).feelProfile).toBe(
      'retro',
    );
    expect(
      parsePack({ settingsVersion: 1, feelProfile: 3 }, (w) => warnings.push(w)).feelProfile,
    ).toBeNull();
    expect(parsePack({ settingsVersion: 1 }, (w) => warnings.push(w)).feelProfile).toBeNull();
    expect(warnings).toHaveLength(1);
  });
});

describe('parsePack touchLayouts', () => {
  const layout = PACK.touchLayouts.landscape;

  it('keeps one layout per orientation', () => {
    const warnings: string[] = [];
    const parsed = parsePack(
      { settingsVersion: 1, touchLayouts: { landscape: null, portrait: layout } },
      (w) => warnings.push(w),
    );
    expect(parsed.touchLayouts).toEqual({ landscape: null, portrait: layout });
    expect(warnings).toEqual([]);
    // Settings saved before M2-4 have none.
    expect(parsePack({ settingsVersion: 1 }, () => {}).touchLayouts).toEqual({
      landscape: null,
      portrait: null,
    });
  });

  it.each([
    ['a ratio outside 0..1', { dpad: { cx: 1.5, cy: 0.5, radius: 0.2, floating: false } }],
    ['a radius of 0', { buttons: { jump: { cx: 0.5, cy: 0.5, radius: 0 } } }],
    ['an unknown action', { buttons: { fly: { cx: 0.5, cy: 0.5, radius: 0.1 } } }],
    ['an unknown handedness', { handedness: 'both' }],
    ['an opacity of 2', { opacity: 2 }],
    ['a d-pad without floating', { dpad: { cx: 0.5, cy: 0.5, radius: 0.2 } }],
    ['not an object', 'left'],
  ])('drops a whole layout with %s, with a warning', (_, broken) => {
    const warnings: string[] = [];
    const parsed = parsePack(
      { settingsVersion: 1, touchLayouts: { landscape: broken, portrait: layout } },
      (w) => warnings.push(w),
    );
    // The other orientation is kept.
    expect(parsed.touchLayouts).toEqual({ landscape: null, portrait: layout });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^touchLayouts\.landscape /);
  });
});

describe('openStore', () => {
  const working = (kind: KeyValueStore['kind']): KeyValueStore => ({
    kind,
    get: async () => undefined,
    set: async () => {},
  });

  it('prefers IndexedDB', async () => {
    const store = await openStore({
      idb: () => working('indexedDB'),
      localStorage: fakeStorage,
      warn: () => {},
    });
    expect(store.kind).toBe('indexedDB');
  });

  it('falls back to localStorage when IndexedDB fails, then to memory', async () => {
    const warnings: string[] = [];
    const broken: KeyValueStore = {
      kind: 'indexedDB',
      get: () => Promise.reject(new Error('blocked')),
      set: async () => {},
    };
    const store = await openStore({
      idb: () => broken,
      localStorage: fakeStorage,
      warn: (w) => warnings.push(w),
    });
    expect(store.kind).toBe('localStorage');
    const none = await openStore({
      idb: () => broken,
      localStorage: () => {
        throw new Error('denied');
      },
      warn: (w) => warnings.push(w),
    });
    expect(none.kind).toBe('memory');
    expect(warnings).toHaveLength(3);
  });
});

describe('effectiveInterpolation', () => {
  it("follows the profile unless the user chose, and the user's choice wins", () => {
    expect(effectiveInterpolation('profile', 'linear')).toBe('linear');
    expect(effectiveInterpolation('profile', 'none')).toBe('none');
    expect(effectiveInterpolation('profile', undefined)).toBe('none');
    expect(effectiveInterpolation('none', 'linear')).toBe('none');
    expect(effectiveInterpolation('linear', 'none')).toBe('linear');
  });
});
