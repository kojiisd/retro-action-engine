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

  keyDown(event: KeyEventLike): void {
    if (event.isComposing) return;
    if (this.map.key(event.code) === 0) return;
    event.preventDefault();
    if (event.repeat || this.down.has(event.code)) return;
    this.down.add(event.code);
    this.sink.sourceChanged();
  }

  keyUp(event: KeyEventLike): void {
    if (this.map.key(event.code) === 0) return;
    event.preventDefault();
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
