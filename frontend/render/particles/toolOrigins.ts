import type * as THREE from 'three';

const HERO_SCALE = 0.88;
const HERO_LEFT_HAND: [number, number, number] = [
  0.465 * HERO_SCALE,
  0.79 * HERO_SCALE,
  0.275 * HERO_SCALE,
];
const HERO_LEFT_PIVOT: [number, number, number] = [0.44 * HERO_SCALE, 1.48 * HERO_SCALE, 0];
const HERO_RIGHT_HAND: [number, number, number] = [
  -0.465 * HERO_SCALE,
  0.79 * HERO_SCALE,
  0.275 * HERO_SCALE,
];
const HERO_RIGHT_PIVOT: [number, number, number] = [-0.44 * HERO_SCALE, 1.48 * HERO_SCALE, 0];

/**
 * Exact CPU mirror of `rotateRollPitchYaw` in `frontend/render/visuals/unified/shaderChunks.ts`:
 * roll about Z, then pitch about X, then yaw about Y.
 */
export function rotateRollPitchYaw(
  rx: number,
  ry: number,
  rz: number,
  roll: number,
  pitch: number,
  yaw: number,
): [number, number, number] {
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const rx1 = rx * cr - ry * sr;
  const ry1 = rx * sr + ry * cr;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const ry2 = ry1 * cp - rz * sp;
  const rz2 = ry1 * sp + rz * cp;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const rx3 = rx1 * cy - rz2 * sy;
  const rz3 = rx1 * sy + rz2 * cy;
  return [rx3, ry2, rz3];
}

/**
 * Exact CPU mirror of `bipedBodyTransform` (`animType = 8`) in `shaderChunks.ts`.
 */
export function evalBipedBodyPoint(
  x: number,
  y: number,
  z: number,
  g: number,
  walkWeight: number,
  workWeight: number,
): [number, number, number] {
  const cy0 = 0.92;
  const roll = -Math.cos(g) * 0.055 * walkWeight + Math.sin(g) * 0.04 * workWeight;
  const pitch = Math.sin(g * 2 - 0.4) * 0.048 * walkWeight + (0.09 + Math.sin(g * 2) * 0.05) * workWeight;
  const yaw = -Math.sin(g) * 0.075 * walkWeight + Math.cos(g) * 0.08 * workWeight;
  const heaveY =
    (-Math.cos(g * 2) * 0.022 - Math.sin(g * 2) * 0.012) * walkWeight +
    (0.012 + Math.sin(g * 2) * 0.012) * workWeight;
  const swayX = -Math.cos(g) * 0.036 * walkWeight + Math.sin(g) * 0.022 * workWeight;
  const surgeZ = Math.sin(g * 2) * 0.025 * walkWeight + (0.02 + Math.sin(g * 2) * 0.018) * workWeight;
  const [rx, ry, rz] = rotateRollPitchYaw(x, y - cy0, z, roll, pitch, yaw);
  return [rx + swayX, cy0 + ry + heaveY, rz + surgeZ];
}

/**
 * Exact CPU mirror of `spiderBodyTransform` (`animType = 9`) in `shaderChunks.ts`.
 */
export function evalSpiderBodyPoint(
  x: number,
  y: number,
  z: number,
  g: number,
  walkWeight: number,
  workWeight: number,
): [number, number, number] {
  const cy0 = 0.76;
  const roll = Math.sin(g - 0.25) * 0.065 * walkWeight + Math.sin(g) * 0.035 * workWeight;
  const pitch = Math.sin(g * 2 - 0.45) * 0.048 * walkWeight + (0.06 + Math.sin(g * 2) * 0.04) * workWeight;
  const yaw = Math.cos(g) * 0.05 * walkWeight + Math.cos(g) * 0.055 * workWeight;
  const heaveY =
    (-Math.cos(g * 2) * 0.032 - Math.sin(g * 2) * 0.018) * walkWeight +
    (0.01 + Math.sin(g * 2) * 0.01) * workWeight;
  const swayX = Math.cos(g) * 0.03 * walkWeight + Math.sin(g) * 0.018 * workWeight;
  const surgeZ = Math.sin(g * 2) * 0.024 * walkWeight + (0.015 + Math.sin(g * 2) * 0.015) * workWeight;
  const [rx, ry, rz] = rotateRollPitchYaw(x, y - cy0, z, roll, pitch, yaw);
  return [rx + swayX, cy0 + ry + heaveY, rz + surgeZ];
}

/**
 * Exact CPU mirror of `BipedArm` (`animType = 5`) + `bipedBodyTransform` in `shaderChunks.ts`.
 */
export function evalBipedArmPoint(
  pos: [number, number, number],
  pivot: [number, number, number],
  g: number,
  walkWeight: number,
  workWeight: number,
): [number, number, number] {
  const [px, py, pz] = pivot;
  const phase = px >= 0 ? Math.PI : 0;
  const sideSign = px >= 0 ? 1 : -1;
  const tau = g + phase;
  const workAngle = (-0.62 + Math.sin(g * 2 + phase * 0.5) * 0.26) * workWeight;
  const workYaw = sideSign * (-0.1 + Math.cos(g * 2 + phase * 0.5) * 0.08) * workWeight;
  const armAngle = Math.sin(tau) * 0.22 * walkWeight + workAngle;
  const ca = Math.cos(armAngle);
  const sa = Math.sin(armAngle);
  const cy = Math.cos(workYaw);
  const sy = Math.sin(workYaw);
  const relX = pos[0] - px;
  const relY = pos[1] - py;
  const relZ = pos[2] - pz;
  const ry1 = relY * ca - relZ * sa;
  const rz1 = relY * sa + relZ * ca;
  const rx2 = relX * cy - rz1 * sy;
  const rz2 = relX * sy + rz1 * cy;
  return evalBipedBodyPoint(px + rx2, py + ry1, pz + rz2, g, walkWeight, workWeight);
}

function localToWorld(
  local: [number, number, number],
  bx: number,
  by: number,
  bz: number,
  yaw: number,
): [number, number, number] {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const [lx, ly, lz] = local;
  return [
    bx + lx * cy + lz * sy,
    by + ly,
    bz - lx * sy + lz * cy,
  ];
}

export interface ArchetypeToolOriginParams {
  archetypeId: string;
  position: [number, number, number];
  yaw?: number;
  time?: number;
  walkWeight?: number;
  workWeight?: number;
}

/**
 * Evaluates world-space tool/hand emitter origins for a unit archetype, synchronized with the GPU
 * vertex animation channels (`aPartAnim`) in `UnifiedColonyMaterial`.
 */
export function evalArchetypeToolOrigins(params: ArchetypeToolOriginParams): [number, number, number][] {
  const {
    archetypeId,
    position: [bx, by, bz],
    yaw = 0,
    time = 0,
    walkWeight = 0,
    workWeight = 1,
  } = params;
  const g = time * 5.0;

  if (archetypeId === 'robot.hero') {
    const leftLocal = evalBipedArmPoint(HERO_LEFT_HAND, HERO_LEFT_PIVOT, g, walkWeight, workWeight);
    const rightLocal = evalBipedArmPoint(HERO_RIGHT_HAND, HERO_RIGHT_PIVOT, g, walkWeight, workWeight);
    return [
      localToWorld(leftLocal, bx, by, bz, yaw),
      localToWorld(rightLocal, bx, by, bz, yaw),
    ];
  }

  if (archetypeId === 'robot.miner') {
    return [
      localToWorld([0, 0.24, 0.84], bx, by, bz, yaw),
      localToWorld([0, 0.48, 0.84], bx, by, bz, yaw),
    ];
  }

  if (archetypeId === 'robot.combat') {
    const recoilL = Math.pow(Math.max(Math.sin(g * (1 + workWeight) + 0.13 * 2.3), 0), 6) * 0.06;
    const recoilR = Math.pow(Math.max(Math.sin(g * (1 + workWeight) - 0.13 * 2.3), 0), 6) * 0.06;
    const leftCannon = evalSpiderBodyPoint(0.13, 1.14, 0.955 - recoilL, g, walkWeight, workWeight);
    const rightCannon = evalSpiderBodyPoint(-0.13, 1.14, 0.955 - recoilR, g, walkWeight, workWeight);
    return [
      localToWorld(leftCannon, bx, by, bz, yaw),
      localToWorld(rightCannon, bx, by, bz, yaw),
    ];
  }

  const recoilWave = Math.sin(g * (1 + workWeight) + 0.5 * 2.3);
  const recoilZ = Math.pow(Math.max(recoilWave, 0), 6) * 0.06;
  return [
    localToWorld([0.5, 0.44, 0.64 - recoilZ], bx, by, bz, yaw),
    localToWorld([0, 0.98, 0.5], bx, by, bz, yaw),
  ];
}

/**
 * Computes world-space tool origins directly from an archetype mesh's live transform and shader uniforms.
 */
export function computeMeshToolOrigins(
  mesh: THREE.Object3D,
  fallbackArchetypeId?: string,
  fallbackWalkWeight = 0,
  fallbackWorkWeight = 1,
): [number, number, number][] {
  const ud = (mesh.userData as {
    archetypeId?: string;
    uniforms?: {
      uTime?: { value: number };
      uWalkWeight?: { value: number };
      uWorkWeight?: { value: number };
    };
  } | undefined) ?? {};
  const childUd = (mesh.children?.[0]?.userData as typeof ud | undefined) ?? {};
  const u = ud.uniforms ?? childUd.uniforms;
  const archetypeId = ud.archetypeId || childUd.archetypeId || fallbackArchetypeId || mesh.name || 'robot.builder';
  const time = typeof u?.uTime?.value === 'number' ? u.uTime.value : 0;
  const walkWeight = typeof u?.uWalkWeight?.value === 'number' ? u.uWalkWeight.value : fallbackWalkWeight;
  const workWeight = typeof u?.uWorkWeight?.value === 'number' ? u.uWorkWeight.value : fallbackWorkWeight;

  return evalArchetypeToolOrigins({
    archetypeId,
    position: [mesh.position.x, mesh.position.y, mesh.position.z],
    yaw: mesh.rotation.y,
    time,
    walkWeight,
    workWeight,
  });
}
