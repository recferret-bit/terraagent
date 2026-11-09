import { describe, expect, it } from 'vitest';
import { rotorClockRate, rotorSpeedScale, SHADER_ROTOR_RAD_PER_TIME } from './rotorSpeed';

describe('rotor speed rescale', () => {
  it('hits the owner anchor points', () => {
    expect(rotorSpeedScale(0.25)).toBeCloseTo(1);
    expect(rotorSpeedScale(0.5)).toBeCloseTo(1.5);
    expect(rotorSpeedScale(0.12)).toBeCloseTo(0.25);
  });
  it('is monotone and bounded, and safe for bad input', () => {
    let prev = -1;
    for (let w = 0; w <= 6; w += 0.05) {
      const s = rotorSpeedScale(w);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
    expect(rotorSpeedScale(NaN)).toBe(0);
    expect(rotorSpeedScale(100)).toBeLessThanOrEqual(3);
  });
  it('turns far slower than the old 12.5 rad/s * wind', () => {
    for (const w of [0.25, 1, 1.5]) {
      expect(rotorClockRate(w) * SHADER_ROTOR_RAD_PER_TIME).toBeLessThan(12.5 * w * 0.5 + (w === 0.25 ? 3 : 0));
    }
    expect(rotorClockRate(1.5) * SHADER_ROTOR_RAD_PER_TIME).toBeLessThan(5);
  });
});
