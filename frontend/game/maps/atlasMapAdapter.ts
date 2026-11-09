import {
  formatContinentId,
  W11_DEFAULT_SECTOR_RADIUS,
  type AtlasManifestV1,
  type PlanetSummaryV1,
  type SectorId,
  type SectorKind,
  type SectorManifestV1,
} from '@terra/contracts';
import {
  buildAtlasManifest,
  buildSmallAtlasPartition,
  createAtlasQueryView,
  extractPinnedAtlasManifest,
  globalTileToSector,
  hexCount,
  hexDistance,
  hexIndex,
  inHex,
  planeToAxial,
  sectorLocalToGlobalTile,
  type AtlasBlobValue,
  type AtlasPartition,
  type AtlasQueryInterface,
  type AtlasTileOwner,
  type GeneratedSmallAtlas,
} from '@terra/sim';
import type { ClientTiles } from '../store/replica/viewCodec';
import { clampPixelToAxial as clampLegacyPixelToAxial } from './minimapInput';
import {
  axialToCanvasPixel,
  canvasPixelToAxial,
  mapScaleForRadius,
  radiusFromTileCount,
} from './rasterCache';
import type { MapLayerDrawView } from './types';

export interface AtlasTileLookupResult {
  readonly q: number;
  readonly r: number;
  readonly inAtlas: boolean;
  readonly playable: boolean;
  readonly sectorId: SectorId | null;
  readonly kind: SectorKind | null;
  readonly macroQ: number | null;
  readonly macroR: number | null;
  readonly localQ: number | null;
  readonly localR: number | null;
  readonly localIndex: number;
  readonly atlasIndex: number;
  readonly bufferIndex: number;
}

export interface AtlasDrawableTile {
  readonly q: number;
  readonly r: number;
  readonly bufferIndex: number;
  readonly sectorId: SectorId | null;
  readonly kind: SectorKind;
}

export interface CreateAtlasMapAdapterOptions {
  readonly w11Enabled?: boolean;
  readonly radius?: number;
  readonly gridRadius?: number;
  readonly tileCount?: number;
  readonly manifest?: AtlasManifestV1 | null;
  readonly query?: AtlasQueryInterface | null;
  readonly atlasBlob?: AtlasBlobValue | null;
  readonly atlas?: GeneratedSmallAtlas | null;
  readonly planetSummary?: PlanetSummaryV1 | null;
}

function emptyTileLookup(q: number, r: number): AtlasTileLookupResult {
  return {
    q, r, inAtlas: false, playable: false, sectorId: null, kind: null,
    macroQ: null, macroR: null, localQ: null, localR: null, localIndex: -1, atlasIndex: -1, bufferIndex: -1,
  };
}

function buildPartitionFromSectors(
  sectors: ReadonlyArray<{ readonly kind: SectorKind; readonly macroQ: number; readonly macroR: number; readonly continentId?: string | null }>,
  sectorRadius: number,
): AtlasPartition | null {
  const landCoords = sectors.filter((s) => s.kind === 'land').map((s) => [s.macroQ, s.macroR] as const);
  if (landCoords.length === 0) return null;
  const oceanCoords = sectors.filter((s) => s.kind === 'ocean').map((s) => [s.macroQ, s.macroR] as const);
  const continentId = sectors.find((s) => s.kind === 'land' && s.continentId)?.continentId ?? formatContinentId(0);
  return buildSmallAtlasPartition({
    sectorRadius,
    landCoords,
    ...(oceanCoords.length >= 12 || (oceanCoords.length > 0 && landCoords.length !== 7) ? { oceanCoords } : {}),
    includeOceanHalo: oceanCoords.length > 0 || landCoords.length === 7,
    continentId,
  });
}

function computeAtlasProjectionRadius(partition: AtlasPartition): number {
  let maxDist = partition.sectorRadius;
  for (let i = 0; i < partition.tiles.length; i++) {
    const t = partition.tiles[i]!;
    const d = hexDistance(0, 0, t.q, t.r);
    if (d > maxDist) maxDist = d;
  }
  return Math.max(1, maxDist);
}

export class AtlasMapAdapter {
  readonly isAtlas: boolean;
  readonly sectorRadius: number;
  readonly projectionRadius: number;
  readonly manifest: AtlasManifestV1 | null;
  readonly query: AtlasQueryInterface | null;
  readonly partition: AtlasPartition | null;
  readonly atlasHash: string | null;
  readonly atlasVersion: number | null;
  readonly planetId: string | null;

  private readonly landOrdinalBySectorId = new Map<SectorId, number>();
  private readonly landTileCount: number;
  private readonly defaultBufferCount: number;
  private cachedDrawableCount = -1;
  private cachedDrawableTiles: readonly AtlasDrawableTile[] = [];
  private cachedBufferToOwnerCount = -1;
  private cachedBufferToOwner: Array<AtlasTileOwner | null> = [];

  constructor(params: {
    readonly isAtlas: boolean;
    readonly sectorRadius: number;
    readonly projectionRadius: number;
    readonly manifest: AtlasManifestV1 | null;
    readonly query: AtlasQueryInterface | null;
    readonly partition: AtlasPartition | null;
    readonly atlasHash?: string | null;
    readonly atlasVersion?: number | null;
    readonly planetId?: string | null;
    readonly defaultBufferCount: number;
  }) {
    this.isAtlas = params.isAtlas;
    this.sectorRadius = params.sectorRadius;
    this.projectionRadius = params.projectionRadius;
    this.manifest = params.manifest;
    this.query = params.query;
    this.partition = params.partition;
    this.atlasHash = params.atlasHash ?? params.manifest?.atlasHash ?? null;
    this.atlasVersion = params.atlasVersion ?? params.manifest?.atlasVersion ?? null;
    this.planetId = params.planetId ?? params.manifest?.planetId ?? null;
    this.defaultBufferCount = params.defaultBufferCount;

    if (this.partition) {
      this.partition.landSectorIds.forEach((id, idx) => {
        this.landOrdinalBySectorId.set(id, idx);
      });
      this.landTileCount = this.partition.landSectorIds.length * this.partition.tilesPerSector;
    } else {
      this.landTileCount = 0;
    }
  }

  private resolveDiskRadius(bufferCount: number): number | null {
    if (bufferCount <= 0) return null;
    const candidate = radiusFromTileCount(bufferCount);
    return hexCount(candidate) === bufferCount ? candidate : null;
  }

  tileIndexOf(q: number, r: number, bufferCount = this.defaultBufferCount): number {
    if (!Number.isSafeInteger(q) || !Number.isSafeInteger(r)) return -1;
    if (!this.isAtlas || !this.partition) {
      const diskR = this.resolveDiskRadius(bufferCount) ?? this.projectionRadius;
      return hexIndex(diskR).indexOf(q, r);
    }

    const owner = this.partition.getTile(q, r);
    if (!owner) return -1;

    if (bufferCount === this.partition.bounds.totalTiles) {
      return owner.atlasIndex;
    }
    if (bufferCount === this.landTileCount && this.landTileCount > 0) {
      if (owner.kind !== 'land') return -1;
      const landOrd = this.landOrdinalBySectorId.get(owner.sectorId);
      if (landOrd === undefined) return -1;
      return landOrd * this.partition.tilesPerSector + owner.localIndex;
    }
    const diskR = this.resolveDiskRadius(bufferCount);
    if (diskR !== null) {
      return hexIndex(diskR).indexOf(q, r);
    }
    return owner.atlasIndex < bufferCount ? owner.atlasIndex : -1;
  }

  tileForBufferIndex(
    bufferIndex: number,
    bufferCount = this.defaultBufferCount,
  ): { q: number; r: number; sectorId: SectorId | null; kind: SectorKind } | null {
    if (bufferIndex < 0 || bufferIndex >= bufferCount) return null;
    if (!this.isAtlas || !this.partition) {
      const diskR = this.resolveDiskRadius(bufferCount) ?? this.projectionRadius;
      const hx = hexIndex(diskR);
      if (bufferIndex >= hx.count) return null;
      return { q: hx.q[bufferIndex]!, r: hx.r[bufferIndex]!, sectorId: null, kind: 'land' };
    }

    if (this.cachedBufferToOwnerCount !== bufferCount) {
      this.cachedBufferToOwnerCount = bufferCount;
      this.cachedBufferToOwner = new Array<AtlasTileOwner | null>(bufferCount).fill(null);
      for (const t of this.partition.tiles) {
        const idx = this.tileIndexOf(t.q, t.r, bufferCount);
        if (idx >= 0 && idx < bufferCount) {
          this.cachedBufferToOwner[idx] = t;
        }
      }
    }
    const hit = this.cachedBufferToOwner[bufferIndex];
    return hit ? { q: hit.q, r: hit.r, sectorId: hit.sectorId, kind: hit.kind } : null;
  }

  getDrawableTiles(bufferCount = this.defaultBufferCount): readonly AtlasDrawableTile[] {
    if (this.cachedDrawableCount === bufferCount) {
      return this.cachedDrawableTiles;
    }
    const out: AtlasDrawableTile[] = [];
    if (!this.isAtlas || !this.partition) {
      const diskR = this.resolveDiskRadius(bufferCount) ?? this.projectionRadius;
      const hx = hexIndex(diskR);
      const limit = Math.min(hx.count, bufferCount);
      for (let i = 0; i < limit; i++) {
        out.push({ q: hx.q[i]!, r: hx.r[i]!, bufferIndex: i, sectorId: null, kind: 'land' });
      }
    } else {
      for (const t of this.partition.tiles) {
        const bufferIndex = this.tileIndexOf(t.q, t.r, bufferCount);
        if (bufferIndex >= 0 && bufferIndex < bufferCount) {
          out.push({ q: t.q, r: t.r, bufferIndex, sectorId: t.sectorId, kind: t.kind });
        }
      }
    }
    this.cachedDrawableCount = bufferCount;
    this.cachedDrawableTiles = out;
    return out;
  }

  isInsideMap(q: number, r: number): boolean {
    if (!Number.isSafeInteger(q) || !Number.isSafeInteger(r)) return false;
    if (!this.isAtlas || !this.partition) return inHex(q, r, this.projectionRadius);
    return this.partition.getTile(q, r) !== null;
  }

  isPlayableLandTile(q: number, r: number): boolean {
    if (!Number.isSafeInteger(q) || !Number.isSafeInteger(r)) return false;
    if (!this.isAtlas || !this.partition) return inHex(q, r, this.projectionRadius);
    const owner = this.partition.getTile(q, r);
    return owner !== null && owner.kind === 'land';
  }

  getSectorForTile(q: number, r: number): SectorManifestV1 | null {
    return this.isAtlas && this.query ? this.query.getSectorForTile(q, r) : null;
  }

  pickSectorAtTile(q: number, r: number): SectorId | null {
    if (!this.isAtlas || !this.partition) return null;
    if (!Number.isSafeInteger(q) || !Number.isSafeInteger(r)) return null;
    return this.partition.getTile(q, r)?.sectorId ?? null;
  }

  pickTile(q: number, r: number, bufferCount = this.defaultBufferCount): AtlasTileLookupResult {
    if (!Number.isSafeInteger(q) || !Number.isSafeInteger(r)) return emptyTileLookup(q, r);

    if (!this.isAtlas || !this.partition) {
      const inside = inHex(q, r, this.projectionRadius);
      const bufferIndex = inside ? this.tileIndexOf(q, r, bufferCount) : -1;
      return {
        q,
        r,
        inAtlas: inside,
        playable: inside,
        sectorId: null,
        kind: inside ? 'land' : null,
        macroQ: inside ? 0 : null,
        macroR: inside ? 0 : null,
        localQ: inside ? q : null,
        localR: inside ? r : null,
        localIndex: bufferIndex,
        atlasIndex: bufferIndex,
        bufferIndex,
      };
    }

    const owner = this.partition.getTile(q, r);
    if (!owner) return emptyTileLookup(q, r);
    return {
      q: owner.q,
      r: owner.r,
      inAtlas: true,
      playable: owner.kind === 'land',
      sectorId: owner.sectorId,
      kind: owner.kind,
      macroQ: owner.macroQ,
      macroR: owner.macroR,
      localQ: owner.localQ,
      localR: owner.localR,
      localIndex: owner.localIndex,
      atlasIndex: owner.atlasIndex,
      bufferIndex: this.tileIndexOf(q, r, bufferCount),
    };
  }

  axialToPixel(q: number, r: number, size: number): { x: number; y: number } {
    return axialToCanvasPixel(q, r, size, this.projectionRadius);
  }

  pixelToAxial(x: number, y: number, size: number): { q: number; r: number } {
    return canvasPixelToAxial(x, y, size, this.projectionRadius);
  }

  tilePixelRadius(size: number): number {
    const scale = mapScaleForRadius(size, this.projectionRadius);
    return Math.max(1.25, scale / Math.sqrt(3));
  }

  pickAtCanvasPixel(
    x: number,
    y: number,
    size: number,
    bufferCount = this.defaultBufferCount,
  ): AtlasTileLookupResult {
    const { q, r } = this.pixelToAxial(x, y, size);
    return this.pickTile(q, r, bufferCount);
  }

  clampPixelToAxial(cx: number, cy: number, size: number): { q: number; r: number } {
    if (!this.isAtlas || !this.partition) {
      return clampLegacyPixelToAxial(cx, cy, size, this.projectionRadius);
    }
    const { q, r } = this.pixelToAxial(cx, cy, size);
    if (this.partition.getTile(q, r)) return { q, r };
    const scale = mapScaleForRadius(size, this.projectionRadius);
    const px = (cx - size * 0.5) / scale;
    const py = (cy - size * 0.5) / scale;
    let factor = 0.92;
    for (let step = 0; step < 24; step++) {
      const [cq, cr] = planeToAxial(px * factor, py * factor);
      if (this.partition.getTile(cq, cr)) return { q: cq, r: cr };
      factor *= 0.88;
    }
    return { q: 0, r: 0 };
  }

  sectorLocalToGlobal(sectorId: SectorId, localQ: number, localR: number): { q: number; r: number } {
    return sectorLocalToGlobalTile(sectorId, localQ, localR, this.sectorRadius);
  }

  globalToSector(q: number, r: number) {
    return globalTileToSector(q, r, this.sectorRadius);
  }
}

const legacyAdapterCache = new Map<string, AtlasMapAdapter>();
const atlasAdapterCache = new Map<string, AtlasMapAdapter>();

export function createAtlasMapAdapter(opts: CreateAtlasMapAdapterOptions = {}): AtlasMapAdapter {
  const w11Enabled = opts.w11Enabled ?? true;
  if (w11Enabled) {
    let manifest: AtlasManifestV1 | null = opts.manifest ?? opts.query?.getManifest() ?? null;
    if (!manifest && opts.atlas) manifest = buildAtlasManifest(opts.atlas);
    if (!manifest && opts.atlasBlob) manifest = extractPinnedAtlasManifest(opts.atlasBlob);
    if (manifest) {
      const defaultBufferCount = opts.tileCount ?? manifest.bounds.totalTiles;
      const cacheKey = `${manifest.planetId}:${manifest.atlasHash}:${defaultBufferCount}`;
      const cached = atlasAdapterCache.get(cacheKey);
      if (cached) return cached;
      const query = opts.query ?? createAtlasQueryView(manifest);
      const partition =
        opts.atlas?.partition ??
        buildPartitionFromSectors(manifest.sectors, manifest.sectorRadius)!;
      const adapter = new AtlasMapAdapter({
        isAtlas: true,
        sectorRadius: manifest.sectorRadius,
        projectionRadius: computeAtlasProjectionRadius(partition),
        manifest,
        query,
        partition,
        defaultBufferCount,
      });
      atlasAdapterCache.set(cacheKey, adapter);
      return adapter;
    }

    if (opts.planetSummary) {
      const partition = buildPartitionFromSectors(opts.planetSummary.sectors, W11_DEFAULT_SECTOR_RADIUS);
      if (partition) {
        return new AtlasMapAdapter({
          isAtlas: true, sectorRadius: partition.sectorRadius, projectionRadius: computeAtlasProjectionRadius(partition),
          manifest: null, query: null, partition,
          atlasHash: opts.planetSummary.atlasHash ?? null, atlasVersion: opts.planetSummary.atlasVersion ?? null,
          planetId: opts.planetSummary.id, defaultBufferCount: opts.tileCount ?? partition.bounds.totalTiles,
        });
      }
    }

    const fallbackRadius = opts.radius ?? opts.gridRadius ?? (opts.tileCount ? radiusFromTileCount(opts.tileCount) : 0);
    if (fallbackRadius === W11_DEFAULT_SECTOR_RADIUS) {
      const defaultBufferCount = opts.tileCount ?? hexCount(W11_DEFAULT_SECTOR_RADIUS);
      const cacheKey = `w11-canonical-default:${W11_DEFAULT_SECTOR_RADIUS}:${defaultBufferCount}`;
      const cached = atlasAdapterCache.get(cacheKey);
      if (cached) return cached;
      const partition = buildSmallAtlasPartition({ sectorRadius: W11_DEFAULT_SECTOR_RADIUS, includeOceanHalo: true });
      const adapter = new AtlasMapAdapter({
        isAtlas: true, sectorRadius: W11_DEFAULT_SECTOR_RADIUS, projectionRadius: computeAtlasProjectionRadius(partition),
        manifest: null, query: null, partition, defaultBufferCount,
      });
      atlasAdapterCache.set(cacheKey, adapter);
      return adapter;
    }
  }

  const radius = Math.max(0, opts.radius ?? opts.gridRadius ?? (opts.tileCount ? radiusFromTileCount(opts.tileCount) : 12));
  const defaultBufferCount = opts.tileCount ?? hexCount(radius);
  const key = `${radius}:${defaultBufferCount}`;
  const cached = legacyAdapterCache.get(key);
  if (cached) return cached;
  const legacy = new AtlasMapAdapter({
    isAtlas: false, sectorRadius: radius, projectionRadius: radius,
    manifest: null, query: null, partition: null, defaultBufferCount,
  });
  legacyAdapterCache.set(key, legacy);
  return legacy;
}

export function resolveMapAdapterForView(
  view: Pick<MapLayerDrawView, 'radius' | 'tiles' | 'clientView'> & {
    readonly atlasAdapter?: AtlasMapAdapter | null;
    readonly atlasManifest?: AtlasManifestV1 | null;
  },
  w11Enabled = true,
): AtlasMapAdapter {
  if (w11Enabled && view.atlasAdapter) return view.atlasAdapter;
  const rawBlob = view.clientView?.blobs?.atlas as
    | AtlasBlobValue
    | { value?: AtlasBlobValue }
    | undefined;
  const atlasBlob =
    rawBlob && typeof rawBlob === 'object' && 'value' in rawBlob && rawBlob.value
      ? rawBlob.value
      : (rawBlob as AtlasBlobValue | undefined);
  return createAtlasMapAdapter({
    w11Enabled,
    radius: view.radius,
    tileCount: view.tiles?.count,
    manifest: view.atlasManifest ?? null,
    atlasBlob: atlasBlob ?? null,
  });
}

export function createClientTilesFromAtlas(atlas: GeneratedSmallAtlas): ClientTiles {
  const count = atlas.partition.bounds.totalTiles;
  return {
    count,
    terrain: atlas.terrain.slice(),
    prep: atlas.prep.slice(),
    height: atlas.height.slice(),
    owner: new Int16Array(count).fill(-1),
    deposit: atlas.deposit.slice(),
    depositTier: atlas.depositTier.slice(),
    richness: atlas.richness.slice(),
    explored: new Uint8Array(count).fill(1),
  };
}
