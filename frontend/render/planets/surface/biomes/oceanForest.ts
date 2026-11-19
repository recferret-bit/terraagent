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
  c.waterFauna = waterFauna;
  c.addLayer(waterFauna.group, {}, waterFauna);

  const grid = new SpatialExclusionGrid(2.4);
  const boulderPlaces = c.boulders(70, (x, z) => { const h = heightAt(x, z) - level; return h > -0.4 && h < 3 ? 0.07 : 0.005; }, [0.4, 1.4], c.rockTint);
  for (const p of boulderPlaces) grid.insert(p.x, p.z, 1.0, 'boulder');

  const forestN = (x: number, z: number) => smoothstep(-0.25, 0.25, nz.fbm(x * 0.03, z * 0.03, 3));
  const treeCandidates = scatterGrid(rng, ext, 2.15 * cellMul, (x, z) => {
    const h = heightAt(x, z) - level;
    if (h < 0.30 || c.slopeAt(x, z) > 0.6) return 0;
    return (h < 1.6 ? 0.40 : 0.14 + 0.84 * forestN(x, z)) * c.landingFree(x, z);
  });
  c.lift(treeCandidates);
  const trees = filterSurfacePlacesWithExclusion(
    grid,
    applySurfaceForestPipeline(treeCandidates, 'oceanForest', c.spec.seed, level),
    1.35,
    1.9,
    'pine',
  );
  c.addMesh(
    buildInstanced(buildBiomeTreeAtlasGeo('oceanForest', c.spec.seed), createFoliageMaterial(c.timeU, 0.95, true, true), trees, {
      sx: [0.58, 0.94], sy: [0.62, 1.06], sink: 0.10, tilt: 0.08, tint: jitter(0.20, 0.20), encodeBreedInColor: true,
    }),
  );

  // Tropical ground cover: lagoon reeds, coastal shrubs, hibiscus/orchid blossoms & lush grass tufts (zero overlaps)
  const reedsRaw = scatterGrid(rng, ext, 2.3 * cellMul, (x, z) => {
    const dh = heightAt(x, z) - level;
    return dh > 0.02 && dh < 0.70 && c.slopeAt(x, z) < 0.45 ? 0.68 * c.landingFree(x, z) : 0;
  });
  c.lift(reedsRaw);
  const reeds = filterSurfacePlacesWithExclusion(grid, reedsRaw, 0.65, 1.1, 'reeds');
  c.addMesh(buildInstanced(makeShoreReedsGeo(c.spec.seed + 21), createFoliageMaterial(c.timeU, 1.7, true), reeds, { sx: [0.85, 1.3], sy: [0.9, 1.4], sink: 0.06, tilt: 0.12, tint: jitter(0.18, 0.12), castShadow: false }));

  const bushRaw = scatterGrid(rng, ext, 3.6 * cellMul, (x, z) => {
    const dh = heightAt(x, z) - level;
    return dh > 0.30 && c.slopeAt(x, z) < 0.50 ? 0.30 * c.landingFree(x, z) : 0;
  });
  c.lift(bushRaw);
  const bushes = filterSurfacePlacesWithExclusion(grid, bushRaw, 0.85, 1.7, 'bush');
  c.addMesh(buildInstanced(makeBushGeo('oceanForest', c.spec.seed + 15), createFoliageMaterial(c.timeU, 0.72), bushes, { sx: [0.8, 1.3], sy: [0.78, 1.22], sink: 0.06, tilt: 0.12, tint: jitter(0.2, 0.15) }));

  const flowersRaw = scatterGrid(rng, ext, 3.1 * cellMul, (x, z) => {
    const dh = heightAt(x, z) - level;
    return dh > 0.30 && c.slopeAt(x, z) < 0.50 ? 0.34 * c.landingFree(x, z) : 0;
  });
  c.lift(flowersRaw);
  const flowers = filterSurfacePlacesWithExclusion(grid, flowersRaw, 0.55, 1.1, 'wildflower');
  c.addMesh(buildInstanced(makeWildflowerGeo('oceanForest', c.spec.seed + 9), createFoliageMaterial(c.timeU, 1.2, true), flowers, { sx: [0.85, 1.25], sy: [0.85, 1.3], sink: 0.03, tilt: 0.12, tint: jitter(0.2, 0.2), castShadow: false }));

  const lushRaw = scatterGrid(rng, ext, 2.5 * cellMul, (x, z) => {
    const dh = heightAt(x, z) - level;
    return dh > 0.30 && c.slopeAt(x, z) < 0.50 ? 0.56 * c.landingFree(x, z) : 0;
  });
  c.lift(lushRaw);
  const lush = filterSurfacePlacesWithExclusion(grid, lushRaw, 0.50, 0.95, 'grassTuft');
  c.addMesh(buildInstanced(makeGrassTuftGeo('oceanForest', c.spec.seed + 5), createFoliageMaterial(c.timeU, 1.4, true), lush, { sx: [0.75, 1.3], sy: [0.75, 1.4], sink: 0.03, tilt: 0.14, tint: jitter(0.22, 0.18), castShadow: false }));

  const pollen = createParticles({ count: 160, box: 120, height: 10, size: 0.7, color: new THREE.Color(0xfff3c0), drift: new THREE.Vector3(0, 0.15, 0), windDrift: 0.17, wobble: 2.0, additive: true, alpha: 0.5, seed: c.spec.seed });
  c.addLayer(pollen.points, pollen.uniforms, pollen);
}
