import { type ActionId, actionBit } from '@retro-action-engine/core';
import type { FocusTargets, PhysicalSource } from './input-buffer';
import type { SourceSink } from './keyboard';
import { buttonAt, dpadSector, inTouchArea, type PlacedLayout, sectorMask } from './touch-geometry';

type Finger =
  /** Started on the d-pad: stays a d-pad finger wherever it slides. */
  | { readonly kind: 'dpad'; sector: number | undefined; dx: number; dy: number }
  /** Any other finger presses the button it is over, if any. */
  | { readonly kind: 'button'; button: number | undefined };

/** What the pad shows: the d-pad direction and which buttons are down. */
export interface TouchPadState {
  readonly dpadSector: number | undefined;
  /** Center of the d-pad in px (moves with a floating d-pad). */
  readonly dpadCenter: { readonly x: number; readonly y: number } | undefined;
  /** Where the d-pad finger is, from the center, in px (for the stick's knob); none when untouched. */
  readonly dpadFinger: { readonly dx: number; readonly dy: number } | undefined;
  readonly pressed: ReadonlySet<number>;
}

/**
 * The virtual pad (docs/input-and-feel.md 3.3, 9). Takes pointer positions in px relative to the
 * pad area and reports changes to the sink at once (no waiting for the next frame). Multi-touch:
 * every finger is tracked by its pointer id. DOM events are wired by `mountTouchPad`.
 */
export class TouchPadDevice implements PhysicalSource {
  private layout: PlacedLayout | undefined;
  private readonly fingers = new Map<number, Finger>();
  private floatingCenter: { x: number; y: number } | undefined;
  private disabled = 0;
  private listener: ((state: TouchPadState) => void) | undefined;

  constructor(private readonly sink: SourceSink) {}

  /** Sets the placed layout (after a resize, too). Fingers on the old layout are let go. */
  setLayout(layout: PlacedLayout | undefined): void {
    this.layout = layout;
    this.releaseAll();
  }

  /** Hides a button's action (e.g. `switch` for a party that cannot switch). */
  setActionEnabled(action: ActionId, enabled: boolean): void {
    const bit = actionBit(action);
    const next = enabled ? this.disabled & ~bit : this.disabled | bit;
    if (next === this.disabled) return;
    this.disabled = next;
    for (const finger of this.fingers.values()) {
      if (
        finger.kind === 'button' &&
        finger.button !== undefined &&
        !this.enabledAt(finger.button)
      ) {
        finger.button = undefined;
      }
    }
    this.changed();
  }

  isActionEnabled(action: ActionId): boolean {
    return (this.disabled & actionBit(action)) === 0;
  }

  /** Called with the new state after every change, for drawing. */
  onChange(listener: ((state: TouchPadState) => void) | undefined): void {
    this.listener = listener;
  }

  held(): number {
    const layout = this.layout;
    if (layout === undefined) return 0;
    let mask = 0;
    for (const finger of this.fingers.values()) {
      if (finger.kind === 'dpad') mask |= sectorMask(finger.sector);
      else if (finger.button !== undefined) {
        mask |= actionBit((layout.buttons[finger.button] as { action: ActionId }).action);
      }
    }
    return mask;
  }

  state(): TouchPadState {
    let sector: number | undefined;
    let dpadFinger: { dx: number; dy: number } | undefined;
    const pressed = new Set<number>();
    for (const finger of this.fingers.values()) {
      if (finger.kind === 'dpad') {
        sector = finger.sector;
        dpadFinger = { dx: finger.dx, dy: finger.dy };
      } else if (finger.button !== undefined) pressed.add(finger.button);
    }
    return { dpadSector: sector, dpadCenter: this.dpadCenter(), dpadFinger, pressed };
  }

  pointerDown(id: number, x: number, y: number): void {
    const layout = this.layout;
    if (layout === undefined || this.fingers.has(id)) return;
    const onDpad = inTouchArea(layout.dpad, x, y);
    if (onDpad && !this.hasDpadFinger()) {
      if (layout.dpad.floating) this.floatingCenter = { x, y };
      this.fingers.set(id, { kind: 'dpad', sector: undefined, dx: 0, dy: 0 });
    } else {
      this.fingers.set(id, { kind: 'button', button: undefined });
    }
    this.move(id, x, y);
  }

  pointerMove(id: number, x: number, y: number): void {
    if (this.fingers.has(id)) this.move(id, x, y);
  }

  pointerUp(id: number): void {
    const finger = this.fingers.get(id);
    if (finger === undefined) return;
    this.fingers.delete(id);
    if (finger.kind === 'dpad') this.floatingCenter = undefined;
    this.changed();
  }

  /** Forgets every finger, reporting the release (hidden pad, new layout, focus loss). */
  releaseAll(): void {
    this.floatingCenter = undefined;
    if (this.fingers.size === 0) return;
    this.fingers.clear();
    this.changed();
  }

  /** Forgets every finger on focus loss. Returns a detach function. */
  attachFocus(targets: FocusTargets): () => void {
    const onBlur = () => this.releaseAll();
    const onVisibility = () => {
      if (targets.document.visibilityState === 'hidden') this.releaseAll();
    };
    targets.window.addEventListener('blur', onBlur);
    targets.document.addEventListener('visibilitychange', onVisibility);
    return () => {
      targets.window.removeEventListener('blur', onBlur);
      targets.document.removeEventListener('visibilitychange', onVisibility);
    };
  }

  private move(id: number, x: number, y: number): void {
    const layout = this.layout;
    const finger = this.fingers.get(id);
    if (layout === undefined || finger === undefined) return;
    if (finger.kind === 'dpad') {
      const center = this.dpadCenter() ?? layout.dpad;
      finger.dx = x - center.x;
      finger.dy = y - center.y;
      const sector = dpadSector(finger.dx, finger.dy, layout.dpad.deadzone, finger.sector);
      if (sector === finger.sector) {
        // Only the knob moved: redraw, nothing to report to the game.
        this.listener?.(this.state());
        return;
      }
      finger.sector = sector;
    } else {
      const button = buttonAt(layout.buttons, x, y, (action) => this.isActionEnabled(action));
      if (button === finger.button) return;
      finger.button = button;
    }
    this.changed();
  }

  private dpadCenter(): { x: number; y: number } | undefined {
    if (this.floatingCenter !== undefined) return this.floatingCenter;
    return this.layout === undefined ? undefined : { x: this.layout.dpad.x, y: this.layout.dpad.y };
  }

  private hasDpadFinger(): boolean {
    for (const finger of this.fingers.values()) if (finger.kind === 'dpad') return true;
    return false;
  }

  private enabledAt(button: number): boolean {
    const b = this.layout?.buttons[button];
    return b !== undefined && this.isActionEnabled(b.action);
  }

  private changed(): void {
    this.sink.sourceChanged();
    this.listener?.(this.state());
  }
}
