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

export function buildForestRock(c: SurfaceContext) {
  const { rng, ext, level, heightAt, nz, terrain, cellMul } = c;
  const shallow = 0x3d8f94, deep = 0x123b4a;
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
    seed: c.spec.seed ^ 0x71e3,
    planetSpan: terrain.span,
    biomeKind: 'forestRock',
  });
  waterFauna.rebuild(shore);
  waterFauna.group.position.y = level;
  c.addLayer(waterFauna.group, {}, waterFauna);

  const forestN = (x: number, z: number) => smoothstep(-0.2, 0.3, nz.fbm(x * 0.035, z * 0.035, 3));
  const trees = scatterGrid(rng, ext, 2.1 * cellMul, (x, z) => {
    const h = heightAt(x, z);
    if (h < level + 0.65 || c.slopeAt(x, z) > 0.55) return 0;
    return (0.08 + 0.88 * forestN(x, z)) * c.landingFree(x, z);
  });
  c.lift(trees);
  for (const p of trees) {
    const stand = nz.fbm(p.x * 0.05 + 17, p.z * 0.05 - 11, 2);
    const mono = nz.n(p.x * 0.04, p.z * 0.04) > 0.15;
    const wetness = Math.max(0, 1 - (p.y - level) / 2.2);
    p.breedIndex = wetness > 0.55 ? 3 : mono ? (stand > 0 ? 0 : 2) : Math.floor(((p.r * 4) + (stand > 0 ? 0 : 1)) % 4);
    p.windMul = p.breedIndex === 3 ? 1.5 : p.breedIndex === 1 ? 1.3 : 0.85;
  }
  c.addMesh(
    buildInstanced(buildBiomeTreeAtlasGeo('forestRock', c.spec.seed), createFoliageMaterial(c.timeU, 0.72, false, true), trees, {
      sx: [0.56, 0.96], sy: [0.62, 1.15], sink: 0.10, tilt: 0.06, tint: jitter(0.20, 0.14), encodeBreedInColor: true,
    }),
  );

  // Ground flora: meadow grass tufts, wildflowers, bushes & shoreline reeds
  const meadow = scatterGrid(rng, ext, 2.8 * cellMul, (x, z) => {
    const h = heightAt(x, z);
    return h > level + 0.35 && c.slopeAt(x, z) < 0.48 ? 0.52 * c.landingFree(x, z) : 0;
  });
  c.lift(meadow);
  c.addMesh(buildInstanced(makeGrassTuftGeo('forestRock', c.spec.seed + 3), createFoliageMaterial(c.timeU, 1.35, true), meadow, { sx: [0.7, 1.25], sy: [0.7, 1.35], sink: 0.03, tilt: 0.14, tint: jitter(0.22, 0.16), castShadow: false }));

  const flowers = meadow.filter((_, i) => i % 3 === 0);
  c.addMesh(buildInstanced(makeWildflowerGeo('forestRock', c.spec.seed + 7), createFoliageMaterial(c.timeU, 1.15, true), flowers, { sx: [0.8, 1.2], sy: [0.8, 1.25], sink: 0.03, tilt: 0.10, tint: jitter(0.2, 0.18), castShadow: false }));

  const bushes = meadow.filter((_, i) => i % 5 === 1);
  c.addMesh(buildInstanced(makeBushGeo('forestRock', c.spec.seed + 11), createFoliageMaterial(c.timeU, 0.65), bushes, { sx: [0.75, 1.25], sy: [0.75, 1.18], sink: 0.06, tilt: 0.12, tint: jitter(0.2, 0.12) }));

  const reeds = scatterGrid(rng, ext, 2.4 * cellMul, (x, z) => {
    const dh = heightAt(x, z) - level;
    return dh > 0.02 && dh < 0.65 && c.slopeAt(x, z) < 0.45 ? 0.65 * c.landingFree(x, z) : 0;
  });
  c.lift(reeds);
  c.addMesh(buildInstanced(makeShoreReedsGeo(c.spec.seed + 19), createFoliageMaterial(c.timeU, 1.65, true), reeds, { sx: [0.8, 1.25], sy: [0.85, 1.35], sink: 0.06, tilt: 0.12, tint: jitter(0.18, 0.1), castShadow: false }));

  c.boulders(260, (x, z) => 0.06 + Math.min(0.4, c.slopeAt(x, z) * 0.35), [0.5, 2.0], c.rockTint, 3);
  c.spires((x, z) => (c.slopeAt(x, z) > 0.45 ? 0.35 : 0.01), 40, [0.7, 1.5], [3, 8], c.rockTint);
  const motes = createParticles({ count: 140, box: 120, height: 12, size: 0.55, color: new THREE.Color(0xe8f2c0), drift: new THREE.Vector3(0, 0.1, 0), windDrift: 0.1, wobble: 2.5, additive: true, alpha: 0.4, seed: c.spec.seed });
  c.addLayer(motes.points, motes.uniforms, motes);
}
