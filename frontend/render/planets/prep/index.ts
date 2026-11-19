export {
  TerrainPrepClient,
  getSharedTerrainPrep,
  type PrepWorkerLike,
} from './TerrainPrepClient';
export {
  buildSphereBuffers,
  cloneTilesForWorker,
  computeHexTerrainPrep,
  computeSurfacePrep,
  handleTerrainPrepRequest,
} from './terrainPrepCore';
export type {
  HexTerrainPrepRequest,
  HexTerrainPrepResponse,
  HexTileTransferArrays,
  SurfacePrepRequest,
  SurfacePrepResponse,
  TerrainPrepErrorResponse,
  TerrainPrepRequest,
  TerrainPrepResponse,
} from './types';
