export {
  axialToWorldVfxPoint,
  DEFAULT_TILE_SIZE_M,
  evalParabolicArcY,
  LASER_BEAM_DURATION_S,
  ProjectileVfxSystem,
  resolveVfxWeaponKind,
} from './ProjectileVfxSystem';
export {
  createPooledInstancedMesh,
  getProjectileVfxGeometry,
  type EmissivePoolSpec,
  type ProjectileGeometryKey,
} from './geometries';
export type {
  ActiveAoeDecalSnapshot,
  ActiveLaserSnapshot,
  ActiveProjectileSnapshot,
  ProjectileFiredVfxInput,
  ProjectileImpactVfxInput,
  ProjectileVfxActiveCounts,
  ProjectileVfxPoolConfig,
  SimProjectileFiredEventLike,
  SimProjectileFiredPayloadLike,
  SimProjectileImpactEventLike,
  SimProjectileImpactPayloadLike,
  VfxPoint3D,
  VfxWeaponKind,
  WorldHeightLookup,
} from './types';
