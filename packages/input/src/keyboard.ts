import type { ActionMap } from './action-map';
import type { FocusTargets, PhysicalSource } from './input-buffer';

/** The fields of a `KeyboardEvent` the device reads. */
export interface KeyEventLike {
  readonly code: string;
  readonly repeat: boolean;
  readonly isComposing: boolean;
  preventDefault(): void;
}

/** Where the device reports changes (an `InputBuffer`). */
export interface SourceSink {
  sourceChanged(): void;
}

/**
 * Keyboard (docs/input-and-feel.md 3.1). Keys are looked up by `KeyboardEvent.code`. Bound keys
 * get `preventDefault()` (no page scroll on arrows or space); unbound keys pass through. Auto
 * repeat is ignored. Key downs during IME composition are ignored; key ups are always taken, so a
 * key can never stay stuck because its release came during composition.
 */
export class KeyboardDevice implements PhysicalSource {
  /** Bound keys that are down. */
  private readonly down = new Set<string>();
  private suspended = false;
  private capture: ((code: string) => void) | undefined;

  constructor(
    private readonly map: ActionMap,
    private readonly sink: SourceSink,
  ) {}

  /** The actions held by the keys that are down (the physical state for resyncs). */
  held(): number {
    let mask = 0;
    for (const code of this.down) mask |= this.map.key(code);
    return mask;
  }

  /**
   * While suspended (a menu is open), keys are left to the page: nothing is held, nothing is
   * prevented. Suspending forgets the keys that were down, without reporting.
   */
  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
    if (suspended) this.down.clear();
  }

  /**
   * While set, the next key downs (any key, bound or not, not auto repeat) go to `capture`
   * instead of the game, with their default action prevented (docs/input-and-feel.md 4.3).
   */
  setCapture(capture: ((code: string) => void) | undefined): void {
    this.capture = capture;
  }

  keyDown(event: KeyEventLike): void {
    if (event.isComposing) return;
    if (this.capture !== undefined) {
      event.preventDefault();
      if (!event.repeat) this.capture(event.code);
      return;
    }
    if (this.suspended || this.map.key(event.code) === 0) return;
    event.preventDefault();
    if (event.repeat || this.down.has(event.code)) return;
    this.down.add(event.code);
    this.sink.sourceChanged();
  }

  keyUp(event: KeyEventLike): void {
    if (this.suspended) return;
    if (this.map.key(event.code) !== 0) event.preventDefault();
    // Also for a key whose binding was removed while it was down.
    if (!this.down.delete(event.code)) return;
    this.sink.sourceChanged();
  }

  /**
   * Forgets every key, without reporting: on focus loss the buffer resyncs to "all released"
   * itself, and keys released in another window never send `keyup` here.
   */
  releaseAll(): void {
    this.down.clear();
  }

  /** Listens for keys on `window` and forgets them on focus loss. Returns a detach function. */
  attach(targets: FocusTargets): () => void {
    const onDown = (event: Event) => this.keyDown(event as unknown as KeyEventLike);
    const onUp = (event: Event) => this.keyUp(event as unknown as KeyEventLike);
    const onBlur = () => this.releaseAll();
    const onVisibility = () => {
      if (targets.document.visibilityState === 'hidden') this.releaseAll();
    };
    targets.window.addEventListener('keydown', onDown);
    targets.window.addEventListener('keyup', onUp);
    targets.window.addEventListener('blur', onBlur);
    targets.document.addEventListener('visibilitychange', onVisibility);
    return () => {
      targets.window.removeEventListener('keydown', onDown);
      targets.window.removeEventListener('keyup', onUp);
      targets.window.removeEventListener('blur', onBlur);
      targets.document.removeEventListener('visibilitychange', onVisibility);
    };
  }
}
