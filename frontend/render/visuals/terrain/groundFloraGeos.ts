import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PlanetKind } from '../../planets/PlanetSpec';
import { Noise2, mulberry32 } from './noise';

/**
 * 3D low-poly botanical ground-cover geometries (never flat 2D sprite billboards — Pillar 1):
 * grass tufts, wildflowers/ferns, berry/scrub bushes, saguaro & barrel/prickly-pear cactuses, and shoreline reeds.
 */

type G = THREE.BufferGeometry;
const C = (hex: number) => new THREE.Color(hex);

function xf(g: G, pos: [number, number, number], scale: [number, number, number] = [1, 1, 1], rot: [number, number, number] = [0, 0, 0]): G {
  g.applyMatrix4(
    new THREE.Matrix4().compose(
      new THREE.Vector3(...pos),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)),
      new THREE.Vector3(...scale),
    ),
  );
  return g;
}

function paint(g: G, color: THREE.Color, jitter = 0.08, topBoost = 0.42, seed = 1): G {
  const out = g.index ? g.toNonIndexed() : g;
  out.deleteAttribute('uv');
  const p = out.getAttribute('position');
  const n = p.count;
  const col = new Float32Array(n * 3);
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
  out.computeVertexNormals();
  return out;
}

const mergeAll = (parts: G[]) => {
  const m = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)))!;
  m.computeVertexNormals();
  m.computeBoundingBox();
  m.computeBoundingSphere();
  return m;
};

/** 3D multi-blade grass tuft (7 curved triangular-prism blades fanning outward). */
export function makeGrassTuftGeo(biome: PlanetKind, seed = 11): G {
  const baseHex = biome === 'dune' ? 0xb59b52 : biome === 'oceanForest' ? 0x4ca644 : 0x528a42;
  const tipHex = biome === 'dune' ? 0xd4be74 : biome === 'oceanForest' ? 0x76cc58 : 0x7ab356;
  const rng = mulberry32(seed);
  const parts: G[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + (rng() - 0.5) * 0.35;
    const dist = i === 0 ? 0 : 0.09 + rng() * 0.12;
    const h = 0.38 + rng() * 0.34;
    const lean = i === 0 ? 0.08 : 0.22 + rng() * 0.25;
    const cone = new THREE.ConeGeometry(0.055, h, 3, 2);
    const p = cone.getAttribute('position');
    for (let k = 0; k < p.count; k++) {
      const y01 = Math.max(0, (p.getY(k) + h / 2) / h);
      p.setZ(k, p.getZ(k) + y01 * y01 * lean * h);
      p.setY(k, p.getY(k) + h / 2 - 0.03);
    }
    cone.rotateY(a);
    cone.translate(Math.cos(a) * dist, 0, Math.sin(a) * dist);
    parts.push(paint(cone, i % 2 ? C(baseHex) : C(tipHex), 0.12, 0.55, seed + i));
  }
  return mergeAll(parts);
}

/** 3D wildflower & fern rosette clump for lush meadow hexes and forest edges. */
export function makeWildflowerGeo(biome: PlanetKind, seed = 23): G {
  const leafHex = biome === 'oceanForest' ? 0x359652 : biome === 'dune' ? 0x7c8c4a : 0x467f3d;
  const petalHex = biome === 'oceanForest' ? 0xff758f : biome === 'dune' ? 0xffbe0b : 0xf4d35e;
  const petalAlt = biome === 'oceanForest' ? 0x48cae4 : biome === 'dune' ? 0xfb8500 : 0xb5838d;
  const parts: G[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const frond = xf(new THREE.ConeGeometry(0.09, 0.42, 4, 1), [Math.cos(a) * 0.12, 0.12, Math.sin(a) * 0.12], [1.2, 1, 0.45], [0.85, a, 0]);
    parts.push(paint(frond, C(leafHex), 0.1, 0.4, seed + i));
  }
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    const x = Math.cos(a) * 0.09, z = Math.sin(a) * 0.09;
    const h = 0.36 + (i % 2) * 0.12;
    parts.push(paint(xf(new THREE.CylinderGeometry(0.016, 0.022, h, 4, 1), [x, h / 2 - 0.02, z]), C(leafHex), 0.08, 0.2, seed + 10 + i));
    parts.push(paint(xf(new THREE.IcosahedronGeometry(0.075, 0), [x, h + 0.02, z], [1.1, 0.65, 1.1]), C(i === 1 ? petalAlt : petalHex), 0.1, 0.45, seed + 20 + i));
  }
  return mergeAll(parts);
}

/** 3D multi-lobe shrub / berry bush / desert creosote scrub. */
export function makeBushGeo(biome: PlanetKind, seed = 37): G {
  const nz = new Noise2(seed);
  const foliageA = biome === 'dune' ? 0x8a8248 : biome === 'oceanForest' ? 0x2d8a48 : 0x3b7338;
  const foliageB = biome === 'dune' ? 0xa39656 : biome === 'oceanForest' ? 0x46a858 : 0x518c44;
  const berryHex = biome === 'dune' ? 0xd97724 : biome === 'oceanForest' ? 0xf72585 : 0xd62828;
  const parts: G[] = [
    paint(xf(new THREE.CylinderGeometry(0.05, 0.09, 0.28, 5, 1), [0, 0.10, 0]), C(0x583e2a), 0.1, 0.1, seed),
  ];
  const lobes: [number, number, number, number][] = [
    [0, 0.34, 0, 0.38], [0.24, 0.25, 0.14, 0.28], [-0.22, 0.26, -0.12, 0.30], [0.06, 0.24, -0.24, 0.26],
  ];
  lobes.forEach(([x, y, z, r], i) => {
    const g = new THREE.IcosahedronGeometry(r, 0);
    const p = g.getAttribute('position');
    for (let k = 0; k < p.count; k++) {
      const d = 1 + 0.22 * nz.n(p.getX(k) * 3 + i, p.getY(k) * 3 + p.getZ(k) * 2);
      p.setXYZ(k, p.getX(k) * d, p.getY(k) * d * 0.82, p.getZ(k) * d);
    }
    parts.push(paint(xf(g, [x, y, z]), C(i % 2 ? foliageA : foliageB), 0.10, 0.45, seed + 10 + i));
  });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    parts.push(paint(xf(new THREE.IcosahedronGeometry(0.048, 0), [Math.cos(a) * 0.24, 0.44, Math.sin(a) * 0.24]), C(berryHex), 0.08, 0.3, seed + 30 + i));
  }
  return mergeAll(parts);
}

/** Classic tall ribbed Saguaro cactus with two asymmetric arms and desert blossom crown. */
export function makeSaguaroCactusGeo(seed = 53): G {
  const green = C(0x4c7c44);
  const armCurveL = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.95, 0), new THREE.Vector3(0.36, 0.98, 0.04), new THREE.Vector3(0.42, 1.58, 0.04)]);
  const armCurveR = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 1.22, 0), new THREE.Vector3(-0.32, 1.26, -0.04), new THREE.Vector3(-0.36, 1.82, -0.04)]);
  const parts: G[] = [
    paint(xf(new THREE.CylinderGeometry(0.14, 0.17, 2.25, 8, 2), [0, 1.06, 0]), green, 0.09, 0.32, seed),
    paint(xf(new THREE.SphereGeometry(0.14, 8, 5), [0, 2.18, 0]), green, 0.08, 0.35, seed + 1),
    paint(new THREE.TubeGeometry(armCurveL, 5, 0.10, 7, false), C(0x55874b), 0.09, 0.32, seed + 2),
    paint(xf(new THREE.SphereGeometry(0.10, 7, 5), [0.42, 1.58, 0.04]), C(0x55874b), 0.08, 0.35, seed + 3),
    paint(new THREE.TubeGeometry(armCurveR, 5, 0.095, 7, false), C(0x487640), 0.09, 0.32, seed + 4),
    paint(xf(new THREE.SphereGeometry(0.095, 7, 5), [-0.36, 1.82, -0.04]), C(0x487640), 0.08, 0.35, seed + 5),
    paint(xf(new THREE.IcosahedronGeometry(0.075, 0), [0, 2.31, 0], [1.2, 0.65, 1.2]), C(0xffbe0b), 0.08, 0.4, seed + 6),
  ];
  return mergeAll(parts);
}

/** Clustered desert Barrel + Prickly-Pear paddle cactus. */
export function makeBarrelCactusGeo(seed = 67): G {
  const parts: G[] = [
    paint(xf(new THREE.SphereGeometry(0.28, 8, 6), [0, 0.22, 0], [1, 1.12, 1]), C(0x548248), 0.1, 0.35, seed),
    paint(xf(new THREE.IcosahedronGeometry(0.07, 0), [0, 0.52, 0], [1.2, 0.6, 1.2]), C(0xf77f00), 0.1, 0.4, seed + 1),
    paint(xf(new THREE.SphereGeometry(0.18, 7, 5), [0.28, 0.14, 0.16], [1, 1.05, 1]), C(0x608f50), 0.1, 0.35, seed + 2),
    paint(xf(new THREE.SphereGeometry(0.16, 7, 5), [-0.22, 0.32, 0.12], [1.1, 1.25, 0.38], [0.15, 0.4, -0.35]), C(0x5d8c4d), 0.1, 0.35, seed + 3),
  ];
  return mergeAll(parts);
}

/** Shoreline cattails & water reeds for wetland and lagoon margins. */
export function makeShoreReedsGeo(seed = 79): G {
  const rng = mulberry32(seed);
  const parts: G[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + (rng() - 0.5) * 0.3;
    const x = Math.cos(a) * (0.06 + rng() * 0.12);
    const z = Math.sin(a) * (0.06 + rng() * 0.12);
    const h = 0.72 + rng() * 0.42;
    const tilt = (rng() - 0.5) * 0.14;
    parts.push(paint(xf(new THREE.CylinderGeometry(0.015, 0.024, h, 4, 1), [x, h / 2 - 0.04, z], [1, 1, 1], [tilt, a, 0]), C(0x4d8b46), 0.1, 0.4, seed + i));
    if (i < 3) {
      parts.push(paint(xf(new THREE.CylinderGeometry(0.036, 0.036, 0.18, 5, 1), [x, h * 0.82, z], [1, 1, 1], [tilt, a, 0]), C(0x5e3b22), 0.08, 0.2, seed + 10 + i));
    }
  }
  return mergeAll(parts);
}
