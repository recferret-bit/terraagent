import type * as THREE from 'three';
import { updateEntityProjectorRig } from './EntityProjectorRig';

/**
 * Renderer side of the building light state. The decision (which level a building should have) is made in ONE place,
 * `lightStateFor(kind).level(...)` in `shared/sim/src/systems/power-core/lightState.ts`; this module only
 * 1. eases the drawn level towards that target (`stepLightLevel`, no pop), and
 * 2. applies the drawn level to everything a building lights with (`applyBuildingLight`): the emissive parts of its
 *    material (`uLit`, `visuals/unified/buildingLit.ts`) and its projector rig. The GPU projector list takes the same
 *    level as a multiplier (`entityVisionSync.ts`).
 * Nothing else in the renderer may look at power or brownout to dim a light.
 */

/** Seconds to ease a light up / down by one e-fold. */
export const LIGHT_RISE_TAU_S = 0.35;
export const LIGHT_FALL_TAU_S = 0.55;

/** Moves `current` towards `target` (both 0..1) over `dt` seconds, exponentially, snapping when within 0.004. */
export function stepLightLevel(current: number, target: number, dt: number): number {
  if (!Number.isFinite(current)) return target;
  const tau = target >= current ? LIGHT_RISE_TAU_S : LIGHT_FALL_TAU_S;
  const next = current + (target - current) * (1 - Math.exp(-Math.max(0, dt) / tau));
  return Math.abs(target - next) < 0.004 ? target : next;
}

function uniformsOf(mesh: THREE.Object3D): Record<string, THREE.IUniform> | undefined {
  const own = (mesh.userData as { uniforms?: Record<string, THREE.IUniform> } | undefined)?.uniforms;
  return own ?? (mesh.children?.[0]?.userData as { uniforms?: Record<string, THREE.IUniform> } | undefined)?.uniforms;
}

/** The drawn light level last applied to a mesh (1 before the first call). */
export function getBuildingLightLevel(mesh: THREE.Object3D): number {
  const v = (mesh.userData as { lightLevel?: number } | undefined)?.lightLevel;
  return typeof v === 'number' ? v : 1;
}

/**
 * THE single entry point that makes a mesh show `level` (0 dark .. 1 fully lit): emissive parts and projector rig.
 * `rigIntensity` is the night-scaled rig power before the level (0 by day), `buildStage` the scaffold stage.
 */
export function applyBuildingLight(mesh: THREE.Object3D, level: number, rigIntensity: number, buildStage = 1): void {
  const lit = Math.max(0, Math.min(1, level));
  if (mesh.userData) (mesh.userData as { lightLevel?: number }).lightLevel = lit;
  const u = uniformsOf(mesh);
  if (u?.uLit) u.uLit.value = lit;
  updateEntityProjectorRig(mesh, rigIntensity * lit, buildStage);
}
