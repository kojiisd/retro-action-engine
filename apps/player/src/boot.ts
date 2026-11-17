import { GameSession, type StartState } from '@retro-action-engine/core';
import {
  ActionMap,
  type FocusTargets,
  GamepadDevice,
  type GamepadLike,
  InputBuffer,
  KeyboardDevice,
} from '@retro-action-engine/input';
import { type FetchLike, loadPack } from '@retro-action-engine/pack';
import { startRenderer } from '@retro-action-engine/renderer-phaser';
import { createEngineHooks, type EngineHooks } from './engine-hooks';

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
  const start: StartState = {
    ...runtime.entry,
    seed: NEW_GAME_SEED,
    feelProfile: runtime.feelDefault,
  };

  const buffer = new InputBuffer();
  const map = new ActionMap(runtime.input);
  const keyboard = new KeyboardDevice(map, buffer);
  const gamepad = new GamepadDevice(map, buffer, options.getGamepads);
  buffer.addSource(keyboard);
  buffer.addSource(gamepad);
  const detachKeys = keyboard.attach(options.focus);
  const detachFocus = buffer.attachFocusEvents(options.focus);

  const session = new GameSession(runtime, start, buffer);
  const hooks = createEngineHooks({
    session,
    feelProfiles: Object.keys(runtime.feel),
    resyncCount: () => buffer.resyncCount,
  });

  const stopRenderer = startRenderer(options.parent, {
    runtime,
    roomId: start.roomId,
    members: runtime.rules.party.members,
    frame: (deltaMs) => {
      // docs/input-and-feel.md 5.3: poll the pads first, then run the ticks.
      gamepad.poll();
      return session.frame(deltaMs);
    },
    interpolation: () => runtime.feel[session.startState.feelProfile]?.interpolation ?? 'none',
    ...(options.onReady === undefined ? {} : { onReady: options.onReady }),
  });

  return {
    hooks,
    stop: () => {
      stopRenderer();
      detachKeys();
      detachFocus();
    },
  };
}
