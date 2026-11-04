import {
  creditResource,
  DEPOSIT,
  ensureColonyLedger,
  ENTITY_KIND,
  ENTITY_STATE,
  getBuildingFootprintTiles,
  hexDistance,
  indexOf,
  insertRow,
  placeSpawnedEntity,
  PREP,
  revealVision,
  setTilePrep,
  startBuildingConstruction,
  syncColonyTerraformStats,
  TERRAIN,
  type PlanetState,
} from '@terra/sim';
import { defineScenario } from './_define';

const RINGED_EXTRACTOR_POS = { q: 3, r: 0 } as const;
const UNTERRAFORMED_EXTRACTOR_POS = { q: -5, r: 0 } as const;

function minDistToFootprint(q: number, r: number, anchorQ: number, anchorR: number, size = 2): number {
  let best = Infinity;
  for (const fp of getBuildingFootprintTiles(anchorQ, anchorR, size)) {
    const d = hexDistance(q, r, fp.q, fp.r);
    if (d < best) best = d;
  }
  return best;
}

function prepareW05TiersGround(state: PlanetState): void {
  for (let i = 0; i < state.grid.count; i++) {
    state.grid.layers.terrain[i] = TERRAIN.flat;
    state.grid.layers.height[i] = 0.08;
    state.grid.layers.deposit[i] = DEPOSIT.none;
    state.grid.layers.richness[i] = 0;
    state.grid.layers.owner[i] = -1;
    setTilePrep(state, i, PREP.flat, 0);
  }

  // Own all 397 tiles within radius 11 of (0, 0).
  const ownedIndices: number[] = [];
  for (let r = -11; r <= 11; r++) {
    for (let q = -11; q <= 11; q++) {
      if (hexDistance(0, 0, q, r) > 11) continue;
      const idx = indexOf(state.grid.radius, q, r);
      if (idx >= 0) {
        state.grid.layers.owner[idx] = 0;
        ownedIndices.push(idx);
      }
    }
  }

  // Mark tiles as Living so the ringed extractor's R=2 ring is 100% Living and colony Terraform % === 31.0 % (123 / 397).
  const targetLivingCount = 123;
  let livingCount = 0;
  const reservedPrepared = new Set<number>();

  const reserveFootprint = (aq: number, ar: number, size: number) => {
    for (const fp of getBuildingFootprintTiles(aq, ar, size)) {
      const idx = indexOf(state.grid.radius, fp.q, fp.r);
      if (idx >= 0) {
        reservedPrepared.add(idx);
        setTilePrep(state, idx, PREP.prepared, 0);
      }
    }
  };

  reserveFootprint(0, 0, 3); // Command Hub
  reserveFootprint(RINGED_EXTRACTOR_POS.q, RINGED_EXTRACTOR_POS.r, 2);
  reserveFootprint(UNTERRAFORMED_EXTRACTOR_POS.q, UNTERRAFORMED_EXTRACTOR_POS.r, 2);
  reserveFootprint(0, -3, 2); // Solar #1
  reserveFootprint(3, -3, 2); // Solar #2
  reserveFootprint(-2, 0, 1); // Pylon #1
  reserveFootprint(-3, 0, 1); // Pylon #2

  // First, make every non-reserved tile within 2 hexes of RINGED_EXTRACTOR_POS Living.
  for (let r = -11; r <= 11; r++) {
    for (let q = -11; q <= 11; q++) {
      if (hexDistance(0, 0, q, r) > 11) continue;
      const idx = indexOf(state.grid.radius, q, r);
      if (idx < 0 || reservedPrepared.has(idx)) continue;
      const distRinged = minDistToFootprint(q, r, RINGED_EXTRACTOR_POS.q, RINGED_EXTRACTOR_POS.r, 2);
      if (distRinged >= 1 && distRinged <= 2) {
        setTilePrep(state, idx, PREP.living, 0);
        livingCount++;
      }
    }
  }

  // Next, fill additional east/south owned tiles (far from UNTERRAFORMED_EXTRACTOR_POS) until livingCount === 123 (31.0 %).
  for (let r = -11; r <= 11 && livingCount < targetLivingCount; r++) {
    for (let q = -11; q <= 11 && livingCount < targetLivingCount; q++) {
      if (hexDistance(0, 0, q, r) > 11) continue;
      const idx = indexOf(state.grid.radius, q, r);
      if (idx < 0 || reservedPrepared.has(idx)) continue;
      if (state.grid.layers.prep[idx] === PREP.living) continue;
      const distPlain = minDistToFootprint(q, r, UNTERRAFORMED_EXTRACTOR_POS.q, UNTERRAFORMED_EXTRACTOR_POS.r, 2);
      if (distPlain <= 3) continue; // Keep the second extractor's ring completely unterraformed (0 %).
      setTilePrep(state, idx, PREP.living, 0);
      livingCount++;
    }
  }

  // Seed the two metals deposits under the two extractors.
  for (const [q, r] of [
    [RINGED_EXTRACTOR_POS.q, RINGED_EXTRACTOR_POS.r],
    [RINGED_EXTRACTOR_POS.q, RINGED_EXTRACTOR_POS.r + 1],
    [UNTERRAFORMED_EXTRACTOR_POS.q, UNTERRAFORMED_EXTRACTOR_POS.r],
    [UNTERRAFORMED_EXTRACTOR_POS.q, UNTERRAFORMED_EXTRACTOR_POS.r + 1],
  ] as const) {
    const idx = indexOf(state.grid.radius, q, r);
    if (idx >= 0) {
      state.grid.layers.deposit[idx] = DEPOSIT.metals;
      state.grid.layers.richness[idx] = 10000;
    }
  }
}

function spawnW05TiersColony(state: PlanetState): void {
  startBuildingConstruction(state, { owner: 0, building: 'commandHub', q: 0, r: 0, instant: true, costOverride: {}, tick: 0 });
  startBuildingConstruction(state, {
    owner: 0,
    building: 'metalsExtractor',
    q: RINGED_EXTRACTOR_POS.q,
    r: RINGED_EXTRACTOR_POS.r,
    instant: true,
    costOverride: {},
    tick: 0,
  });
  startBuildingConstruction(state, {
    owner: 0,
    building: 'metalsExtractor',
    q: UNTERRAFORMED_EXTRACTOR_POS.q,
    r: UNTERRAFORMED_EXTRACTOR_POS.r,
    instant: true,
    costOverride: {},
    tick: 0,
  });
  startBuildingConstruction(state, { owner: 0, building: 'solar', q: 0, r: -3, instant: true, costOverride: {}, tick: 0 });
  startBuildingConstruction(state, { owner: 0, building: 'solar', q: 3, r: -3, instant: true, costOverride: {}, tick: 0 });
  startBuildingConstruction(state, { owner: 0, building: 'pylon', q: -2, r: 0, instant: true, costOverride: {}, tick: 0 });
  startBuildingConstruction(state, { owner: 0, building: 'pylon', q: -3, r: 0, instant: true, costOverride: {}, tick: 0 });

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
}

/**
 * W05-34 Resource Tiers scenario (`docs/plan/waves/W05-shape-the-land.md` §2 step 13 & W05-34):
 * - Colony Terraform % = 31.0 % (123 / 397 owned tiles Living).
 * - Ringed Metals Extractor T1 at `(3, 0)`: ringed by Living tiles (`>= 50 %` in R=2) -> yields 70 % `metals.t1` / 30 % `metals.t2`.
 * - Unterraformed Metals Extractor T1 at `(-5, 0)`: `0 %` terraformed ring -> stays 100 % `metals.t1`.
 */
export default defineScenario({
  id: 'w05-tiers',
  title: 'W05 Resource Tiers (D-34)',
  waves: '..05',
  seed: 'w05-tiers',
  planet: { type: 'temperate', planetType: 'temperate', radius: 16 },
  build(_host, api) {
    const state = api.planet;
    const colony = ensureColonyLedger({
      index: 0,
      id: 'col-0',
      name: 'Terraformed Rings',
      color: 0xff6b00,
      status: 'active',
      stage: 4,
      unlockStage: 4,
      changedAt: 0,
    });
    state.colonies[0] = colony;

    prepareW05TiersGround(state);
    spawnW05TiersColony(state);
    syncColonyTerraformStats(state, 0, 0);
    revealVision(state, 0, 0, 0, 14, 0);

    creditResource(colony, 'metals.t1', 200, 0);
    creditResource(colony, 'minerals.t1', 150, 0);
    creditResource(colony, 'bio.biomass', 100, 0);
    creditResource(colony, 'bio.water', 100, 0);

    api.command('dev.skipnight', {});
    api.settle(5);
  },
});
