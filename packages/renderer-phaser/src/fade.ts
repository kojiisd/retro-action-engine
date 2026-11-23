import type { TransitionView } from '@retro-action-engine/core';

/**
 * How dark the play area is during a room change (ADR-0018): 0 is clear, 1 is black. A `fade`
 * darkens over its first phase and clears over the second; a `cut` draws nothing.
 */
export function fadeAmount(transition: TransitionView | null): number {
  if (transition === null || transition.effect !== 'fade' || transition.ticks <= 0) return 0;
  const done = Math.min(1, transition.tick / transition.ticks);
  return transition.phase === 'out' ? done : 1 - done;
}
