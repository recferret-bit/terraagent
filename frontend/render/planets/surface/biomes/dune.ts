import * as THREE from 'three';
import type { SurfaceContext } from '../SurfaceContext';
import { jitter } from '../SurfaceContext';
import { createParticles } from '../../../visuals/terrain/Particles';
import {
  buildInstanced,
  createFoliageMaterial,
  makeBoulderGeo,
  scatterGrid,
  type Place,
} from '../../../visuals/terrain/Scatter';
import { buildBiomeTreeAtlasGeo } from '../../../visuals/terrain/treeBreeds';
import { applySurfaceForestPipeline } from '../../hex/flora/forestPipeline';
import { filterSurfacePlacesWithExclusion, SpatialExclusionGrid } from '../../hex/flora/floraPlacementPipeline';
import { buildGroundFloraAtlasGeo } from '../../../visuals/terrain/groundFloraGeos';
import { addCompatibleSurfaceFlora, canFitSurfaceObjectAt } from '../surfaceHelpers';

export function buildDune(c: SurfaceContext) {
  const { rng, ext, heightAt, nz, cellMul } = c;
  const grid = new SpatialExclusionGrid(2.2);
  // rust-red rock clusters
  const cl: Place[] = [];
  for (let k0 = 0; k0 < 26; k0++) {
    const a = rng() * Math.PI * 2;
    const r = 13 + rng() * (ext - 16);
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const n = 4 + Math.floor(rng() * 8);
    for (let k = 0; k < n; k++) {
      const aa = rng() * Math.PI * 2;
      const rr = Math.pow(rng(), 0.7) * 3.2;
      cl.push({ x: cx + Math.cos(aa) * rr, z: cz + Math.sin(aa) * rr, y: 0, rot: rng() * 6.28, s: Math.pow(rng(), 2.2), r: rng() });
    }
  }
  const places = cl.filter((p) => c.landingFree(p.x, p.z) > 0.5 && canFitSurfaceObjectAt(c, 'dune', null, 'boulder', p.x, p.z));
  c.lift(places);
  for (const p of places) grid.insert(p.x, p.z, 1.0, 'boulder');
  for (let v = 0; v < 5; v++) {
    const sub = places.filter((_, i) => i % 5 === v);
    c.addMesh(
      buildInstanced(makeBoulderGeo(21 + v * 4 + (c.spec.seed % 11), c.rockTint.clone().lerp(c.darkTint, (v % 3) * 0.22), v), c.rockMat, sub, {
        sx: [0.35, 2.3], sy: [0.3, 1.8], sink: 0.2, tilt: 0.4, tint: jitter(0.3, 0.2),
      }),
    );
  }
  const spires = c.spires(
    (x, z) => (canFitSurfaceObjectAt(c, 'dune', null, 'spire', x, z) && nz.n(x * 0.05, z * 0.05) > 0.15 ? 0.55 : 0),
    24,
    [0.5, 1.0],
    [2.5, 6],
    c.rockTint.clone().lerp(new THREE.Color(c.palette.groundLow), 0.25),
  );
  for (const p of spires) grid.insert(p.x, p.z, 1.0, 'spire');

  // Desert endemic trees via the shared 4-stage Forest Generation Pipeline + compatibility check
  const duneCandidates = scatterGrid(rng, ext, 5.0 * cellMul, (x, z) => {
    if (!canFitSurfaceObjectAt(c, 'dune', null, 'duneTree', x, z)) return 0;
    const oasis = nz.fbm(x * 0.032 + 11, z * 0.032 - 7, 2);
    const lowWadi = heightAt(x, z) < 0.85 ? 0.28 : 0;
    return (oasis + lowWadi > 0.16 ? 0.65 : 0.18) * c.landingFree(x, z);
  });
  c.lift(duneCandidates);
  const duneTrees = filterSurfacePlacesWithExclusion(
    grid,
    applySurfaceForestPipeline(duneCandidates, 'dune', c.spec.seed, null),
    1.3,
    2.2,
    'duneTree',
  );
  c.addMesh(
    buildInstanced(buildBiomeTreeAtlasGeo('dune', c.spec.seed + 31), createFoliageMaterial(c.timeU, 0.80, true, true), duneTrees, {
      sx: [0.58, 0.94], sy: [0.62, 1.05], sink: 0.10, tilt: 0.08, tint: jitter(0.16, 0.08), encodeBreedInColor: true,
    }),
  );

  // Desert cacti, thorny scrub bushes & dry bunchgrass fitted via shared substrate rules
  addCompatibleSurfaceFlora(c, grid, 'dune', null, {
    kind: 'saguaro', cell: 5.4, prob: 0.42, radius: 0.90, sameKindDist: 2.4,
    geo: buildGroundFloraAtlasGeo('saguaro', 'dune', c.spec.seed + 41), sway: 0.18,
    extraProb: (x, z) => (nz.n(x * 0.04 - 5, z * 0.04 + 9) > 0.05 ? 1 : 0),
    instOpts: { sx: [0.8, 1.35], sy: [0.85, 1.5], sink: 0.08, tilt: 0.08, tint: jitter(0.16, 0.08) },
  });

  addCompatibleSurfaceFlora(c, grid, 'dune', null, {
    kind: 'barrelCactus', cell: 4.4, prob: 0.28, radius: 0.65, sameKindDist: 1.7,
    geo: buildGroundFloraAtlasGeo('barrelCactus', 'dune', c.spec.seed + 47), sway: 0.12,
    instOpts: { sx: [0.8, 1.35], sy: [0.8, 1.3], sink: 0.06, tilt: 0.15, tint: jitter(0.18, 0.1) },
  });

  addCompatibleSurfaceFlora(c, grid, 'dune', null, {
    kind: 'bush', cell: 4.2, prob: 0.30, radius: 0.85, sameKindDist: 1.8,
    geo: buildGroundFloraAtlasGeo('bush', 'dune', c.spec.seed + 53), sway: 0.60,
    instOpts: { sx: [0.75, 1.25], sy: [0.75, 1.15], sink: 0.06, tilt: 0.14, tint: jitter(0.2, 0.12) },
  });

  addCompatibleSurfaceFlora(c, grid, 'dune', null, {
    kind: 'grassTuft', cell: 3.2, prob: 0.36, radius: 0.50, sameKindDist: 1.0,
    geo: buildGroundFloraAtlasGeo('grassTuft', 'dune', c.spec.seed + 59), sway: 1.25, doubleSided: true,
    instOpts: { sx: [0.7, 1.2], sy: [0.7, 1.25], sink: 0.03, tilt: 0.14, tint: jitter(0.2, 0.14), castShadow: false },
  });

  const dust = createParticles({
    count: 900, box: 150, height: 9, size: 1.5, color: new THREE.Color(0xf0cf9a),
    drift: new THREE.Vector3(0, 0.05, 0), windDrift: 0.65, wobble: 1.5, additive: false, alpha: 0.18, seed: c.spec.seed,
  });
  c.addLayer(dust.points, dust.uniforms, dust);
}
