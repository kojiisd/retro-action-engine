import type { UiDef } from '@retro-action-engine/core';
import { textWidth } from '@retro-action-engine/pack';
import type { OverlayView } from '@retro-action-engine/renderer-phaser';

/**
 * Messages at the bottom of the game screen, such as "got an item" (ADR-0021): one at a time,
 * each for a while of screen time that runs only while the game runs (not while a menu is open).
 * Pure: the wiring (boot.ts) adds the messages and the time.
 */

/** How long a message stays, in ms of screen time (the owner's "about two seconds"). */
export const TOAST_MS = 2000;

export interface ToastState {
  readonly current: { readonly text: string; readonly leftMs: number } | null;
  /** Messages waiting for the current one to go. */
  readonly queue: readonly string[];
}

export const NO_TOAST: ToastState = { current: null, queue: [] };

/** Adds `texts` after what is waiting, then lets `elapsedMs` of screen time pass. */
export function toastsAfter(
  state: ToastState,
  texts: readonly string[],
  elapsedMs: number,
): ToastState {
  let current = state.current;
  let queue = texts.length === 0 ? state.queue : [...state.queue, ...texts];
  if (current !== null && elapsedMs > 0) {
    const leftMs = current.leftMs - elapsedMs;
    current = leftMs > 0 ? { text: current.text, leftMs } : null;
  }
  if (current === null && queue.length > 0) {
    current = { text: queue[0] as string, leftMs: TOAST_MS };
    queue = queue.slice(1);
  }
  return { current, queue };
}

/** The message's window: centered at the bottom of a `width` x `height` display. */
export function toastView(text: string, ui: UiDef, width: number, height: number): OverlayView {
  const { font, colors } = ui;
  const pad = 4;
  const margin = 6;
  const w = textWidth(font, text) + pad * 2 + 2;
  const h = font.cellH + pad * 2;
  const x = (width - w) >> 1;
  const y = height - margin - h;
  return {
    dim: 0,
    rects: [
      { x, y, w, h, color: colors.border },
      { x: x + 1, y: y + 1, w: w - 2, h: h - 2, color: colors.fill },
    ],
    texts: [{ x: x + 1 + pad, y: y + pad, text, color: colors.text }],
    sprites: [],
  };
}
