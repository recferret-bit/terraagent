import { describe, expect, it } from 'vitest';
import { formatSignedEPerS, gridBalance, readColonyPower, readEntityPower, readPylonLoad } from './power';

describe('grid power readers (shared/power.ts)', () => {
  it('gridBalance shows requested demand and the deficit; a grid without shedding is unchanged', () => {
    expect(gridBalance({ supply: 8, demand: 5, rawDemand: 11, net: 3 })).toEqual({ supply: 8, requested: 11, shed: 6, net: -3, stored: 0 });
    expect(gridBalance({ supply: 28, demand: 11, rawDemand: 11, net: 17 })).toEqual({ supply: 28, requested: 11, shed: 0, net: 17, stored: 0 });
    // older summaries without rawDemand, and the night solar drain already inside the sim's net
    expect(gridBalance({ supply: 8, demand: 14, net: -7 })).toEqual({ supply: 8, requested: 14, shed: 0, net: -7, stored: 0 });
    expect(gridBalance(undefined)).toEqual({ supply: 0, requested: 0, shed: 0, net: 0, stored: 0 });
  });

  it('gridBalance with stores: income is generation, net goes negative at night while the HQ cell / banks carry it', () => {
    // Night, W03 start: 16 generation, 19 requested, the HQ cell discharges 3 (sim supply 19 includes it), nothing shed
    const night = { generationPerS: 16, supply: 19, demand: 19, rawDemand: 19, net: 0, hqCellDischargePerS: 3 };
    expect(gridBalance(night)).toEqual({ supply: 16, requested: 19, shed: 0, net: -3, stored: -3 });
    // Day: surplus 10 refills the cell (8) and a bank (2)
    const day = { generationPerS: 29, supply: 29, demand: 19, rawDemand: 19, net: 10, hqCellChargePerS: 8, capacitorChargePerS: 2 };
    expect(gridBalance(day)).toEqual({ supply: 29, requested: 19, shed: 0, net: 10, stored: 10 });
    // Stores empty: the deficit is shed
    const shed = { generationPerS: 16, supply: 16, demand: 15, rawDemand: 23, net: 1 };
    expect(gridBalance(shed)).toEqual({ supply: 16, requested: 23, shed: 8, net: -7, stored: 0 });
  });

  it('readColonyPower picks the asked colony: col.power, then blobs.power.byColony, then view.power', () => {
    const a = { supply: 1 }, b = { supply: 2 }, c = { supply: 3 };
    expect(readColonyPower({ colonies: [{ index: 0, power: a }, { index: 1, power: b }] }, 1)).toBe(b);
    expect(readColonyPower({ colonies: [{ index: 0 }, { index: 1 }], blobs: { power: { byColony: { 1: c } } } }, 1)).toBe(c);
    expect(readColonyPower({ power: a }, 4)).toBe(a);
  });

  it('readEntityPower and readPylonLoad read from view maps or entities or colony power summary', () => {
    // 1. From view.entityPower / view.pylonLoads directly
    const viewWithMaps = {
      entityPower: { 10: { state: 'offline' as const, reason: 'offline: overload', component: 0 } },
      pylonLoads: { 20: { flow: 85, max: 80, overloaded: true } },
    };
    expect(readEntityPower(viewWithMaps, 10)).toEqual({ state: 'offline', reason: 'offline: overload', component: 0 });
    expect(readPylonLoad(viewWithMaps, 20)).toEqual({ flow: 85, max: 80, overloaded: true });

    // 2. From entities array
    const viewWithEntities = {
      entities: [
        { id: 10, power: { state: 'online' as const, component: 0 } },
        { id: 20, pylon: { flow: 40, max: 80, overloaded: false } },
      ],
    };
    expect(readEntityPower(viewWithEntities, 10)).toEqual({ state: 'online', component: 0 });
    expect(readPylonLoad(viewWithEntities, 20)).toEqual({ flow: 40, max: 80, overloaded: false });

    // 3. Fallback from colonies[0].power
    const viewWithColony = {
      colonies: [
        {
          index: 0,
          power: {
            entityPower: { 10: { state: 'offline' as const, reason: 'offline: brownout', component: 0 } },
            pylonLoads: { 20: { flow: 70, max: 80 } },
          },
        },
      ],
    };
    expect(readEntityPower(viewWithColony, 10)).toEqual({ state: 'offline', reason: 'offline: brownout', component: 0 });
    expect(readPylonLoad(viewWithColony, 20)).toEqual({ flow: 70, max: 80 });
  });

  it('formats signed E/s with a typographic minus', () => {
    expect(formatSignedEPerS(3)).toBe('+3 E/s');
    expect(formatSignedEPerS(-3)).toBe('−3 E/s');
  });
});
