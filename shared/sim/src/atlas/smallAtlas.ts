import {
  formatContinentId,
  formatSectorId,
  W11_DEFAULT_SECTOR_RADIUS,
  W11_SEVEN_SECTOR_COORDS,
  type ContinentId,
  type SectorId,
  type SectorKind,
} from '@terra/contracts';
import { HEX_DIRS, hexCount, hexDistance } from '../grid/hex';
import {
  enumerateSectorTiles,
  globalTileToSector,
  macroNeighbors,
  sectorCenterForMacro,
  tileCoordKey,
} from './partition';
import {
  W11_OCEAN_HALO_SECTOR_COORDS,
  type AtlasCornerTile,
  type AtlasCornerTriple,
  type AtlasPartition,
  type AtlasSeamNeighbor,
  type AtlasSeamTile,
  type AtlasSectorPartition,
  type AtlasTileOwner,
  type BuildSmallAtlasPartitionOptions,
  type GlobalTileSectorLookup,
  type SectorTileEntry,
} from './types';

interface RawSectorSpec {
  readonly sectorId: SectorId;
  readonly ordinal: number;
  readonly kind: SectorKind;
  readonly continentId: ContinentId | null;
  readonly macroQ: number;
  readonly macroR: number;
}

function assertSafeIntPair(a: number, b: number, label: string): void {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) {
    throw new RangeError(`${label} must be safe integers, got (${a}, ${b})`);
  }
}

function collectSmallAtlasSectorSpecs(opts?: BuildSmallAtlasPartitionOptions): RawSectorSpec[] {
  const landCoords = opts?.landCoords ?? W11_SEVEN_SECTOR_COORDS;
  if (landCoords.length === 0) {
    throw new RangeError('landCoords must contain at least one sector coordinate');
  }
  const continentId = opts?.continentId ?? formatContinentId(0);
  const seen = new Set<SectorId>();
  const specs: RawSectorSpec[] = [];

  for (const [mq, mr] of landCoords) {
    assertSafeIntPair(mq, mr, 'land macro coordinates');
    const sectorId = formatSectorId(mq, mr);
    if (seen.has(sectorId)) throw new RangeError(`duplicate sector coordinate (${mq}, ${mr}) in landCoords`);
    seen.add(sectorId);
    specs.push({ sectorId, ordinal: specs.length, kind: 'land', continentId, macroQ: mq + 0, macroR: mr + 0 });
  }

  const includeOceanHalo = opts?.includeOceanHalo ?? true;
  if (!includeOceanHalo && !opts?.oceanCoords) return specs;

  const rawOceanCoords: Array<readonly [number, number]> = [];
  if (opts?.oceanCoords) {
    rawOceanCoords.push(...opts.oceanCoords);
  } else if (landCoords === W11_SEVEN_SECTOR_COORDS) {
    rawOceanCoords.push(...W11_OCEAN_HALO_SECTOR_COORDS);
  } else {
    for (const [mq, mr] of landCoords) {
      for (const [dq, dr] of HEX_DIRS) rawOceanCoords.push([mq + dq, mr + dr]);
    }
  }

  for (const [mq, mr] of rawOceanCoords) {
    assertSafeIntPair(mq, mr, 'ocean macro coordinates');
    const sectorId = formatSectorId(mq, mr);
    if (seen.has(sectorId)) {
      if (opts?.oceanCoords) throw new RangeError(`duplicate or overlapping ocean sector coordinate (${mq}, ${mr})`);
      continue;
    }
    seen.add(sectorId);
    specs.push({ sectorId, ordinal: specs.length, kind: 'ocean', continentId: null, macroQ: mq + 0, macroR: mr + 0 });
  }
  return specs;
}

function buildSeamTilesForSector(
  sectorId: SectorId,
  macroQ: number,
  macroR: number,
  sectorTiles: readonly SectorTileEntry[],
  sectorRadius: number,
  tileByKey: ReadonlyMap<string, AtlasTileOwner>,
): AtlasSeamTile[] {
  const seams: AtlasSeamTile[] = [];
  for (const tile of sectorTiles) {
    if (hexDistance(0, 0, tile.localQ, tile.localR) < sectorRadius) continue;
    const neighbors: AtlasSeamNeighbor[] = [];
    const crossSectorNeighbors: AtlasSeamNeighbor[] = [];
    for (let dir = 0; dir < HEX_DIRS.length; dir++) {
      const [dq, dr] = HEX_DIRS[dir]!;
      const nq = tile.q + dq + 0;
      const nr = tile.r + dr + 0;
      const hit = tileByKey.get(tileCoordKey(nq, nr));
      const owner: GlobalTileSectorLookup = hit ?? globalTileToSector(nq, nr, sectorRadius);
      const entry: AtlasSeamNeighbor = {
        dir,
        oppositeDir: (dir + 3) % 6,
        q: nq,
        r: nr,
        ...owner,
        inAtlas: hit !== undefined,
      };
      neighbors.push(entry);
      if (owner.sectorId !== sectorId) crossSectorNeighbors.push(entry);
    }
    if (crossSectorNeighbors.length > 0) {
      seams.push({
        q: tile.q,
        r: tile.r,
        sectorId,
        macroQ,
        macroR,
        localQ: tile.localQ,
        localR: tile.localR,
        localIndex: tile.localIndex,
        neighbors,
        crossSectorNeighbors,
      });
    }
  }
  return seams;
}

function collectCornerTriples(
  seamTiles: readonly AtlasSeamTile[],
  sectorRadius: number,
  tileByKey: ReadonlyMap<string, AtlasTileOwner>,
): AtlasCornerTriple[] {
  const byKey = new Map<string, AtlasCornerTriple>();
  const resolveCornerTile = (q: number, r: number): AtlasCornerTile => {
    const hit = tileByKey.get(tileCoordKey(q, r));
    const owner: GlobalTileSectorLookup = hit ?? globalTileToSector(q, r, sectorRadius);
    return { q: q + 0, r: r + 0, ...owner, inAtlas: hit !== undefined };
  };

  for (const seam of seamTiles) {
    const tileA = resolveCornerTile(seam.q, seam.r);
    for (let dir = 0; dir < HEX_DIRS.length; dir++) {
      const [dq1, dr1] = HEX_DIRS[dir]!;
      const [dq2, dr2] = HEX_DIRS[(dir + 1) % 6]!;
      const tileB = resolveCornerTile(seam.q + dq1, seam.r + dr1);
      const tileC = resolveCornerTile(seam.q + dq2, seam.r + dr2);
      if (
        tileA.sectorId === tileB.sectorId ||
        tileB.sectorId === tileC.sectorId ||
        tileC.sectorId === tileA.sectorId
      ) {
        continue;
      }
      const sorted = [tileA, tileB, tileC].sort((x, y) =>
        x.sectorId < y.sectorId ? -1 : x.sectorId > y.sectorId ? 1 : x.q - y.q || x.r - y.r,
      ) as [AtlasCornerTile, AtlasCornerTile, AtlasCornerTile];
      const key = `${sorted[0].q},${sorted[0].r}|${sorted[1].q},${sorted[1].r}|${sorted[2].q},${sorted[2].r}`;
      if (byKey.has(key)) continue;
      byKey.set(key, {
        key,
        tiles: sorted,
        sectorIds: [sorted[0].sectorId, sorted[1].sectorId, sorted[2].sectorId],
        allInAtlas: sorted[0].inAtlas && sorted[1].inAtlas && sorted[2].inAtlas,
      });
    }
  }
  return [...byKey.values()];
}

function populatePartitionTiles(
  specs: readonly RawSectorSpec[],
  sectorRadius: number,
): {
  tiles: AtlasTileOwner[];
  tileByKey: Map<string, AtlasTileOwner>;
  rawSectorTiles: Map<SectorId, SectorTileEntry[]>;
  bounds: { minQ: number; maxQ: number; minR: number; maxR: number; totalTiles: number };
} {
  const tiles: AtlasTileOwner[] = [];
  const tileByKey = new Map<string, AtlasTileOwner>();
  const rawSectorTiles = new Map<SectorId, SectorTileEntry[]>();
  let minQ = Infinity;
  let maxQ = -Infinity;
  let minR = Infinity;
  let maxR = -Infinity;

  for (const spec of specs) {
    const { centerQ, centerR } = sectorCenterForMacro(spec.macroQ, spec.macroR, sectorRadius);
    const sectorTiles = enumerateSectorTiles(spec.macroQ, spec.macroR, sectorRadius);
    rawSectorTiles.set(spec.sectorId, sectorTiles);
    for (const st of sectorTiles) {
      const owner: AtlasTileOwner = {
        atlasIndex: tiles.length,
        q: st.q,
        r: st.r,
        sectorId: spec.sectorId,
        sectorOrdinal: spec.ordinal,
        kind: spec.kind,
        macroQ: spec.macroQ,
        macroR: spec.macroR,
        centerQ,
        centerR,
        localQ: st.localQ,
        localR: st.localR,
        localIndex: st.localIndex,
      };
      tiles.push(owner);
      tileByKey.set(tileCoordKey(st.q, st.r), owner);
      if (st.q < minQ) minQ = st.q;
      if (st.q > maxQ) maxQ = st.q;
      if (st.r < minR) minR = st.r;
      if (st.r > maxR) maxR = st.r;
    }
  }
  return {
    tiles,
    tileByKey,
    rawSectorTiles,
    bounds: { minQ: minQ + 0, maxQ: maxQ + 0, minR: minR + 0, maxR: maxR + 0, totalTiles: tiles.length },
  };
}

const defaultPartitionCache = new Map<string, AtlasPartition>();

function defaultPartitionCacheKey(opts?: BuildSmallAtlasPartitionOptions): string | null {
  const sectorRadius = opts?.sectorRadius ?? W11_DEFAULT_SECTOR_RADIUS;
  const landCoords = opts?.landCoords ?? W11_SEVEN_SECTOR_COORDS;
  const oceanCoords = opts?.oceanCoords;
  const includeOceanHalo = opts?.includeOceanHalo ?? true;
  const continentId = opts?.continentId ?? formatContinentId(0);
  if (landCoords !== W11_SEVEN_SECTOR_COORDS) return null;
  if (oceanCoords !== undefined && oceanCoords !== W11_OCEAN_HALO_SECTOR_COORDS) return null;
  return `${sectorRadius}|${includeOceanHalo ? 1 : 0}|${oceanCoords ? 1 : 0}|${continentId}`;
}

export function buildSmallAtlasPartition(opts?: BuildSmallAtlasPartitionOptions): AtlasPartition {
  const cacheKey = defaultPartitionCacheKey(opts);
  if (cacheKey) {
    const cached = defaultPartitionCache.get(cacheKey);
    if (cached) return cached;
  }
  const sectorRadius = opts?.sectorRadius ?? W11_DEFAULT_SECTOR_RADIUS;
  if (!Number.isSafeInteger(sectorRadius) || sectorRadius <= 0) {
    throw new RangeError(`sectorRadius must be a positive integer, got ${sectorRadius}`);
  }
  const specs = collectSmallAtlasSectorSpecs(opts);
  const tilesPerSector = hexCount(sectorRadius);
  const knownSectorIds = new Set<SectorId>(specs.map((s) => s.sectorId));
  const { tiles, tileByKey, rawSectorTiles, bounds } = populatePartitionTiles(specs, sectorRadius);

  const sectors: AtlasSectorPartition[] = [];
  const sectorById = new Map<SectorId, AtlasSectorPartition>();
  const landSectorIds: SectorId[] = [];
  const oceanSectorIds: SectorId[] = [];
  const seamTiles: AtlasSeamTile[] = [];

  for (const spec of specs) {
    const { centerQ, centerR } = sectorCenterForMacro(spec.macroQ, spec.macroR, sectorRadius);
    const sectorTiles = rawSectorTiles.get(spec.sectorId)!;
    const sectorSeams = buildSeamTilesForSector(
      spec.sectorId,
      spec.macroQ,
      spec.macroR,
      sectorTiles,
      sectorRadius,
      tileByKey,
    );
    seamTiles.push(...sectorSeams);
    const sectorPartition: AtlasSectorPartition = {
      sectorId: spec.sectorId,
      ordinal: spec.ordinal,
      kind: spec.kind,
      continentId: spec.continentId,
      macroQ: spec.macroQ,
      macroR: spec.macroR,
      centerQ,
      centerR,
      radius: sectorRadius,
      tileCount: sectorTiles.length,
      neighbors: macroNeighbors(spec.macroQ, spec.macroR, sectorRadius),
      atlasNeighbors: macroNeighbors(spec.macroQ, spec.macroR, sectorRadius, knownSectorIds),
      tiles: sectorTiles,
      seamTiles: sectorSeams,
    };
    sectors.push(sectorPartition);
    sectorById.set(spec.sectorId, sectorPartition);
    if (spec.kind === 'land') landSectorIds.push(spec.sectorId);
    else oceanSectorIds.push(spec.sectorId);
  }

  const cornerTriples = collectCornerTriples(seamTiles, sectorRadius, tileByKey);
  const partition: AtlasPartition = {
    sectorRadius,
    tilesPerSector,
    sectors,
    sectorById,
    landSectorIds,
    oceanSectorIds,
    tiles,
    tileByKey,
    seamTiles,
    cornerTriples,
    bounds,
    getTile: (q: number, r: number) => tileByKey.get(tileCoordKey(q, r)) ?? null,
  };
  if (cacheKey) defaultPartitionCache.set(cacheKey, partition);
  return partition;
}
