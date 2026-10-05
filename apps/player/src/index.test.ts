import * as core from '@retro-action-engine/core';
import * as input from '@retro-action-engine/input';
import * as pack from '@retro-action-engine/pack';
import * as renderer from '@retro-action-engine/renderer-phaser';
import { describe, expect, it } from 'vitest';
import * as entry from './index';

describe('@retro-action-engine/player', () => {
  it('has a loadable entry module', () => {
    expect(entry).toBeDefined();
  });

  it('resolves the entry of every package it depends on', () => {
    for (const mod of [core, pack, input, renderer]) {
      expect(mod).toBeDefined();
    }
  });
});
