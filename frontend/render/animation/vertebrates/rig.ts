import * as THREE from 'three';
import type { VertebratePartInput, VertebratePartRig, VertebrateRigConfig, VertebrateRole } from './types';

export const DEFAULT_MAMMAL_CONFIG: VertebrateRigConfig = {
  isBird: 0,
  comY: 0.45,
  sleepDrop: 0.22,
  strideLen: 0.14,
  liftHeight: 0.065,
  gaitFreq: 5.2,
  headSleepPitch: 0.18,
};

export const DEFAULT_BIRD_CONFIG: VertebrateRigConfig = {
  isBird: 1,
  comY: 0.65,
  sleepDrop: 0,
  strideLen: 0.42,
  liftHeight: 0.34,
  gaitFreq: 7.5,
  headSleepPitch: 0,
  birdSize: 0.45,
};

export function isVertebrateGeometry(geometry: THREE.BufferGeometry): boolean {
  return Boolean(geometry.userData?.vertebrateParts || geometry.hasAttribute('aVertJoint'));
}

export function getVertebrateConfig(geometry: THREE.BufferGeometry): VertebrateRigConfig {
  const cfg = geometry.userData?.vertebrateConfig as VertebrateRigConfig | undefined;
  return cfg ?? DEFAULT_MAMMAL_CONFIG;
}

export function shiftVertebrateRigMetadata(geometry: THREE.BufferGeometry, scale: number, offsetY: number): void {
  const parts = geometry.userData?.vertebrateParts as Array<VertebratePartRig | undefined> | undefined;
  if (!parts) return;
  for (const p of parts) {
    if (!p) continue;
    const hasSpatialJoint = p.role === 4 || p.role === 5 || p.role === 6 || p.role === 7 || p.role === 8;
    if (p.joint && hasSpatialJoint) {
      p.joint = [p.joint[0] * scale, p.joint[1] * scale + offsetY, p.joint[2] * scale];
    }
    if (p.tip && (p.role === 4 || p.role === 5 || p.role === 6)) {
      p.tip = [p.tip[0] * scale, p.tip[1] * scale + offsetY, p.tip[2] * scale];
    }
  }
  const cfg = geometry.userData?.vertebrateConfig as VertebrateRigConfig | undefined;
  if (cfg) {
    cfg.comY = cfg.comY * scale + offsetY;
    cfg.sleepDrop *= scale;
    if (!cfg.isBird) {
      cfg.strideLen *= scale;
      cfg.liftHeight *= scale;
    }
  }
}

export function classifyVertebrateFallback(name: string, anim: number, pivot: THREE.Vector3Tuple): VertebratePartInput {
  let role: VertebrateRole = 1;
  if (anim === 78) role = 2;
  else if (anim === 88) role = 3;
  else if (anim === 92) role = 7;
  else if (name.includes('primary') || name.includes('outer wing')) role = 8;
  else if (name.includes('rectri') || name.includes('tail')) role = 9;
  return {
    role,
    pivot,
    joint: pivot,
    tip: [pivot[0], 0.02, pivot[2]],
    meta: 0,
  };
}

/**
 * Stamps `aVertJoint` (`[jx, jy, jz, role]`) and `aVertTip` (`[tx, ty, tz, meta]`) on a merged vertebrate
 * BufferGeometry using authored `userData.vertebrateParts` + `partRanges`.
 */
export function stampVertebrateRig(geometry: THREE.BufferGeometry): void {
  const anim = geometry.getAttribute('aPartAnim');
  const pos = geometry.getAttribute('position');
  if (!anim || !pos) return;
  const count = pos.count;
  const joints = new Float32Array(count * 4);
  const tips = new Float32Array(count * 4);
  const ranges = (geometry.userData?.partRanges as Array<{ name: string; start: number; count: number }> | undefined) ?? [];
  const metaParts = (geometry.userData?.vertebrateParts as Array<VertebratePartRig | undefined> | undefined) ?? [];

  for (let idx = 0; idx < ranges.length; idx++) {
    const r = ranges[idx]!;
    const authored = metaParts[idx];
    const pivot: THREE.Vector3Tuple = [anim.getY(r.start), anim.getZ(r.start), anim.getW(r.start)];
    const fallback = authored ? null : classifyVertebrateFallback(r.name, Math.round(anim.getX(r.start)), pivot);
    const role = authored?.role ?? fallback?.role ?? 1;
    const joint = authored?.joint ?? fallback?.joint ?? pivot;
    const tip = authored?.tip ?? fallback?.tip ?? [pivot[0], 0.02, pivot[2]];
    const meta = authored?.meta ?? fallback?.meta ?? 0;
    for (let v = r.start; v < r.start + r.count; v++) {
      const o = v * 4;
      joints[o] = joint[0];
      joints[o + 1] = joint[1];
      joints[o + 2] = joint[2];
      joints[o + 3] = role;
      tips[o] = tip[0];
      tips[o + 1] = tip[1];
      tips[o + 2] = tip[2];
      tips[o + 3] = meta;
    }
  }

  geometry.setAttribute('aVertJoint', new THREE.BufferAttribute(joints, 4));
  geometry.setAttribute('aVertTip', new THREE.BufferAttribute(tips, 4));
  if (geometry.boundingSphere) geometry.boundingSphere.radius *= 1.2;
}
