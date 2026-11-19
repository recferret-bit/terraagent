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
import {
  makeBarrelCactusGeo,
  makeBushGeo,
  makeGrassTuftGeo,
  makeSaguaroCactusGeo,
} from '../../../visuals/terrain/groundFloraGeos';

export function buildDune(c: SurfaceContext) {
  const { rng, ext, heightAt, nz, cellMul } = c;
  // rust-red rock clusters
  const cl: Place[] = [];
  for (let k0 = 0; k0 < 26; k0++) {
    const a = rng() * Math.PI * 2, r = 13 + rng() * (ext - 16);
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    const n = 4 + Math.floor(rng() * 8);
    for (let k = 0; k < n; k++) {
      const aa = rng() * Math.PI * 2, rr = Math.pow(rng(), 0.7) * 3.2;
      cl.push({ x: cx + Math.cos(aa) * rr, z: cz + Math.sin(aa) * rr, y: 0, rot: rng() * 6.28, s: Math.pow(rng(), 2.2), r: rng() });
    }
  }
  const places = cl.filter((p) => c.landingFree(p.x, p.z) > 0.5 && c.slopeAt(p.x, p.z) < 1.1);
  c.lift(places);
  for (let v = 0; v < 3; v++) {
    const sub = places.filter((_, i) => i % 3 === v);
    c.addMesh(buildInstanced(makeBoulderGeo(21 + v * 4, c.rockTint.clone().lerp(c.darkTint, v * 0.22)), c.rockMat, sub, { sx: [0.35, 2.3], sy: [0.3, 1.8], sink: 0.2, tilt: 0.4, tint: jitter(0.3, 0.2) }));
  }
  c.spires((x, z) => (nz.n(x * 0.05, z * 0.05) > 0.45 ? 0.5 : 0), 24, [0.5, 1.0], [2.5, 6], c.rockTint.clone().lerp(new THREE.Color(c.palette.groundLow), 0.25));

  // Desert endemic trees via the shared 4-stage Forest Generation Pipeline:
  // Oasis Date Palms in low wadi basins, Sun-Bleached Dry Snags & Joshua-Acacias on dry ridges
  const duneCandidates = scatterGrid(rng, ext, 5.0 * cellMul, (x, z) => {
    if (c.slopeAt(x, z) > 0.52) return 0;
    const oasis = nz.fbm(x * 0.032 + 11, z * 0.032 - 7, 2);
    const lowWadi = heightAt(x, z) < 0.85 ? 0.28 : 0;
    return (oasis + lowWadi > 0.22 ? 0.58 : 0.07) * c.landingFree(x, z);
  });
  c.lift(duneCandidates);
  const duneTrees = applySurfaceForestPipeline(duneCandidates, 'dune', c.spec.seed, null);
  c.addMesh(
    buildInstanced(buildBiomeTreeAtlasGeo('dune', c.spec.seed + 31), createFoliageMaterial(c.timeU, 0.80, true, true), duneTrees, {
      sx: [0.58, 0.94], sy: [0.62, 1.05], sink: 0.10, tilt: 0.08, tint: jitter(0.16, 0.08), encodeBreedInColor: true,
    }),
  );

  // Desert cacti, thorny scrub bushes & dry bunchgrass
  const saguaros = scatterGrid(rng, ext, 5.8 * cellMul, (x, z) =>
    c.slopeAt(x, z) < 0.55 && nz.n(x * 0.04 - 5, z * 0.04 + 9) > 0.05 ? 0.38 * c.landingFree(x, z) : 0,
  );
  c.lift(saguaros);
  c.addMesh(buildInstanced(makeSaguaroCactusGeo(c.spec.seed + 41), createFoliageMaterial(c.timeU, 0.18), saguaros, { sx: [0.8, 1.35], sy: [0.85, 1.5], sink: 0.08, tilt: 0.08, tint: jitter(0.16, 0.08) }));

  const barrels = scatterGrid(rng, ext, 4.6 * cellMul, (x, z) =>
    c.slopeAt(x, z) < 0.65 ? 0.26 * c.landingFree(x, z) : 0,
  );
  c.lift(barrels);
  c.addMesh(buildInstanced(makeBarrelCactusGeo(c.spec.seed + 47), createFoliageMaterial(c.timeU, 0.12), barrels, { sx: [0.8, 1.35], sy: [0.8, 1.3], sink: 0.06, tilt: 0.15, tint: jitter(0.18, 0.1) }));

  const scrub = scatterGrid(rng, ext, 3.8 * cellMul, (x, z) =>
    c.slopeAt(x, z) < 0.58 ? 0.34 * c.landingFree(x, z) : 0,
  );
  c.lift(scrub);
  c.addMesh(buildInstanced(makeBushGeo('dune', c.spec.seed + 53), createFoliageMaterial(c.timeU, 0.60), scrub.filter((_, i) => i % 2 === 0), { sx: [0.75, 1.25], sy: [0.75, 1.15], sink: 0.06, tilt: 0.14, tint: jitter(0.2, 0.12) }));
  c.addMesh(buildInstanced(makeGrassTuftGeo('dune', c.spec.seed + 59), createFoliageMaterial(c.timeU, 1.25, true), scrub, { sx: [0.7, 1.2], sy: [0.7, 1.25], sink: 0.03, tilt: 0.14, tint: jitter(0.2, 0.14), castShadow: false }));

  const dust = createParticles({ count: 900, box: 150, height: 9, size: 1.5, color: new THREE.Color(0xf0cf9a), drift: new THREE.Vector3(0, 0.05, 0), windDrift: 0.65, wobble: 1.5, additive: false, alpha: 0.18, seed: c.spec.seed });
  c.addLayer(dust.points, dust.uniforms, dust);
}
