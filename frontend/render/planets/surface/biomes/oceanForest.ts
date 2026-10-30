import * as THREE from 'three';
import type { SurfaceContext } from '../SurfaceContext';
import { jitter, light } from '../SurfaceContext';
import { createWater } from '../../../visuals/terrain/Liquids';
import { createParticles } from '../../../visuals/terrain/Particles';
import { smoothstep } from '../../../visuals/terrain/noise';
import { scatterGrid, buildInstanced, createFoliageMaterial, makeBroadleafGeo, makePalmGeo } from '../../../visuals/terrain/Scatter';

export function buildOceanForest(c: SurfaceContext) {
  const { rng, ext, level, heightAt, nz, terrain, palette: P, cellMul } = c;
  const water = createWater({ level, heightTex: terrain.heightTex, span: terrain.span, coverage: terrain.span }, P.water ?? 0x1f9fb8, P.waterDeep ?? 0x0b3f66, c.spec.sky.skyColor);
  c.addLayer(water.mesh, water.uniforms, water);
  const la = light(P.groundLow, 1.05), lb = light(P.groundHigh, 0.9);
  const forestN = (x: number, z: number) => smoothstep(-0.25, 0.25, nz.fbm(x * 0.03, z * 0.03, 3));
  const trees = scatterGrid(rng, ext, 2.2 * cellMul, (x, z) => {
    const h = heightAt(x, z); if (h < level + 1.5 || c.slopeAt(x, z) > 0.6) return 0;
    return (0.12 + 0.85 * forestN(x, z)) * c.landingFree(x, z) * smoothstep(level + 1.5, level + 2.4, h);
  });
  c.lift(trees);
  const palms = scatterGrid(rng, ext, 3.0 * cellMul, (x, z) => {
    const h = heightAt(x, z) - level; if (h < 0.45 || h > 2.3 || c.slopeAt(x, z) > 0.5) return 0;
    return 0.35 * c.landingFree(x, z);
  });
  c.lift(palms);
  const tmat = createFoliageMaterial(c.timeU, 1.0), pmat = createFoliageMaterial(c.timeU, 2.2, true);
  c.addMesh(buildInstanced(makeBroadleafGeo(la, lb, 4), tmat, trees, { sx: [0.8, 1.5], sy: [0.8, 1.7], sink: 0.1, tilt: 0.08, tint: jitter(0.22, 0.25) }));
  c.addMesh(buildInstanced(makePalmGeo(light(0x4c9a3a, 1.0)), pmat, palms, { sx: [0.9, 1.3], sy: [0.9, 1.5], sink: 0.1, tilt: 0.12, tint: jitter(0.18, 0.2) }));
  c.boulders(70, (x, z) => { const h = heightAt(x, z) - level; return h > -0.4 && h < 3 ? 0.07 : 0.005; }, [0.4, 1.4], c.rockTint);
  const pollen = createParticles({ count: 160, box: 120, height: 10, size: 0.7, color: new THREE.Color(0xfff3c0), drift: new THREE.Vector3(0.7, 0.15, 0.4), wobble: 2.0, additive: true, alpha: 0.5, seed: c.spec.seed });
  c.addLayer(pollen.points, pollen.uniforms, pollen);
}
