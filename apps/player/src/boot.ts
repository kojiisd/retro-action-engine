import { actionBit, GameSession, type StartState } from '@retro-action-engine/core';
import {
  ActionMap,
  type FocusTargets,
  GamepadDevice,
  type GamepadLike,
  InputBuffer,
  KeyboardDevice,
  mountTouchPad,
  TouchPadDevice,
} from '@retro-action-engine/input';
import { type FetchLike, loadPack } from '@retro-action-engine/pack';
import { startRenderer } from '@retro-action-engine/renderer-phaser';
import type { Binding } from './bindings-edit';
import { formatStats, LatencyMeter } from './debug';
import { createEngineHooks, type EngineHooks } from './engine-hooks';
import {
  effectiveInterpolation,
  type InterpolationMode,
  type KeyValueStore,
  type PackSettings,
  SettingsStore,
  type TouchPadMode,
} from './settings';
import { createGearButton, createSettingsPanel } from './settings-panel';
import { touchPadVisible } from './touch-visibility';
import type { UiStrings } from './ui-strings';

/** Seed of `World.rng` for a new game. Nothing in M1-5 draws from it yet. */
const NEW_GAME_SEED = 1;
const MENU = actionBit('menu');

export interface BootOptions {
  readonly parent: HTMLElement;
  /** Directory URL of the pack, ending with `/`. */
  readonly packUrl: string;
  readonly fetch: FetchLike;
  readonly focus: FocusTargets;
  readonly getGamepads: () => ArrayLike<GamepadLike | null>;
  /** Called once the first frame can be drawn. */
  readonly onReady?: () => void;
  /** Called once the pack is loaded, before anything is drawn, with its display size in px. */
  readonly onDisplay?: (display: { readonly width: number; readonly height: number }) => void;
  /** The virtual pad (docs/input-and-feel.md 9). */
  readonly touch: {
    /** Element the pad is drawn in, placed by the app's CSS inside the safe area. */
    readonly area: HTMLElement;
    readonly document: Document;
    /** `matchMedia('(pointer: coarse)').matches`, read every frame. */
    readonly coarsePointer: () => boolean;
    /** The pad was shown or hidden (the page lays the game screen out again). */
    readonly onVisibleChange: (visible: boolean) => void;
  };
  /** The settings screen (docs/input-and-feel.md 4.3) and where settings are kept (ADR-0011). */
  readonly settings: {
    readonly store: KeyValueStore;
    readonly strings: UiStrings;
    /** Where the gear button and the panel are added. */
    readonly container: HTMLElement;
    readonly buildInfo: string;
    readonly warn: (message: string) => void;
  };
  /** The debug display (dev builds and PR previews only; ADR-0008, revision M2-3). */
  readonly debug?: {
    /** The page clock in ms (`performance.now`), for the latency display. */
    readonly now: () => number;
  };
}

export interface Game {
  readonly hooks: EngineHooks;
  readonly stop: () => void;
}

/**
 * Wires a pack to the engine (docs/architecture.md 4.2): pack → GameSession ← InputBuffer ←
 * devices, the renderer that calls `frame` once per display frame, and the settings screen.
 * Only wiring lives here.
 */
export async function bootGame(options: BootOptions): Promise<Game> {
  const { runtime } = await loadPack(options.fetch, options.packUrl);
  options.onDisplay?.(runtime.display);

  const settingsStore = new SettingsStore(
    options.settings.store,
    runtime.id,
    options.settings.warn,
  );
  const saved = await settingsStore.load();
  let globalSettings = saved.global;
  let packSettings: PackSettings = saved.pack;
  const save = (what: Promise<void>) =>
    what.catch((error: unknown) =>
      options.settings.warn(`settings were not saved: ${String(error)}`),
    );
  // The saved feel profile, if the pack still has it (docs/input-and-feel.md 8.5).
  let feelProfile = runtime.feelDefault;
  if (packSettings.feelProfile !== null) {
    if (runtime.feel[packSettings.feelProfile] !== undefined)
      feelProfile = packSettings.feelProfile;
    else
      options.settings.warn(
        `feel profile "${packSettings.feelProfile}" is not in the pack; using the default`,
      );
  }
  const start: StartState = { ...runtime.entry, seed: NEW_GAME_SEED, feelProfile };
  const debug = options.debug;
  const meter = debug === undefined ? undefined : new LatencyMeter(debug.now);

  // `menu` opens and closes the settings: taken at the moment it is pressed (see frame below).
  let menuPressed = false;
  // After closing, the resync reports a still-held menu button as pressed again: ignore `menu`
  // until it has been let go.
  let menuLocked = false;
  const buffer = new InputBuffer({
    onPressed: (mask) => {
      if ((mask & MENU) !== 0) menuPressed = true;
      meter?.pressed();
    },
  });
  const map = new ActionMap(runtime.input, saved.pack.bindings);
  const keyboard = new KeyboardDevice(map, buffer);
  const gamepad = new GamepadDevice(map, buffer, options.getGamepads);
  const touch = new TouchPadDevice(buffer);
  buffer.addSource(keyboard);
  buffer.addSource(gamepad);
  buffer.addSource(touch);
  const detachKeys = keyboard.attach(options.focus);
  const detachFocus = buffer.attachFocusEvents(options.focus);

  const layout = runtime.input.touch.layouts[runtime.input.touch.layout];
  const pad =
    layout === undefined
      ? undefined
      : mountTouchPad(options.touch.area, touch, layout, {
          document: options.touch.document,
          focus: options.focus,
        });
  const updatePad = (canSwitch: boolean) => {
    if (pad === undefined) return;
    const visible = touchPadVisible({
      mode: globalSettings.touchPad,
      coarsePointer: options.touch.coarsePointer(),
      gamepadConnected: gamepad.connected,
    });
    if (visible !== pad.visible) {
      options.touch.onVisibleChange(visible);
      pad.setVisible(visible);
    }
    // The switch button only where the party can switch (UiState.canSwitch).
    pad.setActionEnabled('switch', canSwitch);
  };

  const session = new GameSession(runtime, start, buffer);
  const savePack = (next: PackSettings) => {
    packSettings = next;
    void save(settingsStore.savePack(packSettings));
  };

  // ---- settings screen: open with the gear or `menu`; the game stops while it is open ----
  const stopCapture = () => {
    keyboard.setCapture(undefined);
    gamepad.setCapture(undefined);
  };
  const panel = createSettingsPanel({
    document: options.touch.document,
    strings: options.settings.strings,
    map,
    buildInfo: options.settings.buildInfo,
    persistent: options.settings.store.kind !== 'memory',
    touchMode: () => globalSettings.touchPad,
    setTouchMode: (mode: TouchPadMode) => {
      globalSettings = { ...globalSettings, touchPad: mode };
      void save(settingsStore.saveGlobal(globalSettings));
    },
    bindingsChanged: () => savePack({ ...packSettings, bindings: map.overrides }),
    feelProfiles: Object.entries(runtime.feel).map(([id, p]) => ({ id, name: p.name })),
    feelProfile: () => session.startState.feelProfile,
    setFeelProfile: (id: string) => {
      if (runtime.feel[id] === undefined || id === session.startState.feelProfile) return;
      // A feel profile holds for a whole run: switching starts the room over.
      session.restart({ ...session.startState, feelProfile: id });
      savePack({ ...packSettings, feelProfile: id === runtime.feelDefault ? null : id });
    },
    interpolation: () => globalSettings.interpolation,
    setInterpolation: (mode: InterpolationMode) => {
      globalSettings = { ...globalSettings, interpolation: mode };
      void save(settingsStore.saveGlobal(globalSettings));
    },
    ...(debug === undefined
      ? {}
      : {
          debug: {
            get: () => globalSettings.debug,
            set: (next) => {
              globalSettings = { ...globalSettings, debug: next };
              void save(settingsStore.saveGlobal(globalSettings));
            },
          },
        }),
    capture: (done: (binding: Binding | undefined) => void) => {
      keyboard.setCapture((code) => {
        stopCapture();
        done(code === 'Escape' ? undefined : { device: 'keyboard', code });
      });
      gamepad.setCapture((padKey, input) => {
        stopCapture();
        done({ device: 'gamepad', pad: padKey, input });
      });
    },
    cancelCapture: stopCapture,
    requestClose: () => closeMenu(),
  });
  const openMenu = () => {
    if (panel.open) return;
    keyboard.setSuspended(true);
    touch.releaseAll();
    panel.show();
  };
  const closeMenu = () => {
    if (!panel.open) return;
    panel.hide();
    keyboard.setSuspended(false);
    // Start the game again from "everything released": nothing pressed in the menu goes on.
    menuLocked = true;
    buffer.focusLost();
  };
  const gear = createGearButton(options.touch.document, options.settings.strings, () =>
    panel.open ? closeMenu() : openMenu(),
  );
  options.settings.container.append(gear, panel.element);

  // Latency and frame stats (debug display), refreshed a few times a second.
  const overlay = options.touch.document.createElement('pre');
  overlay.className = 'debug-overlay';
  overlay.lang = 'en';
  overlay.hidden = true;
  if (meter !== undefined) options.settings.container.append(overlay);
  let overlayFrames = 0;
  const desynchronized = debug !== undefined && saved.global.debug.desynchronized;

  const hooks = createEngineHooks({
    session,
    feelProfiles: Object.keys(runtime.feel),
    resyncCount: () => buffer.resyncCount,
  });

  // Lay the page out for the pad before the renderer measures the game screen.
  updatePad(true);
  const stopRenderer = startRenderer(options.parent, {
    runtime,
    roomId: start.roomId,
    members: runtime.rules.party.members,
    frame: (deltaMs) => {
      // docs/input-and-feel.md 5.3: poll the pads first, then run the ticks.
      gamepad.poll();
      // `menu` opens the settings (any device) and closes them (gamepad: the keyboard is left to
      // the page while they are open, and Esc or the close button close them).
      if (menuLocked && (keyboard.held() | gamepad.held() | touch.held()) & MENU) {
        menuPressed = false;
      } else {
        menuLocked = false;
      }
      if (menuPressed) {
        menuPressed = false;
        if (panel.open) closeMenu();
        else openMenu();
      }
      // No time passes in the game while the settings are open.
      const view = session.frame(panel.open ? 0 : deltaMs);
      meter?.ticked(view.ticks);
      updatePad(view.ui.canSwitch);
      return view;
    },
    interpolation: () =>
      effectiveInterpolation(
        globalSettings.interpolation,
        runtime.feel[session.startState.feelProfile]?.interpolation,
      ),
    showColliders: () => debug !== undefined && globalSettings.debug.hitboxes,
    desynchronized,
    afterDraw: () => {
      if (meter === undefined) return;
      meter.drawn();
      const show = globalSettings.debug.latency;
      overlay.hidden = !show;
      if (show && overlayFrames++ % 10 === 0) {
        overlay.textContent = formatStats(meter.stats(), {
          droppedFrames: session.droppedFrames,
          resyncs: buffer.resyncCount,
          desynchronized,
        });
      }
    },
    ...(options.onReady === undefined ? {} : { onReady: options.onReady }),
  });

  return {
    hooks,
    stop: () => {
      stopRenderer();
      pad?.destroy();
      gear.remove();
      overlay.remove();
      panel.element.remove();
      detachKeys();
      detachFocus();
    },
  };
}
