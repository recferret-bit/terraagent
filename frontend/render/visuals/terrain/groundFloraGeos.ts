import * as THREE from 'three';
import type { PlanetKind } from '../../planets/PlanetSpec';
import {
  botanicalColor as C,
  makeBotanicalBlob as blob,
  mergeBotanicalParts as mergeAll,
  paintBotanical as paint,
  xfBotanical as xf,
  type BotanicalGeo as G,
} from './botanicalGeo';
import {
  buildBoulderAtlasGeo,
  buildSpireAtlasGeo,
  buildVariantAtlasGeo,
  clampGroundVariantBounds,
  GROUND_VARIANT_COUNT,
  makeBarrelCactusGeo,
  makeBoulderGeo,
  makeSaguaroCactusGeo,
  makeSpireGeo,
  normalizeGroundVariantIndex,
  type GroundVariantIndex,
} from './desertAndRockGeos';
import { Noise2, mulberry32 } from './noise';

export {
  buildBoulderAtlasGeo,
  buildSpireAtlasGeo,
  GROUND_VARIANT_COUNT,
  makeBarrelCactusGeo,
  makeBoulderGeo,
  makeSaguaroCactusGeo,
  makeSpireGeo,
  normalizeGroundVariantIndex,
  type GroundVariantIndex,
};

export type GroundFloraAtlasKind = 'grassTuft' | 'wildflower' | 'bush' | 'saguaro' | 'barrelCactus' | 'reeds';

function curvedBlade(rad: number, h: number, lean: number, a: number, dist: number, hex: number, seed: number): G {
  const cone = new THREE.ConeGeometry(rad, h, 3, 2);
  const p = cone.getAttribute('position');
  for (let k = 0; k < p.count; k++) {
    const y01 = Math.max(0, (p.getY(k) + h / 2) / h);
    p.setZ(k, p.getZ(k) + y01 * y01 * lean * h);
    p.setY(k, p.getY(k) + h / 2 - 0.03);
  }
  cone.rotateY(a);
  cone.translate(Math.cos(a) * dist, 0, Math.sin(a) * dist);
  return paint(cone, C(hex), 0.12, 0.55, seed);
}

/** 5 distinct low-poly 3D Grass Tuft & Sedge archetypes (`0..4`). */
export function makeGrassTuftGeo(biome: PlanetKind, seed = 11, variant = 0): G {
  const v = normalizeGroundVariantIndex(variant);
  const baseHex = biome === 'dune' ? 0xb59b52 : biome === 'oceanForest' ? 0x4ca644 : 0x528a42;
  const tipHex = biome === 'dune' ? 0xd4be74 : biome === 'oceanForest' ? 0x76cc58 : 0x7ab356;
  const plumeHex = biome === 'dune' ? 0xe6d49a : biome === 'oceanForest' ? 0xcde38a : 0xd9cd7e;
  const rng = mulberry32(seed + v * 31);
  const parts: G[] = [];
  const count = [7, 9, 9, 11, 8][v]!;
  for (let i = 0; i < count; i++) {
    const a = v === 4 ? (i / count) * 1.4 - 0.7 + 0.35 : (i / count) * Math.PI * 2 + (rng() - 0.5) * 0.35;
    const dist = i === 0 && v !== 3 ? 0 : (v === 2 ? 0.14 : v === 3 ? 0.12 : 0.09) + rng() * 0.12;
    const h = v === 1 ? 0.50 + rng() * 0.20 : v === 2 ? 0.28 + rng() * 0.18 : 0.38 + rng() * 0.30;
    const lean = v === 1 ? 0.08 + rng() * 0.12 : v === 2 ? 0.42 + rng() * 0.18 : v === 4 ? 0.48 : 0.22 + rng() * 0.22;
    parts.push(curvedBlade(v === 3 ? 0.048 : 0.055, h, lean, a, dist, i % 2 ? baseHex : tipHex, seed + i));
  }
  if (v === 1 || v === 4) {
    for (let i = 0; i < 3; i++) {
      const a = v === 4 ? (i - 1) * 0.35 + 0.35 : (i / 3) * Math.PI * 2 + 0.4;
      const sx = Math.cos(a) * 0.10, sz = Math.sin(a) * 0.10;
      const h = 0.56 + (i % 2) * 0.10;
      parts.push(paint(xf(new THREE.CylinderGeometry(0.012, 0.018, h, 4, 1), [sx, h / 2 - 0.03, sz]), C(tipHex), 0.1, 0.3, seed + 30 + i));
      parts.push(paint(xf(new THREE.ConeGeometry(0.034, 0.16, 4, 1), [sx, h + 0.04, sz], [1, 1, 1], [0, a, 0]), C(plumeHex), 0.1, 0.45, seed + 40 + i));
    }
  } else if (v === 3) {
    parts.push(paint(xf(new THREE.IcosahedronGeometry(0.14, 0), [0, 0.06, 0], [1.2, 0.55, 1.2]), C(baseHex), 0.12, 0.3, seed + 50));
  }
  return clampGroundVariantBounds(mergeAll(parts), 0.37, 0.72, -0.06, -0.02);
}

function radialLeaf(
  w: number,
  len: number,
  pitch: number,
  arch: number,
  a: number,
  baseR: number,
  hex: number,
  seed: number,
): G {
  const cone = new THREE.ConeGeometry(w, len, 4, 2);
  const p = cone.getAttribute('position');
  const ux = Math.cos(a), uz = Math.sin(a);
  const tx = -uz, tz = ux;
  const cP = Math.cos(pitch), sP = Math.sin(pitch);
  for (let k = 0; k < p.count; k++) {
    const vx = p.getX(k), vy = p.getY(k), vz = p.getZ(k);
    const s = Math.max(0, Math.min(1, (vy + len * 0.5) / len));
    const along = s * len;
    const taper = Math.min(1, 0.45 + s * 2.2);
    const u = vx * 1.15 * taper;
    const thick = vz * 0.22 * (1 - s * 0.5);
    const r = baseR + along * cP - thick * sP;
    const y = -0.025 + along * sP + thick * cP - arch * s * s;
    p.setXYZ(k, ux * r + tx * u, y, uz * r + tz * u);
  }
  cone.computeVertexNormals();
  return paint(cone, C(hex), 0.1, 0.42, seed);
}

function flowerBlossom(
  cx: number,
  cy: number,
  cz: number,
  r: number,
  petalHex: number,
  centerHex: number,
  seed: number,
  nPetals = 5,
): G[] {
  const out: G[] = [
    paint(xf(new THREE.OctahedronGeometry(r * 0.44, 0), [cx, cy + r * 0.14, cz], [1.1, 0.6, 1.1]), C(centerHex), 0.08, 0.35, seed),
  ];
  for (let p = 0; p < nPetals; p++) {
    const pa = (p / nPetals) * Math.PI * 2 + (seed % 7) * 0.2;
    out.push(paint(
      xf(
        new THREE.OctahedronGeometry(r * 0.42, 0),
        [cx + Math.cos(pa) * r * 0.58, cy + r * 0.04, cz + Math.sin(pa) * r * 0.58],
        [1.15, 0.44, 0.85],
        [0, -pa, 0],
      ),
      C(petalHex),
      0.09,
      0.45,
      seed + 1 + p,
    ));
  }
  return out;
}

/** 5 distinct low-poly 3D Wildflower & Fern archetypes (`0..4`). */
export function makeWildflowerGeo(biome: PlanetKind, seed = 23, variant = 0): G {
  const v = normalizeGroundVariantIndex(variant);
  const leafHex = biome === 'oceanForest' ? 0x359652 : biome === 'dune' ? 0x7c8c4a : 0x467f3d;
  const petalHex = biome === 'oceanForest' ? 0xff758f : biome === 'dune' ? 0xffbe0b : 0xf4d35e;
  const petalAlt = biome === 'oceanForest' ? 0x48cae4 : biome === 'dune' ? 0xfb8500 : 0xb5838d;
  const coreHex = biome === 'dune' ? 0xf77f00 : 0xffd166;
  const parts: G[] = [];
  const leafN = v === 4 ? 8 : 5;
  for (let i = 0; i < leafN; i++) {
    const a = (i / leafN) * Math.PI * 2 + 0.18;
    const len = v === 4 ? 0.31 : 0.26;
    const pitch = v === 4 ? 0.52 : 0.46;
    parts.push(radialLeaf(0.068, len, pitch, 0.08, a, 0.015, leafHex, seed + i));
  }
  if (v === 0 || v === 2) {
    const nHeads = v === 0 ? 3 : 5;
    for (let i = 0; i < nHeads; i++) {
      const a = (i / nHeads) * Math.PI * 2 + 0.4;
      const rad = i === 0 && v === 2 ? 0.02 : 0.095;
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      const h = (v === 2 ? 0.28 : 0.36) + (i % 2) * 0.11;
      parts.push(paint(xf(new THREE.CylinderGeometry(0.014, 0.020, h, 4, 1), [x, h / 2 - 0.02, z]), C(leafHex), 0.08, 0.2, seed + 10 + i));
      parts.push(...flowerBlossom(x, h, z, v === 2 ? 0.068 : 0.076, i % 2 ? petalAlt : petalHex, coreHex, seed + 20 + i * 7));
    }
  } else if (v === 1) {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.3;
      const x = Math.cos(a) * 0.085, z = Math.sin(a) * 0.085;
      const h = 0.50 + (i % 2) * 0.06;
      parts.push(paint(xf(new THREE.CylinderGeometry(0.014, 0.020, h, 4, 1), [x, h / 2 - 0.02, z]), C(leafHex), 0.08, 0.2, seed + 10 + i));
      for (let t = 0; t < 3; t++) {
        parts.push(...flowerBlossom(x, 0.23 + t * 0.11, z, 0.048 - t * 0.006, t === 1 ? petalAlt : petalHex, coreHex, seed + 20 + i * 9 + t * 3, 4));
      }
    }
  } else if (v === 3) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.45;
      const ux = Math.cos(a), uz = Math.sin(a);
      const tx = ux * 0.17, ty = 0.34, tz = uz * 0.17;
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(ux * 0.02, -0.03, uz * 0.02),
        new THREE.Vector3(ux * 0.06, 0.24, uz * 0.06),
        new THREE.Vector3(ux * 0.12, 0.38, uz * 0.12),
        new THREE.Vector3(tx, ty, tz),
      ]);
      parts.push(paint(new THREE.TubeGeometry(curve, 6, 0.013, 4, false), C(leafHex), 0.08, 0.25, seed + 10 + i));
      parts.push(paint(xf(new THREE.IcosahedronGeometry(0.026, 0), [tx, ty, tz]), C(leafHex), 0.08, 0.25, seed + 18 + i));
      parts.push(paint(xf(new THREE.CylinderGeometry(0.020, 0.058, 0.092, 5, 1), [tx, ty - 0.046, tz]), C(i % 2 ? petalAlt : petalHex), 0.1, 0.45, seed + 25 + i));
      parts.push(paint(xf(new THREE.IcosahedronGeometry(0.022, 0), [tx, ty - 0.078, tz]), C(coreHex), 0.08, 0.3, seed + 35 + i));
    }
  } else {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.55;
      parts.push(radialLeaf(0.052, 0.19, 0.88, 0.05, a, 0.01, leafHex, seed + 20 + i));
    }
    parts.push(...flowerBlossom(0, 0.20, 0, 0.086, petalHex, coreHex, seed + 30, 6));
    parts.push(...flowerBlossom(0.11, 0.15, 0.06, 0.050, petalAlt, coreHex, seed + 40, 4));
    parts.push(...flowerBlossom(-0.10, 0.14, -0.08, 0.048, petalAlt, coreHex, seed + 50, 4));
  }
  return clampGroundVariantBounds(mergeAll(parts), 0.31, 0.60, -0.06, -0.02);
}

/** 5 distinct low-poly 3D Shrub, Bramble, Juniper, Sagebrush & Flowering Bush archetypes (`0..4`). */
export function makeBushGeo(biome: PlanetKind, seed = 37, variant = 0): G {
  const v = normalizeGroundVariantIndex(variant);
  const nz = new Noise2(seed + v * 19);
  const folA = biome === 'dune' ? 0x8a8248 : biome === 'oceanForest' ? 0x2d8a48 : 0x3b7338;
  const folB = biome === 'dune' ? 0xa39656 : biome === 'oceanForest' ? 0x46a858 : 0x518c44;
  const berryHex = biome === 'dune' ? 0xd97724 : biome === 'oceanForest' ? 0xf72585 : 0xd62828;
  const parts: G[] = [paint(xf(new THREE.CylinderGeometry(0.05, 0.09, 0.28, 5, 1), [0, 0.10, 0]), C(0x583e2a), 0.1, 0.1, seed, 1)];
  const addLobes = (lobes: [number, number, number, number, number?][]) => {
    lobes.forEach(([x, y, z, r, sy = 0.82], i) => {
      parts.push(paint(xf(blob(r, 0, nz, 0.22, i * 2.1), [x, y, z], [1, sy, 1]), C(i % 2 ? folA : folB), 0.10, 0.45, seed + 10 + i));
    });
  };
  if (v === 0) addLobes([[0, 0.34, 0, 0.36], [0.22, 0.25, 0.13, 0.26], [-0.20, 0.26, -0.11, 0.28], [0.06, 0.24, -0.22, 0.25]]);
  else if (v === 1) addLobes([[0, 0.22, 0, 0.30, 0.72], [0.24, 0.18, 0.12, 0.24, 0.7], [-0.24, 0.19, 0.10, 0.23, 0.7], [0.10, 0.17, -0.24, 0.22, 0.7], [-0.14, 0.20, -0.20, 0.24, 0.7], [0.02, 0.32, 0.04, 0.22, 0.75]]);
  else if (v === 2) {
    [[0.36, 0.32, 0.22], [0.28, 0.30, 0.40], [0.18, 0.28, 0.56]].forEach(([r, h, y], i) => {
      parts.push(paint(xf(new THREE.ConeGeometry(r, h, 6, 1), [0, y, 0]), C(i % 2 ? folA : folB), 0.09, 0.42, seed + 12 + i));
    });
  } else if (v === 3) {
    parts.push(paint(xf(new THREE.CylinderGeometry(0.03, 0.05, 0.24, 4, 1), [0.10, 0.20, 0.05], [1, 1, 1], [0.2, 0, -0.5]), C(0x664a33), 0.1, 0.1, seed + 2, 1));
    addLobes([[0, 0.36, 0, 0.32, 0.52], [0.22, 0.30, 0.12, 0.24, 0.48], [-0.22, 0.28, -0.10, 0.25, 0.5], [0.04, 0.26, -0.22, 0.22, 0.46], [-0.08, 0.44, 0.10, 0.20, 0.52]]);
  } else {
    addLobes([[0, 0.34, 0, 0.34], [0.22, 0.28, 0.14, 0.24], [-0.22, 0.27, -0.12, 0.25], [0.12, 0.26, -0.22, 0.22], [-0.10, 0.28, 0.22, 0.22]]);
  }
  const nAccents = v === 2 ? 0 : v === 4 ? 6 : v === 1 ? 5 : 3;
  for (let i = 0; i < nAccents; i++) {
    const a = (i / Math.max(1, nAccents)) * Math.PI * 2 + 0.5;
    const rad = v === 4 ? 0.26 : 0.23;
    const y = v === 1 ? 0.28 : v === 3 ? 0.38 : 0.42;
    parts.push(paint(xf(new THREE.IcosahedronGeometry(v === 4 ? 0.058 : 0.046, 0), [Math.cos(a) * rad, y, Math.sin(a) * rad]), C(v === 4 && i % 2 ? 0xffd166 : berryHex), 0.08, 0.3, seed + 30 + i));
  }
  return clampGroundVariantBounds(mergeAll(parts), 0.53, 0.70, -0.06, -0.02);
}

/** 5 distinct Shoreline Reed, Papyrus, Bulrush, Horsetail & Water-Iris archetypes (`0..4`). */
export function makeShoreReedsGeo(seed = 79, variant = 0): G {
  const v = normalizeGroundVariantIndex(variant);
  const rng = mulberry32(seed + v * 29);
  const parts: G[] = [];
  const stalks = [6, 5, 9, 7, 5][v]!;
  for (let i = 0; i < stalks; i++) {
    const a = (i / stalks) * Math.PI * 2 + (rng() - 0.5) * 0.28;
    const dist = 0.04 + rng() * 0.09;
    const x = Math.cos(a) * dist, z = Math.sin(a) * dist;
    const h = (v === 1 ? 0.85 : v === 2 ? 0.64 : 0.72) + rng() * 0.34;
    const lean = (rng() * 0.06 + 0.01);
    const tx = x + Math.cos(a) * lean, tz = z + Math.sin(a) * lean;
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(x, -0.04, z), new THREE.Vector3((x + tx) * 0.5, h * 0.5 - 0.04, (z + tz) * 0.5), new THREE.Vector3(tx, h - 0.04, tz)]);
    const stemHex = v === 3 ? 0x5c964e : 0x4d8b46;
    parts.push(paint(new THREE.TubeGeometry(curve, 3, 0.017, 4, false), C(stemHex), 0.1, 0.4, seed + i));
    const at = (t: number): [number, number, number] => [x + (tx - x) * t, -0.04 + h * t, z + (tz - z) * t];
    if (v === 0 && i < 3) {
      parts.push(paint(xf(new THREE.CylinderGeometry(0.034, 0.034, 0.17, 5, 1), at(0.84)), C(0x5e3b22), 0.08, 0.2, seed + 15 + i));
    } else if (v === 1 && i < 4) {
      parts.push(paint(xf(new THREE.CylinderGeometry(0.085, 0.016, 0.11, 6, 1), at(0.96)), C(0x70ad54), 0.1, 0.45, seed + 15 + i));
    } else if (v === 2 && i < 4) {
      parts.push(paint(xf(new THREE.ConeGeometry(0.030, 0.16, 4, 1), at(0.90)), C(0x7a5c38), 0.08, 0.25, seed + 15 + i));
    } else if (v === 3) {
      parts.push(paint(xf(new THREE.CylinderGeometry(0.024, 0.024, 0.03, 4, 1), at(0.50)), C(0x3a5e32), 0.08, 0.2, seed + 25 + i));
      if (i < 3) parts.push(paint(xf(new THREE.ConeGeometry(0.024, 0.09, 4, 1), at(0.98)), C(0xc29b53), 0.08, 0.3, seed + 35 + i));
    } else if (v === 4) {
      parts.push(radialLeaf(0.044, h * 0.62, 0.72, 0.08, a + 0.3, dist * 0.5, 0x3f7d40, seed + 20 + i));
      if (i < 3) parts.push(...flowerBlossom(...at(0.98), 0.056, 0x7b6cf6, 0xffd166, seed + 40 + i * 5, 4));
    }
  }
  return clampGroundVariantBounds(mergeAll(parts), 0.20, 1.14, -0.07, -0.025);
}

/** Builds a 5-variant instanced geometry atlas (`aBreed` 0..4) for any ground flora family. */
export function buildGroundFloraAtlasGeo(kind: GroundFloraAtlasKind, biome: PlanetKind, seed = 17): THREE.BufferGeometry {
  return buildVariantAtlasGeo((v) => {
    switch (kind) {
      case 'grassTuft': return makeGrassTuftGeo(biome, seed + v * 7, v);
      case 'wildflower': return makeWildflowerGeo(biome, seed + v * 7, v);
      case 'bush': return makeBushGeo(biome, seed + v * 7, v);
      case 'saguaro': return makeSaguaroCactusGeo(seed + v * 7, v);
      case 'barrelCactus': return makeBarrelCactusGeo(seed + v * 7, v);
      case 'reeds': return makeShoreReedsGeo(seed + v * 7, v);
    }
  });
}
