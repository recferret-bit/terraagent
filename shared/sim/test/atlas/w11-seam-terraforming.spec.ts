import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  applyCrossSectorDiffChunks,
  applyCrossSectorTerraformPreviewAndJoin,
  applyDiff,
  claimTerritoryRadius,
  collectCrossSectorDiffChunks,
  createAtlasPlanetState,
  creditResource,
  DEPOSIT,
  diffChunks,
  ENTITY_KIND,
  ENTITY_STATE,
  evaluateCrossSectorPlacement,
  executeCrossSectorTerraformOp,
  flattenDuneFootprint,
  flattenMeteorCraterFootprint,
  generateSmallAtlas,
  globalTileToSector,
  hexDistance,
  hexIndex,
  hexTileCenter,
  hexTileDisk,
  insertRow,
  inspectCrossSeamBiomeFeatures,
  inspectCrossSeamHexTileFootprint,
  isHexTile,
  isHexTileCenter,
  isTileUneven,
  MAX_DIFF_PAYLOAD_BYTES,
  MAX_TILE_DIFF_PER_DELTA,
  PREP,
  restore,
  SimHost,
  snapshot,
  TERRAIN,
  touchTile,
  verifyAtlasSeamContinuity,
  type PlanetState,
} from '../../src';

function createReplicaState(source: PlanetState): PlanetState {
  return restore(snapshot(source));
}

describe('W11-47: D-45 7-Sub-Tile Hex-Tile Footprints Across Sector Seams', () => {
  it('partitions global axial coordinates into 7-sub-tile hex-tile disks across 2-sector and 3-sector seams', () => {
    const desertState = createAtlasPlanetState({
      planetId: 'p_dune_seam',
      planetType: 'desert',
      seed: 'w11-47-d45-lattice',
    });

    for (let q = 20; q <= 28; q++) {
      for (let r = -10; r <= 4; r++) {
        const center = hexTileCenter(q, r);
        expect(isHexTileCenter(center.q, center.r)).toBe(true);
        expect(hexDistance(q, r, center.q, center.r)).toBeLessThanOrEqual(1);
        const disk = hexTileDisk(center.q, center.r);
        expect(disk).toHaveLength(7);
        expect(disk.some((pt) => pt.q === q && pt.r === r)).toBe(true);
      }
    }

    const twoSectorFootprint = inspectCrossSeamHexTileFootprint(desertState, 24, -8);
    expect(twoSectorFootprint.diskSubTiles).toHaveLength(7);
    expect(twoSectorFootprint.straddlesSectorSeam).toBe(true);
    expect(twoSectorFootprint.diskSectorIds).toEqual(['sec_0_0', 'sec_1_0']);
    expect(twoSectorFootprint.r4SectorIds).toContain('sec_0_0');
    expect(twoSectorFootprint.r4SectorIds).toContain('sec_1_0');

    const threeSectorFootprint = inspectCrossSeamHexTileFootprint(desertState, 24, 0);
    expect(threeSectorFootprint.diskSubTiles).toHaveLength(7);
    expect(threeSectorFootprint.straddlesSectorSeam).toBe(true);
    expect(threeSectorFootprint.diskSectorIds).toEqual(['sec_0_0', 'sec_0_1', 'sec_1_0']);
    expect(threeSectorFootprint.r4Tiles.length).toBeGreaterThanOrEqual(55);
  });
});

describe('W11-47: Desert Cross-Seam 7-Sub-Tile Flatten & R4 Plane Join', () => {
  it('flattens a 7-sub-tile hex-tile straddling a 2-sector seam and 3-sector corner on a desert world', () => {
    const atlas = generateSmallAtlas({
      planetId: 'p_arrakis_seam',
      planetType: 'desert',
      seed: 'w11-47-desert-seam-join',
    });
    const state = createAtlasPlanetState({
      planetId: 'p_arrakis_seam',
      planetType: 'desert',
      seed: 'w11-47-desert-seam-join',
    });
    const L = state.grid.layers;

    const seamRes = executeCrossSectorTerraformOp(state, {
      q: 24,
      r: -8,
      op: 'flatten',
      targetHeightM: 1.4,
      snapToLattice: true,
      atlas,
    });
    expect(seamRes.straddlesSectorSeam).toBe(true);
    expect(seamRes.diskSectorIds).toEqual(['sec_0_0', 'sec_1_0']);
    expect(seamRes.diskChanges).toHaveLength(7);
    expect(seamRes.footprintReport.isUniformHexTilePlane).toBe(true);
    expect(seamRes.footprintReport.allDiskTilesEven).toBe(true);
    expect(seamRes.footprintReport.maxDiskHeightSpreadM).toBeLessThanOrEqual(1e-5);
    expect(seamRes.footprintReport.maxR4SeamStepM).toBeLessThanOrEqual(0.36);

    for (const tile of seamRes.footprintReport.diskSubTiles) {
      expect(tile.terrain).toBe(TERRAIN.flat);
      expect(tile.prep).toBe(PREP.prepared);
      expect(tile.height).toBeCloseTo(1.4, 4);
      expect(isTileUneven(state.grid.radius, tile.tileIdx, L.terrain, L.height)).toBe(false);
    }

    const cornerRes = executeCrossSectorTerraformOp(state, {
      q: 24,
      r: 0,
      op: 'flatten',
      targetHeightM: 1.25,
      snapToLattice: false,
      atlas,
    });
    expect(cornerRes.diskSectorIds).toEqual(['sec_0_0', 'sec_0_1', 'sec_1_0']);
    expect(cornerRes.footprintReport.isUniformHexTilePlane).toBe(true);
    expect(cornerRes.footprintReport.allDiskTilesEven).toBe(true);
    expect(cornerRes.footprintReport.maxR4SeamStepM).toBeLessThanOrEqual(0.36);

    for (const tile of cornerRes.footprintReport.diskSubTiles) {
      const sec = atlas.sectorById.get(tile.sectorId)!;
      expect(sec.terrain[tile.localIndex]).toBe(TERRAIN.flat);
      expect(sec.prep[tile.localIndex]).toBe(PREP.prepared);
      expect(sec.height[tile.localIndex]).toBeCloseTo(1.25, 4);
    }
  });
});

describe('W11-47: Desert Dunes, Craters, Raise/Lower & Placement Across Seams', () => {
  it('supports dune flattening, crater filling, raise/lower, and cross-seam building placement', () => {
    const state = createAtlasPlanetState({
      planetId: 'p_arrakis_ops',
      planetType: 'desert',
      seed: 'w11-47-desert-ops',
    });
    const hex = hexIndex(state.grid.radius);

    for (const pt of hexTileDisk(24, -6)) {
      const idx = hex.indexOf(pt.q, pt.r);
      state.grid.layers.terrain[idx] = TERRAIN.slope;
      state.grid.layers.prep[idx] = PREP.wild;
      state.grid.layers.height[idx] = 2.4;
    }

    const duneRes = flattenDuneFootprint(state, 24, -6, 8);
    expect(duneRes.count).toBeGreaterThanOrEqual(7);

    const joinRes = executeCrossSectorTerraformOp(state, {
      q: 24,
      r: -6,
      op: 'flatten',
      targetHeightM: 1.2,
      diskRadius: 3,
      r4Radius: 5,
    });
    expect(joinRes.straddlesSectorSeam).toBe(true);
    expect(joinRes.diskSectorIds).toEqual(['sec_0_0', 'sec_1_0']);

    for (const m of joinRes.diskChanges) {
      state.grid.layers.deposit[m.tileIdx] = DEPOSIT.none;
    }
    const hqRow = insertRow(state.entities, state.meta.nextEntityId++, 9);
    state.entities.cols.kind[hqRow] = ENTITY_KIND.hq;
    state.entities.cols.owner[hqRow] = 0;
    state.entities.cols.q[hqRow] = 22;
    state.entities.cols.r[hqRow] = -6;
    state.entities.cols.hp[hqRow] = 500;
    state.entities.cols.hpMax[hqRow] = 500;
    state.entities.cols.state[hqRow] = ENTITY_STATE.idle;

    claimTerritoryRadius(state, { colonyId: 0, q: 24, r: -6, radius: 6, tick: 9 });
    const placement = evaluateCrossSectorPlacement(state, {
      colonyId: 0,
      building: 'commandHub',
      q: 24,
      r: -6,
    });
    expect(placement.ok).toBe(true);
    expect(placement.straddlesSectorBoundary).toBe(true);
    expect(placement.footprintSectorIds).toEqual(['sec_0_0', 'sec_1_0']);

    const raised = executeCrossSectorTerraformOp(state, { q: 24, r: -12, op: 'raise' });
    const lowered = executeCrossSectorTerraformOp(state, { q: 24, r: -12, op: 'lower' });
    expect(lowered.targetHeightM).toBeLessThan(raised.targetHeightM);

    for (const pt of hexTileDisk(24, -15)) {
      const idx = hex.indexOf(pt.q, pt.r);
      state.grid.layers.terrain[idx] = TERRAIN.hole;
      state.grid.layers.prep[idx] = PREP.wild;
    }
    const craterRes = flattenMeteorCraterFootprint(state, 24, -15, 9);
    expect(craterRes.count).toBeGreaterThanOrEqual(7);
  });
});

describe('W11-47: Ocean Cross-Seam Reclaim, Dredge & SimHost Task Execution', () => {
  it('reclaims and dredges a 7-sub-tile hex-tile straddling 2-sector and 3-sector seams on an ocean world', () => {
    const state = createAtlasPlanetState({
      planetId: 'p_pelagic_seam',
      planetType: 'ocean',
      seed: 'w11-47-ocean-seam-join',
    });
    const hex = hexIndex(state.grid.radius);
    const L = state.grid.layers;

    for (const pt of hexTileDisk(24, 0)) {
      const idx = hex.indexOf(pt.q, pt.r);
      L.terrain[idx] = TERRAIN.shallow;
      L.prep[idx] = PREP.wild;
      L.height[idx] = -0.18;
    }

    const reclaimRes = executeCrossSectorTerraformOp(state, {
      q: 24,
      r: 0,
      op: 'reclaim',
      targetHeightM: 0.85,
      snapToLattice: false,
    });
    expect(reclaimRes.diskSectorIds).toEqual(['sec_0_0', 'sec_0_1', 'sec_1_0']);
    expect(reclaimRes.footprintReport.isUniformHexTilePlane).toBe(true);
    expect(reclaimRes.footprintReport.allDiskTilesEven).toBe(true);
    expect(reclaimRes.footprintReport.maxR4SeamStepM).toBeLessThanOrEqual(0.36);

    for (const tile of reclaimRes.footprintReport.diskSubTiles) {
      expect(tile.terrain).toBe(TERRAIN.flat);
      expect(tile.prep).toBe(PREP.prepared);
      expect(tile.height).toBeCloseTo(0.85, 4);
      expect(isHexTile(state.grid.radius, tile.tileIdx, { terrain: L.terrain, prep: L.prep, height: L.height })).toBe(
        tile.distFromCenter === 0 ? true : tile.isHexTile,
      );
    }

    const dredgeRes = executeCrossSectorTerraformOp(state, {
      q: 24,
      r: -8,
      op: 'dredge',
      snapToLattice: true,
    });
    expect(dredgeRes.straddlesSectorSeam).toBe(true);
    expect(dredgeRes.diskSectorIds).toEqual(['sec_0_0', 'sec_1_0']);
    expect(dredgeRes.footprintReport.maxR4SeamStepM).toBeLessThanOrEqual(0.36);
    for (const tile of dredgeRes.footprintReport.diskSubTiles) {
      expect(tile.terrain).toBe(TERRAIN.shallow);
      expect(tile.height).toBeLessThanOrEqual(0);
    }
  });
});

describe('W11-47: SimHost EnqueueTask Terraform & Cross-Sector R4 Preview', () => {
  it('executes SimHost enqueueTask terraform commands on a sector seam tile and previews the R4 join', () => {
    const state = createAtlasPlanetState({
      planetId: 'p_ocean_host',
      planetType: 'ocean',
      seed: 'w11-47-host-enqueue',
    });
    const host = new SimHost({ flags: parseWaves('..05') });
    host.load(state);
    host.submit({
      colonyIndex: 0,
      source: 'dev',
      commandId: 'w11_47_land',
      kind: 'dev.land',
      args: { q: 23, r: -6 },
    });
    host.step(1);
    host.state.colonies[0]!.unlockStage = 4;

    const hex = hexIndex(host.state.grid.radius);
    const seamIdx = hex.indexOf(24, -6);
    host.state.grid.layers.terrain[seamIdx] = TERRAIN.shallow;
    host.state.grid.layers.prep[seamIdx] = PREP.wild;
    host.state.grid.layers.height[seamIdx] = -0.18;
    claimTerritoryRadius(host.state, { colonyId: 0, q: 24, r: -6, radius: 3, tick: host.tick });
    creditResource(host.state.colonies[0]!, 'minerals.t1', 500, host.tick);
    creditResource(host.state.colonies[0]!, 'metals.t1', 500, host.tick);

    host.submit({
      colonyIndex: 0,
      source: 'player',
      commandId: 'w11_47_reclaim_seam',
      kind: 'enqueueTask',
      args: { terraform: { op: 'reclaim', tiles: [{ q: 24, r: -6 }] } },
    });
    const stepOut = host.step(1);
    expect(stepOut.outcomes[0]?.code).toBeUndefined();

    const preview = applyCrossSectorTerraformPreviewAndJoin(host.state, {
      q: 24,
      r: -6,
      op: 'reclaim',
      targetHeightM: 0.25,
    });
    expect(preview.straddlesSectorSeam).toBe(true);
    expect(preview.r4SpansMultipleSectors).toBe(true);
    expect(preview.diskSectorIds).toEqual(['sec_0_0', 'sec_1_0']);
  });
});

describe('W11-47: Desert & Ocean Small-Atlas Generators Across Sector Seams', () => {
  it('generates continuous R4 heights, multi-tile dunes/mesas, and hex-tile deposits on desert and ocean seams', () => {
    const desertAtlas = generateSmallAtlas({
      planetId: 'p_desert_gen',
      planetType: 'desert',
      seed: 'w11-47-desert-generator',
    });
    const desertSeam = verifyAtlasSeamContinuity(desertAtlas);
    expect(desertSeam.ok).toBe(true);
    expect(desertSeam.violations).toHaveLength(0);
    expect(desertSeam.totalSeamPairs).toBeGreaterThan(200);

    const desertState = createAtlasPlanetState({
      planetId: 'p_desert_gen',
      planetType: 'desert',
      seed: 'w11-47-desert-generator',
    });
    const desertFeatures = inspectCrossSeamBiomeFeatures(desertState);
    expect(desertFeatures.planetType).toBe('desert');
    expect(desertFeatures.totalSeamEdges).toBeGreaterThan(200);
    expect(desertFeatures.crossSeamDuneEdges + desertFeatures.crossSeamRockEdges).toBeGreaterThan(0);
    expect(desertFeatures.crossSeamHexTileCount).toBeGreaterThan(20);
    expect(desertFeatures.visibleDepositCount).toBeGreaterThan(0);
    expect(desertFeatures.maxSeamHeightStepM).toBeLessThan(1.5);

    const oceanAtlas = generateSmallAtlas({
      planetId: 'p_ocean_gen',
      planetType: 'ocean',
      seed: 'w11-47-ocean-generator',
    });
    const oceanSeam = verifyAtlasSeamContinuity(oceanAtlas);
    expect(oceanSeam.ok).toBe(true);
    expect(oceanSeam.violations).toHaveLength(0);

    const oceanState = createAtlasPlanetState({
      planetId: 'p_ocean_gen',
      planetType: 'ocean',
      seed: 'w11-47-ocean-generator',
    });
    const oceanFeatures = inspectCrossSeamBiomeFeatures(oceanState);
    expect(oceanFeatures.planetType).toBe('ocean');
    expect(oceanFeatures.crossSeamWaterChannelEdges + oceanFeatures.crossSeamFlatPlaneEdges).toBeGreaterThan(0);
    expect(oceanFeatures.crossSeamHexTileCount).toBeGreaterThan(20);
    expect(oceanFeatures.visibleDepositCount).toBeGreaterThan(0);
    expect(oceanFeatures.maxSeamHeightStepM).toBeLessThan(1.5);
  });
});

describe('W11-47: W05-19 Chunked Tile Diffs Across Multi-Sector Bursts', () => {
  it('splits a > 200 tile cross-sector burst across sec_0_0, sec_1_0, and sec_0_1 into bounded chunks and replicates bit-for-bit', () => {
    const state = createAtlasPlanetState({
      planetId: 'p_burst_desert',
      planetType: 'desert',
      seed: 'w11-47-multi-sector-burst',
    });
    const replica = createReplicaState(state);
    const replica2 = createReplicaState(state);
    const fromTick = state.meta.tick;
    state.meta.tick = fromTick + 1;

    const op1 = executeCrossSectorTerraformOp(state, { q: 24, r: 0, op: 'flatten', targetHeightM: 1.35 });
    const op2 = executeCrossSectorTerraformOp(state, { q: 24, r: -9, op: 'flatten', targetHeightM: 1.15 });
    const op3 = executeCrossSectorTerraformOp(state, { q: 24, r: -18, op: 'raise' });
    const op4 = executeCrossSectorTerraformOp(state, { q: 15, r: 9, op: 'flatten', targetHeightM: 1.05 });
    const uniqueDirty = new Set([
      ...op1.changedTileIndices,
      ...op2.changedTileIndices,
      ...op3.changedTileIndices,
      ...op4.changedTileIndices,
    ]);
    expect(uniqueDirty.size).toBeGreaterThan(200);

    for (const m of op1.diskChanges) {
      state.grid.layers.owner[m.tileIdx] = 0;
      state.grid.layers.explored[m.tileIdx] = 1;
      touchTile(state, m.tileIdx, state.meta.tick);
    }

    const rawChunks = diffChunks(state, fromTick);
    expect(rawChunks.length).toBeGreaterThanOrEqual(3);
    for (const chunk of rawChunks) {
      expect(chunk.tiles.idx.length).toBeLessThanOrEqual(MAX_TILE_DIFF_PER_DELTA);
    }

    const batch = collectCrossSectorDiffChunks(state, fromTick);
    expect(batch.totalChangedTiles).toBeGreaterThan(200);
    expect(batch.allWithinTileBudget).toBe(true);
    expect(batch.allWithinByteBudget).toBe(true);
    expect(batch.spansMultipleSectors).toBe(true);
    expect(batch.affectedSectorIds).toEqual(['sec_0_0', 'sec_0_1', 'sec_1_0']);
    expect(batch.chunkCount).toBe(rawChunks.length);

    for (const meta of batch.chunks) {
      expect(meta.tileCount).toBeGreaterThan(0);
      expect(meta.tileCount).toBeLessThanOrEqual(MAX_TILE_DIFF_PER_DELTA);
      expect(meta.byteLength).toBeLessThanOrEqual(MAX_DIFF_PAYLOAD_BYTES);
    }

    applyCrossSectorDiffChunks(replica, batch);
    expect(Array.from(replica.grid.layers.terrain)).toEqual(Array.from(state.grid.layers.terrain));
    expect(Array.from(replica.grid.layers.prep)).toEqual(Array.from(state.grid.layers.prep));
    expect(Array.from(replica.grid.layers.deposit)).toEqual(Array.from(state.grid.layers.deposit));
    expect(Array.from(replica.grid.layers.owner)).toEqual(Array.from(state.grid.layers.owner));
    expect(Array.from(replica.grid.layers.explored)).toEqual(Array.from(state.grid.layers.explored));
    for (let i = 0; i < state.grid.count; i++) {
      expect(replica.grid.layers.height[i]).toBeCloseTo(state.grid.layers.height[i]!, 5);
    }

    const cornerIdx = hexIndex(state.grid.radius).indexOf(24, 0);
    replica2.grid.layers.terrain[cornerIdx] = TERRAIN.rock;
    for (const chunk of rawChunks) {
      applyDiff(replica2, chunk);
    }
    expect(replica2.grid.layers.terrain[cornerIdx]).toBe(state.grid.layers.terrain[cornerIdx]);
    expect(globalTileToSector(24, 0).sectorId).toBe('sec_0_0');
  });
});
