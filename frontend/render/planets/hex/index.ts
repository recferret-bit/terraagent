export {
  createHexTerrain,
  getActiveHexTerrains,
  getGlobalTerritoryColorBlindMode,
  setGlobalTerritoryColorBlindMode,
  type HexTerrain,
  type HexTerrainHandle,
  type HexTiles,
  type HexPick,
  type HexTerrainOptions,
} from './createHexTerrain';
export {
  buildChunk,
  computeEffectiveHeights,
  fanNormal,
  HEX_DEPOSIT,
  HEX_PREP,
  HEX_TERRAIN,
  INITIAL_PREP_START_TIME,
  PREP_BLEND_DURATION_S,
  tileHash01,
  tileHashU32,
  tileStyle,
  type ChunkBuffers,
  type HexTileLayers,
} from './chunkMesh';
export {
  createHexPropScatter,
  PROP_KINDS,
  scatterChunkProps,
  scatterTileProps,
  type ChunkPropBuckets,
  type HexPropScatter,
  type PropKind,
  type TilePropInstance,
} from './chunkPropScatter';
export { createHexWater, HEX_WATER_LEVEL, type HexWater } from './hexWater';
export {
  BORDER_Y_OFFSET,
  buildTerritoryBorderGeometry,
  createTerritoryBorderMaterial,
  DEFAULT_COLONY_COLORS,
  FROZEN_BORDER_WIDTH,
  GLOBE_PLAYER_COLORS,
  NORMAL_BORDER_WIDTH,
  resolveColonyColorHex,
  resolveColonyColorRgb,
  type TerritoryBorderBuildResult,
  type TerritoryBorderOptions,
  type TerritoryBorderStats,
} from './territoryBorder';
export { kindForPlanetType, specForPlanetType, type SimPlanetType } from './planetKind';
export { CHUNK_TILES, TILE_M, tileXZ, tileAt, planetExtent } from './hexMath';
