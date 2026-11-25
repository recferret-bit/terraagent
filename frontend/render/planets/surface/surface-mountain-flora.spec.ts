import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { PLANET_SPECS, type PlanetKind } from '../PlanetSpec';
import { createHeightField } from '../../visuals/terrain/heightfields';
import { classifySurfaceSite } from '../hex/flora/terrainCompatibility';
import { createPlanetSurface } from './index';
import type { PlanetSurface } from './types';

function estimateSlope(heightAt: (x: number, z: number) => number, x: number, z: number, eps = 0.7): number {
  const gx = (heightAt(x + eps, z) - heightAt(x - eps, z)) / (2 * eps);
  const gz = (heightAt(x, z + eps) - heightAt(x, z - eps)) / (2 * eps);
  return Math.hypot(gx, gz);
}

describe('PlanetSurface mountain flora & object exclusion across all 3 biomes', () => {
  const created: PlanetSurface[] = [];
  afterEach(() => {
    while (created.length > 0) created.pop()!.dispose();
  });

  it('classifySurfaceSite rejects flora substrates on steep slopes and rock mountains in dune, oceanForest, and forestRock', () => {
    const kinds: PlanetKind[] = ['dune', 'oceanForest', 'forestRock'];
    for (const kind of kinds) {
      const spec = PLANET_SPECS[kind];
      const field = createHeightField(spec, 90);
      const waterLevel = field.liquid ? 0 : null;
      const step = 4;
      for (let z = -88; z <= 88; z += step) {
        for (let x = -88; x <= 88; x += step) {
          const y = field.height(x, z);
          if (waterLevel !== null && y <= waterLevel) continue;
          const slope = estimateSlope(field.height, x, z);
          const rockMask = field.rock?.(x, z) ?? 0;
          const substrate = classifySurfaceSite({
            biome: kind,
            x,
            z,
            y,
            slope,
            waterLevel,
            planetSeed: spec.seed,
            rockMask,
          });
          if (kind === 'dune') {
            if (rockMask > 0.34 || slope >= 0.42) {
              expect(['duneMesaCap', 'rockOutcrop'], `${kind} @(${x},${z}) rock=${rockMask.toFixed(2)} slope=${slope.toFixed(2)}`).toContain(substrate.substrate);
            }
          } else if (slope >= 0.48) {
            expect(['rockOutcrop', 'coastalSand', 'submerged'], `${kind} @(${x},${z}) slope=${slope.toFixed(2)}`).toContain(substrate.substrate);
          }
        }
      }
    }
  });

  it('createPlanetSurface places zero dune mesa flora and excludes grass/bush/flower clusters from steep cliffs across biomes', () => {
    const mat = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    for (const kind of ['dune', 'oceanForest', 'forestRock'] as const) {
      const spec = PLANET_SPECS[kind];
      const half = 80;
      const surface = createPlanetSurface(spec, { halfSize: half, quality: 'low' });
      created.push(surface);
      const field = createHeightField(spec, half);
      let checkedFlora = 0;

      surface.group.traverse((obj) => {
        if (!(obj instanceof THREE.InstancedMesh)) return;
        const parentName = (obj.parent?.name || '').toLowerCase();
        if (parentName.includes('biosphere') || (obj.name || '').toLowerCase().includes('biosphere')) return;
        const vc = obj.geometry.attributes.position?.count ?? 0;
        // Ground objects / flora / trees have > 1000 vertices; pebbles/boulders have <= 600 vertices
        if (vc < 1500) return;

        for (let i = 0; i < obj.count; i++) {
          obj.getMatrixAt(i, mat);
          pos.setFromMatrixPosition(mat);
          const scale = new THREE.Vector3().setFromMatrixScale(mat);
          if (scale.lengthSq() < 1e-6) continue;
          checkedFlora++;
          const rockMask = field.rock?.(pos.x, pos.z) ?? 0;
          const sl15 = estimateSlope(field.height, pos.x, pos.z, 1.5);
          if (kind === 'dune') {
            expect(rockMask, `${kind} flora @(${pos.x.toFixed(1)},${pos.z.toFixed(1)}) rockMask`).toBeLessThanOrEqual(0.35);
            expect(sl15, `${kind} flora @(${pos.x.toFixed(1)},${pos.z.toFixed(1)}) sl15`).toBeLessThan(0.5);
          } else {
            // Reeds/bushes/grass/wildflowers use addCompatibleSurfaceFlora; verify non-tree ground flora keeps off steep cliffs
            if (vc !== 4080 && vc !== 4800) {
              expect(sl15, `${kind} flora(verts=${vc}) @(${pos.x.toFixed(1)},${pos.z.toFixed(1)}) sl15`).toBeLessThan(0.5);
            }
          }
        }
      });

      expect(checkedFlora, `${kind} should verify >0 surface flora/tree instances`).toBeGreaterThan(0);
    }
  });
});
