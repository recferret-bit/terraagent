import * as THREE from 'three';
import { createPooledInstancedMesh } from './geometries';
import type {
  ActiveAoeDecalSnapshot,
  ActiveLaserSnapshot,
  ActiveProjectileSnapshot,
  ProjectileVfxActiveCounts,
  ProjectileVfxPoolConfig,
  VfxWeaponKind,
} from './types';

export const LASER_BEAM_DURATION_S = 0.1;
export const DEFAULT_TILE_SIZE_M = 2;

const FORWARD_Z = new THREE.Vector3(0, 0, 1);
const DUMMY = new THREE.Object3D();
const TMP_DIR = new THREE.Vector3();
const TMP_POS = new THREE.Vector3();
const TMP_QUAT = new THREE.Quaternion();

export interface ProjectileSlot extends ActiveProjectileSnapshot {
  smokeCooldownS: number;
}

export interface SmokePuffSlot {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  ageS: number;
  durationS: number;
  baseScale: number;
}

export interface ImpactSlot {
  active: boolean;
  x: number;
  y: number;
  z: number;
  ageS: number;
  durationS: number;
  maxScale: number;
}

export interface DebrisSlot {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  groundY: number;
  ageS: number;
  durationS: number;
}

export interface MeshPoolEntry {
  mesh: THREE.InstancedMesh;
  material: THREE.Material;
}

export interface ProjectileVfxPools {
  bulletPool: MeshPoolEntry;
  shellPool: MeshPoolEntry;
  rocketPool: MeshPoolEntry;
  acidPool: MeshPoolEntry;
  laserCorePool: MeshPoolEntry;
  laserSheathPool: MeshPoolEntry;
  smokePool: MeshPoolEntry;
  impactPool: MeshPoolEntry;
  debrisPool: MeshPoolEntry;
  aoeRingPool: MeshPoolEntry;
  aoeDecalPool: MeshPoolEntry;
  projectiles: ProjectileSlot[];
  lasers: ActiveLaserSnapshot[];
  smokePuffs: SmokePuffSlot[];
  impacts: ImpactSlot[];
  debris: DebrisSlot[];
  aoeDecals: ActiveAoeDecalSnapshot[];
}

export function createProjectileVfxPools(
  group: THREE.Group,
  config: ProjectileVfxPoolConfig,
): ProjectileVfxPools {
  const maxProj = config.maxProjectiles ?? 64;
  const maxLasers = config.maxLasers ?? 32;
  const maxSmoke = config.maxSmokePuffs ?? 96;
  const maxImpacts = config.maxImpacts ?? 48;
  const maxDebris = config.maxDebrisChunks ?? 96;
  const maxAoe = config.maxAoeDecals ?? 32;

  return {
    bulletPool: createPooledInstancedMesh(
      { key: 'bullet', count: maxProj, color: 0xffe082, emissive: 0xffb300, emissiveIntensity: 3.5 },
      group,
    ),
    shellPool: createPooledInstancedMesh(
      { key: 'shell', count: maxProj, color: 0xffab40, emissive: 0xff6d00, emissiveIntensity: 3.4 },
      group,
    ),
    rocketPool: createPooledInstancedMesh(
      { key: 'rocket', count: maxProj, color: 0xff8a65, emissive: 0xff3d00, emissiveIntensity: 3.6 },
      group,
    ),
    acidPool: createPooledInstancedMesh(
      { key: 'acid', count: maxProj, color: 0x78c33d, emissive: 0x446e1d, emissiveIntensity: 0.3, roughness: 0.23, metalness: 0 },
      group,
    ),
    laserCorePool: createPooledInstancedMesh(
      { key: 'laserCore', count: maxLasers, color: 0x84ffff, emissive: 0x00e5ff, emissiveIntensity: 4.2 },
      group,
    ),
    laserSheathPool: createPooledInstancedMesh(
      { key: 'laserSheath', count: maxLasers, color: 0x00e5ff, emissive: 0x00e5ff, emissiveIntensity: 0, additive: true, opacity: 0.45 },
      group,
    ),
    smokePool: createPooledInstancedMesh(
      { key: 'smokePuff', count: maxSmoke, color: 0x9aa4b2, emissive: 0x222831, emissiveIntensity: 0.25, roughness: 0.85 },
      group,
    ),
    impactPool: createPooledInstancedMesh(
      { key: 'impactFlash', count: maxImpacts, color: 0xfff3c4, emissive: 0xff9100, emissiveIntensity: 3.8 },
      group,
    ),
    debrisPool: createPooledInstancedMesh(
      { key: 'impactDebris', count: maxDebris, color: 0xffcc80, emissive: 0xff6d00, emissiveIntensity: 3.2 },
      group,
    ),
    aoeRingPool: createPooledInstancedMesh(
      { key: 'aoeRing', count: maxAoe, color: 0xffab40, emissive: 0xff6d00, emissiveIntensity: 3.6 },
      group,
    ),
    aoeDecalPool: createPooledInstancedMesh(
      { key: 'aoeDecal', count: maxAoe, color: 0x3b2d26, emissive: 0xff5722, emissiveIntensity: 1.4, roughness: 0.9 },
      group,
    ),
    projectiles: Array.from({ length: maxProj }, () => ({
      active: false, weaponKind: 'bullet' as const,
      fromX: 0, fromY: 0, fromZ: 0, toX: 0, toY: 0, toZ: 0,
      x: 0, y: 0, z: 0, t: 0, durationS: 0.25, arcHeight: 0, aoe: 0,
      autoImpactOnArrival: true, smokeCooldownS: 0,
    })),
    lasers: Array.from({ length: maxLasers }, () => ({
      active: false, fromX: 0, fromY: 0, fromZ: 0, toX: 0, toY: 0, toZ: 0, ageS: 0, durationS: LASER_BEAM_DURATION_S,
    })),
    smokePuffs: Array.from({ length: maxSmoke }, () => ({
      active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, ageS: 0, durationS: 0.45, baseScale: 1,
    })),
    impacts: Array.from({ length: maxImpacts }, () => ({
      active: false, x: 0, y: 0, z: 0, ageS: 0, durationS: 0.26, maxScale: 1,
    })),
    debris: Array.from({ length: maxDebris }, () => ({
      active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, groundY: 0, ageS: 0, durationS: 0.45,
    })),
    aoeDecals: Array.from({ length: maxAoe }, () => ({
      active: false, x: 0, y: 0, z: 0, radiusM: 2, ageS: 0, durationS: 0.65,
    })),
  };
}

export function hideInstance(mesh: THREE.InstancedMesh, index: number): void {
  DUMMY.scale.setScalar(0);
  DUMMY.updateMatrix();
  mesh.setMatrixAt(index, DUMMY.matrix);
  mesh.instanceMatrix.needsUpdate = true;
}

export function meshForProjectileKind(
  pools: ProjectileVfxPools,
  kind: Exclude<VfxWeaponKind, 'laser'>,
): THREE.InstancedMesh {
  switch (kind) {
    case 'bullet':
      return pools.bulletPool.mesh;
    case 'shell':
      return pools.shellPool.mesh;
    case 'rocket':
      return pools.rocketPool.mesh;
    case 'acid':
      return pools.acidPool.mesh;
  }
}

export function writeProjectileMatrix(pools: ProjectileVfxPools, idx: number, p: ProjectileSlot): void {
  const mesh = meshForProjectileKind(pools, p.weaponKind);
  const dx = p.toX - p.fromX;
  const dz = p.toZ - p.fromZ;
  const dy = p.toY - p.fromY + 4 * p.arcHeight * (1 - 2 * p.t);
  TMP_DIR.set(dx, dy, dz);
  if (TMP_DIR.lengthSq() < 1e-6) TMP_DIR.set(0, 0, 1);
  else TMP_DIR.normalize();
  TMP_QUAT.setFromUnitVectors(FORWARD_Z, TMP_DIR);
  DUMMY.position.set(p.x, p.y, p.z);
  DUMMY.quaternion.copy(TMP_QUAT);
  DUMMY.scale.setScalar(1);
  DUMMY.updateMatrix();
  mesh.setMatrixAt(idx, DUMMY.matrix);
  mesh.instanceMatrix.needsUpdate = true;
}

export function writeLaserMatrix(pools: ProjectileVfxPools, idx: number, l: ActiveLaserSnapshot): void {
  TMP_DIR.set(l.toX - l.fromX, l.toY - l.fromY, l.toZ - l.fromZ);
  const len = Math.max(0.05, TMP_DIR.length());
  TMP_DIR.divideScalar(len);
  TMP_QUAT.setFromUnitVectors(FORWARD_Z, TMP_DIR);
  const fade = Math.max(0.1, 1 - (l.ageS / l.durationS) * 0.8);
  DUMMY.position.set(l.fromX, l.fromY, l.fromZ);
  DUMMY.quaternion.copy(TMP_QUAT);
  DUMMY.scale.set(fade, fade, len);
  DUMMY.updateMatrix();
  pools.laserCorePool.mesh.setMatrixAt(idx, DUMMY.matrix);
  pools.laserCorePool.mesh.instanceMatrix.needsUpdate = true;
  DUMMY.scale.set(fade * 1.35, fade * 1.35, len);
  DUMMY.updateMatrix();
  pools.laserSheathPool.mesh.setMatrixAt(idx, DUMMY.matrix);
  pools.laserSheathPool.mesh.instanceMatrix.needsUpdate = true;
}

export function writeSmokeMatrix(pools: ProjectileVfxPools, idx: number, s: SmokePuffSlot): void {
  const u = s.ageS / s.durationS;
  const envelope = Math.sin(Math.min(1, u) * Math.PI);
  const scale = s.baseScale * (0.55 + 1.45 * u) * Math.max(0.05, envelope);
  DUMMY.position.set(s.x, s.y, s.z);
  DUMMY.rotation.set(s.ageS * 1.7, s.ageS * 2.3, 0);
  DUMMY.scale.setScalar(scale);
  DUMMY.updateMatrix();
  pools.smokePool.mesh.setMatrixAt(idx, DUMMY.matrix);
  pools.smokePool.mesh.instanceMatrix.needsUpdate = true;
}

export function writeImpactMatrix(pools: ProjectileVfxPools, idx: number, imp: ImpactSlot): void {
  if (imp.maxScale <= 0) { hideInstance(pools.impactPool.mesh, idx); return; }
  const u = imp.ageS / imp.durationS;
  const scale = imp.maxScale * Math.sin(Math.min(1, u) * Math.PI);
  DUMMY.position.set(imp.x, imp.y, imp.z);
  DUMMY.rotation.set(0, imp.ageS * 6, 0);
  DUMMY.scale.setScalar(Math.max(0.05, scale));
  DUMMY.updateMatrix();
  pools.impactPool.mesh.setMatrixAt(idx, DUMMY.matrix);
  pools.impactPool.mesh.instanceMatrix.needsUpdate = true;
}

export function writeDebrisMatrix(pools: ProjectileVfxPools, idx: number, d: DebrisSlot): void {
  const u = d.ageS / d.durationS;
  TMP_DIR.set(d.vx, d.vy, d.vz);
  if (TMP_DIR.lengthSq() > 1e-5) TMP_DIR.normalize();
  else TMP_DIR.set(0, 1, 0);
  TMP_QUAT.setFromUnitVectors(FORWARD_Z, TMP_DIR);
  DUMMY.position.set(d.x, d.y, d.z);
  DUMMY.quaternion.copy(TMP_QUAT);
  DUMMY.scale.setScalar(Math.max(0.05, 1 - u * 0.75));
  DUMMY.updateMatrix();
  pools.debrisPool.mesh.setMatrixAt(idx, DUMMY.matrix);
  pools.debrisPool.mesh.instanceMatrix.needsUpdate = true;
}

export function writeAoeMatrices(
  pools: ProjectileVfxPools,
  idx: number,
  dec: ActiveAoeDecalSnapshot,
): void {
  const u = dec.ageS / dec.durationS;
  const ringRadius = dec.radiusM * (0.2 + 0.8 * Math.min(1, u * 1.4));
  const ringScaleY = Math.max(0.05, 1 - u);
  TMP_POS.set(dec.x, dec.y + 0.04, dec.z);
  DUMMY.position.copy(TMP_POS);
  DUMMY.rotation.set(0, 0, 0);
  DUMMY.scale.set(ringRadius, ringScaleY, ringRadius);
  DUMMY.updateMatrix();
  pools.aoeRingPool.mesh.setMatrixAt(idx, DUMMY.matrix);
  pools.aoeRingPool.mesh.instanceMatrix.needsUpdate = true;

  const decalScale = dec.radiusM * (1 - u * 0.25);
  DUMMY.position.set(dec.x, dec.y + 0.01, dec.z);
  DUMMY.scale.set(decalScale, Math.max(0.05, 1 - u), decalScale);
  DUMMY.updateMatrix();
  pools.aoeDecalPool.mesh.setMatrixAt(idx, DUMMY.matrix);
  pools.aoeDecalPool.mesh.instanceMatrix.needsUpdate = true;
}

export function stepAuxiliaryPools(pools: ProjectileVfxPools, dt: number): void {
  for (let i = 0; i < pools.lasers.length; i++) {
    const l = pools.lasers[i]!;
    if (!l.active) continue;
    l.ageS += dt;
    if (l.ageS >= l.durationS) {
      l.active = false;
      hideInstance(pools.laserCorePool.mesh, i);
      hideInstance(pools.laserSheathPool.mesh, i);
      continue;
    }
    writeLaserMatrix(pools, i, l);
  }
  for (let i = 0; i < pools.smokePuffs.length; i++) {
    const s = pools.smokePuffs[i]!;
    if (!s.active) continue;
    s.ageS += dt;
    if (s.ageS >= s.durationS) {
      s.active = false;
      hideInstance(pools.smokePool.mesh, i);
      continue;
    }
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.z += s.vz * dt;
    writeSmokeMatrix(pools, i, s);
  }
  for (let i = 0; i < pools.impacts.length; i++) {
    const imp = pools.impacts[i]!;
    if (!imp.active) continue;
    imp.ageS += dt;
    if (imp.ageS >= imp.durationS) {
      imp.active = false;
      hideInstance(pools.impactPool.mesh, i);
      continue;
    }
    writeImpactMatrix(pools, i, imp);
  }
  for (let i = 0; i < pools.debris.length; i++) {
    const d = pools.debris[i]!;
    if (!d.active) continue;
    d.ageS += dt;
    if (d.ageS >= d.durationS) {
      d.active = false;
      hideInstance(pools.debrisPool.mesh, i);
      continue;
    }
    d.vy -= 14.0 * dt;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.z += d.vz * dt;
    if (d.y < d.groundY) {
      d.y = d.groundY;
      d.vy = Math.abs(d.vy) * 0.28;
      d.vx *= 0.72;
      d.vz *= 0.72;
    }
    writeDebrisMatrix(pools, i, d);
  }
  for (let i = 0; i < pools.aoeDecals.length; i++) {
    const dec = pools.aoeDecals[i]!;
    if (!dec.active) continue;
    dec.ageS += dt;
    if (dec.ageS >= dec.durationS) {
      dec.active = false;
      hideInstance(pools.aoeRingPool.mesh, i);
      hideInstance(pools.aoeDecalPool.mesh, i);
      continue;
    }
    writeAoeMatrices(pools, i, dec);
  }
}

export function countActivePools(pools: ProjectileVfxPools): ProjectileVfxActiveCounts {
  let projectiles = 0;
  let lasers = 0;
  let smokePuffs = 0;
  let impacts = 0;
  let aoeDecals = 0;
  for (const p of pools.projectiles) if (p.active) projectiles++;
  for (const l of pools.lasers) if (l.active) lasers++;
  for (const s of pools.smokePuffs) if (s.active) smokePuffs++;
  for (const imp of pools.impacts) if (imp.active) impacts++;
  for (const dec of pools.aoeDecals) if (dec.active) aoeDecals++;
  return { projectiles, lasers, smokePuffs, impacts, aoeDecals };
}

export function clearProjectileVfxPools(pools: ProjectileVfxPools): void {
  for (let i = 0; i < pools.projectiles.length; i++) {
    const p = pools.projectiles[i]!;
    if (p.active) {
      p.active = false;
      hideInstance(meshForProjectileKind(pools, p.weaponKind), i);
    }
  }
  for (let i = 0; i < pools.lasers.length; i++) {
    if (pools.lasers[i]!.active) {
      pools.lasers[i]!.active = false;
      hideInstance(pools.laserCorePool.mesh, i);
      hideInstance(pools.laserSheathPool.mesh, i);
    }
  }
  for (let i = 0; i < pools.smokePuffs.length; i++) {
    if (pools.smokePuffs[i]!.active) {
      pools.smokePuffs[i]!.active = false;
      hideInstance(pools.smokePool.mesh, i);
    }
  }
  for (let i = 0; i < pools.impacts.length; i++) {
    if (pools.impacts[i]!.active) {
      pools.impacts[i]!.active = false;
      hideInstance(pools.impactPool.mesh, i);
    }
  }
  for (let i = 0; i < pools.debris.length; i++) {
    if (pools.debris[i]!.active) {
      pools.debris[i]!.active = false;
      hideInstance(pools.debrisPool.mesh, i);
    }
  }
  for (let i = 0; i < pools.aoeDecals.length; i++) {
    if (pools.aoeDecals[i]!.active) {
      pools.aoeDecals[i]!.active = false;
      hideInstance(pools.aoeRingPool.mesh, i);
      hideInstance(pools.aoeDecalPool.mesh, i);
    }
  }
}

export function disposeProjectileVfxPools(pools: ProjectileVfxPools): void {
  clearProjectileVfxPools(pools);
  pools.bulletPool.material.dispose();
  pools.shellPool.material.dispose();
  pools.rocketPool.material.dispose();
  pools.acidPool.material.dispose();
  pools.laserCorePool.material.dispose();
  pools.laserSheathPool.material.dispose();
  pools.smokePool.material.dispose();
  pools.impactPool.material.dispose();
  pools.debrisPool.material.dispose();
  pools.aoeRingPool.material.dispose();
  pools.aoeDecalPool.material.dispose();
}
