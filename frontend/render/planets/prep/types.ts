import type { PlanetKind } from '../PlanetSpec';
import type { TerrainGridData } from '../../visuals/terrain/TerrainGrid';
import type { PrecomputedHexTerrainData } from '../hex/createHexTerrain';

export interface SurfacePrepRequest {
  readonly id: number;
  readonly type: 'surface';
  readonly kind: PlanetKind;
  readonly seed: number;
  readonly halfSize: number;
  readonly quality: 'low' | 'high';
  readonly includeDescentGlobe?: boolean;
}

export interface HexTileTransferArrays {
  readonly terrain: Uint8Array;
  readonly height: Float32Array;
  readonly prep?: Uint8Array;
  readonly deposit?: Uint8Array;
  readonly depositTier?: Uint8Array;
  readonly richness?: Float32Array | Uint16Array;
  readonly owner?: Int16Array | Uint8Array;
}

export interface HexTerrainPrepRequest {
  readonly id: number;
  readonly type: 'hexTerrain';
  readonly radius: number;
  readonly kind: PlanetKind;
  readonly seed: number;
  readonly tiles: HexTileTransferArrays;
}

export type TerrainPrepRequest = SurfacePrepRequest | HexTerrainPrepRequest;

export interface SurfacePrepResponse {
  readonly id: number;
  readonly type: 'surface';
  readonly grid: TerrainGridData;
}

export interface HexTerrainPrepResponse {
  readonly id: number;
  readonly type: 'hexTerrain';
  readonly data: PrecomputedHexTerrainData;
}

export interface TerrainPrepErrorResponse {
  readonly id: number;
  readonly type: 'error';
  readonly message: string;
}

export type TerrainPrepResponse = SurfacePrepResponse | HexTerrainPrepResponse | TerrainPrepErrorResponse;
