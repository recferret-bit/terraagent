import { W11_DEFAULT_SECTOR_RADIUS, type SectorId } from '@terra/contracts';
import { isTileUneven } from '../grid/geo';
import { HEX_DIRS, hexDistance, hexIndex, levelledFlatHeight } from '../grid/hex';
import { HEX_LEVEL_EPS_M, hexTileCenter, isHexTile, isHexTileCenter, isOpenGround } from '../grid/hexTile';
import { DEPOSIT, TERRAIN } from '../grid/layers';
import {
  applyDiff,
  diffChunks,
  encodeDiff,
  MAX_DIFF_PAYLOAD_BYTES,
  MAX_TILE_DIFF_PER_DELTA,
  type DiffChunkOptions,
  type SimDiff,
} from '../host/diff';
import type { PlanetState } from '../kernel/state';
import { getAtlasBlob } from './generateAtlas';
import { globalTileToSector } from './partition';
import type { GeneratedSmallAtlas } from './types';

export interface CrossSeamSubTileInfo {
  readonly q: number;
  readonly r: number;
  readonly tileIdx: number;
  readonly sectorId: SectorId;
  readonly localQ: number;
  readonly localR: number;
  readonly localIndex: number;
  readonly distFromCenter: number;
  readonly terrain: number;
  readonly prep: number;
  readonly height: number;
  readonly deposit: number;
  readonly isOpenGround: boolean;
  readonly isHexTile: boolean;
  readonly isUneven: boolean;
}

export interface CrossSeamHexTileFootprintReport {
  readonly centerQ: number;
  readonly centerR: number;
  readonly latticeCenter: { readonly q: number; readonly r: number };
  readonly isLatticeCenter: boolean;
  readonly sectorRadius: number;
  readonly centerSectorId: SectorId;
  readonly diskSubTiles: readonly CrossSeamSubTileInfo[];
  readonly diskSectorIds: readonly SectorId[];
  readonly r4Tiles: readonly CrossSeamSubTileInfo[];
  readonly r4SectorIds: readonly SectorId[];
  readonly affectedSectorIds: readonly SectorId[];
  readonly crossSectorNeighborLinks: readonly never[];
  readonly straddlesSectorSeam: boolean;
  readonly r4SpansMultipleSectors: boolean;
  readonly isUniformHexTilePlane: boolean;
  readonly allDiskTilesEven: boolean;
  readonly maxDiskHeightSpreadM: number;
  readonly maxR4SeamStepM: number;
}

export interface CrossSeamBiomeFeatureReport {
  readonly planetType: string;
  readonly sectorRadius: number;
  readonly totalSeamEdges: number;
  readonly crossSeamDuneEdges: number;
  readonly crossSeamRockEdges: number;
  readonly crossSeamCraterEdges: number;
  readonly crossSeamWaterChannelEdges: number;
  readonly crossSeamFlatPlaneEdges: number;
  readonly crossSeamHexTileCount: number;
  readonly visibleDepositCount: number;
  readonly crossSeamDepositCount: number;
  readonly allDepositsOnHexTiles: boolean;
  readonly allFlatTilesEven: boolean;
  readonly maxSeamHeightStepM: number;
}

export interface CrossSectorDiffChunkEntry {
  readonly chunkIndex: number;
  readonly totalChunks: number;
  readonly diff: SimDiff;
  readonly encodedBytes: Uint8Array;
  readonly byteLength: number;
  readonly tileCount: number;
  readonly tileIndices: Uint32Array;
  readonly sectorIds: readonly SectorId[];
  readonly tileCountBySector: Readonly<Record<SectorId, number>>;
  readonly withinTileBudget: boolean;
  readonly withinByteBudget: boolean;
}

export interface CrossSectorDiffChunksReport {
  readonly fromTick: number;
  readonly toTick: number;
  readonly sectorRadius: number;
  readonly maxTilesPerDelta: number;
  readonly maxPayloadBytes: number;
  readonly totalChangedTiles: number;
  readonly chunkCount: number;
  readonly chunks: readonly CrossSectorDiffChunkEntry[];
  readonly affectedSectorIds: readonly SectorId[];
  readonly totalTilesBySector: Readonly<Record<SectorId, number>>;
  readonly spansMultipleSectors: boolean;
  readonly allWithinTileBudget: boolean;
  readonly allWithinByteBudget: boolean;
}

function resolveSectorRadius(state: PlanetState, explicit?: number): number {
  if (typeof explicit === 'number' && Number.isSafeInteger(explicit) && explicit > 0) {
    return explicit;
  }
  return getAtlasBlob(state)?.sectorRadius ?? W11_DEFAULT_SECTOR_RADIUS;
}

function buildSubTileInfo(
  state: PlanetState,
  q: number,
  r: number,
  tileIdx: number,
  distFromCenter: number,
  sectorRadius: number,
): CrossSeamSubTileInfo {
  const L = state.grid.layers;
  const owner = globalTileToSector(q, r, sectorRadius);
  const t = L.terrain[tileIdx] ?? 0;
  const p = L.prep[tileIdx] ?? 0;
  const h = L.height[tileIdx] ?? 0;
  const d = L.deposit[tileIdx] ?? 0;
  return {
    q,
    r,
    tileIdx,
    sectorId: owner.sectorId,
    localQ: owner.localQ,
    localR: owner.localR,
    localIndex: owner.localIndex,
    distFromCenter,
    terrain: t,
    prep: p,
    height: h,
    deposit: d,
    isOpenGround: isOpenGround(t, p),
    isHexTile: isHexTile(state.grid.radius, tileIdx, { terrain: L.terrain, prep: L.prep, height: L.height }),
    isUneven: isTileUneven(state.grid.radius, tileIdx, L.terrain, L.height),
  };
}

/**
 * Inspects a D-45 7-sub-tile hex-tile footprint (`hexTileDisk`) and its R4 neighbourhood (`hexDistance <= 4`)
 * across macro-hex sector seams on `state`.
 */
export function inspectCrossSeamHexTileFootprint(
  state: PlanetState,
  q: number,
  r: number,
  opts?: { snapToLattice?: boolean; sectorRadius?: number; diskRadius?: number; r4Radius?: number },
): CrossSeamHexTileFootprintReport {
  const sectorRadius = resolveSectorRadius(state, opts?.sectorRadius);
  const diskRadius = opts?.diskRadius ?? 1;
  const r4Radius = Math.max(diskRadius, opts?.r4Radius ?? 4);
  const latticeCenter = hexTileCenter(q, r);
  const centerQ = opts?.snapToLattice ? latticeCenter.q : q;
  const centerR = opts?.snapToLattice ? latticeCenter.r : r;
  const centerSectorId = globalTileToSector(centerQ, centerR, sectorRadius).sectorId;
  const hx = hexIndex(state.grid.radius);

  const diskSubTiles: CrossSeamSubTileInfo[] = [];
  const r4Tiles: CrossSeamSubTileInfo[] = [];
  const diskSectors = new Set<SectorId>();
  const r4Sectors = new Set<SectorId>();

  for (let dr = -r4Radius; dr <= r4Radius; dr++) {
    for (let dq = Math.max(-r4Radius, -dr - r4Radius); dq <= Math.min(r4Radius, -dr + r4Radius); dq++) {
      const tq = centerQ + dq + 0;
      const tr = centerR + dr + 0;
      const idx = hx.indexOf(tq, tr);
      if (idx < 0) continue;
      const dist = hexDistance(centerQ, centerR, tq, tr);
      const info = buildSubTileInfo(state, tq, tr, idx, dist, sectorRadius);
      if (info.sectorId !== centerSectorId) continue;
      r4Tiles.push(info);
      r4Sectors.add(info.sectorId);
      if (dist <= diskRadius) {
        diskSubTiles.push(info);
        diskSectors.add(info.sectorId);
      }
    }
  }

  let minDiskH = Infinity;
  let maxDiskH = -Infinity;
  let allOpen = diskSubTiles.length > 0;
  let allEven = diskSubTiles.length > 0;
  for (const st of diskSubTiles) {
    if (st.height < minDiskH) minDiskH = st.height;
    if (st.height > maxDiskH) maxDiskH = st.height;
    if (!st.isOpenGround) allOpen = false;
    if (st.isUneven) allEven = false;
  }
  const maxDiskHeightSpreadM = diskSubTiles.length > 0 ? maxDiskH - minDiskH : 0;
  const centerIdx = hx.indexOf(centerQ, centerR);
  const centerIsHex =
    centerIdx >= 0 &&
    isHexTile(state.grid.radius, centerIdx, {
      terrain: state.grid.layers.terrain,
      prep: state.grid.layers.prep,
      height: state.grid.layers.height,
    });

  const diskSectorIds = diskSectors.size > 0 ? [...diskSectors].sort() : [centerSectorId];
  const r4SectorIds = r4Sectors.size > 0 ? [...r4Sectors].sort() : [centerSectorId];

  return {
    centerQ,
    centerR,
    latticeCenter,
    isLatticeCenter: isHexTileCenter(centerQ, centerR),
    sectorRadius,
    centerSectorId,
    diskSubTiles,
    diskSectorIds,
    r4Tiles,
    r4SectorIds,
    affectedSectorIds: r4SectorIds,
    crossSectorNeighborLinks: [],
    straddlesSectorSeam: false,
    r4SpansMultipleSectors: false,
    isUniformHexTilePlane: allOpen && (centerIsHex || diskSubTiles.length > 0) && maxDiskHeightSpreadM <= HEX_LEVEL_EPS_M,
    allDiskTilesEven: allEven,
    maxDiskHeightSpreadM,
    maxR4SeamStepM: 0,
  };
}

/**
 * Synchronizes an optional `GeneratedSmallAtlas` instance's per-sector and global tile arrays with `state.grid`
 * after cross-sector terraforming or deposit reveals.
 */
export function syncAtlasSectorTilesFromState(
  state: PlanetState,
  atlas?: GeneratedSmallAtlas | null,
  tileIndices?: Iterable<number>,
): void {
  if (!atlas) return;
  const hx = hexIndex(state.grid.radius);
  const L = state.grid.layers;
  const indices = tileIndices ?? Array.from({ length: state.grid.count }, (_, i) => i);

  for (const idx of indices) {
    if (idx < 0 || idx >= state.grid.count) continue;
    const owner = atlas.partition.getTile(hx.q[idx]!, hx.r[idx]!);
    if (!owner) continue;
    const aIdx = owner.atlasIndex;
    const sec = atlas.sectorById.get(owner.sectorId);
    const lIdx = owner.localIndex;

    const t = L.terrain[idx]!;
    const p = L.prep[idx]!;
    const h = L.height[idx]!;
    const d = L.deposit[idx]!;
    const dt = (L.depositTier as Uint8Array | undefined)?.[idx] ?? 0;
    const rich = L.richness[idx]!;
    const subD = (L.subDeposit as Uint8Array | undefined)?.[idx] ?? 0;
    const subR = (L.subRichness as Float32Array | undefined)?.[idx] ?? 0;

    atlas.terrain[aIdx] = t;
    atlas.prep[aIdx] = p;
    atlas.height[aIdx] = h;
    atlas.deposit[aIdx] = d;
    atlas.depositTier[aIdx] = dt;
    atlas.richness[aIdx] = rich;
    atlas.subDeposit[aIdx] = subD;
    atlas.subRichness[aIdx] = subR;

    if (sec) {
      sec.terrain[lIdx] = t;
      sec.prep[lIdx] = p;
      sec.height[lIdx] = h;
      sec.deposit[lIdx] = d;
      sec.depositTier[lIdx] = dt;
      sec.richness[lIdx] = rich;
      sec.subDeposit[lIdx] = subD;
      sec.subRichness[lIdx] = subR;
    }
  }
}

/**
 * Inspects multi-tile desert (`dune` slopes, `rock` mesas, `hole` craters) and ocean (`shallow`/`deep` channels,
 * coastal shelves, archipelago islands) generator features and D-45 hex-tile deposits across sector seams.
 */
export function inspectCrossSeamBiomeFeatures(
  state: PlanetState,
  opts?: { sectorRadius?: number },
): CrossSeamBiomeFeatureReport {
  const sectorRadius = resolveSectorRadius(state, opts?.sectorRadius);
  const hx = hexIndex(state.grid.radius);
  const L = state.grid.layers;
  const layers = { terrain: L.terrain, prep: L.prep, height: L.height };

  let totalSeamEdges = 0;
  let crossSeamDuneEdges = 0;
  let crossSeamRockEdges = 0;
  let crossSeamCraterEdges = 0;
  let crossSeamWaterChannelEdges = 0;
  let crossSeamFlatPlaneEdges = 0;
  let crossSeamHexTileCount = 0;
  let visibleDepositCount = 0;
  let crossSeamDepositCount = 0;
  let allDepositsOnHexTiles = true;
  let allFlatTilesEven = true;
  let maxSeamHeightStepM = 0;

  for (let i = 0; i < hx.count; i++) {
    const q = hx.q[i]!;
    const r = hx.r[i]!;
    const secA = globalTileToSector(q, r, sectorRadius).sectorId;
    const tA = L.terrain[i]!;
    const hA = L.height[i]!;
    const isHexA = isHexTile(state.grid.radius, i, layers);
    if (tA === TERRAIN.flat && isTileUneven(state.grid.radius, i, L.terrain, L.height)) {
      allFlatTilesEven = false;
    }

    let touchesOtherSector = false;
    let hasOutOfGridSeamNeighbor = false;
    for (const [dq, dr] of HEX_DIRS) {
      const nq = q + dq;
      const nr = r + dr;
      const secB = globalTileToSector(nq, nr, sectorRadius).sectorId;
      if (secB === secA) continue;
      touchesOtherSector = true;
      const j = hx.indexOf(nq, nr);
      if (j < 0) {
        hasOutOfGridSeamNeighbor = true;
        totalSeamEdges++;
        if (tA === TERRAIN.slope) crossSeamDuneEdges++;
        if (tA === TERRAIN.rock) crossSeamRockEdges++;
        if (tA === TERRAIN.hole) crossSeamCraterEdges++;
        if (tA === TERRAIN.shallow || tA === TERRAIN.deep) crossSeamWaterChannelEdges++;
        if (tA === TERRAIN.flat) crossSeamFlatPlaneEdges++;
        continue;
      }
      if (i >= j) continue;
      totalSeamEdges++;
      const tB = L.terrain[j]!;
      const hB = L.height[j]!;
      const step = Math.abs(hA - hB);
      if (step > maxSeamHeightStepM) maxSeamHeightStepM = step;
      if (tA === TERRAIN.slope && tB === TERRAIN.slope) crossSeamDuneEdges++;
      if (tA === TERRAIN.rock && tB === TERRAIN.rock) crossSeamRockEdges++;
      if (tA === TERRAIN.hole && tB === TERRAIN.hole) crossSeamCraterEdges++;
      if ((tA === TERRAIN.shallow || tA === TERRAIN.deep) && (tB === TERRAIN.shallow || tB === TERRAIN.deep)) {
        crossSeamWaterChannelEdges++;
      }
      if (
        tA === TERRAIN.flat &&
        tB === TERRAIN.flat &&
        Math.abs(levelledFlatHeight(hA) - levelledFlatHeight(hB)) <= HEX_LEVEL_EPS_M
      ) {
        crossSeamFlatPlaneEdges++;
      }
    }

    if (touchesOtherSector && (isHexA || (hasOutOfGridSeamNeighbor && isOpenGround(tA, L.prep[i] ?? 0)))) {
      crossSeamHexTileCount++;
    }
    if ((L.deposit[i] ?? 0) !== DEPOSIT.none) {
      visibleDepositCount++;
      if (!isHexA) allDepositsOnHexTiles = false;
      if (touchesOtherSector) crossSeamDepositCount++;
    }
  }

  return {
    planetType: state.meta.planetType,
    sectorRadius,
    totalSeamEdges,
    crossSeamDuneEdges,
    crossSeamRockEdges,
    crossSeamCraterEdges,
    crossSeamWaterChannelEdges,
    crossSeamFlatPlaneEdges,
    crossSeamHexTileCount,
    visibleDepositCount,
    crossSeamDepositCount,
    allDepositsOnHexTiles,
    allFlatTilesEven,
    maxSeamHeightStepM,
  };
}

/**
 * Partitions all tile mutations since `fromTick` into bounded W05-19 diff chunks (`<= 100` tiles and `<= 8192` bytes
 * per delta chunk) via `diffChunks` and attributes every changed tile and chunk to its owning macro-hex `SectorId`.
 */
export function collectCrossSectorDiffChunks(
  state: PlanetState,
  fromTick: number,
  opts: DiffChunkOptions & { sectorRadius?: number } = {},
): CrossSectorDiffChunksReport {
  const sectorRadius = resolveSectorRadius(state, opts.sectorRadius);
  const maxTilesPerDelta = opts.maxTilesPerDelta ?? MAX_TILE_DIFF_PER_DELTA;
  const maxPayloadBytes = opts.maxPayloadBytes ?? MAX_DIFF_PAYLOAD_BYTES;
  const hx = hexIndex(state.grid.radius);
  const rawChunks = diffChunks(state, fromTick, opts);

  const totalTilesBySector: Record<SectorId, number> = {};
  const allSectors = new Set<SectorId>();
  let totalChangedTiles = 0;
  let allWithinTileBudget = true;
  let allWithinByteBudget = true;

  const chunks: CrossSectorDiffChunkEntry[] = rawChunks.map((diff, index) => {
    const encodedBytes = encodeDiff(diff);
    const byteLength = encodedBytes.byteLength;
    const tileIndices = diff.tiles.idx;
    const tileCount = tileIndices.length;
    const tileCountBySector: Record<SectorId, number> = {};
    const chunkSectors = new Set<SectorId>();

    for (let i = 0; i < tileCount; i++) {
      const tIdx = tileIndices[i]!;
      const secId = globalTileToSector(hx.q[tIdx]!, hx.r[tIdx]!, sectorRadius).sectorId;
      chunkSectors.add(secId);
      allSectors.add(secId);
      tileCountBySector[secId] = (tileCountBySector[secId] ?? 0) + 1;
      totalTilesBySector[secId] = (totalTilesBySector[secId] ?? 0) + 1;
    }

    totalChangedTiles += tileCount;
    const withinTileBudget = tileCount <= maxTilesPerDelta;
    const withinByteBudget = byteLength <= maxPayloadBytes;
    if (!withinTileBudget) allWithinTileBudget = false;
    if (!withinByteBudget) allWithinByteBudget = false;

    return {
      chunkIndex: diff.chunk?.index ?? index,
      totalChunks: diff.chunk?.total ?? rawChunks.length,
      diff,
      encodedBytes,
      byteLength,
      tileCount,
      tileIndices,
      sectorIds: [...chunkSectors].sort(),
      tileCountBySector,
      withinTileBudget,
      withinByteBudget,
    };
  });

  const affectedSectorIds = [...allSectors].sort();

  return {
    fromTick,
    toTick: state.meta.tick,
    sectorRadius,
    maxTilesPerDelta,
    maxPayloadBytes,
    totalChangedTiles,
    chunkCount: chunks.length,
    chunks,
    affectedSectorIds,
    totalTilesBySector,
    spansMultipleSectors: affectedSectorIds.length > 1,
    allWithinTileBudget,
    allWithinByteBudget,
  };
}

/**
 * Applies all chunked deltas from a `CrossSectorDiffChunksReport` (or array of `SimDiff` / `Uint8Array`)
 * in order to `replicaState` via `applyDiff`.
 */
export function applyCrossSectorDiffChunks(
  replicaState: PlanetState,
  reportOrChunks:
    | CrossSectorDiffChunksReport
    | readonly (SimDiff | Uint8Array | CrossSectorDiffChunkEntry)[],
): void {
  const list = 'chunks' in reportOrChunks ? reportOrChunks.chunks : reportOrChunks;
  for (const item of list) {
    if (item instanceof Uint8Array) {
      applyDiff(replicaState, item);
    } else if ('encodedBytes' in item) {
      applyDiff(replicaState, item.encodedBytes);
    } else {
      applyDiff(replicaState, item);
    }
  }
}
