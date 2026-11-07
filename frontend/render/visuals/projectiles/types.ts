export type VfxWeaponKind = 'bullet' | 'shell' | 'rocket' | 'laser' | 'acid';

export interface VfxPoint3D {
  x: number;
  y: number;
  z?: number;
}

export interface ProjectileFiredVfxInput {
  weaponKind?: VfxWeaponKind;
  weaponType?: string;
  weaponId?: string;
  from: VfxPoint3D;
  to: VfxPoint3D;
  speed?: number;
  durationS?: number;
  aoe?: number;
  arc?: 'direct' | 'indirect';
  /**
   * When true (default), non-laser projectiles automatically trigger an impact flash
   * and layered burst when their flight progress reaches `t >= 1`.
   */
  autoImpactOnArrival?: boolean;
  /** Authored muzzle callback for beams and brief discharge flames attached to a moving weapon. */
  source?: () => VfxPoint3D;
  arcHeight?: number;
  targetId?: number;
  impactTick?: number;
  firedTick?: number;
  direction?: () => VfxPoint3D;
}

export interface ProjectileImpactVfxInput {
  weaponKind?: VfxWeaponKind;
  weaponType?: string;
  weaponId?: string;
  at: VfxPoint3D;
  hit?: boolean;
  aoe?: number;
  targetId?: number;
  impactTick?: number;
  normal?: VfxPoint3D;
  groundY?: number;
}

export interface ProjectileVfxActiveCounts {
  projectiles: number;
  lasers: number;
  smokePuffs: number;
  impacts: number;
  aoeDecals: number;
}

export interface ProjectileVfxPoolConfig {
  maxProjectiles?: number;
  maxLasers?: number;
  maxSmokePuffs?: number;
  maxImpacts?: number;
  maxDebrisChunks?: number;
  maxAoeDecals?: number;
  tileSizeM?: number;
}

export interface ActiveProjectileSnapshot {
  active: boolean;
  weaponKind: Exclude<VfxWeaponKind, 'laser'>;
  fromX: number;
  fromY: number;
  fromZ: number;
  toX: number;
  toY: number;
  toZ: number;
  x: number;
  y: number;
  z: number;
  t: number;
  durationS: number;
  arcHeight: number;
  aoe: number;
  autoImpactOnArrival: boolean;
}

export interface ActiveLaserSnapshot {
  source?: () => VfxPoint3D;
  active: boolean;
  fromX: number;
  fromY: number;
  fromZ: number;
  toX: number;
  toY: number;
  toZ: number;
  ageS: number;
  durationS: number;
}

export interface ActiveAoeDecalSnapshot {
  active: boolean;
  x: number;
  y: number;
  z: number;
  radiusM: number;
  ageS: number;
  durationS: number;
}

/**
 * Plain view of a `@terra/sim` `projectileFired` event payload (or wrapper `{ kind, data }`).
 * Kept in `render/` without importing `@terra/sim` internals (AGENTS.md §6).
 */
export interface SimProjectileFiredPayloadLike {
  attackerId?: number;
  targetId?: number;
  weaponKind?: VfxWeaponKind | string;
  weaponType?: string;
  weaponId?: string;
  arc?: 'direct' | 'indirect' | string;
  fromX?: number;
  fromY?: number;
  aimX?: number;
  aimY?: number;
  q?: number;
  r?: number;
  aimQ?: number;
  aimR?: number;
  from?: { x: number; y: number; q?: number; r?: number };
  to?: { x: number; y: number; q?: number; r?: number };
  speed?: number;
  flightTicks?: number;
  impactTick?: number;
  aoe?: number;
  damage?: number;
  tick?: number;
}

export type SimProjectileFiredEventLike =
  | SimProjectileFiredPayloadLike
  | { kind?: string; data: SimProjectileFiredPayloadLike };

/**
 * Plain view of a `@terra/sim` `projectileImpact` event payload (or wrapper `{ kind, data }`).
 */
export interface SimProjectileImpactPayloadLike {
  attackerId?: number;
  firedTick?: number;
  targetId?: number;
  weaponKind?: VfxWeaponKind | string;
  weaponType?: string;
  weaponId?: string;
  aimX?: number;
  aimY?: number;
  q?: number;
  r?: number;
  at?: { x: number; y: number; q?: number; r?: number };
  to?: { x: number; y: number; q?: number; r?: number };
  hit?: boolean;
  aoe?: number;
  damage?: number;
  hitEntityIds?: readonly number[];
  hitIds?: readonly number[];
  tick?: number;
}

export type SimProjectileImpactEventLike =
  | SimProjectileImpactPayloadLike
  | { kind?: string; data: SimProjectileImpactPayloadLike };

export type WorldHeightLookup = (worldX: number, worldZ: number) => number;
