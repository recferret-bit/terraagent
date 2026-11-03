import { describe, expect, it } from 'vitest';
import { createRefreshEstimator, REFRESH_BLOCK } from './displayRefresh';
import { AdaptiveScale } from './adaptiveScale';

const feed = (e: ReturnType<typeof createRefreshEstimator>, intervals: number[], times = 1) => {
  for (let k = 0; k < times; k++) for (const dt of intervals) e.feed(dt);
};

describe('display refresh estimate (rAF probe)', () => {
  it('a 120 Hz screen: found from cheap frames, and still found while GPU-bound (8.3 / 16.7 alternating)', () => {
    const e = createRefreshEstimator();
    expect(e.get()).toBeNull();
    feed(e, [8.33, 16.67], REFRESH_BLOCK * 2);
    expect(e.get()).toBeCloseTo(8.33, 2);
  });

  it('one stray short interval per block cannot fake a faster screen', () => {
    const e = createRefreshEstimator();
    feed(e, [16.67, 16.67, 16.67, 4, 16.67, 16.67, 16.67, 16.67], 20);
    expect(e.get()).toBeCloseTo(16.67, 2);
  });

  it('a long GPU-bound stretch only creeps the estimate up slowly; hidden-tab gaps are ignored', () => {
    const e = createRefreshEstimator();
    feed(e, [8.33], REFRESH_BLOCK);
    feed(e, [16.67, 33.3, 500], REFRESH_BLOCK * 50); // ~10 s of slow frames
    expect(e.get()!).toBeLessThan(11); // ~26 % of the way after 100 blocks
  });
});

describe('AUTO render scale aims at the display rate', () => {
  /** Feeds a vsync-locked stream: frames costing `costMs` present at the next multiple of `refresh`. */
  function run(s: AdaptiveScale, t: number, costMs: () => number, refresh: number, forMs: number, changes: number[]): number {
    const end = t + forMs;
    while (t < end) {
      const dt = Math.ceil(costMs() / refresh - 1e-6) * refresh;
      t += dt;
      if (s.sample(dt, t)) changes.push(s.dpr);
    }
    return t;
  }

  it('120 Hz screen, 10 ms frames at ×2 (they present at 16.7 ms): steps down until it holds 8.3 ms', () => {
    const s = new AdaptiveScale(2, { refreshMs: () => 1000 / 120 });
    const changes: number[] = [];
    const cost = () => 10 * (s.dpr / 2) ** 2; // fill-rate bound: cost ∝ pixels
    run(s, 0, cost, 1000 / 120, 20_000, changes);
    expect(changes[0]).toBe(1.75);
    expect(s.dpr).toBeLessThanOrEqual(1.75);
    expect(cost()).toBeLessThanOrEqual(1000 / 120);
  });

  it('60 Hz screen, the same frames: 16.7 ms is the display rate, so it stays at native', () => {
    const s = new AdaptiveScale(2, { refreshMs: () => 1000 / 60 });
    const changes: number[] = [];
    run(s, 0, () => 10, 1000 / 60, 20_000, changes);
    expect(changes).toEqual([]);
  });

  it('a 240 Hz screen is held at 120 FPS, not beyond', () => {
    const s = new AdaptiveScale(2, { refreshMs: () => 1000 / 240 });
    expect(s.refreshMs()).toBeCloseTo(1000 / 120, 5);
  });
});
