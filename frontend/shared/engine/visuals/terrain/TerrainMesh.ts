import * as THREE from 'three';
import type { PlanetSpec } from '../../planets/PlanetSpec';
import type { HeightField } from './heightfields';
import { buildTerrainGrid, buildTerrainGeometry, buildHeightTexture, makeHeightSampler } from './TerrainGrid';
import { applyTerrainShader } from './terrainShader';

export interface TerrainResult {
  mesh: THREE.Mesh;
  heightAt(x: number, z: number): number;
  heightTex: THREE.DataTexture;
  span: number; // full world size of the grid
  uniforms: Record<string, THREE.IUniform>;
  dispose(): void;
}

const KIND_INDEX = { dune: 0, oceanForest: 1, forestRock: 2 } as const;

/** Single high-res displaced grid. heightAt() interpolates the SAME triangles the GPU renders. */
export function createTerrain(spec: PlanetSpec, field: HeightField, half: number, N: number): TerrainResult {
  const span = half * 4;
  const grid = buildTerrainGrid(field, span, N);
  const geo = buildTerrainGeometry(grid, field, span);
  const heightTex = buildHeightTexture(grid.hs, grid.V);
  const heightAt = makeHeightSampler(grid, span, N);

  const p = spec.palette;
  const c = (n: number) => new THREE.Color(n);
  const uniforms: Record<string, THREE.IUniform> = {
    uTime: { value: 0 },
    uKind: { value: KIND_INDEX[spec.kind] },
    uLevel: { value: field.liquid?.level ?? -99 },
    uExt: { value: half * 2 },
    uLow: { value: c(p.groundLow) }, uHigh: { value: c(p.groundHigh) },
    uRock: { value: c(p.rock) }, uRockDark: { value: c(p.rockDark) },
    uAccent: { value: c(p.accent) },
    uWind: { value: new THREE.Vector2(field.wind[0], field.wind[1]) },
  };

  const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0.0 });
  mat.onBeforeCompile = (sh) => applyTerrainShader(sh, uniforms);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrain';
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return { mesh, heightAt, heightTex, span, uniforms, dispose() { geo.dispose(); mat.dispose(); heightTex.dispose(); } };
}
