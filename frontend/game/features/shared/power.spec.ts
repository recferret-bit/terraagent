import { describe, expect, it } from 'vitest';
import { formatSignedEPerS, gridBalance, readColonyPower } from './power';

describe('grid power readers (shared/power.ts)', () => {
  it('gridBalance shows requested demand and the deficit; a grid without shedding is unchanged', () => {
    expect(gridBalance({ supply: 8, demand: 5, rawDemand: 11, net: 3 })).toEqual({ supply: 8, requested: 11, shed: 6, net: -3 });
    expect(gridBalance({ supply: 28, demand: 11, rawDemand: 11, net: 17 })).toEqual({ supply: 28, requested: 11, shed: 0, net: 17 });
    // older summaries without rawDemand, and the night solar drain already inside the sim's net
    expect(gridBalance({ supply: 8, demand: 14, net: -7 })).toEqual({ supply: 8, requested: 14, shed: 0, net: -7 });
    expect(gridBalance(undefined)).toEqual({ supply: 0, requested: 0, shed: 0, net: 0 });
  });

  it('readColonyPower picks the asked colony: col.power, then blobs.power.byColony, then view.power', () => {
    const a = { supply: 1 }, b = { supply: 2 }, c = { supply: 3 };
    expect(readColonyPower({ colonies: [{ index: 0, power: a }, { index: 1, power: b }] }, 1)).toBe(b);
    expect(readColonyPower({ colonies: [{ index: 0 }, { index: 1 }], blobs: { power: { byColony: { 1: c } } } }, 1)).toBe(c);
    expect(readColonyPower({ power: a }, 4)).toBe(a);
  });

  it('formats signed E/s with a typographic minus', () => {
    expect(formatSignedEPerS(3)).toBe('+3 E/s');
    expect(formatSignedEPerS(-3)).toBe('−3 E/s');
  });
});
