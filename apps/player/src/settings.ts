import { ACTIONS, type ActionId, type GamepadInputId } from '@retro-action-engine/core';
import type { BindingOverrides, TouchLayoutOverride } from '@retro-action-engine/input';

/** Where the virtual pad is shown (docs/input-and-feel.md 9.4). */
export type TouchPadMode = 'auto' | 'show' | 'hide';

/** Motion smoothing: the feel profile's own, or the user's choice (docs/input-and-feel.md 8.5). */
export type InterpolationMode = 'profile' | 'linear' | 'none';

/** Debug display, used only in dev builds and PR previews (ADR-0008, revision M2-3). */
export interface DebugSettings {
  readonly hitboxes: boolean;
  readonly latency: boolean;
  readonly desynchronized: boolean;
}

/** `settings:global` (ADR-0011, revisions M2-2 and M2-3): what does not depend on the pack. */
export interface GlobalSettings {
  readonly settingsVersion: 1;
  readonly touchPad: TouchPadMode;
  readonly interpolation: InterpolationMode;
  readonly debug: DebugSettings;
}

/** The screen's orientation: the virtual pad keeps one layout for each (9.5). */
export type Orientation = 'landscape' | 'portrait';

/** The user's virtual pad layouts; `null` is the pack's own layout. */
export interface TouchLayouts {
  readonly landscape: TouchLayoutOverride | null;
  readonly portrait: TouchLayoutOverride | null;
}

/** `settings:<packId>`: the user's changes to one pack. */
export interface PackSettings {
  readonly settingsVersion: 1;
  readonly bindings: BindingOverrides;
  /** The chosen feel profile; `null` is the pack's default. */
  readonly feelProfile: string | null;
  /** The virtual pad, moved and resized by the user (docs/input-and-feel.md 9.5). */
  readonly touchLayouts: TouchLayouts;
}

export const DEFAULT_DEBUG: DebugSettings = {
  hitboxes: false,
  latency: false,
  desynchronized: false,
};
export const DEFAULT_GLOBAL: GlobalSettings = {
  settingsVersion: 1,
  touchPad: 'auto',
  interpolation: 'profile',
  debug: DEFAULT_DEBUG,
};
export const DEFAULT_TOUCH_LAYOUTS: TouchLayouts = { landscape: null, portrait: null };
export const DEFAULT_PACK: PackSettings = {
  settingsVersion: 1,
  bindings: {},
  feelProfile: null,
  touchLayouts: DEFAULT_TOUCH_LAYOUTS,
};

const GAMEPAD_INPUT =
  /^(button\d+|axis\d+[+-]|dpad(Up|Down|Left|Right)|leftStick(Up|Down|Left|Right))$/;

type Warn = (message: string) => void;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Reads `settings:global`; anything unreadable gives the defaults and a warning. */
export function parseGlobal(value: unknown, warn: Warn): GlobalSettings {
  if (value === undefined) return DEFAULT_GLOBAL;
  if (!isRecord(value) || value.settingsVersion !== 1) {
    warn('settings:global is not a version 1 settings object; using the defaults');
    return DEFAULT_GLOBAL;
  }
  // Each field on its own: one unreadable field does not reset the others.
  const pick = <T extends string>(field: string, allowed: readonly T[], fallback: T): T => {
    const v = value[field];
    if (v === undefined) return fallback;
    if ((allowed as readonly unknown[]).includes(v)) return v as T;
    warn(`settings:global ${field} "${String(v)}" is unknown; using "${fallback}"`);
    return fallback;
  };
  const debug = isRecord(value.debug) ? value.debug : {};
  const flag = (field: keyof DebugSettings) => debug[field] === true;
  return {
    settingsVersion: 1,
    touchPad: pick('touchPad', ['auto', 'show', 'hide'], DEFAULT_GLOBAL.touchPad),
    interpolation: pick(
      'interpolation',
      ['profile', 'linear', 'none'],
      DEFAULT_GLOBAL.interpolation,
    ),
    debug: {
      hitboxes: flag('hitboxes'),
      latency: flag('latency'),
      desynchronized: flag('desynchronized'),
    },
  };
}

/** Per-action lists of strings that pass `valid`; other entries are dropped with a warning. */
function actionLists<T extends string>(
  value: unknown,
  valid: (s: string) => boolean,
  where: string,
  warn: Warn,
): Partial<Record<ActionId, T[]>> {
  const out: Partial<Record<ActionId, T[]>> = {};
  if (!isRecord(value)) {
    if (value !== undefined) warn(`${where} is not an object; ignored`);
    return out;
  }
  for (const [action, list] of Object.entries(value)) {
    if (!(ACTIONS as readonly string[]).includes(action)) {
      warn(`${where}.${action} is not an action; ignored`);
      continue;
    }
    if (!Array.isArray(list) || !list.every((s) => typeof s === 'string' && valid(s))) {
      warn(`${where}.${action} is not a list of inputs; ignored`);
      continue;
    }
    out[action as ActionId] = [...new Set(list as T[])];
  }
  return out;
}

const isUnit = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const isRadius = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 0.5;

/**
 * One saved virtual pad layout, or `null` (the pack's). The pack schema's bounds hold; a layout
 * with anything out of place is dropped as a whole, with a warning, so that no half-moved pad is
 * shown.
 */
function parseTouchOverride(value: unknown, where: string, warn: Warn): TouchLayoutOverride | null {
  if (value === undefined || value === null) return null;
  const bad = (what: string) => {
    warn(`${where} ${what}; using the pack's layout`);
    return null;
  };
  if (!isRecord(value)) return bad('is not an object');
  const out: {
    handedness?: 'right' | 'left';
    opacity?: number;
    dpad?: { cx: number; cy: number; radius: number; floating: boolean };
    buttons?: Partial<Record<ActionId, { cx: number; cy: number; radius: number }>>;
  } = {};
  if (value.handedness !== undefined) {
    if (value.handedness !== 'right' && value.handedness !== 'left') {
      return bad('has an unknown handedness');
    }
    out.handedness = value.handedness;
  }
  if (value.opacity !== undefined) {
    if (!isUnit(value.opacity)) return bad('has an opacity outside 0..1');
    out.opacity = value.opacity;
  }
  if (value.dpad !== undefined) {
    const d = value.dpad;
    if (
      !isRecord(d) ||
      !isUnit(d.cx) ||
      !isUnit(d.cy) ||
      !isRadius(d.radius) ||
      typeof d.floating !== 'boolean'
    ) {
      return bad('has an unreadable d-pad');
    }
    out.dpad = { cx: d.cx, cy: d.cy, radius: d.radius, floating: d.floating };
  }
  if (value.buttons !== undefined) {
    if (!isRecord(value.buttons)) return bad('has unreadable buttons');
    const buttons: Partial<Record<ActionId, { cx: number; cy: number; radius: number }>> = {};
    for (const [action, b] of Object.entries(value.buttons)) {
      if (
        !(ACTIONS as readonly string[]).includes(action) ||
        !isRecord(b) ||
        !isUnit(b.cx) ||
        !isUnit(b.cy) ||
        !isRadius(b.radius)
      ) {
        return bad(`has an unreadable button "${action}"`);
      }
      buttons[action as ActionId] = { cx: b.cx, cy: b.cy, radius: b.radius };
    }
    out.buttons = buttons;
  }
  return out;
}

/** Reads `settings:<packId>`; anything unreadable is dropped with a warning. */
export function parsePack(value: unknown, warn: Warn): PackSettings {
  if (value === undefined) return DEFAULT_PACK;
  if (!isRecord(value) || value.settingsVersion !== 1) {
    warn('pack settings are not a version 1 settings object; using the pack defaults');
    return DEFAULT_PACK;
  }
  const bindings = isRecord(value.bindings) ? value.bindings : {};
  const keyboard = actionLists<string>(
    bindings.keyboard,
    (s) => s.length > 0,
    'bindings.keyboard',
    warn,
  );
  const gamepad: Record<string, Partial<Record<ActionId, GamepadInputId[]>>> = {};
  if (isRecord(bindings.gamepad)) {
    for (const [pad, lists] of Object.entries(bindings.gamepad)) {
      gamepad[pad] = actionLists<GamepadInputId>(
        lists,
        (s) => GAMEPAD_INPUT.test(s),
        `bindings.gamepad["${pad}"]`,
        warn,
      );
    }
  } else if (bindings.gamepad !== undefined) {
    warn('bindings.gamepad is not an object; ignored');
  }
  let feelProfile: string | null = null;
  if (typeof value.feelProfile === 'string' && value.feelProfile !== '') {
    feelProfile = value.feelProfile;
  } else if (value.feelProfile !== undefined && value.feelProfile !== null) {
    warn('feelProfile is not a profile name; using the pack default');
  }
  const layouts = isRecord(value.touchLayouts) ? value.touchLayouts : {};
  if (value.touchLayouts !== undefined && !isRecord(value.touchLayouts)) {
    warn('touchLayouts is not an object; using the pack layouts');
  }
  const touchLayouts: TouchLayouts = {
    landscape: parseTouchOverride(layouts.landscape, 'touchLayouts.landscape', warn),
    portrait: parseTouchOverride(layouts.portrait, 'touchLayouts.portrait', warn),
  };
  return { settingsVersion: 1, bindings: { keyboard, gamepad }, feelProfile, touchLayouts };
}

/** A key-value store for settings (IndexedDB, localStorage, or memory). */
export interface KeyValueStore {
  readonly kind: 'indexedDB' | 'localStorage' | 'memory';
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

/** Keeps values as JSON strings, like localStorage does. */
export function storageStore(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  kind: KeyValueStore['kind'] = 'localStorage',
): KeyValueStore {
  return {
    kind,
    async get(key) {
      const text = storage.getItem(key);
      if (text === null) return undefined;
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return null; // unreadable: parse* warns and uses the defaults
      }
    },
    async set(key, value) {
      storage.setItem(key, JSON.stringify(value));
    },
  };
}

export function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return storageStore(
    { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) },
    'memory',
  );
}

/**
 * The first store that works: IndexedDB (through `idb`), then localStorage, then memory (the
 * settings last until the page closes). `idb` is tried with a read, so a browser that blocks
 * IndexedDB (private modes) falls back.
 */
export async function openStore(options: {
  readonly idb?: () => KeyValueStore;
  readonly localStorage?: () => Pick<Storage, 'getItem' | 'setItem'>;
  readonly warn: Warn;
}): Promise<KeyValueStore> {
  if (options.idb !== undefined) {
    try {
      const store = options.idb();
      await store.get('settings:global');
      return store;
    } catch (error) {
      options.warn(`IndexedDB is not available (${String(error)}); trying localStorage`);
    }
  }
  if (options.localStorage !== undefined) {
    try {
      const storage = options.localStorage();
      const probe = 'settings:probe';
      storage.setItem(probe, '1');
      return storageStore(storage);
    } catch (error) {
      options.warn(`localStorage is not available (${String(error)}); settings are not kept`);
    }
  }
  return memoryStore();
}

/** Loads and saves the settings of one pack (ADR-0011). Saving is immediate. */
export class SettingsStore {
  constructor(
    private readonly store: KeyValueStore,
    private readonly packId: string,
    private readonly warn: Warn,
  ) {}

  get kind(): KeyValueStore['kind'] {
    return this.store.kind;
  }

  async load(): Promise<{ global: GlobalSettings; pack: PackSettings }> {
    const [global, pack] = await Promise.all([
      this.store.get('settings:global'),
      this.store.get(this.packKey()),
    ]);
    return { global: parseGlobal(global, this.warn), pack: parsePack(pack, this.warn) };
  }

  saveGlobal(settings: GlobalSettings): Promise<void> {
    return this.store.set('settings:global', settings);
  }

  savePack(settings: PackSettings): Promise<void> {
    return this.store.set(this.packKey(), settings);
  }

  private packKey(): string {
    return `settings:${this.packId}`;
  }
}

/** The interpolation to draw with: the user's choice, or the feel profile's own (8.5). */
export function effectiveInterpolation(
  mode: InterpolationMode,
  profile: 'linear' | 'none' | undefined,
): 'linear' | 'none' {
  return mode === 'profile' ? (profile ?? 'none') : mode;
}
