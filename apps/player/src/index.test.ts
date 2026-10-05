import * as core from '@retro-action-engine/core';
import * as input from '@retro-action-engine/input';
import * as pack from '@retro-action-engine/pack';
import * as renderer from '@retro-action-engine/renderer-phaser';
import { describe, expect, it } from 'vitest';

// src/index.ts is the browser entry and touches the DOM on import, so it is not imported here.
// The placeholder logic is tested in build-info.test.ts.
describe('@retro-action-engine/player', () => {
  it('resolves the entry of every package it depends on', () => {
    for (const mod of [core, pack, input, renderer]) {
      expect(mod).toBeDefined();
    }
  });
});
