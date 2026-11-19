import * as THREE from 'three';
import type { SurfaceContext } from '../SurfaceContext';
import { jitter } from '../SurfaceContext';
import { createWater } from '../../../visuals/terrain/Liquids';
import { createParticles } from '../../../visuals/terrain/Particles';
import { smoothstep } from '../../../visuals/terrain/noise';
import { scatterGrid, buildInstanced, createFoliageMaterial } from '../../../visuals/terrain/Scatter';
import { buildBiomeTreeAtlasGeo } from '../../../visuals/terrain/treeBreeds';
import { applySurfaceForestPipeline } from '../../hex/flora/forestPipeline';
import { filterSurfacePlacesWithExclusion, SpatialExclusionGrid } from '../../hex/flora/floraPlacementPipeline';
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
  c.waterFauna = waterFauna;
  c.addLayer(waterFauna.group, {}, waterFauna);

  const grid = new SpatialExclusionGrid(2.4);
  const boulderPlaces = c.boulders(260, (x, z) => 0.06 + Math.min(0.4, c.slopeAt(x, z) * 0.35), [0.5, 2.0], c.rockTint, 3);
  for (const p of boulderPlaces) grid.insert(p.x, p.z, 1.1, 'boulder');
  const spirePlaces = c.spires((x, z) => (c.slopeAt(x, z) > 0.45 ? 0.35 : 0.01), 40, [0.7, 1.5], [3, 8], c.rockTint);
  for (const p of spirePlaces) grid.insert(p.x, p.z, 1.1, 'spire');

  const forestN = (x: number, z: number) => smoothstep(-0.2, 0.3, nz.fbm(x * 0.035, z * 0.035, 3));
  const treeCandidates = scatterGrid(rng, ext, 2.0 * cellMul, (x, z) => {
    const h = heightAt(x, z);
    if (h < level + 0.45 || c.slopeAt(x, z) > 0.55) return 0;
    return (0.08 + 0.88 * forestN(x, z)) * c.landingFree(x, z);
  });
  c.lift(treeCandidates);
  const trees = filterSurfacePlacesWithExclusion(
    grid,
    applySurfaceForestPipeline(treeCandidates, 'forestRock', c.spec.seed, level),
    1.35,
    1.9,
    'pine',
  );
  c.addMesh(
    buildInstanced(buildBiomeTreeAtlasGeo('forestRock', c.spec.seed), createFoliageMaterial(c.timeU, 0.72, false, true), trees, {
      sx: [0.56, 0.90], sy: [0.60, 1.06], sink: 0.10, tilt: 0.06, tint: jitter(0.20, 0.14), encodeBreedInColor: true,
    }),
  );

  // Ground flora: shoreline reeds, bushes, wildflowers & meadow grass tufts without overlap
  const reedsRaw = scatterGrid(rng, ext, 2.4 * cellMul, (x, z) => {
    const dh = heightAt(x, z) - level;
    return dh > 0.02 && dh < 0.65 && c.slopeAt(x, z) < 0.45 ? 0.65 * c.landingFree(x, z) : 0;
  });
  c.lift(reedsRaw);
  const reeds = filterSurfacePlacesWithExclusion(grid, reedsRaw, 0.65, 1.1, 'reeds');
  c.addMesh(buildInstanced(makeShoreReedsGeo(c.spec.seed + 19), createFoliageMaterial(c.timeU, 1.65, true), reeds, { sx: [0.8, 1.25], sy: [0.85, 1.35], sink: 0.06, tilt: 0.12, tint: jitter(0.18, 0.1), castShadow: false }));

  const bushRaw = scatterGrid(rng, ext, 3.8 * cellMul, (x, z) => {
    const h = heightAt(x, z);
    return h > level + 0.35 && c.slopeAt(x, z) < 0.48 ? 0.28 * c.landingFree(x, z) : 0;
  });
  c.lift(bushRaw);
  const bushes = filterSurfacePlacesWithExclusion(grid, bushRaw, 0.85, 1.7, 'bush');
  c.addMesh(buildInstanced(makeBushGeo('forestRock', c.spec.seed + 11), createFoliageMaterial(c.timeU, 0.65), bushes, { sx: [0.75, 1.25], sy: [0.75, 1.18], sink: 0.06, tilt: 0.12, tint: jitter(0.2, 0.12) }));

  const flowersRaw = scatterGrid(rng, ext, 3.2 * cellMul, (x, z) => {
    const h = heightAt(x, z);
    return h > level + 0.35 && c.slopeAt(x, z) < 0.48 ? 0.32 * c.landingFree(x, z) : 0;
  });
  c.lift(flowersRaw);
  const flowers = filterSurfacePlacesWithExclusion(grid, flowersRaw, 0.55, 1.1, 'wildflower');
  c.addMesh(buildInstanced(makeWildflowerGeo('forestRock', c.spec.seed + 7), createFoliageMaterial(c.timeU, 1.15, true), flowers, { sx: [0.8, 1.2], sy: [0.8, 1.25], sink: 0.03, tilt: 0.10, tint: jitter(0.2, 0.18), castShadow: false }));

  const meadowRaw = scatterGrid(rng, ext, 2.6 * cellMul, (x, z) => {
    const h = heightAt(x, z);
    return h > level + 0.35 && c.slopeAt(x, z) < 0.48 ? 0.54 * c.landingFree(x, z) : 0;
  });
  c.lift(meadowRaw);
  const meadow = filterSurfacePlacesWithExclusion(grid, meadowRaw, 0.50, 0.95, 'grassTuft');
  c.addMesh(buildInstanced(makeGrassTuftGeo('forestRock', c.spec.seed + 3), createFoliageMaterial(c.timeU, 1.35, true), meadow, { sx: [0.7, 1.25], sy: [0.7, 1.35], sink: 0.03, tilt: 0.14, tint: jitter(0.22, 0.16), castShadow: false }));

  const motes = createParticles({ count: 140, box: 120, height: 12, size: 0.55, color: new THREE.Color(0xe8f2c0), drift: new THREE.Vector3(0, 0.1, 0), windDrift: 0.1, wobble: 2.5, additive: true, alpha: 0.4, seed: c.spec.seed });
  c.addLayer(motes.points, motes.uniforms, motes);
}
