import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  computeEnvironmentAtCycleTick,
  createRegistryPipeline,
  createState,
  cycleTickForTimeSpec,
  getEnvironment,
  step,
} from '../../src';

describe('W02-04 Environment system (slot 1): 20 min day cycle & daylight curve', () => {
  it('on a temperate planet advance 11 min -> see daylight === 0', () => {
    const state = createState({ planetId: 'p-temp', planetType: 'temperate', seed: 'w02', radius: 4 });
    const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });

    // At morning start (tick 1), phase is day and daylight is 1
    step(state, [], 1, pipeline);
    expect(getEnvironment(state).phase).toBe('day');
    expect(getEnvironment(state).daylight).toBe(1);

    // Advance remaining 3299 ticks to reach 11 minutes total (11 * 60 * 5 = 3300 ticks)
    step(state, [], 3299, pipeline);
    const envAt11Min = getEnvironment(state);
    expect(state.meta.tick).toBe(3300);
    expect(envAt11Min.nightShare).toBe(0.45);
    expect(envAt11Min.phase).toBe('night');
    expect(envAt11Min.daylight).toBe(0);
    expect(envAt11Min.clockText).toBe('18:00');
  });

  it('produces identical daylight whether stepped 1 tick at a time or in larger dt chunks', () => {
    const s1 = createState({ planetId: 'p1', planetType: 'temperate', seed: 'w02', radius: 4 });
    const s2 = createState({ planetId: 'p1', planetType: 'temperate', seed: 'w02', radius: 4 });
    const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });

    for (let i = 0; i < 660; i++) step(s1, [], 5, pipeline); // 660 * 5 = 3300 ticks (11 min)
    step(s2, [], 3300, pipeline);

    expect(getEnvironment(s1).daylight).toBe(0);
    expect(getEnvironment(s2).daylight).toBe(0);
    expect(getEnvironment(s1)).toEqual(getEnvironment(s2));
  });

  it('supports desert/ocean 0.40 nightShare, storm hook stub, and time spec conversion', () => {
    const desertMidday = computeEnvironmentAtCycleTick('desert', cycleTickForTimeSpec('12:00', 'desert'));
    expect(desertMidday.nightShare).toBe(0.4);
    expect(desertMidday.phase).toBe('day');
    expect(desertMidday.daylight).toBe(1);
    expect(desertMidday.clockText).toBe('12:00');

    const stormMidday = computeEnvironmentAtCycleTick('desert', cycleTickForTimeSpec('12:00', 'desert'), undefined, true);
    expect(stormMidday.stormActive).toBe(true);
    expect(stormMidday.daylight).toBe(0.5);

    const midnight = computeEnvironmentAtCycleTick('temperate', cycleTickForTimeSpec('00:00', 'temperate'));
    expect(midnight.phase).toBe('night');
    expect(midnight.daylight).toBe(0);
    expect(midnight.clockText).toBe('00:00');
  });
});
