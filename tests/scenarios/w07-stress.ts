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

function prepareStressTerrain(state: PlanetState): void {
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
      if (dist <= 12) {
        state.grid.layers.owner[idx] = 0;
        setTilePrep(state, idx, PREP.prepared, 0);
      } else {
        setTilePrep(state, idx, PREP.flat, 0);
      }
    }
  }
}

function spawnStressColonyAndArmy(state: PlanetState): void {
  startBuildingConstruction(state, { owner: 0, building: 'commandHub', q: 0, r: 0, instant: true, costOverride: {}, tick: 0 });
  startBuildingConstruction(state, { owner: 0, building: 'roboticsFactory', q: 3, r: 3, instant: true, costOverride: {}, tick: 0 });
  startBuildingConstruction(state, { owner: 0, building: 'solar', q: -3, r: 2, instant: true, costOverride: {}, tick: 0 });
  startBuildingConstruction(state, { owner: 0, building: 'solar', q: -3, r: -1, instant: true, costOverride: {}, tick: 0 });
  startBuildingConstruction(state, { owner: 0, building: 'wind', q: 0, r: -4, instant: true, costOverride: {}, tick: 0 });
  startBuildingConstruction(state, { owner: 0, building: 'wind', q: 3, r: -4, instant: true, costOverride: {}, tick: 0 });
  startBuildingConstruction(state, { owner: 0, building: 'supplyDepot', q: -3, r: -3, instant: true, costOverride: {}, tick: 0 });

  for (const [dq, dr] of [[2, -3], [1, -3], [-1, -3], [-2, -3]] as const) {
    startBuildingConstruction(state, { owner: 0, building: 'droneControlArray', q: dq, r: dr, instant: true, costOverride: {}, tick: 0 });
  }
  const turretPosts: Array<[number, number, number, number, number, number]> = [
    [4, 0, 6, 0, 6, -1],
    [-4, 0, -6, 0, -6, 1],
    [0, 4, 0, 6, -1, 6],
    [0, -6, 0, -7, 1, -7],
  ];
  for (const [pq, pr, aq, ar, lq, lr] of turretPosts) {
    startBuildingConstruction(state, { owner: 0, building: 'pylon', q: pq, r: pr, instant: true, costOverride: {}, tick: 0 });
    startBuildingConstruction(state, { owner: 0, building: 'autocannon', q: aq, r: ar, instant: true, costOverride: {}, tick: 0 });
    startBuildingConstruction(state, { owner: 0, building: 'laserTower', q: lq, r: lr, instant: true, costOverride: {}, tick: 0 });
  }

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

  const reconPositions: Array<[number, number]> = [
    [7, -1], [7, 0], [7, 1], [8, -1], [8, 0], [8, 1],
    [-7, -1], [-7, 0], [-7, 1], [0, 7], [1, 7], [-1, 7],
  ];
  for (const [rq, rr] of reconPositions) {
    const id = state.meta.nextEntityId++;
    const row = insertRow(state.entities, id, 0);
    state.entities.cols.kind[row] = ENTITY_KIND.recon;
    state.entities.cols.owner[row] = 0;
    state.entities.cols.tier[row] = 1;
    placeSpawnedEntity(state.entities, row, rq, rr, 0);
    state.entities.cols.hp[row] = 160;
    state.entities.cols.hpMax[row] = 160;
    state.entities.cols.state[row] = ENTITY_STATE.idle;
  }
}

function spawnStressHives(state: PlanetState): void {
  const hives: Array<{ species: 'blackAnt' | 'blueBeetle' | 'greenSpitter'; q: number; r: number; eq: number; er: number; count: number }> = [
    { species: 'blackAnt', q: 30, r: 0, eq: 28, er: 0, count: 12 },
    { species: 'blackAnt', q: -30, r: 0, eq: -28, er: 0, count: 12 },
    { species: 'blueBeetle', q: 0, r: 30, eq: 0, er: 28, count: 3 },
    { species: 'blueBeetle', q: 0, r: -30, eq: 0, er: -28, count: 3 },
    { species: 'greenSpitter', q: 24, r: -24, eq: 22, er: -22, count: 6 },
    { species: 'greenSpitter', q: -24, r: 24, eq: -22, er: 22, count: 6 },
  ];
  for (const h of hives) {
    spawnHiveSite(state, { species: h.species, q: h.q, r: h.r, entranceQ: h.eq, entranceR: h.er, initialResidents: h.count }, 0);
    revealVision(state, 0, h.q, h.r, 6, 0);
  }
  revealVision(state, 0, 0, 0, 16, 0);
}

/**
 * W07 Stress scenario (`docs/plan/waves/W07-first-contact.md` W07-30 & W07-32):
 * - 6 species hives (2 `blackAnt`, 2 `blueBeetle`, 2 `greenSpitter`) with full resident populations (42 bugs).
 * - Armed S3 colony with Robotics Factory, 4 Drone Control Arrays, 4 Autocannons, 4 Laser Towers, and 12 Recon Drones.
 */
export default defineScenario({
  id: 'w07-stress',
  title: 'W07 First Contact Stress',
  waves: '..07',
  seed: 'w07-stress',
  planet: { type: 'temperate', planetType: 'temperate', radius: 36 },
  build(_host, api) {
    const state = api.planet;
    const colony = ensureColonyLedger({
      index: 0,
      id: 'col-0',
      name: 'Bastion',
      color: 0xff6b00,
      status: 'active',
      stage: 3,
      unlockStage: 3,
      threatStage: 3,
      changedAt: 0,
    });
    state.colonies[0] = colony;

    prepareStressTerrain(state);
    spawnStressColonyAndArmy(state);
    spawnStressHives(state);

    creditResource(colony, 'metals.t1', 1200, 0);
    creditResource(colony, 'minerals.t1', 1000, 0);
    creditResource(colony, 'bio.biomass', 800, 0);
    creditResource(colony, 'bio.water', 800, 0);

    api.command('dev.skipnight', {});
  },
});
