import {
  creditResource,
  DEPOSIT,
  ensureColonyLedger,
  ENTITY_KIND,
  ENTITY_STATE,
  hexDistance,
  indexOf,
  insertRow,
  placeSpawnedEntity,
  PREP,
  revealVision,
  setTilePrep,
  spawnHiveSite,
  startBuildingConstruction,
  TERRAIN,
  type PlanetState,
} from '@terra/sim';
import { defineScenario } from './_define';

function prepareW07TerrainAndDeposits(state: PlanetState): void {
  for (let r = -state.grid.radius; r <= state.grid.radius; r++) {
    for (let q = -state.grid.radius; q <= state.grid.radius; q++) {
      const dist = hexDistance(0, 0, q, r);
      if (dist > state.grid.radius) continue;
      const idx = indexOf(state.grid.radius, q, r);
      if (idx < 0) continue;
      state.grid.layers.terrain[idx] = TERRAIN.flat;
      state.grid.layers.height[idx] = 0.08;
      state.grid.layers.deposit[idx] = DEPOSIT.none;
      state.grid.layers.richness[idx] = 0;
      if (dist <= 11) {
        state.grid.layers.owner[idx] = 0;
        setTilePrep(state, idx, PREP.prepared, 0);
      } else {
        setTilePrep(state, idx, PREP.flat, 0);
      }
    }
  }

  const deposits: Array<[number, number, number]> = [
    [3, 0, DEPOSIT.metals],
    [3, 1, DEPOSIT.metals],
    [6, 0, DEPOSIT.metals],
    [6, 1, DEPOSIT.metals],
    [0, 3, DEPOSIT.minerals],
    [1, 3, DEPOSIT.minerals],
    [-4, 0, DEPOSIT.oil],
    [-3, 0, DEPOSIT.oil],
  ];
  for (const [q, r, dep] of deposits) {
    const idx = indexOf(state.grid.radius, q, r);
    if (idx >= 0) {
      state.grid.layers.terrain[idx] = TERRAIN.flat;
      state.grid.layers.height[idx] = 0.08;
      state.grid.layers.deposit[idx] = dep;
      state.grid.layers.richness[idx] = 10000;
      setTilePrep(state, idx, PREP.flat, 0);
    }
  }
}

function spawnW07ColonyStructuresAndWorkers(state: PlanetState): void {
  startBuildingConstruction(state, { owner: 0, building: 'commandHub', q: 0, r: 0, instant: true, costOverride: {}, tick: 0 });
  startBuildingConstruction(state, { owner: 0, building: 'metalsExtractor', q: 3, r: 0, instant: true, costOverride: {}, tick: 0 });
  startBuildingConstruction(state, { owner: 0, building: 'mineralsQuarry', q: 0, r: 3, instant: true, costOverride: {}, tick: 0 });
  startBuildingConstruction(state, { owner: 0, building: 'solar', q: -3, r: 2, instant: true, costOverride: {}, tick: 0 });
  startBuildingConstruction(state, { owner: 0, building: 'solar', q: -3, r: -1, instant: true, costOverride: {}, tick: 0 });
  startBuildingConstruction(state, { owner: 0, building: 'wind', q: 0, r: -4, instant: true, costOverride: {}, tick: 0 });
  startBuildingConstruction(state, { owner: 0, building: 'wind', q: -4, r: -2, instant: true, costOverride: {}, tick: 0 });
  startBuildingConstruction(state, { owner: 0, building: 'wind', q: -5, r: 3, instant: true, costOverride: {}, tick: 0 });
  startBuildingConstruction(state, { owner: 0, building: 'wind', q: -2, r: 5, instant: true, costOverride: {}, tick: 0 });
  startBuildingConstruction(state, { owner: 0, building: 'capacitor', q: -2, r: -3, instant: true, costOverride: {}, tick: 0 });
  startBuildingConstruction(state, { owner: 0, building: 'pylon', q: 5, r: -1, instant: true, costOverride: {}, tick: 0 });
  startBuildingConstruction(state, { owner: 0, building: 'pylon', q: -5, r: 0, instant: true, costOverride: {}, tick: 0 });
  startBuildingConstruction(state, { owner: 0, building: 'pylon', q: 0, r: 6, instant: true, costOverride: {}, tick: 0 });

  const hqId = state.meta.nextEntityId++;
  const hqRow = insertRow(state.entities, hqId, 0);
  state.entities.cols.kind[hqRow] = ENTITY_KIND.hq;
  state.entities.cols.owner[hqRow] = 0;
  state.entities.cols.tier[hqRow] = 1;
  placeSpawnedEntity(state.entities, hqRow, 2, -1, 0);
  state.entities.cols.hp[hqRow] = 900;
  state.entities.cols.hpMax[hqRow] = 900;
  state.entities.cols.cell[hqRow] = 800;
  state.entities.cols.cellMax[hqRow] = 800;
  state.entities.cols.workRate[hqRow] = 1.5;
  state.entities.cols.state[hqRow] = ENTITY_STATE.idle;

  // 2 Builder Drones (2 supply) + 5 Harvester Drones (5 supply) = 7 / 10 starting supply.
  for (const [bq, br] of [[-2, -1], [1, -2]] as const) {
    const bId = state.meta.nextEntityId++;
    const bRow = insertRow(state.entities, bId, 0);
    state.entities.cols.kind[bRow] = ENTITY_KIND.worker;
    state.entities.cols.owner[bRow] = 0;
    state.entities.cols.tier[bRow] = 2;
    placeSpawnedEntity(state.entities, bRow, bq, br, 0);
    state.entities.cols.hp[bRow] = 140;
    state.entities.cols.hpMax[bRow] = 140;
    state.entities.cols.cell[bRow] = 120;
    state.entities.cols.cellMax[bRow] = 120;
    state.entities.cols.workRate[bRow] = 1.5;
    state.entities.cols.state[bRow] = ENTITY_STATE.idle;
  }

  for (const [hq, hr] of [[2, 2], [-2, 2], [2, 1], [-1, 2], [1, 2]] as const) {
    const harvId = state.meta.nextEntityId++;
    const harvRow = insertRow(state.entities, harvId, 0);
    state.entities.cols.kind[harvRow] = ENTITY_KIND.worker;
    state.entities.cols.owner[harvRow] = 0;
    state.entities.cols.tier[harvRow] = 1;
    placeSpawnedEntity(state.entities, harvRow, hq, hr, 0);
    state.entities.cols.hp[harvRow] = 120;
    state.entities.cols.hpMax[harvRow] = 120;
    state.entities.cols.cell[harvRow] = 100;
    state.entities.cols.cellMax[harvRow] = 100;
    state.entities.cols.workRate[harvRow] = 0.5;
    state.entities.cols.state[harvRow] = ENTITY_STATE.idle;
  }
}

function spawnW07SpeciesHives(state: PlanetState): void {
  // Three passive species-specific hives at least 30 tiles away from (0, 0).
  spawnHiveSite(state, { species: 'blackAnt', q: 30, r: 0, entranceQ: 28, entranceR: 0, initialResidents: 6 }, 0);
  spawnHiveSite(state, { species: 'blueBeetle', q: -15, r: 30, entranceQ: -14, entranceR: 28, initialResidents: 2 }, 0);
  spawnHiveSite(state, { species: 'greenSpitter', q: -30, r: 15, entranceQ: -28, entranceR: 14, initialResidents: 4 }, 0);

  revealVision(state, 0, 0, 0, 14, 0);
  // Remote hives must be discovered by a scout, just like in normal gameplay.
}

/**
 * W07 First Contact seed scenario (`docs/plan/waves/W07-first-contact.md` §1 & W07-32):
 * - S3 colony at `(0, 0)` with Command Hub T1, Metals Extractor, Minerals Quarry, 2 Solar Arrays, Wind Turbine,
 *   Capacitor Bank, and Pylons (prepared pads around the Hub ready for Factory, DCA, Autocannon, and Laser Tower).
 * - Starting workers: HQ T1 + 2 Builders + 5 Harvesters (`7 / 10` supply so 3 Recon reach `10 / 10`).
 * - Three passive species-specific hives (`blackAnt`, `blueBeetle`, `greenSpitter`) at distance 30 tiles from `(0, 0)`.
 */
export default defineScenario({
  id: 'w07',
  title: 'W07 First Contact',
  waves: '..07',
  seed: 'w07-first-contact',
  planet: { type: 'temperate', planetType: 'temperate', radius: 36 },
  build(_host, api) {
    const state = api.planet;
    const colony = ensureColonyLedger({
      index: 0,
      id: 'col-0',
      name: 'First Contact',
      color: 0xff6b00,
      status: 'active',
      stage: 3,
      unlockStage: 3,
      threatStage: 3,
      changedAt: 0,
    });
    state.colonies[0] = colony;

    prepareW07TerrainAndDeposits(state);
    spawnW07ColonyStructuresAndWorkers(state);
    spawnW07SpeciesHives(state);

    creditResource(colony, 'metals.t1', 500, 0);
    creditResource(colony, 'minerals.t1', 500, 0);
    creditResource(colony, 'bio.biomass', 250, 0);
    creditResource(colony, 'bio.water', 250, 0);

    api.command('dev.skipnight', {});
  },
});
