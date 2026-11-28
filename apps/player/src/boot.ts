import {
  actionBit,
  actionMask,
  GameSession,
  type Notice,
  type StartState,
  switchToCommand,
} from '@retro-action-engine/core';
import {
  ActionMap,
  applyTouchOverride,
  type FocusTargets,
  GamepadDevice,
  type GamepadLike,
  InputBuffer,
  KeyboardDevice,
  mountTouchPad,
  TouchPadDevice,
  touchOverrideOf,
} from '@retro-action-engine/input';
import { type FetchLike, loadPack, pickLanguage } from '@retro-action-engine/pack';
import { type Scaling, startRenderer } from '@retro-action-engine/renderer-phaser';
import type { Binding } from './bindings-edit';
import { formatStats, LatencyMeter } from './debug';
import { createEngineHooks, type EngineHooks } from './engine-hooks';
import { HoldGate } from './hold-gate';
import {
  itemLook,
  type MenuButton,
  type MenuContext,
  type MenuState,
  menuStep,
  menuView,
  openMenu as openGameMenuState,
} from './menu';
import { menuStrings } from './menu-strings';
import {
  effectiveInterpolation,
  type InterpolationMode,
  type KeyValueStore,
  type Orientation,
  type PackSettings,
  SettingsStore,
  type TouchPadMode,
} from './settings';
import { createGearButton, createSettingsPanel } from './settings-panel';
import { NO_TOAST, type ToastState, toastsAfter, toastView } from './toast';
import { createTouchLayoutEditor, type TouchLayoutEditor } from './touch-layout-editor';
import { touchPadVisible } from './touch-visibility';
import type { UiStrings } from './ui-strings';

/** Seed of `World.rng` for a new game. Nothing in M1-5 draws from it yet. */
const NEW_GAME_SEED = 1;
const MENU = actionBit('menu');
/** The game menu's buttons (ADR-0020); one press with several bits applies them in this order. */
const MENU_BUTTONS: ReadonlyArray<readonly [MenuButton, number]> = [
  ['up', actionBit('up')],
  ['down', actionBit('down')],
  ['confirm', actionMask('confirm', 'jump')],
  ['cancel', actionMask('cancel', 'attack')],
];

export interface BootOptions {
  readonly parent: HTMLElement;
  /** Directory URL of the pack, ending with `/`. */
  readonly packUrl: string;
  readonly fetch: FetchLike;
  readonly focus: FocusTargets;
  readonly getGamepads: () => ArrayLike<GamepadLike | null>;
  /** Called once the first frame can be drawn. */
  readonly onReady?: () => void;
  /** How the game screen is scaled in the page (ADR-0010). Stretched to fit when absent. */
  readonly scaling?: Scaling;
  /** Called once the pack is loaded, before anything is drawn, with its display size in px. */
  readonly onDisplay?: (display: { readonly width: number; readonly height: number }) => void;
  /** The virtual pad (docs/input-and-feel.md 9). */
  readonly touch: {
    /** Element the pad is drawn in, placed by the app's CSS inside the safe area. */
    readonly area: HTMLElement;
    readonly document: Document;
    /** `matchMedia('(pointer: coarse)').matches`, read every frame. */
    readonly coarsePointer: () => boolean;
    /** `matchMedia('(orientation: portrait)').matches`, read every frame (9.5). */
    readonly portrait: () => boolean;
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
  // Writes still in flight; `settingsSaved` (test hook) waits for them.
  const pendingSaves = new Set<Promise<void>>();
  const save = (what: Promise<void>): Promise<void> => {
    const done: Promise<void> = what
      .catch((error: unknown) => options.settings.warn(`settings were not saved: ${String(error)}`))
      .finally(() => pendingSaves.delete(done));
    pendingSaves.add(done);
    return done;
  };
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

  // `menu` opens and closes the game menu (or, in a pack without one, the settings): taken at
  // the moment it is pressed (see frame below).
  let menuPressed = false;
  // The game menu (ADR-0020): open while not null; the presses since the last frame, in the
  // order they came (two presses can fall in one frame).
  let gameMenu: MenuState | null = null;
  let gameMenuPressed: number[] = [];
  // After closing, the resync reports a still-held menu button as pressed again: ignore `menu`
  // until it has been let go.
  let menuLocked = false;
  const buffer = new InputBuffer({
    onPressed: (mask) => {
      if ((mask & MENU) !== 0) menuPressed = true;
      if (gameMenu !== null) gameMenuPressed.push(mask);
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

  // The pack's pad layout, with the user's changes for the screen's orientation (9.5).
  const baseLayout = runtime.input.touch.layouts[runtime.input.touch.layout];
  const orientation = (): Orientation => (options.touch.portrait() ? 'portrait' : 'landscape');
  const layoutFor = (o: Orientation) =>
    baseLayout === undefined
      ? undefined
      : applyTouchOverride(baseLayout, packSettings.touchLayouts[o] ?? undefined);
  let padOrientation = orientation();
  const startLayout = layoutFor(padOrientation);
  const pad =
    startLayout === undefined
      ? undefined
      : mountTouchPad(options.touch.area, touch, startLayout, {
          document: options.touch.document,
          focus: options.focus,
        });
  // Created with the settings screen below; while it is open the pad is shown to be edited.
  let editor: TouchLayoutEditor | undefined;
  let lastCanSwitch = true;
  const updatePad = (canSwitch: boolean) => {
    if (pad === undefined) return;
    lastCanSwitch = canSwitch;
    const now = orientation();
    if (now !== padOrientation) {
      padOrientation = now;
      const next = layoutFor(now);
      if (next !== undefined) pad.setLayout(next);
      editor?.orientationChanged();
    }
    const visible =
      editor?.open === true ||
      touchPadVisible({
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

  // Buttons held as a menu closes wait until they are let go (ADR-0020).
  const heldNow = () => keyboard.held() | gamepad.held() | touch.held();
  const gate = new HoldGate(buffer, heldNow);
  const session = new GameSession(runtime, start, gate);
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
    ...(pad === undefined ? {} : { editTouchLayout: () => openEditor() }),
    feelProfiles: Object.entries(runtime.feel).map(([id, p]) => ({ id, name: p.name })),
    feelProfile: () => session.startState.feelProfile,
    setFeelProfile: (id: string) => {
      if (runtime.feel[id] === undefined || id === session.startState.feelProfile) return;
      // A feel profile holds for a whole run: switching starts over from where the party entered
      // the room it is in (ADR-0018).
      session.restart({ ...session.startState, ...session.roomEntrance, feelProfile: id });
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
    if (gameMenu === null) gate.block(heldNow());
  };
  // ---- the game menu (ADR-0020): the windows over the game; the settings open from it ----
  const ui = runtime.ui;
  const mStrings = menuStrings(options.settings.strings.lang);
  const language = pickLanguage(runtime, [options.settings.strings.lang]);
  const members = () => session.startState.party ?? runtime.rules.party.members;
  const menuContext = (): MenuContext => {
    const list = members();
    const state = session.uiState;
    return {
      members: list,
      activeIndex: Math.max(0, list.indexOf(state.activeCharacterId)),
      party: state.party,
      switchCheck: (i) => session.switchCheck(i),
      items: state.inventory,
      map: session.roomMap(),
    };
  };
  // ---- messages at the bottom of the screen (ADR-0021) ----
  let toasts: ToastState = NO_TOAST;
  const noticeText = (notice: Notice): string => {
    const name = itemLook(runtime, notice.itemId, language).name;
    return mStrings.got(notice.count > 1 ? `${name} x${notice.count}` : name);
  };
  const openGame = () => {
    if (gameMenu !== null) return;
    gameMenu = openGameMenuState(menuContext());
    gameMenuPressed = [];
  };
  const closeGame = () => {
    if (gameMenu === null) return;
    gameMenu = null;
    // Start the game again from "everything released", as after the settings.
    menuLocked = true;
    buffer.focusLost();
    gate.block(heldNow());
  };
  const runGameMenu = () => {
    if (gameMenu === null) return;
    const presses = gameMenuPressed;
    gameMenuPressed = [];
    for (const [button] of presses.flatMap((pressed) =>
      MENU_BUTTONS.filter(([, m]) => (pressed & m) !== 0),
    )) {
      if (gameMenu === null) break;
      const result = menuStep(gameMenu, button, menuContext());
      gameMenu = result.state;
      const effect = result.effect;
      if (effect?.kind === 'close') closeGame();
      else if (effect?.kind === 'openSettings') openMenu();
      else if (effect?.kind === 'switch') {
        // The switch happens on the first tick after the menu closes (ADR-0020).
        session.queueCommand(switchToCommand(effect.member));
        closeGame();
      }
    }
  };
  /** `menu` or the gear: the settings close back to the game menu, which closes the game's. */
  const toggleMenus = () => {
    if (editor?.open === true) closeEditor();
    else if (panel.open) closeMenu();
    else if (ui === undefined) openMenu();
    else if (gameMenu === null) openGame();
    else closeGame();
  };
  const gear = createGearButton(
    options.touch.document,
    options.settings.strings,
    toggleMenus,
    ui !== undefined,
  );
  options.settings.container.append(gear, panel.element);

  // ---- the pad layout editor, opened from the settings; the game stays stopped ----
  const backToSettings = () => {
    gear.hidden = false;
    panel.show();
  };
  if (pad !== undefined && baseLayout !== undefined) {
    editor = createTouchLayoutEditor({
      document: options.touch.document,
      strings: options.settings.strings,
      pad,
      base: baseLayout,
      orientation,
      layout: (o) => layoutFor(o) ?? baseLayout,
      save: (o, edited) =>
        savePack({
          ...packSettings,
          touchLayouts: {
            ...packSettings.touchLayouts,
            [o]: edited === null ? null : touchOverrideOf(edited),
          },
        }),
      done: backToSettings,
    });
    options.settings.container.append(editor.element);
  }
  const openEditor = () => {
    if (editor === undefined || editor.open) return;
    panel.hide();
    gear.hidden = true;
    editor.show();
    updatePad(lastCanSwitch);
  };
  const closeEditor = () => {
    if (editor?.open !== true) return;
    editor.hide();
    backToSettings();
  };

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
    settingsSaved: () => Promise.all([...pendingSaves]).then(() => undefined),
    menu: () => gameMenu,
    toast: () => toasts.current?.text ?? null,
  });

  // Lay the page out for the pad before the renderer measures the game screen.
  updatePad(true);
  // The gear sits at the top-right corner of the game screen (the HUD band), wherever the
  // screen is in the page: with integer scaling it is smaller than the window and centered.
  const win = options.touch.document.defaultView;
  const placeGear = () => {
    const canvas = options.parent.querySelector('canvas');
    if (canvas === null || win === null) return;
    const r = canvas.getBoundingClientRect();
    gear.style.top = `${Math.max(0, r.top) + 2}px`;
    gear.style.right = `${Math.max(0, win.innerWidth - r.right) + 4}px`;
  };
  win?.addEventListener('resize', placeGear);
  const canvasObserver =
    typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => placeGear());
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
        toggleMenus();
      } else if (!panel.open && editor?.open !== true) {
        runGameMenu();
      }
      gameMenuPressed = [];
      // No time passes in the game while a menu, the settings or the pad editor are open.
      const paused = panel.open || editor?.open === true || gameMenu !== null;
      const view = session.frame(paused ? 0 : deltaMs);
      // The message's time runs with the game's: not while a menu is open.
      toasts = toastsAfter(toasts, view.notices.map(noticeText), paused ? 0 : deltaMs);
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
    ...(options.scaling === undefined ? {} : { scaling: options.scaling }),
    ...(ui === undefined
      ? {}
      : {
          overlay: () => {
            const { width, height } = runtime.display;
            if (gameMenu !== null) {
              return menuView(gameMenu, menuContext(), {
                runtime,
                ui,
                strings: mStrings,
                language,
                width,
                height,
              });
            }
            const text = toasts.current?.text;
            return text === undefined ? null : toastView(text, ui, width, height);
          },
        }),
    onReady: () => {
      const canvas = options.parent.querySelector('canvas');
      if (canvas !== null) canvasObserver?.observe(canvas);
      placeGear();
      options.onReady?.();
    },
  });

  return {
    hooks,
    stop: () => {
      stopRenderer();
      pad?.destroy();
      win?.removeEventListener('resize', placeGear);
      canvasObserver?.disconnect();
      gear.remove();
      editor?.element.remove();
      overlay.remove();
      panel.element.remove();
      detachKeys();
      detachFocus();
    },
  };
}
