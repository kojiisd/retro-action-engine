import { describe, expect, it } from 'vitest';
import * as entry from './index';

describe('@retro-action-engine/input', () => {
  it('has a loadable entry module', () => {
    expect(entry).toBeDefined();
  });
});
