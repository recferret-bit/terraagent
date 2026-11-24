import * as THREE from 'three';
import {
  hideInstance,
  meshForProjectileKind,
  writeAoeMatrices,
  writeCartridgeMatrix,
  writeDebrisMatrix,
  writeImpactMatrix,
  writeLaserMatrix,
  writeSmokeMatrix,
  type ProjectileVfxPools,
} from './pools';

const TMP_COLOR = new THREE.Color();
const UP_VEC = new THREE.Vector3(0, 1, 0);

function allocSlot<T extends { active: boolean }>(pool: readonly T[]): number {
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
  const idx = allocSlot(pools.smokePuffs);
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
): void {
  const idx = allocSlot(pools.cartridges);
  const c = pools.cartridges[idx]!;
  const dir = forward.clone().normalize();
  const right = new THREE.Vector3().crossVectors(dir, UP_VEC);
  if (right.lengthSq() < 1e-4) right.set(1, 0, 0);
  else right.normalize();
  const ejectOrigin = new THREE.Vector3(fromX, fromY, fromZ)
    .addScaledVector(dir, backOffset * scale)
    .addScaledVector(right, 0.22 * scale);
  c.active = true;
  c.x = ejectOrigin.x;
  c.y = ejectOrigin.y + 0.08 * scale;
  c.z = ejectOrigin.z;
  const sideSpd = 2.0 + nextRand() * 1.1;
  const upSpd = 2.1 + nextRand() * 0.9;
  const backSpd = 0.4 + nextRand() * 0.6;
  c.vx = right.x * sideSpd - dir.x * backSpd;
  c.vy = upSpd;
  c.vz = right.z * sideSpd - dir.z * backSpd;
  c.rx = nextRand() * Math.PI * 2;
  c.ry = nextRand() * Math.PI * 2;
  c.rz = nextRand() * Math.PI * 2;
  c.vrx = (nextRand() - 0.5) * 32;
  c.vry = (nextRand() - 0.5) * 32;
  c.vrz = (nextRand() - 0.5) * 32;
  c.scale = scale;
  c.groundY = groundY ?? Math.max(0, fromY - 0.88);
  c.ageS = 0;
  c.durationS = 1.05 + nextRand() * 0.25;
  writeCartridgeMatrix(pools, idx, c);
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
    if (c.y <= c.groundY + 0.025) {
      c.y = c.groundY + 0.025;
      c.vy = Math.abs(c.vy) * 0.40;
      c.vx *= 0.62;
      c.vz *= 0.62;
      c.vrx *= 0.55;
      c.vry *= 0.55;
      c.vrz *= 0.55;
    }
    writeCartridgeMatrix(pools, i, c);
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
}
