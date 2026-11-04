import {
  creditResource,
  DEPOSIT,
  ensureColonyLedger,
  ENTITY_KIND,
  ENTITY_STATE,
  hexDistance,
  hexIndex,
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

function seedW04TerrainAndBiomeSamples(state: PlanetState): void {
  const radius = state.grid.radius;
  const hx = hexIndex(radius);

  for (let i = 0; i < state.grid.count; i++) {
    const q = hx.q[i]!;
    const r = hx.r[i]!;
    if (hexDistance(0, 0, q, r) <= 10 || hexDistance(7, 0, q, r) <= 4) {
      state.grid.layers.terrain[i] = TERRAIN.flat;
      state.grid.layers.height[i] = 0.08;
      state.grid.layers.deposit[i] = DEPOSIT.none;
      state.grid.layers.richness[i] = 0;
      setTilePrep(state, i, PREP.flat, 0);
    }
  }

  for (const [q, r] of [[0, -2], [1, -2], [-1, -1]] as const) {
    const idx = indexOf(radius, q, r);
    if (idx >= 0) setTilePrep(state, idx, PREP.living, 0);
  }
  for (const [q, r] of [[-4, 2], [-4, 3], [-3, 3]] as const) {
    const idx = indexOf(radius, q, r);
    if (idx >= 0) {
      state.grid.layers.terrain[idx] = TERRAIN.shallow;
      setTilePrep(state, idx, PREP.wild, 0);
    }
  }
  for (const [q, r] of [[3, -3], [4, -3]] as const) {
    const idx = indexOf(radius, q, r);
    if (idx >= 0) {
      state.grid.layers.terrain[idx] = TERRAIN.forest;
      setTilePrep(state, idx, PREP.wild, 0);
    }
  }
  for (const [q, r] of [[-3, -2], [-2, -3]] as const) {
    const idx = indexOf(radius, q, r);
    if (idx >= 0) {
      state.grid.layers.terrain[idx] = TERRAIN.rock;
      setTilePrep(state, idx, PREP.wild, 0);
    }
  }
}

function spawnW04Unit(
  state: PlanetState,
  owner: number,
  kind: number,
  q: number,
  r: number,
): void {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, 0);
  state.entities.cols.kind[row] = kind;
  state.entities.cols.owner[row] = owner;
  state.entities.cols.tier[row] = 1;
  placeSpawnedEntity(state.entities, row, q, r, 0);
  state.entities.cols.hp[row] = 400;
  state.entities.cols.hpMax[row] = 400;
  state.entities.cols.cell[row] = 200;
  state.entities.cols.cellMax[row] = 200;
  state.entities.cols.workRate[row] = 1.0;
  state.entities.cols.state[row] = ENTITY_STATE.idle;
}

/**
 * W04 Maps & Camera seed scenario (`docs/plan/waves/W04-maps-camera.md` §1 & W04-33):
 * - Two colonies on a radius-16 temperate planet (Colony 0 at `(0, 0)` and foreign Colony 1 at `(7, 0)`).
 * - Varied tile states (Prepared grey, Living green, Forest, Rock, Shallow water blue) and partial exploration.
 */
export default defineScenario({
  id: 'w04',
  title: 'W04 Maps & Camera',
  waves: '..04',
  seed: 'w04-maps-camera',
  planet: { type: 'temperate', planetType: 'temperate', radius: 16 },
  build(_host, api) {
    const state = api.planet;
    const colony0 = ensureColonyLedger({
      index: 0,
      id: 'col-0',
      name: 'First Light',
      color: 0xff6b00,
      status: 'active',
      changedAt: 0,
    });
    const colony1 = ensureColonyLedger({
      index: 1,
      id: 'col-1',
      name: 'Vanguard Colony',
      color: 0x38bdf8,
      status: 'active',
      changedAt: 0,
    });
    state.colonies[0] = colony0;
    state.colonies[1] = colony1;

    seedW04TerrainAndBiomeSamples(state);

    startBuildingConstruction(state, {
      owner: 0,
      building: 'commandHub',
      q: 0,
      r: 0,
      instant: true,
      costOverride: {},
      tick: 0,
    });
    startBuildingConstruction(state, {
      owner: 1,
      building: 'commandHub',
      q: 7,
      r: 0,
      instant: true,
      costOverride: {},
      tick: 0,
    });

    spawnW04Unit(state, 0, ENTITY_KIND.hq, 2, -1);
    spawnW04Unit(state, 0, ENTITY_KIND.harvester, -2, 1);
    spawnW04Unit(state, 1, ENTITY_KIND.hq, 6, 1);
    spawnW04Unit(state, 1, ENTITY_KIND.harvester, 6, -1);

    revealVision(state, 0, 0, 0, 10, 0);
    revealVision(state, 0, 7, 0, 4, 0);

    creditResource(colony0, 'metals.t1', 400, 0);
    creditResource(colony0, 'minerals.t1', 250, 0);
    creditResource(colony0, 'bio.biomass', 150, 0);
    creditResource(colony0, 'bio.water', 150, 0);

    api.command('dev.skipnight', {});
  },
});
