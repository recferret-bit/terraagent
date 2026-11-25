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
  /** Optional scale multiplier for projectile mesh geometry (e.g. heavy autocannon shells vs smaller artillery shells). */
  projectileScale?: number;
  /** Emit a spinning brass cartridge casing on fire (`reconGun`, `autocannon`). */
  ejectCartridge?: boolean;
  /** Optional world breech port for spent brass casing spawn (falls back to muzzle if omitted). */
  ejectFrom?: VfxPoint3D;
  /** Optional world lateral ejection direction vector from breech port. */
  ejectDir?: VfxPoint3D;
  /** Ground elevation (world Y) beneath shooter for ejected cartridge bounce. */
  ejectGroundY?: number;
  /** Optional scale multiplier for ejected brass cartridge casing. */
  ejectScale?: number;
  /** Suppress initial muzzle burst / light on sub-burst followups if desired. */
  suppressLight?: boolean;
  /** True if intended target is an insect (used by autoImpactOnArrival bursts). */
  targetIsInsect?: boolean;
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
  /** Surface normal of terrain beneath impact point for sloped ground crater placement. */
  groundNormal?: VfxPoint3D;
  /** True when the impacted entity is an insect, emitting extra green acid hemolymph splatter. */
  targetIsInsect?: boolean;
}

export interface ProjectileVfxActiveCounts {
  projectiles: number;
  lasers: number;
  smokePuffs: number;
  impacts: number;
  aoeDecals: number;
  cartridges?: number;
  shockwaves?: number;
  craters?: number;
}

export interface MechanicalDeathVfxInput {
  at: VfxPoint3D;
  groundY?: number;
  kind: 'bot' | 'building';
  scale?: number;
}

export interface ActiveShockwaveSnapshot {
  active: boolean;
  x: number;
  y: number;
  z: number;
  startRadius: number;
  maxRadius: number;
  thickness: number;
  baseOpacity: number;
  ageS: number;
  durationS: number;
}

export interface ProjectileVfxPoolConfig {
  maxProjectiles?: number;
  maxLasers?: number;
  maxSmokePuffs?: number;
  maxImpacts?: number;
  maxDebrisChunks?: number;
  maxAoeDecals?: number;
  maxCartridges?: number;
  maxCraters?: number;
  tileSizeM?: number;
  /** Toggle publishing active lasers, shells, muzzle flashes and explosions to `ColonyVisionAndLights` (default `true`). */
  emitDynamicLights?: boolean;
}

export interface ActiveGroundCraterSnapshot {
  active: boolean;
  x: number;
  y: number;
  z: number;
  radiusM: number;
  yaw: number;
  ageS: number;
}

export interface ActiveProjectileSnapshot {
  active: boolean;
  weaponKind: Exclude<VfxWeaponKind, 'laser'>;
  weaponId?: string;
  scale: number;
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
  targetId?: number;
  targetIsInsect?: boolean;
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
  hideRing?: boolean;
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
