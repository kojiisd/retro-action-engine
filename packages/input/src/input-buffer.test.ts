import { actionMask } from '@retro-action-engine/core';
import { describe, expect, it } from 'vitest';
import { InputBuffer } from './input-buffer';

/** Stand-ins for window and document: plain EventTargets with a settable visibility state. */
function focusTargets() {
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), {
    visibilityState: 'visible' as DocumentVisibilityState,
  });
  return { window, document };
}

describe('InputBuffer (DOM side)', () => {
  it('combines the physical state of every source', () => {
    const buffer = new InputBuffer();
    buffer.addSource({ held: () => actionMask('left') });
    const remove = buffer.addSource({ held: () => actionMask('jump') });
    expect(buffer.physical()).toBe(actionMask('left', 'jump'));
    remove();
    expect(buffer.physical()).toBe(actionMask('left'));
  });

  it('turns device transitions into frames', () => {
    const buffer = new InputBuffer();
    buffer.transition('right', true);
    expect(buffer.nextFrame()).toEqual({
      held: actionMask('right'),
      pressed: actionMask('right'),
      released: 0,
    });
  });

  it('(d) resyncs to "everything released" on blur, one tick later', () => {
    const buffer = new InputBuffer();
    const keys = { held: actionMask('right', 'jump') };
    buffer.addSource({ held: () => keys.held });
    buffer.transition('right', true);
    buffer.transition('jump', true);
    buffer.nextFrame();
    const targets = focusTargets();
    const detach = buffer.attachFocusEvents(targets);
    targets.window.dispatchEvent(new Event('blur'));
    expect(buffer.resyncCount).toBe(1);
    expect(buffer.nextFrame()).toEqual({
      held: 0,
      pressed: 0,
      released: actionMask('right', 'jump'),
    });
    detach();
    targets.window.dispatchEvent(new Event('blur'));
    expect(buffer.resyncCount).toBe(1);
  });

  it('(d) resyncs when the page becomes hidden, but not when it becomes visible', () => {
    const reasons: string[] = [];
    const buffer = new InputBuffer({ onResync: (reason) => reasons.push(reason) });
    const targets = focusTargets();
    buffer.attachFocusEvents(targets);
    targets.document.dispatchEvent(new Event('visibilitychange'));
    expect(reasons).toEqual([]);
    targets.document.visibilityState = 'hidden';
    targets.document.dispatchEvent(new Event('visibilitychange'));
    expect(reasons).toEqual(['focusLost']);
  });

  it('(c) resyncs to the physical state after dropped time', () => {
    const buffer = new InputBuffer();
    let held = 0;
    buffer.addSource({ held: () => held });
    // Many transitions arrive, then the driver drops time; only the final state matters.
    for (let i = 0; i < 4; i++) {
      buffer.transition('attack', i % 2 === 0);
    }
    held = actionMask('left');
    buffer.transition('left', true);
    buffer.droppedTime();
    expect(buffer.nextFrame()).toEqual({
      held: actionMask('left'),
      pressed: actionMask('left'),
      released: 0,
    });
  });

  it('(b) resyncs on a backlog over maxBacklogTicks using the sources', () => {
    const reasons: string[] = [];
    const buffer = new InputBuffer({ maxBacklogTicks: 2, onResync: (r) => reasons.push(r) });
    let held = 0;
    buffer.addSource({ held: () => held });
    for (let i = 0; i < 3; i++) {
      held = i % 2 === 0 ? actionMask('jump') : 0;
      buffer.transition('jump', i % 2 === 0);
    }
    expect(reasons).toEqual(['backlog']);
    expect(buffer.nextFrame().held).toBe(held);
  });
});

describe('InputBuffer.onPressed', () => {
  it('reports actions that just went down, even if they go up before the next frame', () => {
    const pressed: number[] = [];
    let held = 0;
    const buffer = new InputBuffer({ onPressed: (mask) => pressed.push(mask) });
    buffer.addSource({ held: () => held });
    held = actionMask('menu');
    buffer.sourceChanged();
    held = 0;
    buffer.sourceChanged();
    held = actionMask('menu', 'jump');
    buffer.sourceChanged();
    held = actionMask('jump');
    buffer.sourceChanged();
    expect(pressed).toEqual([actionMask('menu'), actionMask('menu', 'jump')]);
  });
});
