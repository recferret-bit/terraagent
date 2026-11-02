import { describe, expect, it } from 'vitest';
import { atan2Det } from '../../src/kernel/detMath';

describe('deterministic atan2 (SIM-D-06)', () => {
  it('matches Math.atan2 within 2e-5 rad around the whole circle and at the axes', () => {
    let worst = 0;
    for (let i = 0; i < 3600; i++) {
      const a = (i / 3600) * 2 * Math.PI - Math.PI;
      for (const len of [1e-6, 0.37, 1, 42]) {
        const x = Math.cos(a) * len;
        const y = Math.sin(a) * len;
        const d = Math.abs(atan2Det(y, x) - Math.atan2(y, x));
        worst = Math.max(worst, Math.min(d, 2 * Math.PI - d));
      }
    }
    expect(worst).toBeLessThan(2e-5);
    expect(atan2Det(0, 0)).toBe(0);
    expect(atan2Det(0, 1)).toBe(0);
    expect(atan2Det(1, 0)).toBeCloseTo(Math.PI / 2, 12);
    expect(atan2Det(0, -1)).toBeCloseTo(Math.PI, 12);
  });
});
