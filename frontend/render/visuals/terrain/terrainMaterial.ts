import * as THREE from 'three';
import type { PlanetKind, PlanetSpec } from '../../planets/PlanetSpec';
import { applyTerrainShader } from './terrainShader';

const KIND_INDEX: Record<PlanetKind, number> = { dune: 0, oceanForest: 1, forestRock: 2 };

/** Uniforms of the terrain shader from a planet palette. `ext` = full extent (m) the radial fog fade is measured against. */
export function terrainUniforms(spec: PlanetSpec, level: number, ext: number, wind: readonly [number, number]): Record<string, THREE.IUniform> {
  const p = spec.palette;
  const c = (n: number) => new THREE.Color(n);
  return {
    uTime: { value: 0 },
    uKind: { value: KIND_INDEX[spec.kind] },
    uLevel: { value: level },
    uExt: { value: ext },
    uLow: { value: c(p.groundLow) }, uHigh: { value: c(p.groundHigh) },
    uRock: { value: c(p.rock) }, uRockDark: { value: c(p.rockDark) },
    uAccent: { value: c(p.accent) },
    uWind: { value: new THREE.Vector2(wind[0], wind[1]) },
  };
}

/** The terrain material; `extend` may add shader terms after the terrain shader ran (the hex terrain adds its edge lines). */
export function createTerrainMaterial(uniforms: Record<string, THREE.IUniform>, extend?: (sh: THREE.WebGLProgramParametersWithUniforms) => void): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0.0 });
  mat.onBeforeCompile = (sh) => { applyTerrainShader(sh, uniforms); extend?.(sh); };
  return mat;
}
