import * as THREE from 'three';
import type { SurfaceContext } from '../SurfaceContext';
import { jitter, light } from '../SurfaceContext';
import { createWater } from '../../../visuals/terrain/Liquids';
import { createParticles } from '../../../visuals/terrain/Particles';
import { smoothstep } from '../../../visuals/terrain/noise';
import { scatterGrid, buildInstanced, createFoliageMaterial, makePineGeo } from '../../../visuals/terrain/Scatter';

export function buildForestRock(c: SurfaceContext) {
  const { rng, ext, level, heightAt, nz, terrain, cellMul } = c;
  const water = createWater({ level, heightTex: terrain.heightTex, span: terrain.span, coverage: terrain.span }, 0x3d8f94, 0x123b4a, c.spec.sky.skyColor);
  c.addLayer(water.mesh, water.uniforms, water);
  const pa = light(0x2f6a3c, 1.0), pb = light(0x3f7a43, 1.0);
  const forestN = (x: number, z: number) => smoothstep(-0.2, 0.3, nz.fbm(x * 0.035, z * 0.035, 3));
  const pines = scatterGrid(rng, ext, 2.1 * cellMul, (x, z) => {
    const h = heightAt(x, z); if (h < level + 0.9 || c.slopeAt(x, z) > 0.55) return 0;
    return (0.08 + 0.88 * forestN(x, z)) * c.landingFree(x, z);
  });
  c.lift(pines);
  c.addMesh(buildInstanced(makePineGeo(pa, pb), createFoliageMaterial(c.timeU, 0.7), pines, { sx: [0.75, 1.35], sy: [0.8, 1.9], sink: 0.1, tilt: 0.06, tint: jitter(0.2, 0.15) }));
  c.boulders(260, (x, z) => 0.06 + Math.min(0.4, c.slopeAt(x, z) * 0.35), [0.5, 2.0], c.rockTint, 3);
  c.spires((x, z) => (c.slopeAt(x, z) > 0.45 ? 0.35 : 0.01), 40, [0.7, 1.5], [3, 8], c.rockTint);
  const motes = createParticles({ count: 140, box: 120, height: 12, size: 0.55, color: new THREE.Color(0xe8f2c0), drift: new THREE.Vector3(0.4, 0.1, 0.25), wobble: 2.5, additive: true, alpha: 0.4, seed: c.spec.seed });
  c.addLayer(motes.points, motes.uniforms, motes);
}
