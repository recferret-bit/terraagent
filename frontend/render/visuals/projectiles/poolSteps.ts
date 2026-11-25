import * as THREE from 'three';
import {
  hideInstance,
  meshForProjectileKind,
  writeAoeMatrices,
  writeCartridgeMatrix,
  writeCraterMatrix,
  writeDebrisMatrix,
  writeImpactMatrix,
  writeLaserMatrix,
  writeShockwaveMatrix,
  writeSmokeMatrix,
  type ProjectileVfxPools,
} from './pools';
import type { VfxPoint3D } from './types';

const TMP_COLOR = new THREE.Color();
const UP_VEC = new THREE.Vector3(0, 1, 0);

export function allocPoolSlot<T extends { active: boolean }>(pool: readonly T[]): number {
  for (let i = 0; i < pool.length; i++) {
    if (!pool[i]!.active) return i;
  }
  return 0;
}

export function spawnSmokePuffInPool(
  pools: ProjectileVfxPools,
  nextRand: () => number,
  x: number,
  y: number,
  z: number,
  scaleMul = 1,
  warm = false,
): void {
  const idx = allocPoolSlot(pools.smokePuffs);
  const puff = pools.smokePuffs[idx]!;
  puff.active = true;
  puff.x = x + (nextRand() - 0.5) * 0.14;
  puff.y = y + (nextRand() - 0.5) * 0.14;
  puff.z = z + (nextRand() - 0.5) * 0.14;
  puff.vx = (nextRand() - 0.5) * 0.7;
  puff.vy = (warm ? 0.55 : 0.45) + nextRand() * 0.65;
  puff.vz = (nextRand() - 0.5) * 0.7;
  puff.ageS = 0;
  puff.durationS = (warm ? 0.56 : 0.36) + nextRand() * 0.22;
  puff.baseScale = (0.48 + nextRand() * 0.34) * scaleMul;
  TMP_COLOR.setHex(warm ? (nextRand() > 0.42 ? 0x625a54 : 0xff9b42) : 0x9aa4b2);
  pools.smokePool.mesh.setColorAt(idx, TMP_COLOR);
  if (pools.smokePool.mesh.instanceColor) pools.smokePool.mesh.instanceColor.needsUpdate = true;
  writeSmokeMatrix(pools, idx, puff);
}

export function ejectCartridgeInPool(
  pools: ProjectileVfxPools,
  nextRand: () => number,
  fromX: number,
  fromY: number,
  fromZ: number,
  forward: THREE.Vector3,
  scale = 1,
  backOffset = -0.52,
  groundY?: number,
  ejectDir?: THREE.Vector3,
): void {
  const idx = allocPoolSlot(pools.cartridges);
  const c = pools.cartridges[idx]!;
  const dir = forward.clone().normalize();
  let right: THREE.Vector3;
  if (ejectDir && ejectDir.lengthSq() > 1e-6) {
    right = ejectDir.clone().normalize();
  } else {
    right = new THREE.Vector3().crossVectors(dir, UP_VEC);
    if (right.lengthSq() < 1e-4) right.set(1, 0, 0);
    else right.normalize();
  }
  const fromPort = backOffset >= 0;
  const ejectOrigin = new THREE.Vector3(fromX, fromY, fromZ)
    .addScaledVector(dir, fromPort ? 0 : backOffset * scale)
    .addScaledVector(right, (fromPort ? 0.035 : 0.22) * scale);
  c.active = true;
  c.x = ejectOrigin.x;
  c.y = ejectOrigin.y + (fromPort ? 0.02 : 0.08) * scale;
  c.z = ejectOrigin.z;
  const isHeavy = scale >= 1.8;
  const sideSpd = isHeavy ? 1.7 + nextRand() * 0.8 : 2.0 + nextRand() * 1.1;
  const upSpd = isHeavy ? 1.9 + nextRand() * 0.7 : 2.1 + nextRand() * 0.9;
  const backSpd = isHeavy ? 0.25 + nextRand() * 0.45 : 0.4 + nextRand() * 0.6;
  const spinMag = isHeavy ? 20 : 32;
  c.vx = right.x * sideSpd - dir.x * backSpd;
  c.vy = upSpd;
  c.vz = right.z * sideSpd - dir.z * backSpd;
  c.rx = nextRand() * Math.PI * 2;
  c.ry = nextRand() * Math.PI * 2;
  c.rz = nextRand() * Math.PI * 2;
  c.vrx = (nextRand() - 0.5) * spinMag;
  c.vry = (nextRand() - 0.5) * spinMag;
  c.vrz = (nextRand() - 0.5) * spinMag;
  c.scale = scale;
  c.groundY = groundY ?? Math.max(0, fromY - 0.88);
  c.ageS = 0;
  c.durationS = isHeavy ? 1.45 + nextRand() * 0.4 : 1.05 + nextRand() * 0.25;
  writeCartridgeMatrix(pools, idx, c);
}

export function spawnGroundCraterInPool(
  pools: ProjectileVfxPools,
  nextRand: () => number,
  x: number,
  groundY: number,
  z: number,
  radiusM: number,
  groundNormal?: VfxPoint3D,
): void {
  if (pools.craters.length === 0) return;
  for (const zc of pools.noCraterZones) {
    const dx = x - zc.x;
    const dz = z - zc.z;
    const lim = zc.radiusM + radiusM * 0.5;
    if (dx * dx + dz * dz <= lim * lim) return;
  }
  const idx = pools.craterCursor++ % pools.craters.length;
  const c = pools.craters[idx]!;
  c.active = true;
  c.x = x;
  c.y = groundY;
  c.z = z;
  c.radiusM = Math.max(0.18, radiusM);
  c.yaw = nextRand() * Math.PI * 2;
  c.ageS = 0;
  c.nx = groundNormal?.x ?? 0;
  c.ny = groundNormal?.y ?? 1;
  c.nz = groundNormal?.z ?? 0;
  writeCraterMatrix(pools, idx, c);
}

/** Hides ground craters overlapping a death site or wreck and blocks late-arriving overkill craters there. */
export function clearGroundCratersNear(
  pools: ProjectileVfxPools,
  x: number,
  z: number,
  radiusM: number,
  ownerId?: number,
): number {
  let cleared = 0;
  const rBase = Math.max(0, radiusM);
  if (rBase > 0) {
    if (ownerId !== undefined) {
      for (let i = pools.noCraterZones.length - 1; i >= 0; i--) {
        if (pools.noCraterZones[i]!.ownerId === ownerId) pools.noCraterZones.splice(i, 1);
      }
    }
    if (pools.noCraterZones.length >= 96) {
      const dropIdx = pools.noCraterZones.findIndex((zc) => zc.ownerId === undefined);
      pools.noCraterZones.splice(dropIdx >= 0 ? dropIdx : 0, 1);
    }
    pools.noCraterZones.push({ x, z, radiusM: Math.max(1.1, rBase), ageS: 0, ...(ownerId !== undefined ? { ownerId } : {}) });
  }
  for (let i = 0; i < pools.craters.length; i++) {
    const c = pools.craters[i]!;
    if (!c.active) continue;
    const limit = rBase + c.radiusM * 0.65;
    const dx = c.x - x;
    const dz = c.z - z;
    if (dx * dx + dz * dz <= limit * limit) {
      c.active = false;
      hideInstance(pools.craterPool.mesh, i);
      cleared++;
    }
  }
  return cleared;
}

export function releaseNoCraterZoneByOwner(pools: ProjectileVfxPools, ownerId: number): void {
  for (let i = pools.noCraterZones.length - 1; i >= 0; i--) {
    if (pools.noCraterZones[i]!.ownerId === ownerId) pools.noCraterZones.splice(i, 1);
  }
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
  stepCartridges(pools, dt);
  stepAoeDecals(pools, dt);
  stepShockwaves(pools, dt);
  for (let i = pools.noCraterZones.length - 1; i >= 0; i--) {
    const zc = pools.noCraterZones[i]!;
    if (zc.ownerId !== undefined) continue;
    zc.ageS += dt;
    if (zc.ageS >= 12.0) pools.noCraterZones.splice(i, 1);
  }
  for (let i = 0; i < pools.craters.length; i++) {
    const cr = pools.craters[i]!;
    if (!cr.active) continue;
    const prevAge = cr.ageS;
    cr.ageS += dt;
    if (cr.ageS > 2.4 && prevAge < 5.0) writeCraterMatrix(pools, i, cr);
  }
}

function stepCartridges(pools: ProjectileVfxPools, dt: number): void {
  for (let i = 0; i < pools.cartridges.length; i++) {
    const c = pools.cartridges[i]!;
    if (!c.active) continue;
    c.ageS += dt;
    if (c.ageS >= c.durationS) {
      c.active = false;
      hideInstance(pools.cartridgePool.mesh, i);
      continue;
    }
    c.vy -= 12.0 * dt;
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    c.z += c.vz * dt;
    c.rx += c.vrx * dt;
    c.ry += c.vry * dt;
    c.rz += c.vrz * dt;
    const restClearance = 0.025 * c.scale;
    if (c.y <= c.groundY + restClearance) {
      c.y = c.groundY + restClearance;
      c.vy = Math.abs(c.vy) * (c.scale >= 1.8 ? 0.34 : 0.40);
      c.vx *= 0.62;
      c.vz *= 0.62;
      c.vrx *= 0.55;
      c.vry *= 0.55;
      c.vrz *= 0.55;
    }
    writeCartridgeMatrix(pools, i, c);
  }
}

function stepAoeDecals(pools: ProjectileVfxPools, dt: number): void {
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

function stepShockwaves(pools: ProjectileVfxPools, dt: number): void {
  for (let i = 0; i < pools.shockwaves.length; i++) {
    const sw = pools.shockwaves[i]!;
    if (!sw.active) continue;
    sw.ageS += dt;
    if (sw.ageS >= sw.durationS) {
      sw.active = false;
      hideInstance(pools.shockwavePool.mesh, i);
      pools.shockwaveAlpha.setX(i, 0);
      pools.shockwaveAlpha.needsUpdate = true;
      continue;
    }
    writeShockwaveMatrix(pools, i, sw);
  }
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
  for (let i = 0; i < pools.cartridges.length; i++) {
    if (pools.cartridges[i]!.active) {
      pools.cartridges[i]!.active = false;
      hideInstance(pools.cartridgePool.mesh, i);
    }
  }
  for (let i = 0; i < pools.aoeDecals.length; i++) {
    if (pools.aoeDecals[i]!.active) {
      pools.aoeDecals[i]!.active = false;
      hideInstance(pools.aoeRingPool.mesh, i);
      hideInstance(pools.aoeDecalPool.mesh, i);
    }
  }
  for (let i = 0; i < pools.shockwaves.length; i++) {
    if (pools.shockwaves[i]!.active) {
      pools.shockwaves[i]!.active = false;
      hideInstance(pools.shockwavePool.mesh, i);
      pools.shockwaveAlpha.setX(i, 0);
      pools.shockwaveAlpha.needsUpdate = true;
    }
  }
  pools.craterCursor = 0;
  pools.noCraterZones.length = 0;
  for (let i = 0; i < pools.craters.length; i++) {
    if (pools.craters[i]!.active) {
      pools.craters[i]!.active = false;
      hideInstance(pools.craterPool.mesh, i);
    }
  }
}

export function disposeProjectileVfxPools(pools: ProjectileVfxPools): void {
  clearProjectileVfxPools(pools);
  pools.bulletPool.material.dispose();
  pools.shellPool.material.dispose();
  pools.rocketPool.material.dispose();
  pools.acidPool.material.dispose();
  pools.cartridgePool.material.dispose();
  pools.laserCorePool.material.dispose();
  pools.laserSheathPool.material.dispose();
  pools.smokePool.material.dispose();
  pools.impactPool.material.dispose();
  pools.debrisPool.material.dispose();
  pools.aoeRingPool.material.dispose();
  pools.aoeDecalPool.material.dispose();
  pools.shockwavePool.mesh.geometry.dispose();
  pools.shockwavePool.material.dispose();
  pools.craterPool.material.dispose();
}
