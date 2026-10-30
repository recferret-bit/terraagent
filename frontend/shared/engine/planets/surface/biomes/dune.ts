import * as THREE from 'three';
import type { SurfaceContext } from '../SurfaceContext';
import { jitter } from '../SurfaceContext';
import { createParticles } from '../../../visuals/terrain/Particles';
import { buildInstanced, makeBoulderGeo, type Place } from '../../../visuals/terrain/Scatter';

export function buildDune(c: SurfaceContext) {
  const { rng, ext } = c;
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
  c.spires((x, z) => (c.nz.n(x * 0.05, z * 0.05) > 0.45 ? 0.5 : 0), 24, [0.5, 1.0], [2.5, 6], c.rockTint.clone().lerp(new THREE.Color(c.palette.groundLow), 0.25));
  const dust = createParticles({ count: 900, box: 150, height: 9, size: 1.5, color: new THREE.Color(0xf0cf9a), drift: new THREE.Vector3(c.field.wind[0] * 3.2, 0.05, c.field.wind[1] * 3.2), wobble: 1.5, additive: false, alpha: 0.18, seed: c.spec.seed });
  c.addLayer(dust.points, dust.uniforms, dust);
}
