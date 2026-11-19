import * as THREE from 'three';
import type { SurfaceContext } from '../SurfaceContext';
import { jitter } from '../SurfaceContext';
import { createWater } from '../../../visuals/terrain/Liquids';
import { createParticles } from '../../../visuals/terrain/Particles';
import { smoothstep } from '../../../visuals/terrain/noise';
import { scatterGrid, buildInstanced, createFoliageMaterial } from '../../../visuals/terrain/Scatter';
import { buildBiomeTreeAtlasGeo } from '../../../visuals/terrain/treeBreeds';
import {
  makeBushGeo,
  makeGrassTuftGeo,
  makeShoreReedsGeo,
  makeWildflowerGeo,
} from '../../../visuals/terrain/groundFloraGeos';
import { createWaterFauna } from '../../../visuals/water/fauna/WaterFauna';
import { bakeShoreField, createShoreField, texelCentre } from '../../../visuals/water/shoreField';

export function buildOceanForest(c: SurfaceContext) {
  const { rng, ext, level, heightAt, nz, terrain, palette: P, cellMul } = c;
  const shallow = P.water ?? 0x1f9fb8, deep = P.waterDeep ?? 0x0b3f66;
  const water = createWater({ level, heightTex: terrain.heightTex, span: terrain.span, coverage: terrain.span }, shallow, deep, c.spec.sky.skyColor);
  c.addLayer(water.mesh, water.uniforms, water);

  const shore = bakeShoreField((x, z) => {
    const depth = level - heightAt(x, z);
    return depth <= 0.08 ? 0 : depth > 0.95 ? 2 : 1;
  }, createShoreField(terrain.span, 384));
  for (let j = 0; j < shore.res; j++) {
    const tz = texelCentre(j, shore.res, shore.span);
    for (let i = 0; i < shore.res; i++) {
      const k = j * shore.res + i;
      if (shore.mask[k]) shore.bed[k] = Math.max(shore.bed[k]!, heightAt(texelCentre(i, shore.res, shore.span), tz) - level);
    }
  }
  const waterFauna = createWaterFauna({
    time: water.uniforms.uTime!,
    deepColor: water.uniforms.uDeep ?? { value: new THREE.Color(deep) },
    seed: c.spec.seed ^ 0x55a9,
    planetSpan: terrain.span,
    biomeKind: 'oceanForest',
  });
  waterFauna.rebuild(shore);
  waterFauna.group.position.y = level;
  c.addLayer(waterFauna.group, {}, waterFauna);

  const forestN = (x: number, z: number) => smoothstep(-0.25, 0.25, nz.fbm(x * 0.03, z * 0.03, 3));
  const trees = scatterGrid(rng, ext, 2.25 * cellMul, (x, z) => {
    const h = heightAt(x, z) - level;
    if (h < 0.35 || c.slopeAt(x, z) > 0.6) return 0;
    return (h < 1.6 ? 0.38 : 0.14 + 0.84 * forestN(x, z)) * c.landingFree(x, z);
  });
  c.lift(trees);
  for (const p of trees) {
    const dh = p.y - level;
    const stand = nz.fbm(p.x * 0.045 - 13, p.z * 0.045 + 29, 2);
    // Coastal mangrove & coconut palm along shores; emergent banyan & coral blossom inland
    if (dh < 0.95) p.breedIndex = p.r > 0.45 ? 1 : 0;
    else if (dh < 1.85) p.breedIndex = p.r > 0.35 ? 0 : 2;
    else p.breedIndex = stand > 0.08 ? 2 : p.r > 0.55 ? 3 : 2;
    p.windMul = p.breedIndex === 0 ? 1.55 : p.breedIndex === 3 ? 1.10 : 0.68;
  }
  c.addMesh(
    buildInstanced(buildBiomeTreeAtlasGeo('oceanForest', c.spec.seed), createFoliageMaterial(c.timeU, 0.95, true, true), trees, {
      sx: [0.58, 1.02], sy: [0.62, 1.14], sink: 0.10, tilt: 0.09, tint: jitter(0.20, 0.20), encodeBreedInColor: true,
    }),
  );

  // Tropical ground cover: lush grass tufts, hibiscus/orchid blossoms, coastal shrubs & lagoon reeds
  const lush = scatterGrid(rng, ext, 2.7 * cellMul, (x, z) => {
    const dh = heightAt(x, z) - level;
    return dh > 0.30 && c.slopeAt(x, z) < 0.50 ? 0.55 * c.landingFree(x, z) : 0;
  });
  c.lift(lush);
  c.addMesh(buildInstanced(makeGrassTuftGeo('oceanForest', c.spec.seed + 5), createFoliageMaterial(c.timeU, 1.4, true), lush, { sx: [0.75, 1.3], sy: [0.75, 1.4], sink: 0.03, tilt: 0.14, tint: jitter(0.22, 0.18), castShadow: false }));
  c.addMesh(buildInstanced(makeWildflowerGeo('oceanForest', c.spec.seed + 9), createFoliageMaterial(c.timeU, 1.2, true), lush.filter((_, i) => i % 3 === 0), { sx: [0.85, 1.25], sy: [0.85, 1.3], sink: 0.03, tilt: 0.12, tint: jitter(0.2, 0.2), castShadow: false }));
  c.addMesh(buildInstanced(makeBushGeo('oceanForest', c.spec.seed + 15), createFoliageMaterial(c.timeU, 0.72), lush.filter((_, i) => i % 4 === 1), { sx: [0.8, 1.3], sy: [0.78, 1.22], sink: 0.06, tilt: 0.12, tint: jitter(0.2, 0.15) }));

  const reeds = scatterGrid(rng, ext, 2.3 * cellMul, (x, z) => {
    const dh = heightAt(x, z) - level;
    return dh > 0.02 && dh < 0.70 && c.slopeAt(x, z) < 0.45 ? 0.68 * c.landingFree(x, z) : 0;
  });
  c.lift(reeds);
  c.addMesh(buildInstanced(makeShoreReedsGeo(c.spec.seed + 21), createFoliageMaterial(c.timeU, 1.7, true), reeds, { sx: [0.85, 1.3], sy: [0.9, 1.4], sink: 0.06, tilt: 0.12, tint: jitter(0.18, 0.12), castShadow: false }));

  c.boulders(70, (x, z) => { const h = heightAt(x, z) - level; return h > -0.4 && h < 3 ? 0.07 : 0.005; }, [0.4, 1.4], c.rockTint);
  const pollen = createParticles({ count: 160, box: 120, height: 10, size: 0.7, color: new THREE.Color(0xfff3c0), drift: new THREE.Vector3(0, 0.15, 0), windDrift: 0.17, wobble: 2.0, additive: true, alpha: 0.5, seed: c.spec.seed });
  c.addLayer(pollen.points, pollen.uniforms, pollen);
}
