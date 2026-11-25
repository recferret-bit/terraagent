import * as THREE from 'three';
import type { CombatBurstSystem } from '../../particles/CombatBurstSystem';
import type { CombatDynamicLights } from './CombatDynamicLights';
import type { ProjectileVfxPools } from './pools';
import { writeImpactMatrix, writeShockwaveMatrix } from './pools';
import { allocPoolSlot, clearGroundCratersNear, spawnSmokePuffInPool } from './poolSteps';
import type { VfxPoint3D } from './types';

export type MechanicalDeathKind = 'bot' | 'building';

export interface MechanicalDeathVfxInput {
  kind: MechanicalDeathKind;
  at: VfxPoint3D;
  groundY?: number;
  scale?: number;
}

export interface SmolderSite {
  x: number;
  y: number;
  z: number;
  scale: number;
  ageS: number;
  durationS: number;
  cooldownS: number;
  building: boolean;
}

const MAX_SMOLDER_SITES = 16;
const UP_VEC = new THREE.Vector3(0, 1, 0);
const TMP_COLOR = new THREE.Color();

function spawnShockwaveRing(
  pools: ProjectileVfxPools,
  x: number,
  y: number,
  z: number,
  opts: {
    startRadius: number;
    maxRadius: number;
    thickness: number;
    baseOpacity: number;
    durationS: number;
    colorHex: number;
  },
): void {
  const idx = allocPoolSlot(pools.shockwaves);
  const sw = pools.shockwaves[idx]!;
  sw.active = true;
  sw.x = x;
  sw.y = y;
  sw.z = z;
  sw.startRadius = opts.startRadius;
  sw.maxRadius = opts.maxRadius;
  sw.thickness = opts.thickness;
  sw.baseOpacity = opts.baseOpacity;
  sw.ageS = 0;
  sw.durationS = opts.durationS;
  TMP_COLOR.setHex(opts.colorHex);
  pools.shockwavePool.mesh.setColorAt(idx, TMP_COLOR);
  if (pools.shockwavePool.mesh.instanceColor) pools.shockwavePool.mesh.instanceColor.needsUpdate = true;
  writeShockwaveMatrix(pools, idx, sw);
}

function spawnDeathImpactFlash(
  pools: ProjectileVfxPools,
  x: number,
  blastY: number,
  z: number,
  scale: number,
  building: boolean,
): void {
  const impIdx = allocPoolSlot(pools.impacts);
  const imp = pools.impacts[impIdx]!;
  imp.active = true;
  imp.x = x;
  imp.y = blastY;
  imp.z = z;
  imp.ageS = 0;
  imp.durationS = building ? 0.32 : 0.24;
  imp.maxScale = (building ? 1.65 : 1.12) * scale;
  TMP_COLOR.setHex(0xffe082);
  pools.impactPool.mesh.setColorAt(impIdx, TMP_COLOR);
  if (pools.impactPool.mesh.instanceColor) pools.impactPool.mesh.instanceColor.needsUpdate = true;
  writeImpactMatrix(pools, impIdx, imp);

  // Clear overlapping shell/rocket crater quads instead of spawning an opaque cylinder disk under the wreck.
  clearGroundCratersNear(pools, x, z, (building ? 2.8 : 1.6) * scale);
}

/** Triggers combined fireball/chunk burst, dual shockwaves, crater clearing, smoke plume, light flash & smolder. */
export function emitMechanicalDeathVfx(
  pools: ProjectileVfxPools,
  bursts: CombatBurstSystem,
  lights: CombatDynamicLights,
  smolderSites: SmolderSite[],
  nextRand: () => number,
  opts: MechanicalDeathVfxInput,
): void {
  const building = opts.kind === 'building';
  const scale = Math.max(0.45, opts.scale ?? (building ? 1.25 : 1.0));
  const x = opts.at.x;
  const z = opts.at.z ?? 0;
  const groundY = opts.groundY ?? 0;
  const blastY = Math.max(groundY + (building ? 0.65 : 0.42), opts.at.y);

  // 1. Fireball, 3D sparks/shrapnel, embers & dense smoke preset
  bursts.emit(building ? 'combat.buildingDeath' : 'combat.botDeath', {
    at: new THREE.Vector3(x, blastY, z),
    normal: UP_VEC,
    groundY,
    scale,
  });

  // 2. Dual concentric ground shockwaves: fast fiery core + wider pressure wave
  const swY = groundY + 0.24;
  spawnShockwaveRing(pools, x, swY, z, {
    startRadius: 0.25 * scale,
    maxRadius: (building ? 3.2 : 2.15) * scale,
    thickness: building ? 1.55 : 1.15,
    baseOpacity: 0.96,
    durationS: building ? 0.48 : 0.36,
    colorHex: 0xff7818,
  });
  spawnShockwaveRing(pools, x, swY + 0.04, z, {
    startRadius: 0.38 * scale,
    maxRadius: (building ? 4.4 : 2.85) * scale,
    thickness: building ? 1.05 : 0.85,
    baseOpacity: 0.68,
    durationS: building ? 0.70 : 0.52,
    colorHex: 0xffdfb3,
  });

  // 3-4. Hot core flash & clear any craters beneath the wreck
  spawnDeathImpactFlash(pools, x, blastY, z, scale, building);

  // 5. Initial rolling dark + warm explosion smoke plume
  const puffCount = building ? 8 : 5;
  const spread = (building ? 0.9 : 0.5) * scale;
  for (let i = 0; i < puffCount; i++) {
    const px = x + (nextRand() - 0.5) * spread;
    const py = groundY + 0.35 + nextRand() * 0.75 * scale;
    const pz = z + (nextRand() - 0.5) * spread;
    spawnSmokePuffInPool(pools, nextRand, px, py, pz, (building ? 1.55 : 1.15) * scale, true);
  }

  // 6. Lingering smolder plume over the cratered wreck
  if (smolderSites.length >= MAX_SMOLDER_SITES) smolderSites.shift();
  smolderSites.push({
    x,
    y: groundY + 0.32 * scale,
    z,
    scale,
    ageS: 0,
    durationS: building ? 4.5 : 2.8,
    cooldownS: 0.18,
    building,
  });

  // 7. Explosion flash illumination
  lights.push(
    x,
    blastY + 0.45,
    z,
    1.0,
    0.48,
    0.10,
    (building ? 16.0 : 11.5) * scale,
    building ? 8.2 : 6.4,
    building ? 0.65 : 0.48,
  );
  lights.sync(pools);
}

export function stepSmolderSites(
  sites: SmolderSite[],
  pools: ProjectileVfxPools,
  nextRand: () => number,
  dt: number,
): void {
  for (let i = sites.length - 1; i >= 0; i--) {
    const s = sites[i]!;
    s.ageS += dt;
    if (s.ageS >= s.durationS) {
      sites.splice(i, 1);
      continue;
    }
    s.cooldownS -= dt;
    if (s.cooldownS <= 0) {
      s.cooldownS = (s.building ? 0.16 : 0.24) + nextRand() * 0.14;
      const spread = (s.building ? 0.55 : 0.28) * s.scale;
      const fade = 1 - (s.ageS / s.durationS) * 0.45;
      const warm = s.ageS < s.durationS * 0.55 && nextRand() > 0.35;
      spawnSmokePuffInPool(
        pools,
        nextRand,
        s.x + (nextRand() - 0.5) * spread,
        s.y,
        s.z + (nextRand() - 0.5) * spread,
        (s.building ? 1.2 : 0.85) * s.scale * fade,
        warm,
      );
    }
  }
}

export function emitInsectDeathVfx(
  pools: ProjectileVfxPools,
  bursts: CombatBurstSystem,
  lights: CombatDynamicLights,
  _nextRand: () => number,
  opts: { at: VfxPoint3D; groundY?: number; scale?: number },
): void {
  const x = opts.at.x;
  const z = opts.at.z ?? 0;
  const groundY = opts.groundY ?? 0;
  const y = Math.max(groundY + 0.28, opts.at.y);
  const scale = opts.scale ?? 1;
  const atVec = new THREE.Vector3(x, y, z);
  bursts.emit('combat.insectDeath', { at: atVec, normal: UP_VEC, groundY, scale });
  bursts.emit('combat.acidHit', { at: atVec, normal: UP_VEC, groundY, scale: scale * 1.35 });

  // Clear overlapping shell/rocket craters and never spawn a flat cylinder disk beneath corpses or hives.
  clearGroundCratersNear(pools, x, z, 1.8 * scale);

  lights.push(x, groundY + 0.55, z, 0.55, 1.0, 0.20, 9.5, 4.8, 0.45);
  lights.sync(pools);
}
