import { GameSession, type StartState } from '@retro-action-engine/core';
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
import { createEngineHooks, type EngineHooks } from './engine-hooks';
import { touchPadVisible } from './touch-visibility';

/** Seed of `World.rng` for a new game. Nothing in M1-5 draws from it yet. */
const NEW_GAME_SEED = 1;

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
}

export interface Game {
  readonly hooks: EngineHooks;
  readonly stop: () => void;
}

/**
 * Wires a pack to the engine (docs/architecture.md 4.2): pack → GameSession ← InputBuffer ←
 * devices, and the renderer that calls `frame` once per display frame. Only wiring lives here.
 */
export async function bootGame(options: BootOptions): Promise<Game> {
  const { runtime } = await loadPack(options.fetch, options.packUrl);
  options.onDisplay?.(runtime.display);
  const start: StartState = {
    ...runtime.entry,
    seed: NEW_GAME_SEED,
    feelProfile: runtime.feelDefault,
  };

  const buffer = new InputBuffer();
  const map = new ActionMap(runtime.input);
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
      const view = session.frame(deltaMs);
      updatePad(view.ui.canSwitch);
      return view;
    },
    interpolation: () => runtime.feel[session.startState.feelProfile]?.interpolation ?? 'none',
    ...(options.onReady === undefined ? {} : { onReady: options.onReady }),
  });

  return {
    hooks,
    stop: () => {
      stopRenderer();
      pad?.destroy();
      detachKeys();
      detachFocus();
    },
  };
}
