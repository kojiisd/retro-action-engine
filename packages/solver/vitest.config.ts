import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@retro-action-engine/solver',
    // Many tests solve a whole room (a breadth-first search with every reached foothold's replay
    // verified): 1-4 s each alone, and past Vitest's 5 s default on a busy CI runner. The limit is
    // for this known amount of work, not for a flaky test (the searches are deterministic).
    testTimeout: 30_000,
  },
});
