import { describe, expect, it } from 'vitest';
import { debugAllowed, formatStats, LatencyMeter } from './debug';

describe('debugAllowed', () => {
  it('is on in dev, PR previews and e2e builds, and off in production', () => {
    expect(debugAllowed({ DEV: true })).toBe(true);
    expect(debugAllowed({ VITE_PR_NUMBER: '17' })).toBe(true);
    expect(debugAllowed({ VITE_E2E_HOOKS: '1' })).toBe(true);
    expect(debugAllowed({ DEV: false, VITE_PR_NUMBER: '', VITE_E2E_HOOKS: '0' })).toBe(false);
    expect(debugAllowed({})).toBe(false);
  });
});

describe('LatencyMeter', () => {
  it('measures from the first press to the drawing of the first frame that ran ticks', () => {
    let t = 0;
    const meter = new LatencyMeter(() => t);
    meter.pressed(); // t = 0
    t = 5;
    meter.pressed(); // ignored: one sample at a time
    meter.ticked(0);
    t = 8;
    meter.drawn(); // no ticks yet: still pending
    meter.ticked(2);
    t = 21;
    meter.drawn();
    expect(meter.stats()).toMatchObject({ last: 21, avg: 21, max: 21, maxTicks: 2 });
    meter.pressed(); // t = 21
    meter.ticked(1);
    t = 30;
    meter.drawn();
    expect(meter.stats()).toMatchObject({ last: 9, avg: 15, max: 21 });
  });

  it('counts the frames drawn in the last second', () => {
    let t = 0;
    const meter = new LatencyMeter(() => t);
    for (let i = 0; i < 120; i++) {
      t = i * 20; // 50 fps; the window keeps frames up to 1000 ms old
      meter.drawn();
    }
    expect(meter.stats().fps).toBe(51);
    expect(
      formatStats(meter.stats(), { droppedFrames: 2, resyncs: 1, desynchronized: false }),
    ).toBe(
      'input→draw ms last - avg - max -\nfps 51  ticks/frame max 0  dropped 2  resyncs 1\ndesynchronized off',
    );
  });
});
