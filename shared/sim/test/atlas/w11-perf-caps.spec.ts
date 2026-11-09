import { describe, expect, it } from 'vitest';
import {
  CANONICAL_PLANETS,
  formatSectorId,
  W11_SEVEN_SECTOR_COORDS,
} from '@terra/contracts';
import {
  buildAtlasManifest,
  buildDefaultAtlasConfig,
  createAtlasPlanetState,
  enforceSmallAtlasPreAllocationCaps,
  estimateGzipWireBytes,
  estimateSmallAtlasAllocationBytes,
  generateSmallAtlas,
  measurePlanetStateMemoryBytes,
  runSmallAtlasBenchmark,
  runSmallAtlasCorpusBenchmark,
  SmallAtlasCapExceededError,
  validateSmallAtlasBudgetCaps,
  W11_PUBLISHED_SMALL_ATLAS_FIXTURE,
  W11_SMALL_ATLAS_PERF_CAPS,
  W11_SUPPORTED_SCALE_ID,
} from '../../src';

describe('W11-43 · Published W11 small-atlas perf caps and non-claim of W27 scale', () => {
  it('pins W11_SMALL_ATLAS_PERF_CAPS and W11_PUBLISHED_SMALL_ATLAS_FIXTURE with w27ScaleClaimed: false', () => {
    expect(W11_SMALL_ATLAS_PERF_CAPS.supportedScale).toBe(W11_SUPPORTED_SCALE_ID);
    expect(W11_SMALL_ATLAS_PERF_CAPS.w27ScaleClaimed).toBe(false);
    expect(W11_SMALL_ATLAS_PERF_CAPS.maxTotalSectors).toBe(19);
    expect(W11_SMALL_ATLAS_PERF_CAPS.maxLandSectors).toBe(7);
    expect(W11_SMALL_ATLAS_PERF_CAPS.maxOceanSectors).toBe(12);
    expect(W11_SMALL_ATLAS_PERF_CAPS.maxContinents).toBe(1);
    expect(W11_SMALL_ATLAS_PERF_CAPS.maxSectorRadius).toBe(48);
    expect(W11_SMALL_ATLAS_PERF_CAPS.maxTilesPerSector).toBe(7_057);
    expect(W11_SMALL_ATLAS_PERF_CAPS.maxTotalTiles).toBe(134_083);
    expect(W11_SMALL_ATLAS_PERF_CAPS.maxTotalTilesHardCeiling).toBe(140_000);
    expect(W11_SMALL_ATLAS_PERF_CAPS.maxFoundingSeatsPerSector).toBe(5);
    expect(W11_SMALL_ATLAS_PERF_CAPS.supportedFoundingSeatsPerSector).toEqual([3, 4, 5]);
    expect(W11_SMALL_ATLAS_PERF_CAPS.maxTotalFoundingSeatsPerWorld).toBe(35);
    expect(W11_SMALL_ATLAS_PERF_CAPS.maxCanonicalWorlds).toBe(3);
    expect(W11_SMALL_ATLAS_PERF_CAPS.maxSnapshotRawBytes).toBe(8 * 1024 * 1024);
    expect(W11_SMALL_ATLAS_PERF_CAPS.maxDeltaWireBytesPerChunk).toBe(8_192);
    expect(W11_SMALL_ATLAS_PERF_CAPS.maxSimStepP95Ms).toBe(50);
    expect(W11_SMALL_ATLAS_PERF_CAPS.maxMapRasterScanPaintMs).toBe(16);
    expect(W11_SMALL_ATLAS_PERF_CAPS.maxHeapDeltaBytesPerWorld).toBe(64 * 1024 * 1024);

    expect(W11_PUBLISHED_SMALL_ATLAS_FIXTURE.w27ScaleClaimed).toBe(false);
    expect(W11_PUBLISHED_SMALL_ATLAS_FIXTURE.totalSectors).toBe(19);
    expect(W11_PUBLISHED_SMALL_ATLAS_FIXTURE.landSectors).toBe(7);
    expect(W11_PUBLISHED_SMALL_ATLAS_FIXTURE.sectorRadius).toBe(48);
    expect(W11_PUBLISHED_SMALL_ATLAS_FIXTURE.tilesPerSector).toBe(7_057);
    expect(W11_PUBLISHED_SMALL_ATLAS_FIXTURE.totalAtlasTiles).toBe(134_083);
    expect(W11_PUBLISHED_SMALL_ATLAS_FIXTURE.planetGridRadius).toBe(48);
    expect(W11_PUBLISHED_SMALL_ATLAS_FIXTURE.planetGridTiles).toBe(7_057);
    expect(W11_PUBLISHED_SMALL_ATLAS_FIXTURE.deferredToW27).toContain('150_sector_medium_atlas');
    expect(W11_PUBLISHED_SMALL_ATLAS_FIXTURE.deferredToW27).toContain('450_sector_large_atlas');
  });

  it('accepts supported W11 small-atlas configurations across X=3, 4, and 5 and all 3 canonical worlds', () => {
    for (const planetType of ['desert', 'ocean', 'temperate'] as const) {
      for (const seats of [3, 4, 5] as const) {
        const cfg = buildDefaultAtlasConfig({ planetType, foundingSeatsPerSector: seats });
        const check = validateSmallAtlasBudgetCaps(cfg);
        expect(check.ok).toBe(true);
        expect(check.code).toBeUndefined();
        expect(check.w27ScaleClaimed).toBe(false);
        expect(check.w27ScaleRejected).toBe(false);
        expect(check.violations).toEqual([]);
        expect(check.observed.totalSectors).toBe(19);
        expect(check.observed.landSectors).toBe(7);
        expect(check.observed.oceanSectors).toBe(12);
        expect(check.observed.sectorRadius).toBe(48);
        expect(check.observed.totalTiles).toBe(134_083);
        expect(check.observed.foundingSeatsPerSector).toBe(seats);
        expect(check.observed.totalFoundingSeats).toBe(7 * seats);

        const manifest = buildAtlasManifest(cfg);
        expect(enforceSmallAtlasPreAllocationCaps(manifest).ok).toBe(true);
      }
    }
  });
});

describe('W11-43 · Acceptance check 1A: Pre-allocation rejection of W27 150/450-sector scale', () => {
  it('rejects W27 150-sector and 450-sector configurations before allocation with SmallAtlasCapExceededError', () => {
    for (const w27Sectors of [150, 450] as const) {
      const check = validateSmallAtlasBudgetCaps({ totalSectors: w27Sectors });
      expect(check.ok).toBe(false);
      expect(check.code).toBe('atlas_budget_exceeded');
      expect(check.w27ScaleClaimed).toBe(false);
      expect(check.w27ScaleRejected).toBe(true);
      expect(check.observed.totalSectors).toBe(w27Sectors);
      expect(check.observed.totalTiles).toBe(w27Sectors * 7_057);
      expect(check.violations.map((v) => v.field)).toContain('totalSectors');
      expect(check.violations.map((v) => v.field)).toContain('totalTiles');
      expect(check.violations.map((v) => v.field)).toContain('estimatedAllocationBytes');

      let caught: unknown;
      try {
        generateSmallAtlas({ totalSectors: w27Sectors });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(SmallAtlasCapExceededError);
      expect(caught).toBeInstanceOf(RangeError);
      const capErr = caught as SmallAtlasCapExceededError;
      expect(capErr.code).toBe('atlas_budget_exceeded');
      expect(capErr.w27ScaleClaimed).toBe(false);
      expect(capErr.w27ScaleRejected).toBe(true);
      expect(capErr.observed.totalSectors).toBe(w27Sectors);

      expect(() => createAtlasPlanetState({ totalSectors: w27Sectors })).toThrow(SmallAtlasCapExceededError);
      expect(() => runSmallAtlasBenchmark({ totalSectors: w27Sectors })).toThrow(SmallAtlasCapExceededError);
    }
  });
});

describe('W11-43 · Acceptance check 1B: Pre-allocation rejection of oversized sector/seat/continent configs', () => {
  it('rejects oversized landSectors (12), sectorRadius (65), foundingSeatsPerSector (8), and continentCount (3) before allocation', () => {
    const extraLandCoords = [
      ...W11_SEVEN_SECTOR_COORDS,
      [2, 0],
      [2, -1],
      [2, -2],
      [1, -2],
      [0, -2],
    ] as const;
    const landCheck = validateSmallAtlasBudgetCaps({ landSectors: 12 });
    expect(landCheck.ok).toBe(false);
    expect(landCheck.code).toBe('atlas_budget_exceeded');
    expect(landCheck.w27ScaleRejected).toBe(true);
    expect(landCheck.violations.map((v) => v.field)).toContain('landSectors');
    expect(landCheck.violations.map((v) => v.field)).toContain('totalSectors');
    expect(landCheck.violations.map((v) => v.field)).toContain('totalFoundingSeats');
    expect(() => generateSmallAtlas({ landSectors: 12 })).toThrow(SmallAtlasCapExceededError);
    expect(() => generateSmallAtlas({ landCoords: extraLandCoords })).toThrow(SmallAtlasCapExceededError);
    expect(() => createAtlasPlanetState({ landCoords: extraLandCoords })).toThrow(SmallAtlasCapExceededError);

    const radiusCheck = validateSmallAtlasBudgetCaps({ sectorRadius: 65 });
    expect(radiusCheck.ok).toBe(false);
    expect(radiusCheck.code).toBe('atlas_budget_exceeded');
    expect(radiusCheck.violations.map((v) => v.field)).toContain('sectorRadius');
    expect(radiusCheck.violations.map((v) => v.field)).toContain('totalTiles');
    expect(radiusCheck.violations.map((v) => v.field)).toContain('planetRadius');
    expect(() => generateSmallAtlas({ sectorRadius: 65 })).toThrow(SmallAtlasCapExceededError);
    expect(() => createAtlasPlanetState({ sectorRadius: 65 })).toThrow(SmallAtlasCapExceededError);

    const seatsCheck = validateSmallAtlasBudgetCaps({ foundingSeatsPerSector: 8 });
    expect(seatsCheck.ok).toBe(false);
    expect(seatsCheck.code).toBe('atlas_budget_exceeded');
    expect(seatsCheck.violations.map((v) => v.field)).toContain('foundingSeatsPerSector');
    expect(seatsCheck.violations.map((v) => v.field)).toContain('totalFoundingSeats');
    expect(() => generateSmallAtlas({ foundingSeatsPerSector: 8 })).toThrow(SmallAtlasCapExceededError);
    expect(() => createAtlasPlanetState({ foundingSeatsPerSector: 8 })).toThrow(SmallAtlasCapExceededError);

    const contCheck = validateSmallAtlasBudgetCaps({ continentCount: 3 });
    expect(contCheck.ok).toBe(false);
    expect(contCheck.code).toBe('atlas_budget_exceeded');
    expect(contCheck.w27ScaleRejected).toBe(true);
    expect(contCheck.violations.map((v) => v.field)).toEqual(['continentCount']);
    expect(() => generateSmallAtlas({ continentCount: 3 })).toThrow(SmallAtlasCapExceededError);
    expect(() => createAtlasPlanetState({ continentCount: 3 })).toThrow(SmallAtlasCapExceededError);

    const multiContinentSectors = W11_SEVEN_SECTOR_COORDS.map(([mq, mr], idx) => ({
      sectorId: formatSectorId(mq, mr),
      continentId: `cont_${idx % 3}`,
      macroQ: mq,
      macroR: mr,
      kind: 'land' as const,
      radius: 24,
      foundingCapacity: 4,
    }));
    const multiContCfgCheck = validateSmallAtlasBudgetCaps({ sectors: multiContinentSectors });
    expect(multiContCfgCheck.ok).toBe(false);
    expect(multiContCfgCheck.violations.map((v) => v.field)).toContain('continentCount');
  });

  it('rejects oversized planetRadius/gridRadius, canonicalWorlds, and runtime telemetry breaches', () => {
    expect(() => createAtlasPlanetState({ gridRadius: 120 })).toThrow(SmallAtlasCapExceededError);
    expect(() => generateSmallAtlas({ planetRadius: 120 })).toThrow(SmallAtlasCapExceededError);
    expect(() => generateSmallAtlas({ canonicalWorlds: 5 })).toThrow(SmallAtlasCapExceededError);

    const runtimeBreach = validateSmallAtlasBudgetCaps({
      snapshotRawBytes: 12 * 1024 * 1024,
      deltaWireBytesPerChunk: 16_384,
      simStepP95Ms: 85,
      mapRasterScanPaintMs: 32,
      heapDeltaBytes: 128 * 1024 * 1024,
    });
    expect(runtimeBreach.ok).toBe(false);
    expect(runtimeBreach.code).toBe('atlas_budget_exceeded');
    expect(runtimeBreach.violations.map((v) => v.field)).toEqual([
      'snapshotRawBytes',
      'deltaWireBytesPerChunk',
      'simStepP95Ms',
      'mapRasterScanPaintMs',
      'heapDeltaBytes',
    ]);
  });
});

describe('W11-43 · Acceptance check 2A: Measured supported W11 small-atlas benchmark', () => {
  it('runs runSmallAtlasBenchmark() on the supported 19-sector (7 land, R=48, X=4) fixture within all memory, wire, tick, and render budgets', () => {
    const report = runSmallAtlasBenchmark({
      planetType: 'temperate',
      seed: CANONICAL_PLANETS.temperate.seed,
      activeColonies: 4,
      simSteps: 20,
      cameraFrames: 8,
    });

    expect(report.withinBudget).toBe(true);
    expect(report.w27ScaleClaimed).toBe(false);
    expect(report.supportedScale).toBe('w11_small_atlas_7_land_19_total');
    expect(report.totalSectors).toBe(19);
    expect(report.landSectors).toBe(7);
    expect(report.oceanSectors).toBe(12);
    expect(report.sectorRadius).toBe(48);
    expect(report.tilesPerSector).toBe(7_057);
    expect(report.totalTiles).toBe(134_083);
    expect(report.foundingSeatsPerSector).toBe(4);
    expect(report.nominalCapacity).toBe(28);
    expect(report.validatedCapacity).toBe(28);

    expect(report.memory.withinBudget).toBe(true);
    expect(report.memory.atlasTypedArrayBytes).toBeGreaterThan(500_000);
    expect(report.memory.planetStateTypedArrayBytes).toBeGreaterThan(200_000);
    expect(report.estimatedStateBytes).toBe(
      report.memory.atlasTypedArrayBytes + report.memory.planetStateTypedArrayBytes,
    );
    expect(report.heapUsedDeltaBytes).toBeLessThanOrEqual(W11_SMALL_ATLAS_PERF_CAPS.maxHeapDeltaBytesPerWorld);

    expect(report.wire.withinBudget).toBe(true);
    expect(report.snapshotRawBytes).toBeGreaterThan(100_000);
    expect(report.snapshotRawBytes).toBeLessThanOrEqual(W11_SMALL_ATLAS_PERF_CAPS.maxSnapshotRawBytes);
    expect(report.clientSnapshotRawBytes).toBeGreaterThan(50_000);
    expect(report.clientSnapshotRawBytes).toBeLessThanOrEqual(report.snapshotRawBytes);
    expect(report.snapshotGzipBytes).toBeGreaterThan(10_000);
    expect(report.snapshotGzipBytes).toBeLessThan(report.snapshotRawBytes);
    expect(report.deltaChunkCount).toBeGreaterThanOrEqual(1);
    expect(report.maxDeltaChunkWireBytes).toBeGreaterThan(0);
    expect(report.maxDeltaChunkWireBytes).toBeLessThanOrEqual(W11_SMALL_ATLAS_PERF_CAPS.maxDeltaWireBytesPerChunk);
    expect(report.wire.spansMultipleSectors).toBe(false);
    expect(report.wire.allDeltaChunksWithinByteBudget).toBe(true);
    expect(report.wire.allDeltaChunksWithinTileBudget).toBe(true);

    expect(report.simTick.withinBudget).toBe(true);
    expect(report.simTick.steps).toBe(20);
    expect(report.stepMeanMs).toBeGreaterThan(0);
    expect(report.stepP95Ms).toBeGreaterThan(0);
    expect(report.stepP95Ms).toBeLessThanOrEqual(W11_SMALL_ATLAS_PERF_CAPS.maxSimStepP95Ms);

    expect(report.render.withinBudget).toBe(true);
    expect(report.render.rasterSize).toBe(256);
    expect(report.render.paintedAtlasTiles).toBe(7_057);
    expect(report.render.crossSectorSeamEdgesPainted).toBeGreaterThan(1_000);
    expect(report.render.crossSectorTerritoryEdgesChecked).toBeGreaterThan(0);
    expect(report.mapScanPaintMs).toBeGreaterThan(0);
    expect(report.mapScanPaintMs).toBeLessThanOrEqual(W11_SMALL_ATLAS_PERF_CAPS.maxMapRasterScanPaintMs);

    expect(report.environment.genVersion).toBeGreaterThanOrEqual(1);
    expect(report.environment.atlasVersion).toBe(1);
    expect(report.workload.activeColonies).toBe(4);
    expect(report.workload.crossSectorWalkSteps).toBeGreaterThan(1);
    expect(report.workload.crossSectorBuildingsPlaced).toBeGreaterThanOrEqual(4);
    expect(report.workload.crossSeamTerraformOps).toBe(2);
    expect(report.budgetCheck.ok).toBe(true);
  });
});

describe('W11-43 · Acceptance check 2B: 3-world canonical corpus benchmark', () => {
  it('benchmarks all 3 canonical worlds (desert, ocean, temperate) within W11 budget caps via runSmallAtlasCorpusBenchmark', () => {
    const corpus = runSmallAtlasCorpusBenchmark({
      activeColonies: 3,
      simSteps: 8,
      cameraFrames: 4,
    });
    expect(corpus.withinBudget).toBe(true);
    expect(corpus.w27ScaleClaimed).toBe(false);
    expect(corpus.supportedScale).toBe(W11_SUPPORTED_SCALE_ID);
    expect(corpus.worldReports).toHaveLength(3);
    expect(corpus.worldReports.map((r) => r.planetType)).toEqual(['desert', 'ocean', 'temperate']);
    expect(corpus.maxSnapshotRawBytes).toBeLessThanOrEqual(W11_SMALL_ATLAS_PERF_CAPS.maxSnapshotRawBytes);
    expect(corpus.maxDeltaChunkWireBytes).toBeLessThanOrEqual(W11_SMALL_ATLAS_PERF_CAPS.maxDeltaWireBytesPerChunk);
    expect(corpus.maxStepP95Ms).toBeLessThanOrEqual(W11_SMALL_ATLAS_PERF_CAPS.maxSimStepP95Ms);
    expect(corpus.maxMapScanPaintMs).toBeLessThanOrEqual(W11_SMALL_ATLAS_PERF_CAPS.maxMapRasterScanPaintMs);

    expect(estimateGzipWireBytes(new Uint8Array(0))).toBe(20);
    expect(estimateSmallAtlasAllocationBytes({ totalSectors: 19, sectorRadius: 48 })).toBeLessThan(
      W11_SMALL_ATLAS_PERF_CAPS.maxEstimatedAllocationBytes,
    );
    const state = createAtlasPlanetState({ planetType: 'desert' });
    expect(measurePlanetStateMemoryBytes(state).planetStateTypedArrayBytes).toBeGreaterThan(200_000);
  });
});
