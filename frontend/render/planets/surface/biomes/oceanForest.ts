import * as THREE from 'three';
import type { SurfaceContext } from '../SurfaceContext';
import { jitter } from '../SurfaceContext';
import { createParticles } from '../../../visuals/terrain/Particles';
import { smoothstep } from '../../../visuals/terrain/noise';
import { scatterGrid, buildInstanced, createFoliageMaterial } from '../../../visuals/terrain/Scatter';
import { buildBiomeTreeAtlasGeo } from '../../../visuals/terrain/treeBreeds';
import { applySurfaceForestPipeline } from '../../hex/flora/forestPipeline';
import { filterSurfacePlacesWithExclusion, SpatialExclusionGrid } from '../../hex/flora/floraPlacementPipeline';
import { buildGroundFloraAtlasGeo } from '../../../visuals/terrain/groundFloraGeos';
import { addCompatibleSurfaceFlora, canFitSurfaceObjectAt, mountSurfaceHydroLayer } from '../surfaceHelpers';

export function buildOceanForest(c: SurfaceContext) {
  const { rng, ext, level, heightAt, nz, palette: P, cellMul } = c;
  const shallow = P.water ?? 0x1f9fb8;
  const deep = P.waterDeep ?? 0x0b3f66;
  mountSurfaceHydroLayer(c, shallow, deep, 'oceanForest', 0x55a9);

  const forestN = (x: number, z: number) => smoothstep(-0.25, 0.25, nz.fbm(x * 0.03, z * 0.03, 3));
  const grid = new SpatialExclusionGrid(2.4);
  const boulderPlaces = c.boulders(70, (x, z) => {
    if (!canFitSurfaceObjectAt(c, 'oceanForest', level, 'boulder', x, z, forestN(x, z), 1.90)) return 0;
    const h = heightAt(x, z) - level;
    return h < 3 ? 0.07 : 0.015;
  }, [0.4, 1.4], c.rockTint);
  for (const p of boulderPlaces) grid.insert(p.x, p.z, 1.0, 'boulder');

  const treeCandidates = scatterGrid(rng, ext, 2.15 * cellMul, (x, z) => {
    const fd = forestN(x, z);
    if (!canFitSurfaceObjectAt(c, 'oceanForest', level, 'pine', x, z, Math.max(0.46, fd))) return 0;
    const h = heightAt(x, z) - level;
    return (h < 1.6 ? 0.40 : 0.14 + 0.84 * fd) * c.landingFree(x, z);
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

  // Tropical ground cover fitted via shared substrate rules (no bushes, wildflowers, or grass tufts on coastal sand)
  addCompatibleSurfaceFlora(c, grid, 'oceanForest', level, {
    kind: 'reeds', cell: 2.3, prob: 0.68, radius: 0.65, sameKindDist: 1.1,
    geo: buildGroundFloraAtlasGeo('reeds', 'oceanForest', c.spec.seed + 21), sway: 1.7, doubleSided: true,
    instOpts: { sx: [0.85, 1.3], sy: [0.9, 1.4], sink: 0.06, tilt: 0.12, tint: jitter(0.18, 0.12), castShadow: false },
  }, forestN);

  addCompatibleSurfaceFlora(c, grid, 'oceanForest', level, {
    kind: 'bush', cell: 3.6, prob: 0.34, radius: 0.85, sameKindDist: 1.7,
    geo: buildGroundFloraAtlasGeo('bush', 'oceanForest', c.spec.seed + 15), sway: 0.72,
    instOpts: { sx: [0.8, 1.3], sy: [0.78, 1.22], sink: 0.06, tilt: 0.12, tint: jitter(0.2, 0.15) },
  }, forestN);

  addCompatibleSurfaceFlora(c, grid, 'oceanForest', level, {
    kind: 'wildflower', cell: 3.1, prob: 0.38, radius: 0.55, sameKindDist: 1.1,
    geo: buildGroundFloraAtlasGeo('wildflower', 'oceanForest', c.spec.seed + 9), sway: 1.2, doubleSided: true,
    instOpts: { sx: [0.85, 1.25], sy: [0.85, 1.3], sink: 0.03, tilt: 0.12, tint: jitter(0.2, 0.2), castShadow: false },
  }, forestN);

  addCompatibleSurfaceFlora(c, grid, 'oceanForest', level, {
    kind: 'grassTuft', cell: 2.5, prob: 0.60, radius: 0.56, sameKindDist: 0.95,
    geo: buildGroundFloraAtlasGeo('grassTuft', 'oceanForest', c.spec.seed + 5), sway: 1.4, doubleSided: true,
    instOpts: { sx: [0.75, 1.3], sy: [0.75, 1.4], sink: 0.03, tilt: 0.14, tint: jitter(0.22, 0.18), castShadow: false },
  }, forestN);

  const pollen = createParticles({
    count: 160, box: 120, height: 10, size: 0.7, color: new THREE.Color(0xfff3c0),
    drift: new THREE.Vector3(0, 0.15, 0), windDrift: 0.17, wobble: 2.0, additive: true, alpha: 0.5, seed: c.spec.seed,
  });
  c.addLayer(pollen.points, pollen.uniforms, pollen);
}
