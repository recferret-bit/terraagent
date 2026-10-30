import { describe, expect, it } from 'vitest';
import { CORRECTION_MS, PoseBlender } from './blend';

const P = (x: number, y = 0, rot = 0) => ({ x, y, rot });

describe('PoseBlender', () => {
  it('blends a jump over 150 ms with ease-out and ends exactly at the target', () => {
    const b = new PoseBlender(P(0), 0);
    expect(b.setTarget(P(6), 1000)).toBe(6);
    expect(b.at(1000).x).toBe(0);
    const mid = b.at(1000 + CORRECTION_MS / 2).x;
    expect(mid).toBeGreaterThan(3); // ease-out: more than linear at half time
    expect(mid).toBeLessThan(6);
    let prev = 0;
    for (let t = 0; t <= CORRECTION_MS; t += 10) { const x = b.at(1000 + t).x; expect(x).toBeGreaterThanOrEqual(prev); prev = x; }
    expect(b.at(1000 + CORRECTION_MS).x).toBe(6);
    expect(b.at(5000).x).toBe(6);
  });

  it('starts a new blend from where the entity is drawn right now', () => {
    const b = new PoseBlender(P(0), 0);
    b.setTarget(P(6), 0);
    const shown = b.at(75).x;
    b.setTarget(P(0), 75);
    expect(b.at(75).x).toBeCloseTo(shown, 9);
    expect(b.at(75 + CORRECTION_MS).x).toBe(0);
  });

  it('moves ordinary per-tick motion linearly and reports no correction', () => {
    const b = new PoseBlender(P(0), 0);
    expect(b.setTarget(P(0.3), 0)).toBe(0);
    expect(b.at(CORRECTION_MS / 2).x).toBeCloseTo(0.15, 9);
  });

  it('takes the shortest way round for rotation', () => {
    const b = new PoseBlender(P(0, 0, 3), 0);
    b.setTarget(P(0, 0, -3), 0);
    const r = b.at(CORRECTION_MS / 2).rot;
    expect(Math.abs(r)).toBeGreaterThan(3); // goes through pi, not through 0
  });

  it('ignores an unchanged target', () => {
    const b = new PoseBlender(P(2), 0);
    expect(b.setTarget(P(2), 10)).toBe(0);
    expect(b.at(10).x).toBe(2);
  });
});
