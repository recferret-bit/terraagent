export { ObjectPool, type ObjectPoolOptions, type PoolStats, type PoolThresholdSpec } from './ObjectPool';
export { PooledInstancedBucket } from './PooledInstancedBucket';
export {
  PooledMeshEntry,
  PooledObject,
  PooledSlotObject,
  pruneStaleBiomePools,
  releaseBiomeMeshEntry,
} from './PooledObject';
export {
  BIOME_CELL_POOL_THRESHOLDS,
  BUG_POOL_THRESHOLDS,
  BUILDING_POOL_THRESHOLDS,
  resolveBugPoolThreshold,
  resolveBuildingPoolThreshold,
  resolveResourceNodePoolThreshold,
  resolveRockNodePoolThreshold,
  resolveTreeNodePoolThreshold,
  resolveUnitPoolThreshold,
  scaleCellPoolForRadius,
  UNIT_POOL_THRESHOLDS,
  type CellPoolSpec,
} from './PoolThresholds';
