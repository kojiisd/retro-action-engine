import { describe, expect, it } from 'vitest';
import * as entry from './index';

describe('@retro-action-engine/core', () => {
  it('has a loadable entry module', () => {
    expect(entry).toBeDefined();
  });
});
