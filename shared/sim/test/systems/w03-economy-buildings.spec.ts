import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  compileData,
  createRegistryPipeline,
  createState,
  creditResource,
  demolishBuilding,
  DEPOSIT,
  ensureColonyLedger,
  ENTITY_KIND,
  ENTITY_STATE,
  evaluatePlacement,
  hexIndex,
  insertRow,
  placeMineralsQuarry,
  placeSupplyDepot,
  placeWaterExtractor,
  placementWorldFromState,
  PREP,
  resolveEconomyBuildingRow,
  resolvePlacementRule,
  setTileDeposit,
  setTilePrep,
  setTileTerrain,
  startBuildingConstruction,
  step,
  TERRAIN,
  type PlanetState,
} from '../../src';
import { resolveBuildingRow as resolveEconomyConstructionRow } from '../../src/systems/economy/buildingRows';
import { resourceValue } from '../../src/systems/economy/ledger';

function createCleanFlatPlanet(planetType: 'temperate' | 'desert' = 'temperate', radius = 8): PlanetState {
  const state = createState({ planetId: `p-${planetType}`, planetType, seed: 'w03-11', radius });
  for (let i = 0; i < state.grid.count; i++) {
    setTileTerrain(state, i, TERRAIN.flat, 0);
    setTilePrep(state.grid, i, PREP.prepared, 0);
    setTileDeposit(state, i, DEPOSIT.none, 0, 0);
    state.grid.layers.height[i] = 0;
  }
  const colony = ensureColonyLedger({
    index: 0,
    id: 'col-0',
    name: 'Alpha',
    color: 0xff6b00,
    status: 'active',
    changedAt: 0,
  });
  state.colonies.push(colony);
  return state;
}

function spawnActiveHubAndSolar(state: PlanetState): void {
  const hubRow = insertRow(state.entities, state.meta.nextEntityId++, 0);
  state.entities.cols.kind[hubRow] = ENTITY_KIND.commandHub;
  state.entities.cols.owner[hubRow] = 0;
  state.entities.cols.q[hubRow] = 0;
  state.entities.cols.r[hubRow] = 0;
  state.entities.cols.footprintW[hubRow] = 3;
  state.entities.cols.footprintD[hubRow] = 3;
  state.entities.cols.hp[hubRow] = 1500;
  state.entities.cols.hpMax[hubRow] = 1500;
  state.entities.cols.state[hubRow] = ENTITY_STATE.active;

  const solarRow = insertRow(state.entities, state.meta.nextEntityId++, 0);
  state.entities.cols.kind[solarRow] = ENTITY_KIND.solar;
  state.entities.cols.owner[solarRow] = 0;
  state.entities.cols.q[solarRow] = -3;
  state.entities.cols.r[solarRow] = 0;
  state.entities.cols.footprintW[solarRow] = 2;
  state.entities.cols.footprintD[solarRow] = 2;
  state.entities.cols.hp[solarRow] = 400;
  state.entities.cols.hpMax[solarRow] = 400;
  state.entities.cols.state[solarRow] = ENTITY_STATE.active;
}

describe('W03-11 Minerals Quarry T1 placement & production', () => {
  it('off deposit -> rejected site_blocked (no deposit); on minerals deposit -> produces +0.75 * richness/s minerals.t1', () => {
    const state = createCleanFlatPlanet('temperate', 8);
    spawnActiveHubAndSolar(state);
    const pipeline = createRegistryPipeline({ flags: parseWaves('..03') });

    const evalOff = evaluatePlacement(placementWorldFromState(state), {
      colonyId: 0,
      building: 'mineralsQuarry',
      q: 2,
      r: 1,
      requireBuilder: false,
    });
    expect(evalOff).toMatchObject({ ok: false, code: 'site_blocked', block: 'noDeposit' });
    expect(placeMineralsQuarry(state, { owner: 0, q: 2, r: 1 })).toEqual({ ok: false, code: 'site_blocked', detail: 'no deposit' });
    expect(startBuildingConstruction(state, { owner: 0, building: 'mineralsQuarry', q: 2, r: 1, instant: true })).toEqual({
      ok: false,
      code: 'site_blocked',
      detail: 'no deposit',
    });

    const idx = hexIndex(state.grid.radius);
    setTileDeposit(state, idx.indexOf(3, 1), DEPOSIT.metals, 10000, 0);
    expect(placeMineralsQuarry(state, { owner: 0, q: 2, r: 1 })).toEqual({
      ok: false,
      code: 'site_blocked',
      detail: 'no deposit',
    });

    setTileDeposit(state, idx.indexOf(3, 1), DEPOSIT.minerals, 12000, 0);
    expect(
      evaluatePlacement(placementWorldFromState(state), {
        colonyId: 0,
        building: 'mineralsQuarry',
        q: 2,
        r: 1,
        requireBuilder: false,
      }).ok,
    ).toBe(true);

    const placedOn = placeMineralsQuarry(state, { owner: 0, q: 2, r: 1 });
    expect(placedOn.ok).toBe(true);
    if (!placedOn.ok) throw new Error('expected ok');
    expect(placedOn.richnessMult).toBeCloseTo(1.2, 5);

    step(state, [], 5, pipeline);
    const colony = ensureColonyLedger(state.colonies[0]);
    expect(resourceValue(colony, 'minerals.t1')).toBeCloseTo(0.9, 5);
    expect(colony.production.incomePerS['minerals.t1']).toBeCloseTo(0.9, 4);
    expect(colony.production.familyIncomePerS.minerals).toBeCloseTo(0.9, 4);

    creditResource(colony, 'minerals.t1', 500, state.meta.tick);
    step(state, [], 5, pipeline);
    expect(colony.stock['minerals.t1']).toBe(500);
    expect(colony.production.incomePerS['minerals.t1']).toBe(0);
  });
});

describe('W03-11 Supply Depot T1 storage caps & Water Extractor T1 production', () => {
  it('Supply Depot T1: placing a Depot raises family caps 500 -> 1500 (+1000 each), and demolishing lowers them back to 500', () => {
    const state = createCleanFlatPlanet('temperate', 8);
    spawnActiveHubAndSolar(state);
    const colony = ensureColonyLedger(state.colonies[0]);
    expect(colony.caps).toEqual({ metals: 500, minerals: 500, bio: 500 });

    const d1 = placeSupplyDepot(state, { owner: 0, q: 2, r: 1 });
    expect(d1.ok).toBe(true);
    if (!d1.ok) throw new Error('expected ok');
    expect(colony.caps).toEqual({ metals: 1500, minerals: 1500, bio: 1500 });

    const d2 = startBuildingConstruction(state, {
      owner: 0,
      building: 'supplyDepot',
      q: 2,
      r: -2,
      instant: true,
      costOverride: {},
    });
    expect(d2.ok).toBe(true);
    if (!d2.ok) throw new Error('expected ok');
    expect(colony.caps).toEqual({ metals: 2500, minerals: 2500, bio: 2500 });

    expect(demolishBuilding(state, d2.entityId, 0).ok).toBe(true);
    expect(colony.caps).toEqual({ metals: 1500, minerals: 1500, bio: 1500 });

    expect(demolishBuilding(state, d1.entityId, 0).ok).toBe(true);
    expect(colony.caps).toEqual({ metals: 500, minerals: 500, bio: 500 });
  });

  it('Water Extractor T1: produces +0.875 bio.water/s on temperate and 0.5x (+0.4375/s) on desert without requiring a deposit', () => {
    const tempState = createCleanFlatPlanet('temperate', 8);
    spawnActiveHubAndSolar(tempState);
    const pipeline = createRegistryPipeline({ flags: parseWaves('..03') });

    expect(placeWaterExtractor(tempState, { owner: 0, q: 2, r: 1 })).toMatchObject({ ok: true, outputMult: 1.0 });
    step(tempState, [], 5, pipeline);
    const tempCol = ensureColonyLedger(tempState.colonies[0]);
    expect(resourceValue(tempCol, 'bio.water')).toBeCloseTo(0.875, 5);
    expect(tempCol.production.incomePerS['bio.water']).toBeCloseTo(0.875, 4);
    expect(tempCol.production.familyIncomePerS.bio).toBeCloseTo(0.875, 4);

    const desertState = createCleanFlatPlanet('desert', 8);
    spawnActiveHubAndSolar(desertState);
    expect(placeWaterExtractor(desertState, { owner: 0, q: 2, r: 1 })).toMatchObject({ ok: true, outputMult: 0.5 });
    step(desertState, [], 5, pipeline);
    const desertCol = ensureColonyLedger(desertState.colonies[0]);
    expect(resourceValue(desertCol, 'bio.water')).toBeCloseTo(0.4375, 5);
    expect(desertCol.production.incomePerS['bio.water']).toBeCloseTo(0.4375, 4);
    expect(desertCol.production.incomePerS['bio.water']).toBeCloseTo(tempCol.production.incomePerS['bio.water'] * 0.5, 5);
  });

  it('respects ..02 wave gating for W03 buildings in resolvePlacementRule and resolveBuildingRow', () => {
    const w02Data = compileData(parseWaves('..02'));
    expect(resolvePlacementRule('metalsExtractor', w02Data)).not.toBeNull();
    expect(resolveEconomyBuildingRow('solar', w02Data)).not.toBeNull();
    expect(resolveEconomyConstructionRow('solar', w02Data)).not.toBeNull();
    expect(resolvePlacementRule('mineralsQuarry', w02Data)).toBeNull();
    expect(resolvePlacementRule('supplyDepot', w02Data)).toBeNull();
    expect(resolvePlacementRule('waterExtractor', w02Data)).toBeNull();
    expect(resolveEconomyBuildingRow('supplyDepot', w02Data)).toBeNull();
    expect(resolveEconomyConstructionRow('supplyDepot', w02Data)).toBeNull();
  });
});
