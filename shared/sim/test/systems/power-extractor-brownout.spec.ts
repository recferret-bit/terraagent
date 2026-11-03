import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createRegistryPipeline,
  createState,
  DEPOSIT,
  ENTITY_KIND,
  ENTITY_STATE,
  getColonyPower,
  getHqRechargeRateEPerS,
  indexOf,
  insertRow,
  placeMetalsExtractor,
  rowOf,
  setHqCellEnergy,
  setPlanetTime,
  spawnHqUnit,
  step,
  type PlanetState,
} from '../../src';

/**
 * The owner's report "I built an iron extractor (−6 E/s) and energy is still 200/200": the Command Hub's grid is
 * +8 E/s Founder Core against its own −5 E/s, so one Extractor (−6) is a deficit (11 > 8) and brownout shedding takes
 * it offline (group 3). The "E" the HUD shows as `n / max` is the HQ power cell, which only terraform work drains.
 */
function colonyWithHubHqAndExtractor(): { state: PlanetState; hqRow: number; extRow: number; extId: number } {
  const state = createState({ planetId: 'p1', planetType: 'temperate', seed: 'w02-ext', radius: 10 });
  const cols = state.entities.cols;
  const hubRow = insertRow(state.entities, state.meta.nextEntityId++, 0);
  cols.kind[hubRow] = ENTITY_KIND.commandHub;
  cols.owner[hubRow] = 0;
  cols.footprintW[hubRow] = 3;
  cols.footprintD[hubRow] = 3;
  cols.hp[hubRow] = 1500;
  cols.hpMax[hubRow] = 1500;
  cols.state[hubRow] = ENTITY_STATE.active;
  const hqId = spawnHqUnit(state, { owner: 0, q: 2, r: -1 });
  for (const [q, r] of [[3, 0], [4, 0]] as const) {
    const i = indexOf(state.grid.radius, q, r);
    state.grid.layers.deposit[i] = DEPOSIT.metals;
    state.grid.layers.richness[i] = 10000;
  }
  const placed = placeMetalsExtractor(state, { owner: 0, q: 3, r: 0 });
  if (!placed.ok) throw new Error(`extractor not placed: ${placed.code}`);
  return { state, hqRow: rowOf(state.entities, hqId), extRow: rowOf(state.entities, placed.entityId), extId: placed.entityId };
}

const metals = (state: PlanetState): number => Number((state.colonies[0]?.stock as Record<string, number> | undefined)?.['metals.t1'] ?? 0);

describe('Hub + HQ + one Metals Extractor: the extractor is shed, the HQ cell is not the grid', () => {
  it('sheds the extractor (11 E/s demand > 8 E/s supply), it produces nothing, and the HQ cell stays full', () => {
    const { state, hqRow, extRow, extId } = colonyWithHubHqAndExtractor();
    const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });
    const cellMax = state.entities.cols.cellMax[hqRow];
    const before = metals(state);

    for (let i = 0; i < 50; i++) step(state, [], 1, pipeline);

    const power = getColonyPower(state, 0);
    expect(power.supply).toBe(8);
    expect(power.rawDemand).toBe(11);
    expect(power.demand).toBe(5);
    expect(power.net).toBe(3);
    expect(power.brownout).toBe(true);
    expect(power.shedEntityIds).toEqual([extId]);
    expect(power.offlineReasons[extId]).toBe('offline: brownout');
    expect(state.entities.cols.state[extRow]).toBe(ENTITY_STATE.offlineBrownout);
    expect(metals(state)).toBe(before);
    // `col.power` and `blobs.power` carry the same summary
    const blob = (state.blobs.power?.value as { byColony: Record<number, unknown> }).byColony[0];
    expect(blob).toEqual(power);
    // The HQ cell is separate from the grid: nothing drew from it
    expect(state.entities.cols.cell[hqRow]).toBe(cellMax);
  });

  it('suspends the HQ fast recharge while shed group 3 is shed (3 E/s, not 20 E/s), and restores it with the grid', () => {
    const { state, hqRow, extRow } = colonyWithHubHqAndExtractor();
    const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });
    const cols = state.entities.cols;
    expect(getHqRechargeRateEPerS(state, hqRow)).toBe(20); // no power evaluation yet: fast near the active Hub

    step(state, [], 1, pipeline); // power.core sheds group 3 (the extractor and the HQ fast recharge)
    expect(getColonyPower(state, 0).hqFastRechargeShed).toBe(true);
    expect(getHqRechargeRateEPerS(state, hqRow)).toBe(3);
    setHqCellEnergy(state, hqRow, 100);
    step(state, [], 1, pipeline);
    expect(cols.cell[hqRow]).toBeCloseTo(100.6, 4); // 3 E/s = 0.6 E per tick

    // A midday Solar (+20 net) carries the extractor: group 3 is no longer shed, the fast recharge returns
    setPlanetTime(state, { timeOfDay: 12 }, state.meta.tick); // the environment follows the planet's solar clock each step
    const solarRow = insertRow(state.entities, state.meta.nextEntityId++, state.meta.tick);
    cols.kind[solarRow] = ENTITY_KIND.solar;
    cols.owner[solarRow] = 0;
    cols.q[solarRow] = -3;
    cols.r[solarRow] = 0;
    cols.footprintW[solarRow] = 2;
    cols.footprintD[solarRow] = 2;
    cols.hp[solarRow] = 400;
    cols.state[solarRow] = ENTITY_STATE.active;
    step(state, [], 1, pipeline);
    const power = getColonyPower(state, 0);
    expect(power.brownout).toBe(false);
    expect(power.hqFastRechargeShed).toBe(false);
    expect(cols.state[extRow]).toBe(ENTITY_STATE.active);
    expect(getHqRechargeRateEPerS(state, hqRow)).toBe(20);
    const metalsBefore = metals(state);
    step(state, [], 5, pipeline);
    expect(metals(state)).toBeGreaterThan(metalsBefore); // a powered extractor produces
  });
});
