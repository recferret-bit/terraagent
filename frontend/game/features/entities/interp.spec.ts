import { describe, expect, it } from 'vitest';
import { EXTRAPOLATE_MAX_TICKS, INTERP_DELAY_TICKS, SampleBuffer } from './interp';

const buf = (...xs: Array<[number, number]>) => { const b = new SampleBuffer(); for (const [tick, x] of xs) b.push({ tick, x, y: 0, rot: 0 }); return b; };

describe('SampleBuffer', () => {
  it('renders 400 ms (two ticks) behind', () => {
    expect(INTERP_DELAY_TICKS * 200).toBe(400);
    const b = buf([10, 0], [11, 1], [12, 2], [13, 3]);
    const serverTick = 13;
    expect(b.sampleAt(serverTick - INTERP_DELAY_TICKS)!.x).toBe(1);
    expect(b.sampleAt(serverTick - INTERP_DELAY_TICKS + 0.5)!.x).toBeCloseTo(1.5, 9);
  });

  it('extrapolates at most 200 ms, then holds', () => {
    const b = buf([10, 0], [11, 1]);
    expect(b.sampleAt(11.5)!.x).toBeCloseTo(1.5, 9);
    expect(b.sampleAt(11 + EXTRAPOLATE_MAX_TICKS)!.x).toBeCloseTo(2, 9);
    expect(b.sampleAt(14)!.x).toBeCloseTo(2, 9);
  });

  it('does not extrapolate a teleport', () => {
    expect(buf([10, 0], [11, 6]).sampleAt(11.8)!.x).toBe(6);
  });

  it('holds the first sample before the buffer and returns null when empty', () => {
    expect(buf([10, 4], [11, 5]).sampleAt(3)!.x).toBe(4);
    expect(new SampleBuffer().sampleAt(1)).toBeNull();
  });

  it('replaces a same-tick sample and restarts on an older tick', () => {
    const b = buf([10, 0], [10, 3]);
    expect(b.length).toBe(1);
    b.push({ tick: 4, x: 9, y: 0, rot: 0 });
    expect(b.length).toBe(1);
  });
});
