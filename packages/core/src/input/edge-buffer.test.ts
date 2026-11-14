import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MAX_BACKLOG_TICKS, EdgeBuffer, MAX_QUEUE, type ResyncReason } from './edge-buffer';
import { ACTIONS, type ActionId, actionMask } from './frame';

const m = actionMask;

/** A buffer whose physical state the test drives, like a device would. */
function device(options: { maxQueue?: number; maxBacklogTicks?: number } = {}) {
  let physical = 0;
  const reasons: ResyncReason[] = [];
  const buffer = new EdgeBuffer({
    readPhysical: () => physical,
    onResync: (reason) => reasons.push(reason),
    ...options,
  });
  return {
    buffer,
    reasons,
    get physical() {
      return physical;
    },
    /** A physical change that the device also queues. */
    set(action: ActionId, down: boolean) {
      physical = down ? physical | m(action) : physical & ~m(action);
      buffer.push(action, down);
    },
  };
}

describe('EdgeBuffer: the examples of docs/input-and-feel.md 5.1', () => {
  it('example 1: jump down, up, down within one frame of two ticks', () => {
    const d = device();
    d.set('jump', true);
    d.set('jump', false);
    d.set('jump', true);
    expect(d.buffer.nextFrame()).toEqual({ held: m('jump'), pressed: m('jump'), released: 0 });
    expect(d.buffer.nextFrame()).toEqual({ held: 0, pressed: 0, released: m('jump') });
    expect(d.buffer.nextFrame()).toEqual({ held: m('jump'), pressed: m('jump'), released: 0 });
  });

  it('example 2: different actions are consumed in the same tick', () => {
    const d = device();
    d.set('right', true);
    d.set('jump', true);
    d.set('right', false);
    expect(d.buffer.nextFrame()).toEqual({
      held: m('right', 'jump'),
      pressed: m('right', 'jump'),
      released: 0,
    });
    expect(d.buffer.nextFrame()).toEqual({ held: m('jump'), pressed: 0, released: m('right') });
  });

  it('example 3: order is kept even for a different action behind the stop', () => {
    const d = device();
    d.set('jump', true);
    d.set('jump', false);
    d.set('attack', true);
    expect(d.buffer.nextFrame()).toEqual({ held: m('jump'), pressed: m('jump'), released: 0 });
    expect(d.buffer.nextFrame()).toEqual({
      held: m('attack'),
      pressed: m('attack'),
      released: m('jump'),
    });
  });

  it('a tap shorter than a tick lasts one tick; empty ticks repeat held without edges', () => {
    const d = device();
    d.set('right', true);
    expect(d.buffer.nextFrame()).toEqual({ held: m('right'), pressed: m('right'), released: 0 });
    expect(d.buffer.nextFrame()).toEqual({ held: m('right'), pressed: 0, released: 0 });
    expect(d.buffer.nextFrame()).toEqual({ held: m('right'), pressed: 0, released: 0 });
  });

  it('drops pushes that do not change the pending state', () => {
    const d = device();
    d.buffer.push('jump', false);
    d.buffer.push('jump', true);
    d.buffer.push('jump', true);
    expect(d.buffer.length).toBe(1);
  });
});

describe('EdgeBuffer: resync triggers (held matches the physical state one tick later)', () => {
  it('(a) queue overflow', () => {
    const d = device({ maxQueue: 8, maxBacklogTicks: 100 });
    // Alternate several actions so the backlog stays low while the queue grows.
    for (let i = 0; i < 9; i++) {
      d.set(ACTIONS[i % 4] as ActionId, i % 8 < 4);
    }
    expect(d.reasons).toEqual(['queueOverflow']);
    expect(d.buffer.nextFrame().held).toBe(d.physical);
  });

  it('(b) backlog beyond maxBacklogTicks', () => {
    const d = device();
    d.set('right', true);
    d.buffer.nextFrame();
    for (let i = 0; i <= DEFAULT_MAX_BACKLOG_TICKS; i++) {
      d.set('jump', i % 2 === 0);
    }
    expect(d.reasons).toEqual(['backlog']);
    const frame = d.buffer.nextFrame();
    expect(frame.held).toBe(d.physical);
    // Only actions that differ get an edge: right was and is held, so it has none.
    expect(frame.pressed & m('right')).toBe(0);
  });

  it('(c) dropped time (called by the loop driver)', () => {
    const d = device();
    d.set('left', true);
    d.set('left', false);
    d.set('left', true);
    d.set('down', true);
    d.buffer.resync('droppedTime');
    expect(d.reasons).toEqual(['droppedTime']);
    const frame = d.buffer.nextFrame();
    expect(frame).toEqual({ held: d.physical, pressed: d.physical, released: 0 });
    expect(d.buffer.length).toBe(0);
  });

  it('(d) focus lost: every action counts as released', () => {
    const d = device();
    d.set('right', true);
    d.set('jump', true);
    d.buffer.nextFrame();
    d.set('attack', true);
    d.buffer.resync('focusLost', 0);
    const frame = d.buffer.nextFrame();
    expect(frame).toEqual({ held: 0, pressed: 0, released: m('right', 'jump') });
    expect(d.buffer.resyncCount).toBe(1);
  });

  it('uses the documented limits by default', () => {
    expect(MAX_QUEUE).toBe(256);
    expect(DEFAULT_MAX_BACKLOG_TICKS).toBe(6);
  });
});

describe('EdgeBuffer: properties over random transition streams', () => {
  // Steps: a device toggles an action, or the loop consumes a tick.
  const stepArb = fc.oneof(
    fc.record({ kind: fc.constant('toggle' as const), action: fc.constantFrom(...ACTIONS) }),
    fc.record({ kind: fc.constant('tick' as const) }),
  );

  it('consumes every transition exactly once, in order, never pressed and released together, and held is the running result', () => {
    fc.assert(
      fc.property(fc.array(stepArb, { maxLength: 300 }), (steps) => {
        let physical = 0;
        const buffer = new EdgeBuffer({
          readPhysical: () => physical,
          maxQueue: 100_000,
          maxBacklogTicks: 100_000,
        });
        const pushed: Array<[ActionId, boolean]> = [];
        const consumed: Array<[ActionId, boolean]> = [];
        let held = 0;
        const tick = () => {
          const f = buffer.nextFrame();
          expect(f.pressed & f.released).toBe(0);
          expect(f.pressed & ~f.held).toBe(0);
          expect(f.released & f.held).toBe(0);
          for (const action of ACTIONS) {
            const bit = m(action);
            if (f.pressed & bit) consumed.push([action, true]);
            if (f.released & bit) consumed.push([action, false]);
          }
          held = (held | f.pressed) & ~f.released;
          expect(f.held).toBe(held);
        };
        for (const s of steps) {
          if (s.kind === 'tick') {
            tick();
          } else {
            const down = (physical & m(s.action)) === 0;
            physical ^= m(s.action);
            buffer.push(s.action, down);
            pushed.push([s.action, down]);
          }
        }
        while (buffer.length > 0) tick();
        expect(held).toBe(physical);
        // Exactly once, and per action in the pushed order.
        for (const action of ACTIONS) {
          expect(consumed.filter(([a]) => a === action)).toEqual(
            pushed.filter(([a]) => a === action),
          );
        }
        expect(consumed).toHaveLength(pushed.length);
      }),
      { numRuns: 500 },
    );
  });
});
