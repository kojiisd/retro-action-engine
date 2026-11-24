import { type InputFrame, isHeld, isPressed } from '../input/frame';
import type { FeelProfile } from '../runtime/feel';
import type { World } from '../world/world';

/** What the player wants this tick (docs/input-and-feel.md 6.1). */
export interface Intent {
  /** -1, 0 or 1 after the SOCD rule. */
  readonly moveDir: number;
  readonly jumpPressed: boolean;
  readonly jumpHeld: boolean;
  readonly downHeld: boolean;
  /** `up` held without `down` (ladders, ADR-0019). */
  readonly upHeld: boolean;
  readonly switchRequested: boolean;
  /** `attack` pressed this tick (ADR-0017; the controller remembers it, M3-2c). */
  readonly attackPressed: boolean;
  /** `up` pressed this tick: enters a door (ADR-0018). */
  readonly upPressed: boolean;
}

/**
 * The `inputIntent` system. Records the press ticks the controller needs later (jump buffer,
 * SOCD lastWins) and resolves left + right with `feel.socd`. Up and down are always neutral.
 */
export function inputIntent(world: World, frame: InputFrame, feel: FeelProfile): Intent {
  const c = world.controller;
  const t = world.tick;
  if (isPressed(frame, 'left')) c.leftPressedTick = t;
  if (isPressed(frame, 'right')) c.rightPressedTick = t;
  const jumpPressed = isPressed(frame, 'jump');
  if (jumpPressed) c.jumpPressedTick = t;

  const left = isHeld(frame, 'left');
  const right = isHeld(frame, 'right');
  let moveDir = 0;
  if (left && right) {
    if (feel.socd === 'leftWins') {
      moveDir = -1;
    } else if (feel.socd === 'lastWins') {
      moveDir = Math.sign(c.rightPressedTick - c.leftPressedTick);
    }
  } else if (left) {
    moveDir = -1;
  } else if (right) {
    moveDir = 1;
  }

  return {
    moveDir,
    jumpPressed,
    jumpHeld: isHeld(frame, 'jump'),
    downHeld: isHeld(frame, 'down') && !isHeld(frame, 'up'),
    upHeld: isHeld(frame, 'up') && !isHeld(frame, 'down'),
    switchRequested: isPressed(frame, 'switch'),
    attackPressed: isPressed(frame, 'attack'),
    upPressed: isPressed(frame, 'up'),
  };
}
