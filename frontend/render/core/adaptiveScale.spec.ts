import { describe, expect, it } from 'vitest';
import { AdaptiveScale, autoScaleLevels, DEFAULT_ADAPTIVE_SCALE } from './adaptiveScale';

/** Feeds `ms`-long frames for `forMs` starting at `t`; returns the end time and every dpr change seen. */
function run(s: AdaptiveScale, t: number, ms: number, forMs: number, changes: number[] = []): number {
  const end = t + forMs;
  while (t < end) {
    t += ms;
    if (s.sample(ms, t)) changes.push(s.dpr);
  }
  return t;
}

describe('adaptive render scale (pure state machine)', () => {
  it('levels: the ceiling first, then the fixed steps below it', () => {
    expect(autoScaleLevels(2)).toEqual([2, 1.75, 1.5, 1.25, 1]);
    expect(autoScaleLevels(1.5)).toEqual([1.5, 1.25, 1]);
    expect(autoScaleLevels(1.6)).toEqual([1.6, 1.5, 1.25, 1]);
    expect(autoScaleLevels(1)).toEqual([1]);
  });

  it('stays at native DPR while frames are fast', () => {
    const s = new AdaptiveScale(2);
    const changes: number[] = [];
    run(s, 0, 8.3, 20_000, changes);
    expect(changes).toEqual([]);
    expect(s.dpr).toBe(2);
  });

  it('steps down one level per ~1 s of slow frames (never a cascade inside the settle time) and stops at 1.0', () => {
    const s = new AdaptiveScale(2);
    const changes: number[] = [];
    let t = run(s, 0, 25, 900, changes);
    expect(changes).toEqual([]); // under the 1 s hold
    t = run(s, t, 25, 300, changes);
    expect(changes).toEqual([1.75]);
    t = run(s, t, 25, 1000, changes);
    expect(changes).toEqual([1.75]); // settle + new hold after a step
    run(s, t, 25, 20_000, changes);
    expect(changes).toEqual([1.75, 1.5, 1.25, 1]);
    expect(s.dpr).toBe(1);
  });

  it('steps back up only after ~3 s of fast frames', () => {
    const s = new AdaptiveScale(2);
    const changes: number[] = [];
    let t = run(s, 0, 25, 1300, changes);
    expect(s.dpr).toBe(1.75);
    t = run(s, t, 8.3, 2500, changes);
    expect(s.dpr).toBe(1.75);
    run(s, t, 8.3, 2000, changes);
    expect(changes).toEqual([1.75, 2]);
  });

  it('ignores frames in the dead band and single hitches; long gaps (hidden tab) reset the hold', () => {
    const s = new AdaptiveScale(2);
    const changes: number[] = [];
    let t = run(s, 0, 15, 10_000, changes); // between up (12) and down (18): hold
    for (let i = 0; i < 20; i++) { t = run(s, t, 8.3, 500, changes); s.sample(240, (t += 240)); } // one 240 ms hitch per 0.5 s
    s.sample(5000, (t += 5000));
    run(s, t, 8.3, 500, changes);
    expect(changes).toEqual([]);
  });

  it('backs off a level the GPU cannot hold instead of oscillating', () => {
    // Pretend 2.0 costs 24 ms, 1.75 costs 8 ms: every probe back to 2.0 fails.
    const s = new AdaptiveScale(2);
    const cost = () => (s.dpr === 2 ? 24 : 8);
    const changes: number[] = [];
    let t = 0;
    while (t < 120_000) { const ms = cost(); t += ms; if (s.sample(ms, t)) changes.push(s.dpr); }
    const ups = changes.filter((d) => d === 2).length;
    // Without the back-off a probe every ~3 s + 1 s slow would give ~30 ups in 2 minutes.
    expect(ups).toBeLessThanOrEqual(6);
    expect(s.upHoldMs).toBeGreaterThan(DEFAULT_ADAPTIVE_SCALE.upHoldMs * 4);
    expect(s.dpr === 1.75 || s.dpr === 2).toBe(true);
  });

  it('on a vsync-locked 60 Hz display, 16.7 ms frames count as fast (recovers) and 33 ms drops as slow', () => {
    const s = new AdaptiveScale(2);
    const changes: number[] = [];
    let t = run(s, 0, 33.3, 1500, changes);
    expect(s.dpr).toBe(1.75);
    t = run(s, t, 16.7, 4000, changes);
    expect(s.dpr).toBe(2);
    expect(changes).toEqual([1.75, 2]);
    run(s, t, 16.7, 30_000, changes);
    expect(changes).toEqual([1.75, 2]);
  });

  it('setCeiling restarts at the new top', () => {
    const s = new AdaptiveScale(2);
    run(s, 0, 25, 1300);
    expect(s.dpr).toBe(1.75);
    expect(s.setCeiling(1.5)).toBe(true);
    expect(s.dpr).toBe(1.5);
  });
});
