import {
  W11_SEVEN_SECTOR_COORDS,
  type ContinentId,
  type SectorId,
  type SectorKind,
  type SectorNeighbourV1,
} from '@terra/contracts';

/** Alias matching US spelling alongside `@terra/contracts` `SectorNeighbourV1`. */
export type SectorNeighborV1 = SectorNeighbourV1;
export type { SectorNeighbourV1 };

export interface GlobalTileSectorLookup {
  readonly sectorId: SectorId;
  readonly macroQ: number;
  readonly macroR: number;
  readonly centerQ: number;
  readonly centerR: number;
  readonly localQ: number;
  readonly localR: number;
  readonly localIndex: number;
}

export interface SectorTileEntry {
  readonly q: number;
  readonly r: number;
  readonly localQ: number;
  readonly localR: number;
  readonly localIndex: number;
}

export interface TileSectorNeighbor extends GlobalTileSectorLookup {
  readonly dir: number;
  readonly oppositeDir: number;
  readonly q: number;
  readonly r: number;
  readonly crossesSectorBoundary: boolean;
}

export type TileSectorNeighbour = TileSectorNeighbor;

export interface AtlasTileOwner extends GlobalTileSectorLookup {
  readonly atlasIndex: number;
  readonly q: number;
  readonly r: number;
  readonly sectorOrdinal: number;
  readonly kind: SectorKind;
}

export interface AtlasSeamNeighbor extends GlobalTileSectorLookup {
  readonly dir: number;
  readonly oppositeDir: number;
  readonly q: number;
  readonly r: number;
  readonly inAtlas: boolean;
}

export interface AtlasSeamTile {
  readonly q: number;
  readonly r: number;
  readonly sectorId: SectorId;
  readonly macroQ: number;
  readonly macroR: number;
  readonly localQ: number;
  readonly localR: number;
  readonly localIndex: number;
  readonly neighbors: readonly AtlasSeamNeighbor[];
  readonly crossSectorNeighbors: readonly AtlasSeamNeighbor[];
}

export interface AtlasCornerTile extends GlobalTileSectorLookup {
  readonly q: number;
  readonly r: number;
  readonly inAtlas: boolean;
}

export interface AtlasCornerTriple {
  readonly key: string;
  readonly tiles: readonly [AtlasCornerTile, AtlasCornerTile, AtlasCornerTile];
  readonly sectorIds: readonly [SectorId, SectorId, SectorId];
  readonly allInAtlas: boolean;
}

export interface AtlasSectorPartition {
  readonly sectorId: SectorId;
  readonly ordinal: number;
  readonly kind: SectorKind;
  readonly continentId: ContinentId | null;
  readonly macroQ: number;
  readonly macroR: number;
  readonly centerQ: number;
  readonly centerR: number;
  readonly radius: number;
  readonly tileCount: number;
  readonly neighbors: readonly SectorNeighborV1[];
  readonly atlasNeighbors: readonly SectorNeighborV1[];
  readonly tiles: readonly SectorTileEntry[];
  readonly seamTiles: readonly AtlasSeamTile[];
}

export interface BuildSmallAtlasPartitionOptions {
  readonly sectorRadius?: number;
  readonly landCoords?: readonly (readonly [number, number])[];
  readonly oceanCoords?: readonly (readonly [number, number])[];
  readonly includeOceanHalo?: boolean;
  readonly continentId?: ContinentId;
}

export interface AtlasPartition {
  readonly sectorRadius: number;
  readonly tilesPerSector: number;
  readonly sectors: readonly AtlasSectorPartition[];
  readonly sectorById: ReadonlyMap<SectorId, AtlasSectorPartition>;
  readonly landSectorIds: readonly SectorId[];
  readonly oceanSectorIds: readonly SectorId[];
  readonly tiles: readonly AtlasTileOwner[];
  readonly tileByKey: ReadonlyMap<string, AtlasTileOwner>;
  readonly seamTiles: readonly AtlasSeamTile[];
  readonly cornerTriples: readonly AtlasCornerTriple[];
  readonly bounds: {
    readonly minQ: number;
    readonly maxQ: number;
    readonly minR: number;
    readonly maxR: number;
    readonly totalTiles: number;
  };
  getTile(q: number, r: number): AtlasTileOwner | null;
}

/** Ring-2 ocean halo around the default 7-sector land continent (12 macro hexes at macro distance 2). */
export const W11_OCEAN_HALO_SECTOR_COORDS: readonly (readonly [number, number])[] = [
  [2, 0],
  [2, -1],
  [2, -2],
  [1, -2],
  [0, -2],
  [-1, -1],
  [-2, 0],
  [-2, 1],
  [-2, 2],
  [-1, 2],
  [0, 2],
  [1, 1],
] as const;

export const W11_SMALL_ATLAS_SECTOR_COORDS: readonly (readonly [number, number])[] = [
  ...W11_SEVEN_SECTOR_COORDS,
  ...W11_OCEAN_HALO_SECTOR_COORDS,
] as const;
