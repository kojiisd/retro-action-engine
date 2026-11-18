import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GLOBAL,
  DEFAULT_PACK,
  type KeyValueStore,
  memoryStore,
  openStore,
  type PackSettings,
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
};

describe('SettingsStore', () => {
  it('starts from the defaults when nothing is saved', async () => {
    const settings = new SettingsStore(memoryStore(), 'sample', () => {});
    expect(await settings.load()).toEqual({ global: DEFAULT_GLOBAL, pack: DEFAULT_PACK });
  });

  it('round-trips global and pack settings, per pack id', async () => {
    const store = memoryStore();
    const a = new SettingsStore(store, 'sample', () => {});
    await a.saveGlobal({ settingsVersion: 1, touchPad: 'hide' });
    await a.savePack(PACK);
    expect(await new SettingsStore(store, 'sample', () => {}).load()).toEqual({
      global: { settingsVersion: 1, touchPad: 'hide' },
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
