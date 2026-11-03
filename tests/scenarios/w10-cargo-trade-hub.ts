import {
  creditResource,
  DEPOSIT,
  ensureColonyLedger,
  ENTITY_KIND,
  ENTITY_STATE,
  indexOf,
  insertRow,
  placeSpawnedEntity,
  PREP,
  recomputeFamilyCaps,
  revealVision,
  setTilePrep,
  startBuildingConstruction,
  TERRAIN,
  type PlanetState,
} from '@terra/sim';
import { defineScenario } from './_define';

function prepareW10Basin(state: PlanetState): void {
  for (let i = 0; i < state.grid.count; i++) {
    const t = state.grid.layers.terrain[i];
    if (t === TERRAIN.flat || t === TERRAIN.slope || t === TERRAIN.hole || state.grid.layers.deposit[i] !== DEPOSIT.none) {
      state.grid.layers.terrain[i] = TERRAIN.flat;
      state.grid.layers.height[i] = 0.08;
      setTilePrep(state, i, PREP.flat, 0);
    }
  }
  for (let r = -8; r <= 8; r++) {
    for (let q = -8; q <= 8; q++) {
      const idx = indexOf(state.grid.radius, q, r);
      if (idx >= 0) {
        state.grid.layers.terrain[idx] = TERRAIN.flat;
        state.grid.layers.height[idx] = 0.08;
        state.grid.layers.deposit[idx] = DEPOSIT.none;
        state.grid.layers.richness[idx] = 0;
        setTilePrep(state, idx, PREP.flat, 0);
      }
    }
  }
  for (const rRange of [[1, 3], [-3, -1]] as const) {
    for (let r = rRange[0]; r <= rRange[1]; r++) {
      for (let q = 2; q <= 4; q++) {
        const idx = indexOf(state.grid.radius, q, r);
        if (idx >= 0) {
          state.grid.layers.terrain[idx] = TERRAIN.flat;
          state.grid.layers.height[idx] = 0.08;
          setTilePrep(state, idx, PREP.prepared, 0);
        }
      }
    }
  }
  const deposits: Array<[number, number, number]> = [
    [5, 0, DEPOSIT.metals],
    [5, 1, DEPOSIT.metals],
    [0, 5, DEPOSIT.minerals],
    [1, 5, DEPOSIT.minerals],
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

/**
 * W10 Cargo & Trade Hub seed scenario (`docs/plan/waves/W10-cargo-trade-hub.md` §1 & W10-30):
 * - Stage 2 colony (`stage: 2`, `tradeHubAtS2: true`).
 * - Command Hub T1 completed at `(0, 0)`, Solar Collector T1 at `(-3, 2)`, and an online Trade Hub T1 at `(2, 1)`.
 * - Prepared tiles at `q: 2..4, r: -3..-1` for additional building placement.
 * - HQ T1 worker ready at `(0, 3)` (`workRate = 1.5×`).
 * - Starting stock: `900 metals.t1`, `400 minerals.t1`, `300 bio.water`, `200 bio.biomass` (storage cap `1500/1500/1500`).
 * - Morning (`06:00`, `daylight = 1.0`, `phase = 'day'`).
 */
export const w10CargoTradeHubScenario = defineScenario({
  id: 'w10',
  title: 'W10 Cargo & Trade Hub',
  waves: '..10',
  seed: 'w10-cargo-trade-hub',
  planet: { type: 'temperate', planetType: 'temperate', radius: 16 },
  build(_host, api) {
    const state = api.planet;
    const rawPlanetId = state.meta.planetId;
    const colonyId =
      rawPlanetId && rawPlanetId !== 'pl_dev'
        ? `col-0-${rawPlanetId.slice(-8).toLowerCase()}`
        : 'col-0';
    const colony = ensureColonyLedger(
      {
        index: 0,
        id: colonyId,
        name: 'Orbital Port',
        color: 0xff6b00,
        status: 'active',
        stage: 2,
        tradeHubAtS2: true,
        neighborContact: true,
        contactFake: false,
        guildVisit: false,
        changedAt: 0,
      },
      { depotCount: 2 },
    );
    state.colonies[0] = colony;
    prepareW10Basin(state);

    // Complete Command Hub T1 at (0, 0), Solar Collector T1 at (-3, 2), and online Trade Hub T1 at (2, 1)
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
      owner: 0,
      building: 'solar',
      q: -3,
      r: 2,
      instant: true,
      costOverride: {},
      tick: 0,
    });
    startBuildingConstruction(state, {
      owner: 0,
      building: 'tradeHub',
      q: 2,
      r: 1,
      instant: true,
      costOverride: {},
      tick: 0,
    });

    // Storage cap at 1,500 per family so starting stock of 900 metals.t1 fits with 600 free room
    recomputeFamilyCaps(colony, true, 2, 0);

    // Spawn HQ T1 worker at (0, 3)
    const hqId = state.meta.nextEntityId++;
    const hqRow = insertRow(state.entities, hqId, 0);
    state.entities.cols.kind[hqRow] = ENTITY_KIND.hq;
    state.entities.cols.owner[hqRow] = 0;
    state.entities.cols.tier[hqRow] = 1;
    placeSpawnedEntity(state.entities, hqRow, 0, 3, 0);
    state.entities.cols.hp[hqRow] = 800;
    state.entities.cols.hpMax[hqRow] = 800;
    state.entities.cols.cell[hqRow] = 200;
    state.entities.cols.cellMax[hqRow] = 200;
    state.entities.cols.workRate[hqRow] = 1.5;
    state.entities.cols.state[hqRow] = ENTITY_STATE.idle;
    revealVision(state, 0, 0, 0, 10, 0);

    // Seed starting stock: 900 metals.t1, 400 minerals.t1, 300 bio.water, 200 bio.biomass
    creditResource(colony, 'metals.t1', 900, 0);
    creditResource(colony, 'minerals.t1', 400, 0);
    creditResource(colony, 'bio.water', 300, 0);
    creditResource(colony, 'bio.biomass', 200, 0);

    // Ensure morning (06:00, daylight = 1.0) and evaluate initial power (+28 supply / -11 demand / +17 E/s net)
    api.command('dev.skipnight', {});
  },
});

export default w10CargoTradeHubScenario;
