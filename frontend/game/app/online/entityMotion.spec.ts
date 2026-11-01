import { describe, expect, it } from 'vitest';
import { MotionTrack, RENDER_DELAY_TICKS, RenderClock } from './entityMotion';

const TICK_S = 0.2;
const pose = (tick: number, x: number) => ({ tick, x, y: 0, rot: 0 });

describe('online unit motion: tick-keyed track + monotonic render clock', () => {
  it('interpolates linearly between ticks, so a unit walking 0.32 tiles/tick is drawn at constant speed', () => {
    const t = new MotionTrack();
    t.push(pose(10, 0));
    t.push(pose(11, 0.32));
    t.push(pose(12, 0.64));
    expect(t.at(10.5)?.x).toBeCloseTo(0.16, 6);
    expect(t.at(11.25)?.x).toBeCloseTo(0.4, 6);
    expect(t.at(12.4)?.x).toBeCloseTo(0.64 + 0.4 * 0.32, 6); // short extrapolation
    expect(t.at(20)?.x).toBeCloseTo(0.64 + 0.5 * 0.32, 6); // then hold
  });

  it('an older confirmed view fills in instead of throwing away the predicted future (no jump back)', () => {
    const t = new MotionTrack();
    t.push(pose(10, 0));
    t.push(pose(13, 0.96)); // predicted view, 3 ticks ahead
    t.push(pose(11, 0.32)); // confirmed view arrives later with an older tick
    t.push(pose(13, 0.96)); // confirmed reaches the same tick: replaces, no duplicate
    expect(t.length).toBe(3);
    expect(t.at(12)?.x).toBeCloseTo(0.64, 6);
    t.dropAfter(11); // the predicted command was rejected
    expect(t.at(13)?.x).toBeCloseTo(0.32 + 0.5 * 0.32, 6);
  });

  it('the clock follows the sim rate behind the newest tick and never runs backwards when views step back', () => {
    const c = new RenderClock(TICK_S);
    c.observe(100);
    expect(c.tick).toBe(100 - RENDER_DELAY_TICKS);
    let prev = c.tick;
    const seen: number[] = [];
    for (let frame = 0; frame < 60; frame++) {
      if (frame % 12 === 0) c.observe(100 + frame / 12 + 3); // a predicted view ahead…
      if (frame % 12 === 6) c.observe(100 + frame / 12); // …then the older confirmed view
      const now = c.advance(1 / 60);
      expect(now).toBeGreaterThanOrEqual(prev);
      seen.push(now - prev);
      prev = now;
    }
    expect(Math.max(...seen)).toBeLessThan(0.25); // no visible jumps: < 1/4 tick per 60 Hz frame
  });

  it('under warp 10 (50 ticks/s, deltas of 10 ticks at 5 Hz) it measures the rate and glides at ≤ 2.5 ticks per 60 Hz frame', () => {
    const c = new RenderClock(TICK_S);
    let tick = 1000;
    c.observe(tick);
    let prev = c.tick;
    let maxStep = 0;
    for (let frame = 1; frame <= 600; frame++) { // 10 s at 60 fps
      if (frame % 12 === 0) c.observe((tick += 10));
      const now = c.advance(1 / 60);
      if (frame > 120) maxStep = Math.max(maxStep, now - prev); // after the rate settled
      expect(now).toBeGreaterThanOrEqual(prev);
      prev = now;
    }
    expect(c.rate).toBeGreaterThan(40);
    expect(c.rate).toBeLessThan(60);
    expect(maxStep).toBeLessThan(2.5);
    expect(tick - c.tick).toBeLessThan(25); // keeps up with the sim
  });

  it('snaps on a resync instead of fast-forwarding through it', () => {
    const c = new RenderClock(TICK_S);
    c.observe(10);
    c.advance(0.1);
    c.observe(500);
    expect(c.advance(0.016)).toBeCloseTo(500 - RENDER_DELAY_TICKS, 1);
  });
});
