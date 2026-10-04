import { describe, expect, it } from 'vitest';
import * as entry from './index';

describe('@retro-action-engine/renderer-phaser', () => {
  it('has a loadable entry module', () => {
    expect(entry).toBeDefined();
  });
});
