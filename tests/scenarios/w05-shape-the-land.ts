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
  syncColonyTerraformStats,
  TERRAIN,
  type PlanetState,
} from '@terra/sim';
import { defineScenario } from './_define';

/** 6 Shallow-water tiles in `Hex r=1` around `(-4, 1)` (Demo Step 4). */
export const W05_SHALLOW_LAKE_TILES: ReadonlyArray<readonly [number, number]> = [
  [-4, 1],
  [-4, 0],
  [-3, 0],
  [-5, 1],
  [-3, 1],
  [-5, 2],
];

/** 1 Deep-water tile at the lake edge (Demo Step 1 / locked Deep Reclaim; excluded from eligibleOwnedTiles). */
export const W05_DEEP_LAKE_TILE = [-4, 2] as const;

/** 10 Prepared meadow tiles south of the Hub inside both `Hex r=2` at `(1, 4)` and `Rect (-1, 3)..(3, 5)` (Demo Step 5). */
export const W05_PREPARED_MEADOW_TILES: ReadonlyArray<readonly [number, number]> = [
  [0, 3],
  [1, 3],
  [2, 3],
  [3, 3],
  [-1, 4],
  [0, 4],
  [1, 4],
  [2, 4],
  [3, 4],
  [1, 5],
];

function claimW05Territory(state: PlanetState): void {
  for (let i = 0; i < state.grid.count; i++) {
    state.grid.layers.terrain[i] = TERRAIN.flat;
    state.grid.layers.height[i] = 0.08;
    state.grid.layers.deposit[i] = DEPOSIT.none;
    state.grid.layers.richness[i] = 0;
    state.grid.layers.owner[i] = -1;
    setTilePrep(state, i, PREP.flat, 0);
  }

  // Own 397 tiles in radius 11 + 16 tiles on ring 12 = 413 owned tiles total.
  // With 1 Deep-water tile at (-4, 2), eligibleOwnedTiles === 412 (so 10 Living tiles = 2.4 %).
  for (let r = -11; r <= 11; r++) {
    for (let q = -11; q <= 11; q++) {
      if (hexDistance(0, 0, q, r) > 11) continue;
      const idx = indexOf(state.grid.radius, q, r);
      if (idx >= 0) state.grid.layers.owner[idx] = 0;
    }
  }
  const extraRing12: ReadonlyArray<readonly [number, number]> = [
    [0, -12], [1, -12], [2, -12], [3, -12], [4, -12], [5, -12], [6, -12],
    [7, -12], [8, -12], [9, -12], [10, -12], [11, -12], [12, -12],
    [-12, 0], [-12, 1], [-12, 2],
  ];
  for (const [q, r] of extraRing12) {
    const idx = indexOf(state.grid.radius, q, r);
    if (idx >= 0) state.grid.layers.owner[idx] = 0;
  }
}

function seedW05FeaturesAndDeposits(state: PlanetState): void {
  // Metals deposits under the two northern Metals Extractors: (-3, -2) and (1, -6).
  for (const [q, r] of [[-3, -2], [-2, -2], [1, -6], [2, -6]] as const) {
    const idx = indexOf(state.grid.radius, q, r);
    if (idx >= 0) {
      state.grid.layers.deposit[idx] = DEPOSIT.metals;
      state.grid.layers.richness[idx] = 10000;
    }
  }

  // Step 3: 2x2 Minerals Quarry site at (4, 0) -> 2 slope + 1 hole + 1 flat (Level x2, Fill x1, Grade x4).
  for (const [q, r] of [[4, 0], [5, 0]] as const) {
    const idx = indexOf(state.grid.radius, q, r);
    if (idx >= 0) {
      state.grid.layers.terrain[idx] = TERRAIN.slope;
      state.grid.layers.height[idx] = 0.32;
      state.grid.layers.deposit[idx] = DEPOSIT.minerals;
      state.grid.layers.richness[idx] = 10000;
      setTilePrep(state, idx, PREP.flat, 0);
    }
  }
  const holeIdx = indexOf(state.grid.radius, 4, 1);
  if (holeIdx >= 0) {
    state.grid.layers.terrain[holeIdx] = TERRAIN.hole;
    state.grid.layers.height[holeIdx] = 0.02;
    setTilePrep(state, holeIdx, PREP.flat, 0);
  }
  const flatIdx = indexOf(state.grid.radius, 5, 1);
  if (flatIdx >= 0) {
    state.grid.layers.terrain[flatIdx] = TERRAIN.flat;
    state.grid.layers.height[flatIdx] = 0.08;
    setTilePrep(state, flatIdx, PREP.flat, 0);
  }

  // Step 4: Shallow lake (6 shallow tiles + 1 deep tile) west of the Hub.
  for (const [q, r] of W05_SHALLOW_LAKE_TILES) {
    const idx = indexOf(state.grid.radius, q, r);
    if (idx >= 0) {
      state.grid.layers.terrain[idx] = TERRAIN.shallow;
      state.grid.layers.height[idx] = 0.01;
      setTilePrep(state, idx, PREP.flat, 0);
    }
  }
  const deepIdx = indexOf(state.grid.radius, W05_DEEP_LAKE_TILE[0], W05_DEEP_LAKE_TILE[1]);
  if (deepIdx >= 0) {
    state.grid.layers.terrain[deepIdx] = TERRAIN.deep;
    state.grid.layers.height[deepIdx] = -0.05;
    setTilePrep(state, deepIdx, PREP.flat, 0);
  }

  // Step 5: 10 Prepared meadow tiles south of the Hub.
  for (const [q, r] of W05_PREPARED_MEADOW_TILES) {
    const idx = indexOf(state.grid.radius, q, r);
    if (idx >= 0) {
      state.grid.layers.terrain[idx] = TERRAIN.flat;
      state.grid.layers.height[idx] = 0.08;
      setTilePrep(state, idx, PREP.prepared, 0);
    }
  }
}

function spawnW05StructuresAndUnits(state: PlanetState): void {
  startBuildingConstruction(state, { owner: 0, building: 'commandHub', q: 0, r: 0, instant: true, costOverride: {}, tick: 0 });
  for (const [q, r] of [[1, -4], [3, -4], [5, -4], [3, -6]] as const) {
    startBuildingConstruction(state, { owner: 0, building: 'solar', q, r, instant: true, costOverride: {}, tick: 0 });
  }
  startBuildingConstruction(state, { owner: 0, building: 'supplyDepot', q: 5, r: -6, instant: true, costOverride: {}, tick: 0 });
  startBuildingConstruction(state, { owner: 0, building: 'waterExtractor', q: 2, r: -2, instant: true, costOverride: {}, tick: 0 });
  startBuildingConstruction(state, { owner: 0, building: 'metalsExtractor', q: -3, r: -2, instant: true, costOverride: {}, tick: 0 });
  startBuildingConstruction(state, { owner: 0, building: 'metalsExtractor', q: 1, r: -6, instant: true, costOverride: {}, tick: 0 });

  const spawnUnit = (kind: number, q: number, r: number, hp: number, cell: number, workRate: number) => {
    const id = state.meta.nextEntityId++;
    const row = insertRow(state.entities, id, 0);
    state.entities.cols.kind[row] = kind;
    state.entities.cols.owner[row] = 0;
    state.entities.cols.tier[row] = 1;
    placeSpawnedEntity(state.entities, row, q, r, 0);
    state.entities.cols.hp[row] = hp;
    state.entities.cols.hpMax[row] = hp;
    state.entities.cols.cell[row] = cell;
    state.entities.cols.cellMax[row] = cell;
    state.entities.cols.workRate[row] = workRate;
    state.entities.cols.state[row] = ENTITY_STATE.idle;
  };

  spawnUnit(ENTITY_KIND.hq, 2, 1, 900, 800, 1.5);
  spawnUnit(ENTITY_KIND.builder, 2, 2, 150, 100, 1.0);
  spawnUnit(ENTITY_KIND.harvester, -2, 1, 120, 100, 0.5);
  spawnUnit(ENTITY_KIND.harvester, -2, 2, 120, 100, 0.5);
}

/**
 * W05 Shape the Land seed scenario (`docs/plan/waves/W05-shape-the-land.md` §2 steps 1–5, 11):
 * - S4 `temperate` colony with 412 eligible owned tiles (`0 / 412 (0.0 %)` at start, `10 / 412 (2.4 %)` after seeding 10 tiles).
 * - East `(4, 0)..(5, 1)`: 2 slope + 1 hole + 1 flat Minerals Quarry site (`Level ×2, Fill ×1, Grade ×4`).
 * - West `(-5, 0)..(-3, 2)`: shallow lake (`6` `TERRAIN.shallow` tiles in `Hex r=1` around `(-4, 1)` + `1` `TERRAIN.deep` at `(-4, 2)`).
 * - South `(-1, 3)..(3, 5)`: `10` Prepared meadow tiles inside `Hex r=2` around `(1, 4)` for Irrigate → Seed.
 */
export default defineScenario({
  id: 'w05',
  title: 'W05 Shape the Land',
  waves: '..05',
  seed: 'w05-shape-the-land',
  planet: { type: 'temperate', planetType: 'temperate', radius: 16 },
  build(_host, api) {
    const state = api.planet;
    const colony = ensureColonyLedger({
      index: 0,
      id: 'col-0',
      name: 'Shape the Land',
      color: 0xff6b00,
      status: 'active',
      stage: 4,
      unlockStage: 4,
      changedAt: 0,
    });
    state.colonies[0] = colony;

    claimW05Territory(state);
    seedW05FeaturesAndDeposits(state);
    spawnW05StructuresAndUnits(state);
    // Re-applyterritory & features after Hub completion's R=10 claim so exact 412 eligible owned tiles hold.
    claimW05Territory(state);
    seedW05FeaturesAndDeposits(state);
    // Keep pre-built building footprints Prepared without adding extra open Prepared tiles.
    for (const [q, r, size] of [
      [0, 0, 3],
      [1, -4, 2],
      [3, -4, 2],
      [5, -4, 2],
      [3, -6, 2],
      [5, -6, 2],
      [2, -2, 2],
      [-3, -2, 2],
      [1, -6, 2],
    ] as const) {
      const minOff = -Math.floor((size - 1) / 2);
      for (let dr = minOff; dr < minOff + size; dr++) {
        for (let dq = minOff; dq < minOff + size; dq++) {
          const idx = indexOf(state.grid.radius, q + dq, r + dr);
          if (idx >= 0) setTilePrep(state, idx, PREP.prepared, 0);
        }
      }
    }
    syncColonyTerraformStats(state, 0, 0);
    revealVision(state, 0, 0, 0, 14, 0);

    creditResource(colony, 'metals.t1', 800, 0);
    creditResource(colony, 'minerals.t1', 600, 0);
    creditResource(colony, 'bio.biomass', 400, 0);
    creditResource(colony, 'bio.water', 600, 0);

    api.command('dev.skipnight', {});
    api.settle(5);
  },
});
