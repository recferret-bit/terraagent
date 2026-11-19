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
  type PrecomputedHexTerrainData,
} from './createHexTerrain';
export {
  buildChunk,
  computeEffectiveHeights,
  fanNormal,
  HEX_DEPOSIT,
  HEX_PREP,
  HEX_TERRAIN,
  isDryShoreTile,
  isWaterAt,
  tileHash01,
  tileHashU32,
  tileShoreFactor,
  tileStyle,
  type ChunkBuffers,
  type HexTileLayers,
} from './chunkMesh';
export {
  buildChunkPropInstances,
  createHexPropScatter,
  depositVisualTier,
  getDepositVisualStage,
  PROP_KINDS,
  scatterChunkProps,
  scatterTileProps,
  type ChunkPropBuckets,
  type DepositVisualStage,
  type HexPropScatter,
  type PropKind,
  type TilePropInstance,
} from './chunkPropScatter';
export { createHexWater, HEX_WATER_LEVEL, type HexWater } from './hexWater';
export { createHexWaterfallSet, type HexWaterfallSet } from './hexWaterfall';
export {
  applyTileStatePreset,
  createHexTileTint,
  TILE_STATE_PRESETS,
  type HexTileTint,
  type TileStatePreset,
} from './tileTint';
export {
  BORDER_VERTS_PER_EDGE,
  BORDER_Y_OFFSET,
  buildTerritoryBorderGeometry,
  createTerritoryBorderMaterial,
  DEFAULT_COLONY_COLORS,
  FROZEN_BORDER_WIDTH,
  NORMAL_BORDER_WIDTH,
  resolveColonyColorHex,
  resolveColonyColorRgb,
  type TerritoryBorderBuildResult,
  type TerritoryBorderOptions,
  type TerritoryBorderStats,
} from './territoryBorder';
export { kindForPlanetType, planetTypeForKind, specForPlanetType, type SimPlanetType } from './planetKind';
export {
  CHUNK_TILES,
  HEX_PROP_EDGE_MARGIN_M,
  TILE_M,
  clampToGroundHexagon,
  hexEdgeMarginM,
  planetExtent,
  tileAt,
  tileXZ,
} from './hexMath';
