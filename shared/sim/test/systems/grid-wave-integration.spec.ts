import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  BUILDING_KIND, UNIT_KIND, ENTITY_KIND, ENTITY_STATE, compileData, countColonyEntities,
  createState, ensureColonyRecord, evaluateColonyPower, insertRow, placeSpawnedEntity,
} from '../../src';

function fixture() {
  const state = createState({ planetId: 'grid-integration', planetType: 'temperate', seed: 'grid-integration', radius: 12 });
  const colony = ensureColonyRecord(state, 0, 0);
  const spawn = (kind: number, q: number, r: number, tier = 1) => {
    const row = insertRow(state.entities, state.meta.nextEntityId++, 0);
    const c = state.entities.cols;
    c.kind[row] = kind; c.owner[row] = 0; c.tier[row] = tier;
    c.hp[row] = c.hpMax[row] = 800; c.state[row] = ENTITY_STATE.active;
    placeSpawnedEntity(state.entities, row, q, r, 0);
    return row;
  };
  return { state, colony, spawn, data: compileData(parseWaves('..12')) };
}

describe('W03 integration with landed progression and trade', () => {
  it('preserves Trade Hub wire identity and counts live builders, pylons and depots correctly', () => {
    expect(ENTITY_KIND.tradeHub).toBe(8);
    expect(ENTITY_KIND.worker).not.toBe(ENTITY_KIND.tradeHub);
    expect(UNIT_KIND.worker).toBe(ENTITY_KIND.worker);
    expect(BUILDING_KIND.pylon).toBe(ENTITY_KIND.pylon);
    expect(BUILDING_KIND.depot).toBe(ENTITY_KIND.supplyDepot);
    const { state, spawn } = fixture();
    spawn(ENTITY_KIND.worker, 0, 0);
    spawn(ENTITY_KIND.pylon, 1, 0);
    spawn(ENTITY_KIND.supplyDepot, 2, 0);
    const counts = countColonyEntities(state, 0);
    expect(counts.completedBuildings).toBe(2);
    expect(counts.buildingCountsByKind.pylon).toBe(1);
    expect(counts.buildingCountsByKind.depot).toBe(1);
    expect(counts.unitCountsByKind.worker).toBe(1);
  });

  it('retains tiered Trade Hub draw, cuts power despite stored energy, and restores the grid', () => {
    const { state, colony, spawn, data } = fixture();
    spawn(ENTITY_KIND.commandHub, 0, 0);
    const trade = spawn(ENTITY_KIND.tradeHub, 3, -2, 2);
    const hq = spawn(ENTITY_KIND.hq, 0, 3);
    state.entities.cols.cell[hq] = state.entities.cols.cellMax[hq] = 800;
    const live = evaluateColonyPower(state, 0, data, 1);
    expect(live.rawDemand).toBe(Number(data.tables.hub.t1.powerDrainPerS) + Number(data.tables.tradeHub.t2.powerDrainPerS));
    colony.powerSupplyOverride = 0;
    const off = evaluateColonyPower(state, 0, data, 2);
    expect(off.supply).toBe(0);
    expect(state.entities.cols.cell[hq]).toBe(800);
    expect(state.entities.cols.state[trade]).toBe(ENTITY_STATE.offlineBrownout);
    colony.powerSupplyOverride = null;
    evaluateColonyPower(state, 0, data, 3);
    expect(state.entities.cols.state[trade]).toBe(ENTITY_STATE.active);
  });
});
