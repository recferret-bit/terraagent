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
  startBuildingConstruction,
  TERRAIN,
  type PlanetState,
} from '@terra/sim';
import { defineScenario } from './_define';

function prepareW03GroundAndDeposits(state: PlanetState): void {
  for (let i = 0; i < state.grid.count; i++) {
    const t = state.grid.layers.terrain[i];
    if (t === TERRAIN.flat || t === TERRAIN.slope || t === TERRAIN.hole || state.grid.layers.deposit[i] !== DEPOSIT.none) {
      state.grid.layers.terrain[i] = TERRAIN.flat;
      state.grid.layers.height[i] = 0.08;
      setTilePrep(state, i, PREP.flat, 0);
    }
  }

  for (let r = -13; r <= 13; r++) {
    for (let q = -13; q <= 13; q++) {
      if (hexDistance(0, 0, q, r) > 13) continue;
      const idx = indexOf(state.grid.radius, q, r);
      if (idx >= 0) {
        state.grid.layers.terrain[idx] = TERRAIN.flat;
        state.grid.layers.height[idx] = 0.08;
        state.grid.layers.deposit[idx] = DEPOSIT.none;
        state.grid.layers.richness[idx] = 0;
        state.grid.layers.owner[idx] = 0;
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
    [10, 0, DEPOSIT.minerals],
    [10, 1, DEPOSIT.minerals],
    [11, 0, DEPOSIT.minerals],
    [11, 1, DEPOSIT.minerals],
    [0, 10, DEPOSIT.minerals],
    [1, 10, DEPOSIT.minerals],
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

function spawnW03StructuresAndUnits(state: PlanetState): void {
  startBuildingConstruction(state, { owner: 0, building: 'commandHub', q: 0, r: 0, instant: true, costOverride: {}, tick: 0 });
  startBuildingConstruction(state, { owner: 0, building: 'metalsExtractor', q: 3, r: 0, instant: true, costOverride: {}, tick: 0 });
  startBuildingConstruction(state, { owner: 0, building: 'solar', q: -3, r: 2, instant: true, costOverride: {}, tick: 0 });

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

  for (const [hq, hr] of [[2, 2], [-2, 2]] as const) {
    const harvId = state.meta.nextEntityId++;
    const harvRow = insertRow(state.entities, harvId, 0);
    state.entities.cols.kind[harvRow] = ENTITY_KIND.harvester;
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

/**
 * W03 The Grid seed scenario (`docs/plan/waves/W03-the-grid.md` §3 & W03-29):
 * - Colony at the end of W02: Command Hub T1 at `(0, 0)`, 1 Metals Extractor T1 at `(3, 0)`, 1 Solar Array T1 at `(-3, 2)`.
 * - Units: HQ T1 at `(2, -1)` + 2 Harvester Drones at `(2, 2)` and `(-2, 2)`.
 * - Starting stock: `metals.t1 400, minerals.t1 250, bio.biomass 200, bio.water 200` (caps `500/500/500`).
 */
export default defineScenario({
  id: 'w03',
  title: 'W03 The Grid',
  waves: '..03',
  seed: 'w03-the-grid',
  planet: { type: 'temperate', planetType: 'temperate', radius: 16 },
  build(_host, api) {
    const state = api.planet;
    const colony = ensureColonyLedger({
      index: 0,
      id: 'col-0',
      name: 'The Grid',
      color: 0xff6b00,
      status: 'active',
      changedAt: 0,
    });
    state.colonies[0] = colony;

    prepareW03GroundAndDeposits(state);
    spawnW03StructuresAndUnits(state);
    revealVision(state, 0, 0, 0, 14, 0);

    creditResource(colony, 'metals.t1', 400, 0);
    creditResource(colony, 'minerals.t1', 250, 0);
    creditResource(colony, 'bio.biomass', 200, 0);
    creditResource(colony, 'bio.water', 200, 0);

    api.command('dev.skipnight', {});
  },
});
