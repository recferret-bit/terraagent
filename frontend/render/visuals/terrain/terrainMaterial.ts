import * as THREE from 'three';
import type { PlanetKind, PlanetSpec } from '../../planets/PlanetSpec';
import { createTerraformMapTexture, resolveTerraformPalette } from '../TerrainAndWaterShaders';
import { applyTerrainShader } from './terrainShader';

const KIND_INDEX: Record<PlanetKind, number> = { dune: 0, oceanForest: 1, forestRock: 2 };

/**
 * Uniforms of the terrain shader from a planet palette. `ext` = full extent (m) the radial fog fade is measured against.
 * `terraformMap`: the caller's `uTerraformMap` (the hex terrain's per-tile one); without it a 128² world-space map is
 * allocated here, which the caller then owns (dispose it with the material).
 */
export function terrainUniforms(
  spec: PlanetSpec, level: number, ext: number, wind: readonly [number, number], terraformMap?: THREE.Texture,
): Record<string, THREE.IUniform> {
  const p = spec.palette;
  const tfPalette = resolveTerraformPalette(spec.kind);
  const terraformTexture = terraformMap ?? createTerraformMapTexture(128).terraformTexture;
  const c = (n: number) => new THREE.Color(n);
  return {
    uTime: { value: 0 },
    uKind: { value: KIND_INDEX[spec.kind] },
    uLevel: { value: level },
    uExt: { value: ext },
    uLow: { value: c(p.groundLow) }, uHigh: { value: c(p.groundHigh) },
    uRock: { value: c(p.rock) }, uRockDark: { value: c(p.rockDark) },
    uAccent: { value: c(p.accent) },
    uTerraformMap: { value: terraformTexture },
    uTerraformedLush: { value: c(tfPalette.terraformedLush) },
    uFrontierGlow: { value: c(tfPalette.frontierGlow) },
    uWind: { value: new THREE.Vector2(wind[0], wind[1]) },
  };
}

/** The terrain material; `extend` may add shader terms after the terrain shader ran (the hex terrain adds its edge lines). */
export function createTerrainMaterial(uniforms: Record<string, THREE.IUniform>, extend?: (sh: THREE.WebGLProgramParametersWithUniforms) => void): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0.0 });
  mat.shadowSide = THREE.DoubleSide;
  mat.onBeforeCompile = (sh) => { applyTerrainShader(sh, uniforms); extend?.(sh); };
  return mat;
}
