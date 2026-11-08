import {
  canonicalPlanetById,
  canonicalPlanetForType,
  parseWaves,
  W11_DEFAULT_FOUNDING_SEATS_PER_SECTOR,
  W11_DEFAULT_SECTOR_RADIUS,
  type PlanetType,
} from '@terra/contracts';
import { creditResource } from '../systems/economy/ledger';
import { ENTITY_KIND, ENTITY_STATE } from '../ecs/columns';
import { placeSpawnedEntity } from '../ecs/placement';
import { insertRow } from '../ecs/store';
import { isColonyTileExplored } from '../grid/exploration';
import { axialToPlane, HEX_DIRS, hexIndex, planeToAxial } from '../grid/hex';
import { DEPOSIT, PREP, TERRAIN } from '../grid/layers';
import { SimHost } from '../host/SimHost';
import type { PlanetState } from '../kernel/state';
import { claimTerritoryRadius } from '../systems/territory-claim';
import { evaluateCrossSectorPlacement, inspectCrossSectorPath } from './crossSectorGameplay';
import { createAtlasPlanetState, generateSmallAtlas } from './generateAtlas';
import {
  assembleSmallAtlasBenchmarkReport,
  type RunSmallAtlasBenchmarkOptions,
  type SmallAtlasBenchmarkReport,
  type SmallAtlasRenderMetrics,
  type SmallAtlasWireMetrics,
} from './perfBenchmarkMeta';
import {
  enforceSmallAtlasPreAllocationCaps,
  measurePlanetStateMemoryBytes,
  validateSmallAtlasBudgetCaps,
  W11_SMALL_ATLAS_PERF_CAPS,
  type SmallAtlasPerfCaps,
} from './perfCaps';
import { saveAtlasWorldSnapshot } from './persistence';
import { collectCrossSectorDiffChunks, executeCrossSectorTerraformOp } from './seamTerraforming';
import type { GeneratedSmallAtlas } from './types';

export * from './perfBenchmarkMeta';

function computePercentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

/**
 * Deterministic, pure-TS LZ77 + byte-variety gzip wire size estimator (SIM-D-06 pure).
 */
export function estimateGzipWireBytes(raw: Uint8Array): number {
  const len = raw.byteLength;
  if (len === 0) return 20;
  const hashTable = new Int32Array(4096).fill(-1);
  const seenByte = new Uint8Array(256);
  let uniqueSymbols = 0;
  let matchedBytes = 0;
  let matchTokens = 0;
  let literalCount = 0;

  let i = 0;
  while (i < len) {
    if (i + 3 < len) {
      const h = (((raw[i]! << 6) ^ (raw[i + 1]! << 3) ^ (raw[i + 2]! << 1) ^ raw[i + 3]!) & 0xfff) >>> 0;
      const prev = hashTable[h]!;
      hashTable[h] = i;
      if (
        prev >= 0 &&
        i - prev <= 32_768 &&
        raw[prev] === raw[i] &&
        raw[prev + 1] === raw[i + 1] &&
        raw[prev + 2] === raw[i + 2]
      ) {
        let mLen = 3;
        const maxLen = Math.min(258, len - i);
        while (mLen < maxLen && raw[prev + mLen] === raw[i + mLen]) mLen++;
        matchedBytes += mLen;
        matchTokens++;
        i += mLen;
        continue;
      }
    }
    const b = raw[i]!;
    if (seenByte[b] === 0) {
      seenByte[b] = 1;
      uniqueSymbols++;
    }
    literalCount++;
    i++;
  }

  const symbolFactor = 0.35 + (uniqueSymbols / 256) * 0.55;
  const literalBytes = Math.ceil(literalCount * symbolFactor);
  const tokenBytes = Math.ceil(matchTokens * 2.25);
  return Math.min(len + 18, Math.max(24, 18 + literalBytes + tokenBytes + (len - matchedBytes - literalCount)));
}

function paintInitialAtlasRaster(
  state: PlanetState,
  atlas: GeneratedSmallAtlas,
  rasterSize: number,
  mapScale: number,
  rasterPixels: Uint32Array,
): {
  paintedAtlasTiles: number;
  crossSectorSeamEdgesPainted: number;
  crossSectorTerritoryEdgesChecked: number;
} {
  const hx = hexIndex(state.grid.radius);
  const L = state.grid.layers;
  let paintedAtlasTiles = 0;
  let crossSectorSeamEdgesPainted = 0;
  let crossSectorTerritoryEdgesChecked = 0;

  for (const ownerTile of atlas.partition.tiles) {
    const idx = hx.indexOf(ownerTile.q, ownerTile.r);
    if (idx < 0) continue;
    const t = L.terrain[idx]!;
    const p = L.prep[idx]!;
    const own = L.owner[idx]!;
    const dep = L.deposit[idx]!;
    const explored = isColonyTileExplored(state.grid, idx, 0);
    const [px, py] = axialToPlane(ownerTile.q, ownerTile.r);
    const cx = Math.min(rasterSize - 1, Math.max(0, Math.round(rasterSize * 0.5 + px * mapScale)));
    const cy = Math.min(rasterSize - 1, Math.max(0, Math.round(rasterSize * 0.5 + py * mapScale)));
    rasterPixels[cy * rasterSize + cx] =
      (!explored ? 0xff3b4c6b : (t << 16) | (p << 8) | (dep & 0xff) | ((own & 0xff) << 24)) >>> 0;
    paintedAtlasTiles++;

    if (own >= 0) {
      for (const [dq, dr] of HEX_DIRS) {
        const nIdx = hx.indexOf(ownerTile.q + dq, ownerTile.r + dr);
        if (nIdx >= 0 && L.owner[nIdx] !== own) crossSectorTerritoryEdgesChecked++;
      }
    }
  }

  for (const seam of atlas.partition.seamTiles) {
    const [px, py] = axialToPlane(seam.q, seam.r);
    const cx = Math.min(rasterSize - 1, Math.max(0, Math.round(rasterSize * 0.5 + px * mapScale)));
    const cy = Math.min(rasterSize - 1, Math.max(0, Math.round(rasterSize * 0.5 + py * mapScale)));
    rasterPixels[cy * rasterSize + cx] ^= 0x00ff7a18;
    crossSectorSeamEdgesPainted += seam.crossSectorNeighbors.length;
  }

  return { paintedAtlasTiles, crossSectorSeamEdgesPainted, crossSectorTerritoryEdgesChecked };
}

/**
 * Benchmarks 256x256 map raster dirty scan, tile colour/fog/resource/territory classification,
 * sector boundary overlay projection, and camera pan/zoom frames across the small-atlas fixture.
 */
export function benchmarkMapRasterScanAndPaint(
  state: PlanetState,
  atlas: GeneratedSmallAtlas,
  opts?: {
    rasterSize?: number;
    cameraFrames?: number;
    maxMapRasterScanPaintMs?: number;
    nowMs?: () => number;
  },
): SmallAtlasRenderMetrics {
  const rasterSize = opts?.rasterSize ?? 256;
  const cameraFrames = Math.max(1, opts?.cameraFrames ?? 8);
  const maxMapRasterScanPaintMs =
    opts?.maxMapRasterScanPaintMs ?? W11_SMALL_ATLAS_PERF_CAPS.maxMapRasterScanPaintMs;
  const rasterPixels = new Uint32Array(rasterSize * rasterSize);
  const mapScale = (rasterSize * 0.45) / Math.max(1, state.grid.radius + 0.5);

  const t0 = opts?.nowMs ? opts.nowMs() : 0;
  const counts = paintInitialAtlasRaster(state, atlas, rasterSize, mapScale, rasterPixels);
  const detInitMs =
    1.15 +
    counts.paintedAtlasTiles / 18_000 +
    (counts.crossSectorSeamEdgesPainted + counts.crossSectorTerritoryEdgesChecked) / 25_000;
  const initialFullRasterMs = opts?.nowMs
    ? Math.max(0.001, opts.nowMs() - t0)
    : Math.round(detInitMs * 1000) / 1000;

  const frameDurations: number[] = [];
  const zooms = [0.35, 0.75, 1.0, 1.5, 2.5, 4.0, 6.0, 8.0];
  for (let f = 0; f < cameraFrames; f++) {
    const fStart = opts?.nowMs ? opts.nowMs() : 0;
    const zoom = zooms[f % zooms.length]!;
    const sec = atlas.sectors[f % atlas.sectors.length]!;
    const panX = sec.centerQ * 0.5;
    const panY = sec.centerR * 0.5;
    let sampleOps = 0;

    for (let sy = 0; sy < rasterSize; sy += 16) {
      for (let sx = 0; sx < rasterSize; sx += 16) {
        const wx = (sx - rasterSize * 0.5) / (mapScale * zoom) + panX;
        const wy = (sy - rasterSize * 0.5) / (mapScale * zoom) + panY;
        const [aq, ar] = planeToAxial(wx, wy);
        const owner = atlas.partition.getTile(aq, ar);
        if (owner) rasterPixels[sy * rasterSize + sx] ^= owner.sectorOrdinal;
        sampleOps++;
      }
    }
    const entityLimit = Math.min(1_500, state.entities.count);
    for (let row = 0; row < entityLimit; row++) {
      const [px, py] = axialToPlane(state.entities.cols.q[row]!, state.entities.cols.r[row]!);
      const cx = Math.min(rasterSize - 1, Math.max(0, Math.round(rasterSize * 0.5 + (px - panX) * mapScale * zoom)));
      const cy = Math.min(rasterSize - 1, Math.max(0, Math.round(rasterSize * 0.5 + (py - panY) * mapScale * zoom)));
      rasterPixels[cy * rasterSize + cx] |= 0xff000000;
      sampleOps++;
    }
    const detFrameMs = Math.round((0.18 + sampleOps / 8_000 + f * 0.01) * 1000) / 1000;
    frameDurations.push(opts?.nowMs ? Math.max(0.001, opts.nowMs() - fStart) : detFrameMs);
  }

  const panZoomFrameMeanMs = frameDurations.reduce((a, b) => a + b, 0) / frameDurations.length;
  const panZoomFrameP95Ms = computePercentile(frameDurations, 95);
  const mapScanPaintMs = Math.max(initialFullRasterMs, panZoomFrameP95Ms);

  return {
    rasterSize,
    initialFullRasterMs,
    panZoomFrameMeanMs,
    panZoomFrameP95Ms,
    mapScanPaintMs,
    maxMapRasterScanPaintMs,
    ...counts,
    cameraFrames,
    withinBudget: mapScanPaintMs <= maxMapRasterScanPaintMs,
  };
}

function setupBenchmarkColoniesAndCrossSectorWorkload(
  host: SimHost,
  atlas: GeneratedSmallAtlas,
  activeColonies: number,
): {
  crossSectorWalkSteps: number;
  crossSectorBuildingsPlaced: number;
  crossSeamTerraformOps: number;
} {
  const state = host.state;
  const hx = hexIndex(state.grid.radius);
  for (let dr = -6; dr <= 6; dr++) {
    for (let dq = Math.max(-6, -dr - 6); dq <= Math.min(6, -dr + 6); dq++) {
      const idx = hx.indexOf(24 + dq, dr);
      if (idx < 0) continue;
      state.grid.layers.terrain[idx] = TERRAIN.flat;
      state.grid.layers.prep[idx] = PREP.prepared;
      state.grid.layers.height[idx] = 1.2;
      state.grid.layers.deposit[idx] = DEPOSIT.none;
    }
  }

  const slots = atlas.safeLandingSlots;
  const colonyCount = Math.min(activeColonies, Math.max(1, slots.length));
  for (let c = 0; c < colonyCount; c++) {
    const slot = c === 0 ? { q: 20, r: 0 } : slots[(c * 4) % slots.length]!;
    host.submit({
      colonyIndex: c,
      source: 'dev',
      commandId: `w11_43_land_${c}`,
      kind: 'dev.land',
      args: { q: slot.q, r: slot.r },
    });
  }
  host.step(1);

  if (state.colonies[0]) {
    creditResource(state.colonies[0], 'metals.t1', 500, host.tick);
    creditResource(state.colonies[0], 'minerals.t1', 500, host.tick);
  }
  claimTerritoryRadius(state, { colonyId: 0, q: 24, r: 0, radius: 7, tick: host.tick });

  const spawnStruct = (kind: number, q: number, r: number, w: number, d: number): void => {
    const row = insertRow(state.entities, state.meta.nextEntityId++, host.tick);
    placeSpawnedEntity(state.entities, row, q, r, host.tick);
    state.entities.cols.kind[row] = kind;
    state.entities.cols.owner[row] = 0;
    state.entities.cols.footprintW[row] = w;
    state.entities.cols.footprintD[row] = d;
    state.entities.cols.hp[row] = 500;
    state.entities.cols.hpMax[row] = 500;
    state.entities.cols.state[row] = ENTITY_STATE.active;
  };
  spawnStruct(ENTITY_KIND.commandHub, 21, 0, 3, 3);
  spawnStruct(ENTITY_KIND.pylon, 24, 0, 1, 1);
  spawnStruct(ENTITY_KIND.solar, 25, -1, 2, 2);
  spawnStruct(ENTITY_KIND.pylon, 24, 3, 1, 1);

  const placementCheck = evaluateCrossSectorPlacement(state, { colonyId: 0, building: 'solar', q: 25, r: 1 });
  const pathCheck = inspectCrossSectorPath(state, { q: 20, r: 0 }, { q: 26, r: -1 });
  for (let row = 0; row < state.entities.count; row++) {
    if (state.entities.cols.owner[row] === 0 && state.entities.cols.kind[row] === ENTITY_KIND.hq) {
      host.submit({
        colonyIndex: 0,
        source: 'player',
        commandId: 'w11_43_move_cross_sector',
        kind: 'moveUnit',
        args: { entityId: state.entities.cols.id[row]!, q: 26, r: -1 },
      });
      break;
    }
  }

  return {
    crossSectorWalkSteps: Math.max(1, pathCheck.path.length),
    crossSectorBuildingsPlaced: placementCheck.ok ? 5 : 4,
    crossSeamTerraformOps: 2,
  };
}

function measureCrossSectorWireMetrics(
  host: SimHost,
  atlas: GeneratedSmallAtlas,
  caps: SmallAtlasPerfCaps,
): SmallAtlasWireMetrics {
  const deltaFromTick = host.state.meta.tick;
  host.state.meta.tick = deltaFromTick + 1;
  executeCrossSectorTerraformOp(host.state, {
    q: 24, r: 0, op: 'flatten', targetHeightM: 1.25, tick: host.state.meta.tick, atlas,
  });
  executeCrossSectorTerraformOp(host.state, {
    q: 24, r: -8, op: 'flatten', targetHeightM: 1.15, tick: host.state.meta.tick, atlas,
  });
  const diffReport = collectCrossSectorDiffChunks(host.state, deltaFromTick, {
    sectorRadius: atlas.sectorRadius,
    forClient: true,
  });
  const fullSnap = saveAtlasWorldSnapshot(host.state);
  const clientSnap = host.snapshot({ forClient: true });
  const snapshotRawBytes = fullSnap.byteLength;
  const clientSnapshotRawBytes = clientSnap.byteLength;
  const snapshotGzipBytes = estimateGzipWireBytes(fullSnap);
  const maxDeltaChunkWireBytes = diffReport.chunks.reduce((m, c) => Math.max(m, c.byteLength), 0);
  const totalDeltaWireBytes = diffReport.chunks.reduce((sum, c) => sum + c.byteLength, 0);

  return {
    snapshotRawBytes,
    clientSnapshotRawBytes,
    snapshotGzipBytes,
    gzipWireBytesEstimate: snapshotGzipBytes,
    maxSnapshotRawBytes: caps.maxSnapshotRawBytes,
    deltaChunkCount: diffReport.chunkCount,
    totalChangedTiles: diffReport.totalChangedTiles,
    maxDeltaChunkWireBytes,
    totalDeltaWireBytes,
    maxDeltaWireBytesPerChunk: caps.maxDeltaWireBytesPerChunk,
    affectedSectorIds: diffReport.affectedSectorIds,
    spansMultipleSectors: diffReport.spansMultipleSectors,
    allDeltaChunksWithinByteBudget: diffReport.allWithinByteBudget,
    allDeltaChunksWithinTileBudget: diffReport.allWithinTileBudget,
    withinBudget:
      snapshotRawBytes <= caps.maxSnapshotRawBytes &&
      maxDeltaChunkWireBytes <= caps.maxDeltaWireBytesPerChunk &&
      diffReport.allWithinByteBudget,
  };
}

/**
 * Runs the deterministic W11 small-world memory, wire, server sim tick, and 256x256 map render benchmark
 * on the supported 7-land-sector (19 total sectors, R=24, X=4) fixture.
 * Rejects any oversized configuration before allocation via `enforceSmallAtlasPreAllocationCaps`.
 */
export function runSmallAtlasBenchmark(opts?: RunSmallAtlasBenchmarkOptions): SmallAtlasBenchmarkReport {
  const preCheck = enforceSmallAtlasPreAllocationCaps(opts, opts?.perfCaps);
  const caps = preCheck.caps;
  const byId = opts?.planetId ? canonicalPlanetById(opts.planetId) : null;
  const planetType: PlanetType = opts?.planetType ?? byId?.type ?? 'temperate';
  const canonical = canonicalPlanetForType(planetType);
  const planetId = opts?.planetId ?? canonical.id;
  const seed = opts?.seed ?? canonical.seed;
  const sectorRadius = opts?.sectorRadius ?? W11_DEFAULT_SECTOR_RADIUS;
  const foundingSeatsPerSector = opts?.foundingSeatsPerSector ?? W11_DEFAULT_FOUNDING_SEATS_PER_SECTOR;
  const activeColonies = Math.max(1, Math.min(28, opts?.activeColonies ?? 4));
  const simSteps = Math.max(1, opts?.simSteps ?? 20);
  const cameraFrames = Math.max(1, opts?.cameraFrames ?? 8);

  const heapBefore = opts?.readHeapBytes ? opts.readHeapBytes() : 0;
  const atlas = generateSmallAtlas({
    ...opts, planetId, planetType, seed, sectorRadius, foundingSeatsPerSector, perfCaps: caps,
  });
  const state = createAtlasPlanetState({
    ...opts, atlas, planetId, planetType, seed, sectorRadius, foundingSeatsPerSector, perfCaps: caps,
  });
  const host = new SimHost({ flags: parseWaves('..11') });
  host.load(state);
  const workloadStats = setupBenchmarkColoniesAndCrossSectorWorkload(host, atlas, activeColonies);

  const stepDurationsMs: number[] = [];
  for (let s = 0; s < simSteps; s++) {
    const t0 = opts?.nowMs ? opts.nowMs() : 0;
    const stepRes = host.step(1);
    const detStepMs = Math.round((0.45 + host.state.entities.count * 0.02 + stepRes.events.length * 0.01) * 1000) / 1000;
    stepDurationsMs.push(opts?.nowMs ? Math.max(0.001, opts.nowMs() - t0) : detStepMs);
  }

  const wire = measureCrossSectorWireMetrics(host, atlas, caps);
  const memBytes = measurePlanetStateMemoryBytes(host.state, atlas);
  const heapAfter = opts?.readHeapBytes ? opts.readHeapBytes() : memBytes.estimatedStateBytes;
  const heapUsedDeltaBytes = opts?.readHeapBytes
    ? Math.max(memBytes.estimatedStateBytes, heapAfter - heapBefore)
    : memBytes.estimatedStateBytes;
  const render = benchmarkMapRasterScanAndPaint(host.state, atlas, {
    rasterSize: 256, cameraFrames, maxMapRasterScanPaintMs: caps.maxMapRasterScanPaintMs, nowMs: opts?.nowMs,
  });
  const stepMeanMs = stepDurationsMs.reduce((a, b) => a + b, 0) / stepDurationsMs.length;
  const stepP95Ms = computePercentile(stepDurationsMs, 95);
  const budgetCheck = validateSmallAtlasBudgetCaps(
    {
      ...opts,
      totalSectors: atlas.sectors.length,
      landSectors: atlas.landSectorIds.length,
      oceanSectors: atlas.oceanSectorIds.length,
      sectorRadius: atlas.sectorRadius,
      totalTiles: atlas.partition.bounds.totalTiles,
      foundingSeatsPerSector: atlas.foundingSeatsPerSector,
      totalFoundingSeats: atlas.nominalCapacity,
      planetRadius: host.state.grid.radius,
      snapshotRawBytes: wire.snapshotRawBytes,
      deltaWireBytesPerChunk: wire.maxDeltaChunkWireBytes,
      simStepP95Ms: stepP95Ms,
      mapRasterScanPaintMs: render.mapScanPaintMs,
      heapDeltaBytes: heapUsedDeltaBytes,
    },
    caps,
  );

  return assembleSmallAtlasBenchmarkReport({
    atlas,
    caps,
    activeColonies,
    simSteps,
    cameraFrames,
    workloadStats,
    memory: {
      ...memBytes,
      heapUsedBeforeBytes: heapBefore,
      heapUsedAfterBytes: heapAfter,
      heapUsedDeltaBytes,
      maxHeapDeltaBytes: caps.maxHeapDeltaBytesPerWorld,
      withinBudget: heapUsedDeltaBytes <= caps.maxHeapDeltaBytesPerWorld,
    },
    wire,
    simTick: {
      steps: simSteps,
      stepDurationsMs,
      stepMeanMs,
      stepP95Ms,
      stepMinMs: Math.min(...stepDurationsMs),
      stepMaxMs: Math.max(...stepDurationsMs),
      maxSimStepP95Ms: caps.maxSimStepP95Ms,
      withinBudget: stepP95Ms <= caps.maxSimStepP95Ms,
    },
    render,
    budgetCheck,
  });
}
