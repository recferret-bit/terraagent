import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  applyCrossSectorDiffChunks,
  applyCrossSectorTerraformPreviewAndJoin,
  applyDiff,
  applySeamSafeTerraform,
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
  inspectSeamTerraforming,
  isHexTileCenter,
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

describe('W11-47: D-45 7-Sub-Tile Hex-Tile Footprints Clamped at Sector Seams', () => {
  it('clamps 7-sub-tile hex-tile disks and R4 neighbourhoods to centerSectorId at 2-sector and 3-sector seams', () => {
    const desertState = createAtlasPlanetState({
      planetId: 'p_dune_seam',
      planetType: 'desert',
      seed: 'w11-47-d45-lattice',
      sectorRadius: 24,
      gridRadius: 56,
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
    expect(twoSectorFootprint.centerSectorId).toBe('sec_0_0');
    expect(twoSectorFootprint.straddlesSectorSeam).toBe(false);
    expect(twoSectorFootprint.r4SpansMultipleSectors).toBe(false);
    expect(twoSectorFootprint.diskSectorIds).toEqual(['sec_0_0']);
    expect(twoSectorFootprint.r4SectorIds).toEqual(['sec_0_0']);
    expect(twoSectorFootprint.affectedSectorIds).toEqual(['sec_0_0']);
    expect(twoSectorFootprint.crossSectorNeighborLinks).toEqual([]);
    expect(twoSectorFootprint.diskSubTiles.every((t) => t.sectorId === 'sec_0_0')).toBe(true);

    const threeSectorFootprint = inspectSeamTerraforming(desertState, 24, 0);
    expect(threeSectorFootprint.centerSectorId).toBe('sec_0_0');
    expect(threeSectorFootprint.straddlesSectorSeam).toBe(false);
    expect(threeSectorFootprint.r4SpansMultipleSectors).toBe(false);
    expect(threeSectorFootprint.diskSectorIds).toEqual(['sec_0_0']);
    expect(threeSectorFootprint.affectedSectorIds).toEqual(['sec_0_0']);
    expect(threeSectorFootprint.crossSectorNeighborLinks).toEqual([]);
  });
});

describe('W11-47: Desert Sector-Clamped Flatten & R4 Plane Join', () => {
  it('flattens a hex-tile at a 2-sector seam and 3-sector corner without mutating adjacent sectors', () => {
    const atlas = generateSmallAtlas({
      planetId: 'p_arrakis_seam',
      planetType: 'desert',
      seed: 'w11-47-desert-seam-join',
      sectorRadius: 24,
    });
    const state = createAtlasPlanetState({
      planetId: 'p_arrakis_seam',
      planetType: 'desert',
      seed: 'w11-47-desert-seam-join',
      sectorRadius: 24,
      gridRadius: 56,
    });
    const L = state.grid.layers;
    const hex = hexIndex(state.grid.radius);
    const adjIdx = hex.indexOf(25, -8); // in sec_1_0
    const beforeAdjHeight = L.height[adjIdx]!;
    const beforeAdjTerrain = L.terrain[adjIdx]!;

    const seamRes = executeCrossSectorTerraformOp(state, {
      q: 24,
      r: -8,
      op: 'flatten',
      targetHeightM: 1.4,
      snapToLattice: true,
      atlas,
    });
    expect(seamRes.straddlesSectorSeam).toBe(false);
    expect(seamRes.r4SpansMultipleSectors).toBe(false);
    expect(seamRes.diskSectorIds).toEqual(['sec_0_0']);
    expect(seamRes.affectedSectorIds).toEqual(['sec_0_0']);
    expect(seamRes.crossSectorNeighborLinks).toEqual([]);
    expect(seamRes.footprintReport.isUniformHexTilePlane).toBe(true);
    expect(L.height[adjIdx]).toBe(beforeAdjHeight);
    expect(L.terrain[adjIdx]).toBe(beforeAdjTerrain);

    for (const tile of seamRes.footprintReport.diskSubTiles) {
      expect(tile.sectorId).toBe('sec_0_0');
      expect(tile.terrain).toBe(TERRAIN.flat);
      expect(tile.prep).toBe(PREP.prepared);
      expect(tile.height).toBeCloseTo(1.4, 4);
    }

    const cornerRes = applySeamSafeTerraform(state, {
      q: 24,
      r: 0,
      op: 'flatten',
      targetHeightM: 1.25,
      snapToLattice: false,
      atlas,
    });
    expect(cornerRes.diskSectorIds).toEqual(['sec_0_0']);
    expect(cornerRes.affectedSectorIds).toEqual(['sec_0_0']);
    expect(cornerRes.crossSectorNeighborLinks).toEqual([]);
    expect(cornerRes.footprintReport.isUniformHexTilePlane).toBe(true);

    for (const tile of cornerRes.footprintReport.diskSubTiles) {
      expect(tile.sectorId).toBe('sec_0_0');
      const sec = atlas.sectorById.get(tile.sectorId)!;
      expect(sec.terrain[tile.localIndex]).toBe(TERRAIN.flat);
      expect(sec.prep[tile.localIndex]).toBe(PREP.prepared);
      expect(sec.height[tile.localIndex]).toBeCloseTo(1.25, 4);
    }
  });
});

describe('W11-47: Desert Dunes, Craters, Raise/Lower & Sector-Isolated Placement', () => {
  it('supports dune flattening, crater filling, raise/lower, and intra-sector building placement while blocking cross-seam placement', () => {
    const state = createAtlasPlanetState({
      planetId: 'p_arrakis_ops',
      planetType: 'desert',
      seed: 'w11-47-desert-ops',
      sectorRadius: 24,
      gridRadius: 56,
    });
    const hex = hexIndex(state.grid.radius);

    for (const pt of hexTileDisk(21, -6)) {
      const idx = hex.indexOf(pt.q, pt.r);
      state.grid.layers.terrain[idx] = TERRAIN.slope;
      state.grid.layers.prep[idx] = PREP.wild;
      state.grid.layers.height[idx] = 2.4;
    }

    const duneRes = flattenDuneFootprint(state, 21, -6, 8);
    expect(duneRes.count).toBeGreaterThanOrEqual(7);

    const joinRes = executeCrossSectorTerraformOp(state, {
      q: 21,
      r: -6,
      op: 'flatten',
      targetHeightM: 1.2,
      diskRadius: 3,
      r4Radius: 5,
    });
    expect(joinRes.straddlesSectorSeam).toBe(false);
    expect(joinRes.diskSectorIds).toEqual(['sec_0_0']);
    expect(joinRes.affectedSectorIds).toEqual(['sec_0_0']);

    for (const m of joinRes.diskChanges) {
      state.grid.layers.deposit[m.tileIdx] = DEPOSIT.none;
    }
    const hqRow = insertRow(state.entities, state.meta.nextEntityId++, 9);
    state.entities.cols.kind[hqRow] = ENTITY_KIND.hq;
    state.entities.cols.owner[hqRow] = 0;
    state.entities.cols.q[hqRow] = 19;
    state.entities.cols.r[hqRow] = -6;
    state.entities.cols.hp[hqRow] = 500;
    state.entities.cols.hpMax[hqRow] = 500;
    state.entities.cols.state[hqRow] = ENTITY_STATE.idle;

    claimTerritoryRadius(state, { colonyId: 0, q: 21, r: -6, radius: 6, tick: 9 });
    const intraPlacement = evaluateCrossSectorPlacement(state, {
      colonyId: 0,
      building: 'commandHub',
      q: 21,
      r: -6,
    });
    expect(intraPlacement.ok).toBe(true);
    expect(intraPlacement.straddlesSectorBoundary).toBe(false);
    expect(intraPlacement.footprintSectorIds).toEqual(['sec_0_0']);

    const seamPlacement = evaluateCrossSectorPlacement(state, {
      colonyId: 0,
      building: 'commandHub',
      q: 24,
      r: -6,
    });
    expect(seamPlacement.ok).toBe(false);
    expect(seamPlacement.reason).toBe('cross_sector_disabled');
    expect(seamPlacement.straddlesSectorBoundary).toBe(true);

    const raised = executeCrossSectorTerraformOp(state, { q: 24, r: -12, op: 'raise' });
    const lowered = executeCrossSectorTerraformOp(state, { q: 24, r: -12, op: 'lower' });
    expect(lowered.targetHeightM).toBeLessThan(raised.targetHeightM);

    for (const pt of hexTileDisk(21, -12)) {
      const idx = hex.indexOf(pt.q, pt.r);
      state.grid.layers.terrain[idx] = TERRAIN.hole;
      state.grid.layers.prep[idx] = PREP.wild;
    }
    const craterRes = flattenMeteorCraterFootprint(state, 21, -12, 9);
    expect(craterRes.count).toBeGreaterThanOrEqual(7);
  });
});

describe('W11-47: Ocean Sector-Clamped Reclaim, Dredge & SimHost Task Execution', () => {
  it('reclaims and dredges a hex-tile at 2-sector and 3-sector seams while clamping mutations to centerSectorId', () => {
    const state = createAtlasPlanetState({
      planetId: 'p_pelagic_seam',
      planetType: 'ocean',
      seed: 'w11-47-ocean-seam-join',
      sectorRadius: 24,
      gridRadius: 56,
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
    expect(reclaimRes.diskSectorIds).toEqual(['sec_0_0']);
    expect(reclaimRes.affectedSectorIds).toEqual(['sec_0_0']);
    expect(reclaimRes.straddlesSectorSeam).toBe(false);
    expect(reclaimRes.r4SpansMultipleSectors).toBe(false);
    expect(reclaimRes.footprintReport.isUniformHexTilePlane).toBe(true);

    for (const tile of reclaimRes.footprintReport.diskSubTiles) {
      expect(tile.sectorId).toBe('sec_0_0');
      expect(tile.terrain).toBe(TERRAIN.flat);
      expect(tile.prep).toBe(PREP.prepared);
      expect(tile.height).toBeCloseTo(0.85, 4);
    }
    // Adjacent sector tile (25, 0) in sec_1_0 was not reclaimed!
    expect(L.terrain[hex.indexOf(25, 0)]).toBe(TERRAIN.shallow);

    const dredgeRes = executeCrossSectorTerraformOp(state, {
      q: 24,
      r: -8,
      op: 'dredge',
      snapToLattice: true,
    });
    expect(dredgeRes.straddlesSectorSeam).toBe(false);
    expect(dredgeRes.diskSectorIds).toEqual(['sec_0_0']);
    expect(dredgeRes.affectedSectorIds).toEqual(['sec_0_0']);
    for (const tile of dredgeRes.footprintReport.diskSubTiles) {
      expect(tile.sectorId).toBe('sec_0_0');
      expect(tile.terrain).toBe(TERRAIN.shallow);
      expect(tile.height).toBeLessThanOrEqual(0);
    }
  });
});

describe('W11-47: SimHost EnqueueTask Terraform & Sector-Isolated R4 Preview', () => {
  it('executes SimHost enqueueTask terraform commands on a sector seam tile and previews the sector-clamped R4 join', () => {
    const state = createAtlasPlanetState({
      planetId: 'p_ocean_host',
      planetType: 'ocean',
      seed: 'w11-47-host-enqueue',
    });
    expect(state.grid.radius).toBe(48);
    const host = new SimHost({ flags: parseWaves('..05') });
    host.load(state);
    host.submit({
      colonyIndex: 0,
      source: 'dev',
      commandId: 'w11_47_land',
      kind: 'dev.land',
      args: { q: 47, r: -12 },
    });
    host.step(1);
    host.state.colonies[0]!.unlockStage = 4;

    const hex = hexIndex(host.state.grid.radius);
    const seamIdx = hex.indexOf(48, -12);
    host.state.grid.layers.terrain[seamIdx] = TERRAIN.shallow;
    host.state.grid.layers.prep[seamIdx] = PREP.wild;
    host.state.grid.layers.height[seamIdx] = -0.18;
    claimTerritoryRadius(host.state, { colonyId: 0, q: 48, r: -12, radius: 3, tick: host.tick });
    creditResource(host.state.colonies[0]!, 'minerals.t1', 500, host.tick);
    creditResource(host.state.colonies[0]!, 'metals.t1', 500, host.tick);

    host.submit({
      colonyIndex: 0,
      source: 'player',
      commandId: 'w11_47_reclaim_seam',
      kind: 'enqueueTask',
      args: { terraform: { op: 'reclaim', tiles: [{ q: 48, r: -12 }] } },
    });
    const stepOut = host.step(1);
    expect(stepOut.outcomes[0]?.code).toBeUndefined();

    const preview = applyCrossSectorTerraformPreviewAndJoin(host.state, {
      q: 48,
      r: -12,
      op: 'reclaim',
      targetHeightM: 0.25,
    });
    expect(preview.straddlesSectorSeam).toBe(false);
    expect(preview.r4SpansMultipleSectors).toBe(false);
    expect(preview.diskSectorIds).toEqual(['sec_0_0']);
    expect(preview.affectedSectorIds).toEqual(['sec_0_0']);
    expect(preview.crossSectorNeighborLinks).toEqual([]);
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
      atlas: desertAtlas,
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
      atlas: oceanAtlas,
    });
    const oceanFeatures = inspectCrossSeamBiomeFeatures(oceanState);
    expect(oceanFeatures.planetType).toBe('ocean');
    expect(oceanFeatures.crossSeamWaterChannelEdges + oceanFeatures.crossSeamFlatPlaneEdges).toBeGreaterThan(0);
    expect(oceanFeatures.crossSeamHexTileCount).toBeGreaterThan(20);
    expect(oceanFeatures.visibleDepositCount).toBeGreaterThan(0);
    expect(oceanFeatures.maxSeamHeightStepM).toBeLessThan(1.5);
  });
});

describe('W11-47: W05-19 Chunked Tile Diffs Within Isolated Sector Grid', () => {
  it('splits a > 200 tile burst within sec_0_0 into bounded chunks and replicates bit-for-bit', () => {
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
    const op2 = executeCrossSectorTerraformOp(state, { q: 24, r: -12, op: 'flatten', targetHeightM: 1.15 });
    const op3 = executeCrossSectorTerraformOp(state, { q: 12, r: -24, op: 'raise' });
    const op4 = executeCrossSectorTerraformOp(state, { q: -12, r: 24, op: 'flatten', targetHeightM: 1.05 });
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
    expect(batch.spansMultipleSectors).toBe(false);
    expect(batch.affectedSectorIds).toEqual(['sec_0_0']);
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
    expect(globalTileToSector(48, 0).sectorId).toBe('sec_0_0');
  });
});
