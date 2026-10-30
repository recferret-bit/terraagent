import { COARSE_DT, TICK_MS } from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { COARSE_STEP_MS, MAX_CATCHUP, PlanetScheduler } from '../../src/game/thread/scheduler';

/** Fake clock + timer: `advance(ms)` jumps time, firing due timers in order; `jump(ms)` models a blocked thread. */
function rig() {
  let now = 0;
  let timer: { at: number; fn: () => void } | undefined;
  const steps: { id: string; dt: number }[] = [];
  const s = new PlanetScheduler({
    now: () => now,
    schedule: (fn, delay) => { const t = { at: now + delay, fn }; timer = t; return () => { if (timer === t) timer = undefined; }; },
    step: (id, dt) => { steps.push({ id, dt }); },
  });
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      if (!timer || timer.at > end) break;
      const t = timer;
      timer = undefined;
      now = Math.max(now, t.at);
      t.fn();
      if (t.at === now && !timer) break;
    }
    now = end;
  };
  const jump = (ms: number) => { now += ms; };
  return { s, steps, advance, jump, get now() { return now; } };
}

describe('PlanetScheduler', () => {
  it('5 TPS gives 5 steps per simulated second', () => {
    const r = rig();
    r.s.add('a');
    r.s.start();
    r.advance(1000 - 1);
    expect(r.steps.length).toBe(5);
    expect(r.steps.every((x) => x.dt === 1)).toBe(true);
  });

  it('does not drift over 10 000 simulated seconds, even with late timers', () => {
    const r = rig();
    r.s.add('a');
    r.s.start();
    // late-firing timer: advance in 7 ms chunks so passes run up to 6 ms late
    const end = 10_000_000 - 1; // first step is due at t=0, so [0, 10 000 s) holds exactly 50 000 slots
    let t = 0;
    for (; t + 7 <= end; t += 7) r.advance(7);
    r.advance(end - t);
    expect(r.steps.length).toBe(10_000 * 5);
  });

  it('after a 2 s block steps at most 5 per pass, lag rises then falls to 0', () => {
    const r = rig();
    r.s.add('a');
    r.s.add('b');
    r.s.start();
    r.advance(1000);
    r.jump(2000);
    const lag: number[] = [];
    const per: number[] = [];
    for (let i = 0; i < 6; i++) {
      const before = r.steps.length;
      const rep = r.s.runPass();
      per.push(r.steps.length - before);
      lag.push(rep.maxLag);
      expect(rep.maxPlanetSteps).toBeLessThanOrEqual(MAX_CATCHUP);
    }
    console.log('lag series', lag.join(','), 'steps per pass', per.join(','));
    expect(lag[0]).toBeGreaterThanOrEqual(5);
    expect(lag[0]).toBeGreaterThan(lag[1]!);
    expect(lag.at(-1)).toBe(0);
    expect(Math.max(...per)).toBeLessThanOrEqual(MAX_CATCHUP * 2);
  });

  it('coarse mode steps dt=COARSE_DT once per second', () => {
    const r = rig();
    r.s.add('a');
    r.s.setMode('a', 'coarse');
    r.s.start();
    r.advance(3000);
    expect(r.steps.length).toBe(4); // due at 0, 1000, 2000, 3000
    expect(r.steps.every((x) => x.dt === COARSE_DT)).toBe(true);
    expect(COARSE_STEP_MS).toBe(1000);
    expect(r.s.info('a')?.mode).toBe('coarse');
  });

  it('warp x10 gives 50 ticks per second', () => {
    const r = rig();
    r.s.add('a');
    r.s.setWarp('a', 10);
    r.s.start();
    r.advance(1000 - 1);
    expect(r.steps.length).toBe(50);
    r.s.setWarp('a', 1000);
    expect(r.s.info('a')?.warp).toBe(100);
    expect(TICK_MS).toBe(200);
  });
});
