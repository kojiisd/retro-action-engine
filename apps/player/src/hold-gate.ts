import type { InputFrame, InputSource } from '@retro-action-engine/core';

/**
 * Keeps buttons that are held when a menu closes away from the game until they are let go
 * (ADR-0020: the game starts again from "everything released"). The input keeps working while
 * the game menu is open, so without this a direction held through the menu would walk the
 * character as soon as it closes.
 *
 * Closing a menu resyncs the input as if every button were let go (`InputBuffer.focusLost`), and
 * the buttons still held then come back as new presses: those are what this hides. Whether a
 * button is still held is read from the devices, not from the frames.
 */
export class HoldGate implements InputSource {
  private blocked = 0;
  /** What the game was last given as held. */
  private given = 0;

  constructor(
    private readonly source: InputSource,
    /** The buttons physically held now (every device). */
    private readonly physical: () => number,
  ) {}

  /** Blocks `mask` (the buttons physically held as a menu closes) until each is let go. */
  block(mask: number): void {
    this.blocked |= mask;
  }

  get blockedMask(): number {
    return this.blocked;
  }

  nextFrame(): InputFrame {
    const frame = this.source.nextFrame();
    // A blocked button that has been let go belongs to the game again from its next press.
    this.blocked &= this.physical();
    const blocked = this.blocked;
    if (blocked === 0 && (frame.released & ~this.given) === 0) {
      this.given = frame.held;
      return frame;
    }
    const held = frame.held & ~blocked;
    // A release only for what the game holds: it never saw a blocked button go down.
    const released = frame.released & this.given & ~held;
    this.given = held;
    return { ...frame, held, pressed: frame.pressed & ~blocked, released };
  }

  droppedTime(): void {
    this.source.droppedTime?.();
  }
}
