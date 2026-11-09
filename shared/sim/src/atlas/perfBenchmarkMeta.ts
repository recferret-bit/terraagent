import type { PlanetType, SectorId } from '@terra/contracts';
import { GEN_VERSION } from '../gen/generators';
import {
  W11_DEFAULT_ATLAS_VERSION,
  W11_DEFAULT_CONFIG_VERSION,
  W11_DEFAULT_TOPOLOGY_VERSION,
} from './manifest';
import { runSmallAtlasBenchmark } from './perfBenchmark';
import {
  W11_SUPPORTED_SCALE_ID,
  type SmallAtlasBudgetCapInput,
  type SmallAtlasBudgetValidationResult,
  type SmallAtlasPerfCaps,
} from './perfCaps';
import type { GeneratedSmallAtlas } from './types';

export {
  W11_DEFAULT_ATLAS_VERSION,
  W11_DEFAULT_CONFIG_VERSION,
  W11_DEFAULT_TOPOLOGY_VERSION,
};

export interface SmallAtlasBenchmarkEnvironment {
  readonly genVersion: number;
  readonly atlasVersion: number;
  readonly topologyVersion: number;
  readonly configVersion: number;
  readonly runtimeVersion: string;
  readonly platform: string;
  readonly arch: string;
}

export interface SmallAtlasBenchmarkWorkload {
  readonly planetId: string;
  readonly planetType: PlanetType;
  readonly seed: string;
  readonly totalSectors: number;
  readonly landSectors: number;
  readonly oceanSectors: number;
  readonly sectorRadius: number;
  readonly tilesPerSector: number;
  readonly totalTiles: number;
  readonly foundingSeatsPerSector: number;
  readonly nominalCapacity: number;
  readonly validatedCapacity: number;
  readonly activeColonies: number;
  readonly crossSectorWalkSteps: number;
  readonly crossSectorBuildingsPlaced: number;
  readonly crossSeamTerraformOps: number;
  readonly simSteps: number;
  readonly cameraFrames: number;
}

export interface SmallAtlasMemoryMetrics {
  readonly atlasTypedArrayBytes: number;
  readonly planetStateTypedArrayBytes: number;
  readonly estimatedStateBytes: number;
  readonly heapUsedBeforeBytes: number;
  readonly heapUsedAfterBytes: number;
  readonly heapUsedDeltaBytes: number;
  readonly maxHeapDeltaBytes: number;
  readonly withinBudget: boolean;
}

export interface SmallAtlasWireMetrics {
  readonly snapshotRawBytes: number;
  readonly clientSnapshotRawBytes: number;
  readonly snapshotGzipBytes: number;
  readonly gzipWireBytesEstimate: number;
  readonly maxSnapshotRawBytes: number;
  readonly deltaChunkCount: number;
  readonly totalChangedTiles: number;
  readonly maxDeltaChunkWireBytes: number;
  readonly totalDeltaWireBytes: number;
  readonly maxDeltaWireBytesPerChunk: number;
  readonly affectedSectorIds: readonly SectorId[];
  readonly spansMultipleSectors: boolean;
  readonly allDeltaChunksWithinByteBudget: boolean;
  readonly allDeltaChunksWithinTileBudget: boolean;
  readonly withinBudget: boolean;
}

export interface SmallAtlasSimTickMetrics {
  readonly steps: number;
  readonly stepDurationsMs: readonly number[];
  readonly stepMeanMs: number;
  readonly stepP95Ms: number;
  readonly stepMinMs: number;
  readonly stepMaxMs: number;
  readonly maxSimStepP95Ms: number;
  readonly withinBudget: boolean;
}

export interface SmallAtlasRenderMetrics {
  readonly rasterSize: number;
  readonly initialFullRasterMs: number;
  readonly panZoomFrameMeanMs: number;
  readonly panZoomFrameP95Ms: number;
  readonly mapScanPaintMs: number;
  readonly maxMapRasterScanPaintMs: number;
  readonly paintedAtlasTiles: number;
  readonly crossSectorSeamEdgesPainted: number;
  readonly crossSectorTerritoryEdgesChecked: number;
  readonly cameraFrames: number;
  readonly withinBudget: boolean;
}

export interface SmallAtlasBenchmarkReport {
  readonly withinBudget: boolean;
  readonly w27ScaleClaimed: false;
  readonly supportedScale: typeof W11_SUPPORTED_SCALE_ID;
  readonly planetId: string;
  readonly planetType: PlanetType;
  readonly seed: string;
  readonly totalSectors: number;
  readonly landSectors: number;
  readonly oceanSectors: number;
  readonly sectorRadius: number;
  readonly tilesPerSector: number;
  readonly totalTiles: number;
  readonly foundingSeatsPerSector: number;
  readonly nominalCapacity: number;
  readonly validatedCapacity: number;
  readonly estimatedStateBytes: number;
  readonly heapUsedDeltaBytes: number;
  readonly snapshotRawBytes: number;
  readonly clientSnapshotRawBytes: number;
  readonly snapshotGzipBytes: number;
  readonly maxDeltaChunkWireBytes: number;
  readonly deltaChunkCount: number;
  readonly stepMeanMs: number;
  readonly stepP95Ms: number;
  readonly mapScanPaintMs: number;
  readonly caps: SmallAtlasPerfCaps;
  readonly environment: SmallAtlasBenchmarkEnvironment;
  readonly workload: SmallAtlasBenchmarkWorkload;
  readonly memory: SmallAtlasMemoryMetrics;
  readonly wire: SmallAtlasWireMetrics;
  readonly simTick: SmallAtlasSimTickMetrics;
  readonly render: SmallAtlasRenderMetrics;
  readonly budgetCheck: SmallAtlasBudgetValidationResult;
}

export interface RunSmallAtlasBenchmarkOptions extends SmallAtlasBudgetCapInput {
  readonly activeColonies?: number;
  readonly simSteps?: number;
  readonly cameraFrames?: number;
  readonly perfCaps?: Partial<SmallAtlasPerfCaps>;
  readonly nowMs?: () => number;
  readonly readHeapBytes?: () => number;
}

export const V1_ATLAS_META = {
  genVersion: GEN_VERSION,
  runtimeInfo(): { runtimeVersion: string; platform: string; arch: string } {
    return {
      runtimeVersion: 'isomorphic-ts-v1',
      platform: 'portable-sim',
      arch: 'deterministic-ieee754',
    };
  },
} as const;

export function assembleSmallAtlasBenchmarkReport(params: {
  readonly atlas: GeneratedSmallAtlas;
  readonly caps: SmallAtlasPerfCaps;
  readonly activeColonies: number;
  readonly simSteps: number;
  readonly cameraFrames: number;
  readonly workloadStats: {
    readonly crossSectorWalkSteps: number;
    readonly crossSectorBuildingsPlaced: number;
    readonly crossSeamTerraformOps: number;
  };
  readonly memory: SmallAtlasMemoryMetrics;
  readonly wire: SmallAtlasWireMetrics;
  readonly simTick: SmallAtlasSimTickMetrics;
  readonly render: SmallAtlasRenderMetrics;
  readonly budgetCheck: SmallAtlasBudgetValidationResult;
}): SmallAtlasBenchmarkReport {
  const { atlas, caps, activeColonies, simSteps, cameraFrames, workloadStats, memory, wire, simTick, render, budgetCheck } = params;
  return {
    withinBudget: budgetCheck.ok && memory.withinBudget && wire.withinBudget && simTick.withinBudget && render.withinBudget,
    w27ScaleClaimed: false,
    supportedScale: W11_SUPPORTED_SCALE_ID,
    planetId: atlas.planetId,
    planetType: atlas.planetType,
    seed: atlas.seed,
    totalSectors: atlas.sectors.length,
    landSectors: atlas.landSectorIds.length,
    oceanSectors: atlas.oceanSectorIds.length,
    sectorRadius: atlas.sectorRadius,
    tilesPerSector: atlas.tilesPerSector,
    totalTiles: atlas.partition.bounds.totalTiles,
    foundingSeatsPerSector: atlas.foundingSeatsPerSector,
    nominalCapacity: atlas.nominalCapacity,
    validatedCapacity: atlas.validatedCapacity,
    estimatedStateBytes: memory.estimatedStateBytes,
    heapUsedDeltaBytes: memory.heapUsedDeltaBytes,
    snapshotRawBytes: wire.snapshotRawBytes,
    clientSnapshotRawBytes: wire.clientSnapshotRawBytes,
    snapshotGzipBytes: wire.snapshotGzipBytes,
    maxDeltaChunkWireBytes: wire.maxDeltaChunkWireBytes,
    deltaChunkCount: wire.deltaChunkCount,
    stepMeanMs: simTick.stepMeanMs,
    stepP95Ms: simTick.stepP95Ms,
    mapScanPaintMs: render.mapScanPaintMs,
    caps,
    environment: {
      genVersion: V1_ATLAS_META.genVersion,
      atlasVersion: W11_DEFAULT_ATLAS_VERSION,
      topologyVersion: W11_DEFAULT_TOPOLOGY_VERSION,
      configVersion: W11_DEFAULT_CONFIG_VERSION,
      ...V1_ATLAS_META.runtimeInfo(),
    },
    workload: {
      planetId: atlas.planetId,
      planetType: atlas.planetType,
      seed: atlas.seed,
      totalSectors: atlas.sectors.length,
      landSectors: atlas.landSectorIds.length,
      oceanSectors: atlas.oceanSectorIds.length,
      sectorRadius: atlas.sectorRadius,
      tilesPerSector: atlas.tilesPerSector,
      totalTiles: atlas.partition.bounds.totalTiles,
      foundingSeatsPerSector: atlas.foundingSeatsPerSector,
      nominalCapacity: atlas.nominalCapacity,
      validatedCapacity: atlas.validatedCapacity,
      activeColonies,
      ...workloadStats,
      simSteps,
      cameraFrames,
    },
    memory,
    wire,
    simTick,
    render,
    budgetCheck,
  };
}

export interface SmallAtlasCorpusBenchmarkReport {
  readonly withinBudget: boolean;
  readonly w27ScaleClaimed: false;
  readonly supportedScale: typeof W11_SUPPORTED_SCALE_ID;
  readonly worldReports: readonly SmallAtlasBenchmarkReport[];
  readonly maxSnapshotRawBytes: number;
  readonly maxDeltaChunkWireBytes: number;
  readonly maxStepP95Ms: number;
  readonly maxMapScanPaintMs: number;
  readonly maxHeapUsedDeltaBytes: number;
}

export function runSmallAtlasCorpusBenchmark(
  opts?: Omit<RunSmallAtlasBenchmarkOptions, 'planetType' | 'planetId'> & {
    readonly planetTypes?: readonly PlanetType[];
  },
): SmallAtlasCorpusBenchmarkReport {
  const planetTypes: readonly PlanetType[] = opts?.planetTypes ?? ['desert', 'ocean', 'temperate'];
  const worldReports = planetTypes.map((planetType) => runSmallAtlasBenchmark({ ...opts, planetType }));
  return {
    withinBudget: worldReports.every((r) => r.withinBudget),
    w27ScaleClaimed: false,
    supportedScale: W11_SUPPORTED_SCALE_ID,
    worldReports,
    maxSnapshotRawBytes: Math.max(0, ...worldReports.map((r) => r.snapshotRawBytes)),
    maxDeltaChunkWireBytes: Math.max(0, ...worldReports.map((r) => r.maxDeltaChunkWireBytes)),
    maxStepP95Ms: Math.max(0, ...worldReports.map((r) => r.stepP95Ms)),
    maxMapScanPaintMs: Math.max(0, ...worldReports.map((r) => r.mapScanPaintMs)),
    maxHeapUsedDeltaBytes: Math.max(0, ...worldReports.map((r) => r.heapUsedDeltaBytes)),
  };
}

export type { SectorId };
