import * as THREE from 'three';
import type { PlanetSpec } from '../../planets/PlanetSpec';
import type { HeightField } from './heightfields';
import { buildTerrainGrid, buildTerrainGeometry, buildHeightTexture, makeHeightSampler } from './TerrainGrid';
import { createTerrainMaterial, terrainUniforms } from './terrainMaterial';

export interface TerrainResult {
  mesh: THREE.Mesh;
  heightAt(x: number, z: number): number;
  heightTex: THREE.DataTexture;
  span: number; // full world size of the grid
  uniforms: Record<string, THREE.IUniform>;
  dispose(): void;
}

/** Single high-res displaced grid. heightAt() interpolates the SAME triangles the GPU renders. */
export function createTerrain(spec: PlanetSpec, field: HeightField, half: number, N: number): TerrainResult {
  const span = half * 4;
  const grid = buildTerrainGrid(field, span, N);
  const geo = buildTerrainGeometry(grid, field, span);
  const heightTex = buildHeightTexture(grid.hs, grid.V);
  const heightAt = makeHeightSampler(grid, span, N);

  const uniforms = terrainUniforms(spec, field.liquid?.level ?? -99, half * 2, field.wind);
  const mat = createTerrainMaterial(uniforms);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrain';
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return { mesh, heightAt, heightTex, span, uniforms, dispose() { geo.dispose(); mat.dispose(); heightTex.dispose(); } };
}
