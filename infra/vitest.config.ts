import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    // Synthesizing a CDK app takes a few seconds per test.
    testTimeout: 30_000,
  },
});
