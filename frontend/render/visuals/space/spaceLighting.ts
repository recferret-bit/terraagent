import * as THREE from 'three';
import { getColonyVisionUniforms } from '../../lighting/ColonyVisionAndLights';

/**
 * Colony-only uniforms of the Unified material that must not reach hardware in space. They are module-global (the
 * colony FoV shroud, the planet's night factor and the colony projector lights) and are keyed on colony world xz, so a
 * carrier or pod rendered in the orbital stage / high above the descent would be shrouded to near-black (shroud keep
 * ≈ 0.05 outside vision) by a colony that is not even in its scene.
 */
const COLONY_ONLY = ['uFovEnabled', 'uNightFactor', 'uProjectorCount', 'uVisionSourceCount'] as const;

export interface SpaceLighting {
  /** true: the colony uniforms read 0 for these meshes; false: they follow the live colony values again. */
  set(isolated: boolean): void;
}

type CompileFn = THREE.Material['onBeforeCompile'];

/** Wraps one material's `onBeforeCompile` so its colony-only uniforms come from per-model gates (no shader change). */
function gateMaterial(mat: THREE.Material, isIsolated: () => boolean): void {
  if (mat.userData.spaceLitGated || mat.onBeforeCompile === THREE.Material.prototype.onBeforeCompile) return;
  const prev: CompileFn = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey();
  const live = getColonyVisionUniforms();
  const gates: Record<string, THREE.IUniform> = {};
  for (const key of COLONY_ONLY) {
    gates[key] = { get value() { return isIsolated() ? 0 : live[key]!.value; }, set value(_v: unknown) { /* read-only gate */ } };
  }
  mat.onBeforeCompile = function (this: THREE.Material, shader, renderer) {
    prev.call(this, shader, renderer);
    for (const key of COLONY_ONLY) if (key in shader.uniforms) shader.uniforms[key] = gates[key]!;
  };
  // same GLSL as before; one extra cached program shared by every gated material
  mat.customProgramCacheKey = () => `${prevKey}|spaceLit`;
  mat.userData.spaceLitGated = true;
  mat.needsUpdate = true;
}

/** Gates every material under `root` (the Unified colony material of kitbash models; plain materials are untouched). */
export function createSpaceLighting(root: THREE.Object3D, isolated = true): SpaceLighting {
  let on = isolated;
  const isIsolated = () => on;
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (!m) return;
    for (const mat of Array.isArray(m) ? m : [m]) gateMaterial(mat, isIsolated);
  });
  return { set(v) { on = v; } };
}
