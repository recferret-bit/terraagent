import * as THREE from 'three';
import type { CombatBurstSystem } from '../../particles/CombatBurstSystem';
import type { CombatDynamicLights } from './CombatDynamicLights';
import type { ProjectileVfxPools } from './pools';
import {
  ejectCartridgeInPool,
  spawnGroundCraterInPool,
  spawnSmokePuffInPool,
} from './poolSteps';
import type {
  ProjectileFiredVfxInput,
  ProjectileImpactVfxInput,
  VfxPoint3D,
  VfxWeaponKind,
  WorldHeightLookup,
} from './types';

export function emitFiredMuzzleEffects(
  pools: ProjectileVfxPools,
  bursts: CombatBurstSystem,
  lights: CombatDynamicLights,
  nextRand: () => number,
  autocannonEjectSide: -1 | 1,
  input: ProjectileFiredVfxInput,
  kind: Exclude<VfxWeaponKind, 'laser'>,
  arcHeight: number,
  dx: number,
  dy: number,
  dz: number,
): -1 | 1 {
  const fromX = input.from.x;
  const fromY = input.from.y;
  const fromZ = input.from.z ?? 0;
  const wid = input.weaponId?.toLowerCase() ?? '';
  let nextSide = autocannonEjectSide;

  if (kind !== 'acid') {
    const axis = input.direction?.();
    const normal = axis
      ? new THREE.Vector3(axis.x, axis.y, axis.z ?? 0).normalize()
      : new THREE.Vector3(dx, dy + 4 * arcHeight, dz).normalize();
    const muzzleScale =
      wid === 'autocannon' ? 1.55 : kind === 'shell' ? 1.45 : wid === 'recongun' ? 1.05 : 1;
    bursts.emit('combat.muzzle', {
      at: new THREE.Vector3(fromX, fromY, fromZ),
      normal,
      groundY: fromY - 1,
      scale: muzzleScale,
      source: input.source,
      direction: input.direction,
    });
    if (input.ejectCartridge ?? (wid === 'recongun' || wid === 'autocannon' || kind === 'shell')) {
      const ejectPt = input.ejectFrom ?? { x: fromX, y: fromY, z: fromZ };
      const backOffset = input.ejectFrom ? 0.04 : -0.52;
      const casingScale =
        input.ejectScale ?? (kind === 'shell' ? 2.15 : wid === 'autocannon' ? 1.45 : 1.0);
      let ejectDirVec: THREE.Vector3 | undefined;
      if (input.ejectDir) {
        ejectDirVec = new THREE.Vector3(input.ejectDir.x, input.ejectDir.y, input.ejectDir.z ?? 0);
      } else if (wid === 'autocannon') {
        ejectDirVec = new THREE.Vector3().crossVectors(normal, new THREE.Vector3(0, 1, 0));
        if (ejectDirVec.lengthSq() < 1e-4) ejectDirVec.set(1, 0, 0);
        else ejectDirVec.normalize();
        ejectDirVec.multiplyScalar(nextSide);
        nextSide = nextSide === 1 ? -1 : 1;
      }
      ejectCartridgeInPool(
        pools,
        nextRand,
        ejectPt.x,
        ejectPt.y,
        ejectPt.z ?? 0,
        normal,
        casingScale,
        backOffset,
        input.ejectGroundY,
        ejectDirVec,
      );
    }
    if (!input.suppressLight) {
      const flashRange = wid === 'autocannon' || kind === 'shell' ? 7.8 : 5.8;
      const flashInt = wid === 'autocannon' || kind === 'shell' ? 4.4 : 3.2;
      lights.push(fromX, fromY, fromZ, 1.0, 0.72, 0.25, flashRange, flashInt, 0.13);
      lights.sync(pools);
    }
  } else if (!input.suppressLight) {
    lights.sync(pools);
  }
  if (kind === 'rocket') {
    spawnSmokePuffInPool(pools, nextRand, fromX, fromY, fromZ, 0.78, true);
  }
  if (kind === 'shell') {
    spawnSmokePuffInPool(pools, nextRand, fromX, fromY, fromZ, 0.65, true);
  }
  return nextSide;
}

export function emitImpactBurstsAndCrater(
  pools: ProjectileVfxPools,
  bursts: CombatBurstSystem,
  lights: CombatDynamicLights,
  nextRand: () => number,
  input: ProjectileImpactVfxInput,
  kind: VfxWeaponKind,
): void {
  const x = input.at.x;
  const y = input.at.y;
  const z = input.at.z ?? 0;
  const preset =
    kind === 'rocket' ? 'rocket' : kind === 'shell' ? 'artillery'
      : kind === 'laser' ? 'laserHit' : kind === 'acid' ? 'acidHit' : 'impact';
  const wid = input.weaponId?.toLowerCase() ?? '';
  const n = input.normal;
  const normVec = n ? new THREE.Vector3(n.x, n.y, n.z ?? 0) : new THREE.Vector3(0, 1, 0);
  const gY = input.groundY ?? y - 0.35;
  const craterY = input.groundY ?? (Math.abs(y) <= 0.25 ? y : y - 0.35);
  const groundNormVec = input.groundNormal
    ? new THREE.Vector3(input.groundNormal.x, input.groundNormal.y, input.groundNormal.z ?? 0).normalize()
    : new THREE.Vector3(0, 1, 0);
  bursts.emit(`combat.${preset}`, {
    at: new THREE.Vector3(x, y, z),
    normal: normVec,
    groundY: gY,
    scale: kind === 'rocket' || kind === 'shell' ? 1.25 : 1,
  });
  if (kind === 'shell' || kind === 'rocket' || kind === 'bullet') {
    const dustSizing =
      kind === 'shell' ? { scale: 1.65, velocityScale: 1.38 }
        : kind === 'rocket' ? { scale: 1.22, velocityScale: 1.12 }
          : wid === 'autocannon' ? { scale: 0.78, velocityScale: 0.85 }
            : { scale: 0.48, velocityScale: 0.62 };
    bursts.emit('combat.dustBurst', {
      at: new THREE.Vector3(x, Math.max(craterY + 0.06, Math.min(y, craterY + 0.32)), z),
      normal: groundNormVec,
      groundY: craterY,
      scale: dustSizing.scale,
      velocityScale: dustSizing.velocityScale,
    });
  }
  const hitsGround = input.targetId === undefined && (input.hit === false || y <= craterY + 0.22);
  let craterRadius = 0;
  if (hitsGround) {
    if (kind === 'shell') {
      craterRadius = (1.15 + nextRand() * 0.25) * (input.aoe && input.aoe > 1 ? 1.12 : 1.0);
    } else if (kind === 'rocket') {
      craterRadius = 0.82 + nextRand() * 0.22;
    } else if (kind === 'bullet') {
      craterRadius = wid === 'autocannon' ? 0.50 + nextRand() * 0.14 : 0.32 + nextRand() * 0.10;
    }
  }
  if (craterRadius > 0) {
    spawnGroundCraterInPool(pools, nextRand, x, craterY, z, craterRadius, input.groundNormal);
  }
  if (input.targetIsInsect && input.hit !== false && kind !== 'acid') {
    bursts.emit('combat.acidHit', {
      at: new THREE.Vector3(x, y, z),
      normal: normVec,
      groundY: gY,
      scale: kind === 'rocket' || kind === 'shell' ? 1.48 : 1.12,
    });
  }
  if (kind === 'rocket' || kind === 'shell') {
    lights.push(x, y + 0.35, z, 1.0, 0.46, 0.08, 12.0, 6.2, 0.50);
  } else if (kind === 'laser') {
    lights.push(x, y + 0.2, z, 0.3, 0.94, 1.0, 6.0, 3.2, 0.18);
  } else if (kind === 'acid') {
    lights.push(x, y + 0.2, z, 0.45, 1.0, 0.18, 5.2, 2.5, 0.25);
  } else {
    const green = Boolean(input.targetIsInsect && input.hit !== false);
    lights.push(x, y + 0.2, z, green ? 0.55 : 1.0, green ? 0.96 : 0.70, green ? 0.22 : 0.22, 5.0, 2.6, 0.16);
  }
  lights.sync(pools);
}

export function lookupWorldGroundNormal(
  heightLookup: WorldHeightLookup | undefined,
  x: number,
  z: number,
): VfxPoint3D | undefined {
  if (!heightLookup) return undefined;
  const eps = 0.4;
  const hL = heightLookup(x - eps, z);
  const hR = heightLookup(x + eps, z);
  const hD = heightLookup(x, z - eps);
  const hU = heightLookup(x, z + eps);
  const norm = new THREE.Vector3(hL - hR, 2 * eps, hD - hU).normalize();
  return { x: norm.x, y: norm.y, z: norm.z };
}
