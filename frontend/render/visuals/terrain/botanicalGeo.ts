import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Noise2, mulberry32 } from './noise';

export type BotanicalGeo = THREE.BufferGeometry;

export const botanicalColor = (hexOrColor: number | THREE.Color): THREE.Color =>
  hexOrColor instanceof THREE.Color ? hexOrColor.clone() : new THREE.Color(hexOrColor);

/** Applies translation, Euler rotation, and scale in place to a sub-part geometry. */
export function xfBotanical(
  g: BotanicalGeo,
  pos: [number, number, number],
  scale: [number, number, number] = [1, 1, 1],
  rot: [number, number, number] = [0, 0, 0],
): BotanicalGeo {
  g.applyMatrix4(
    new THREE.Matrix4().compose(
      new THREE.Vector3(...pos),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)),
      new THREE.Vector3(...scale),
    ),
  );
  return g;
}

/**
 * Stamps per-face jittered vertex colors, top-down sunlight boost, and explicit `aBark` (`1` on woody stems/roots,
 * `0` on foliage/blossoms/rocks) onto a non-indexed sub-part geometry.
 */
export function paintBotanical(
  g: BotanicalGeo,
  color: THREE.Color,
  jitter = 0.08,
  topBoost = 0.35,
  seed = 1,
  bark = 0,
): BotanicalGeo {
  const out = g.index ? g.toNonIndexed() : g;
  out.deleteAttribute('uv');
  const p = out.getAttribute('position');
  const n = p.count;
  const col = new Float32Array(n * 3);
  const barkAttr = new Float32Array(n).fill(bark);
  const rng = mulberry32(seed);
  const box = new THREE.Box3().setFromBufferAttribute(p as THREE.BufferAttribute);
  const hgt = Math.max(1e-3, box.max.y - box.min.y);
  const tmp = new THREE.Color();
  for (let t = 0; t < n; t += 3) {
    const k = 1 + (rng() - 0.5) * 2 * jitter;
    for (let v = 0; v < 3; v++) {
      const y = (p.getY(t + v) - box.min.y) / hgt;
      tmp.copy(color).multiplyScalar(k * (1 + topBoost * (y - 0.5)));
      col[(t + v) * 3] = tmp.r;
      col[(t + v) * 3 + 1] = tmp.g;
      col[(t + v) * 3 + 2] = tmp.b;
    }
  }
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('aBark', new THREE.BufferAttribute(barkAttr, 1));
  out.computeVertexNormals();
  return out;
}

/** Displaced icosahedron blob used for organic tree crowns and rock boulders. */
export function makeBotanicalBlob(
  radius: number,
  detail: number,
  noise: Noise2,
  amp: number,
  seedOff: number,
): BotanicalGeo {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const d = 1 + amp * noise.n(x * 1.7 + seedOff, y * 1.7 + z * 1.3);
    p.setXYZ(i, x * d, y * d, z * d);
  }
  g.computeVertexNormals();
  return g;
}

/** Merges painted non-indexed sub-parts and computes normals + bounding volumes. */
export function mergeBotanicalParts(parts: readonly BotanicalGeo[]): BotanicalGeo {
  const m = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)))!;
  m.computeVertexNormals();
  m.computeBoundingBox();
  m.computeBoundingSphere();
  return m;
}

/** Shared per-instance brightness and warm/cool hue jitter callback for instanced props and flora. */
export const jitterBotanicalTint =
  (amt: number, hueShift = 0) =>
  (rv: number, c: THREE.Color): void => {
    const k = 1 + (rv - 0.5) * 2 * amt;
    c.setRGB(k * (1 + (rv - 0.5) * hueShift), k, k * (1 - (rv - 0.5) * hueShift));
  };
