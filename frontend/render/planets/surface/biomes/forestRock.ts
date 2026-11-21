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

export function buildForestRock(c: SurfaceContext) {
  const { rng, ext, level, nz, cellMul } = c;
  mountSurfaceHydroLayer(c, 0x3d8f94, 0x123b4a, 'forestRock', 0x71e3);

  const forestN = (x: number, z: number) => smoothstep(-0.2, 0.3, nz.fbm(x * 0.035, z * 0.035, 3));
  const grid = new SpatialExclusionGrid(2.4);
  const boulderPlaces = c.boulders(260, (x, z) => {
    if (!canFitSurfaceObjectAt(c, 'forestRock', level, 'boulder', x, z, forestN(x, z), 2.60)) return 0;
    return 0.06 + Math.min(0.4, c.slopeAt(x, z) * 0.35);
  }, [0.5, 2.0], c.rockTint, 5);
  for (const p of boulderPlaces) grid.insert(p.x, p.z, 1.1, 'boulder');
  const spirePlaces = c.spires((x, z) => (canFitSurfaceObjectAt(c, 'forestRock', level, 'spire', x, z, 0, 1.85) ? 0.35 : 0), 40, [0.7, 1.5], [3, 8], c.rockTint);
  for (const p of spirePlaces) grid.insert(p.x, p.z, 1.1, 'spire');

  const treeCandidates = scatterGrid(rng, ext, 2.0 * cellMul, (x, z) => {
    const fd = forestN(x, z);
    if (!canFitSurfaceObjectAt(c, 'forestRock', level, 'pine', x, z, Math.max(0.46, fd))) return 0;
    return (0.08 + 0.88 * fd) * c.landingFree(x, z);
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

  // Ground flora fitted via shared substrate rules (no bushes, wildflowers, or grass tufts on coastal sand)
  addCompatibleSurfaceFlora(c, grid, 'forestRock', level, {
    kind: 'reeds', cell: 2.4, prob: 0.65, radius: 0.65, sameKindDist: 1.1,
    geo: buildGroundFloraAtlasGeo('reeds', 'forestRock', c.spec.seed + 19), sway: 1.65, doubleSided: true,
    instOpts: { sx: [0.8, 1.25], sy: [0.85, 1.35], sink: 0.06, tilt: 0.12, tint: jitter(0.18, 0.1), castShadow: false },
  }, forestN);

  addCompatibleSurfaceFlora(c, grid, 'forestRock', level, {
    kind: 'bush', cell: 3.8, prob: 0.28, radius: 0.85, sameKindDist: 1.7,
    geo: buildGroundFloraAtlasGeo('bush', 'forestRock', c.spec.seed + 11), sway: 0.65,
    instOpts: { sx: [0.75, 1.25], sy: [0.75, 1.18], sink: 0.06, tilt: 0.12, tint: jitter(0.2, 0.12) },
  }, forestN);

  addCompatibleSurfaceFlora(c, grid, 'forestRock', level, {
    kind: 'wildflower', cell: 3.2, prob: 0.32, radius: 0.55, sameKindDist: 1.1,
    geo: buildGroundFloraAtlasGeo('wildflower', 'forestRock', c.spec.seed + 7), sway: 1.15, doubleSided: true,
    instOpts: { sx: [0.8, 1.2], sy: [0.8, 1.25], sink: 0.03, tilt: 0.10, tint: jitter(0.2, 0.18), castShadow: false },
  }, forestN);

  addCompatibleSurfaceFlora(c, grid, 'forestRock', level, {
    kind: 'grassTuft', cell: 2.6, prob: 0.54, radius: 0.56, sameKindDist: 0.95,
    geo: buildGroundFloraAtlasGeo('grassTuft', 'forestRock', c.spec.seed + 3), sway: 1.35, doubleSided: true,
    instOpts: { sx: [0.7, 1.25], sy: [0.7, 1.35], sink: 0.03, tilt: 0.14, tint: jitter(0.22, 0.16), castShadow: false },
  }, forestN);

  const motes = createParticles({
    count: 140, box: 120, height: 12, size: 0.55, color: new THREE.Color(0xe8f2c0),
    drift: new THREE.Vector3(0, 0.1, 0), windDrift: 0.1, wobble: 2.5, additive: true, alpha: 0.4, seed: c.spec.seed,
  });
  c.addLayer(motes.points, motes.uniforms, motes);
}
