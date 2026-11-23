import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  botanicalColor as C,
  makeBotanicalBlob as blob,
  mergeBotanicalParts as mergeAll,
  paintBotanical as paint,
  xfBotanical as xf,
  type BotanicalGeo as G,
} from './botanicalGeo';
import { Noise2 } from './noise';

export const GROUND_VARIANT_COUNT = 5;
export type GroundVariantIndex = 0 | 1 | 2 | 3 | 4;

export function normalizeGroundVariantIndex(v = 0): GroundVariantIndex {
  return ((((Math.trunc(v) % GROUND_VARIANT_COUNT) + GROUND_VARIANT_COUNT) % GROUND_VARIANT_COUNT) as GroundVariantIndex);
}

/** Ensures every variant keeps an embedded skirt in `[minYFloor, minYCeil]` and stays inside `(maxR, maxY)`. */
export function clampGroundVariantBounds(
  g: G,
  maxR: number,
  maxY: number,
  minYFloor = -0.06,
  minYCeil = -0.025,
): G {
  const pos = g.getAttribute('position');
  let rMax = 0;
  let yMax = -Infinity;
  let yMin = Infinity;
  for (let i = 0; i < pos.count; i++) {
    rMax = Math.max(rMax, Math.hypot(pos.getX(i), pos.getZ(i)));
    const y = pos.getY(i);
    if (y > yMax) yMax = y;
    if (y < yMin) yMin = y;
  }
  const rx = rMax > maxR ? maxR / rMax : 1;
  const ry = yMax > maxY ? maxY / yMax : 1;
  if (rx < 1 || ry < 1) {
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      pos.setXYZ(i, pos.getX(i) * rx, y > 0 ? y * ry : y, pos.getZ(i) * rx);
    }
    yMin = Infinity;
    for (let i = 0; i < pos.count; i++) yMin = Math.min(yMin, pos.getY(i));
  }
  if (yMin > minYCeil) g.translate(0, minYCeil - yMin, 0);
  else if (yMin < minYFloor) g.translate(0, minYFloor - yMin, 0);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Merges 5 distinct ground object variants (`0..4`) into a single instanced atlas with `aBreed`. */
export function buildVariantAtlasGeo(buildOne: (v: GroundVariantIndex) => G): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < GROUND_VARIANT_COUNT; i++) {
    const v = i as GroundVariantIndex;
    const g = buildOne(v);
    const nonIdx = g.index ? g.toNonIndexed() : g;
    const vCount = nonIdx.getAttribute('position').count;
    nonIdx.setAttribute('aBreed', new THREE.BufferAttribute(new Float32Array(vCount).fill(v), 1));
    parts.push(nonIdx);
  }
  const merged = mergeGeometries(parts)!;
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

function armTube(pts: [number, number, number][], rad: number, hex: number, seed: number): G[] {
  const c = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  const end = pts[pts.length - 1]!;
  return [
    paint(new THREE.TubeGeometry(c, 5, rad, 7, false), C(hex), 0.09, 0.32, seed),
    paint(xf(new THREE.SphereGeometry(rad, 7, 5), end), C(hex), 0.08, 0.35, seed + 1),
  ];
}

function desertColumn(
  rTop: number,
  rBot: number,
  h: number,
  pos: [number, number, number],
  rot: [number, number, number],
  hex: number,
  seed: number,
  withBloom = false,
): G[] {
  const col = xf(new THREE.CylinderGeometry(rTop, rBot, h, 8, 2), pos, [1, 1, 1], rot);
  const tipOff = new THREE.Vector3(0, h * 0.5, 0).applyEuler(new THREE.Euler(...rot));
  const topPos: [number, number, number] = [pos[0] + tipOff.x, pos[1] + tipOff.y, pos[2] + tipOff.z];
  const cap = xf(new THREE.SphereGeometry(rTop, 8, 5), topPos);
  const out = [paint(col, C(hex), 0.09, 0.32, seed), paint(cap, C(hex), 0.08, 0.35, seed + 1)];
  if (withBloom) {
    out.push(paint(xf(new THREE.IcosahedronGeometry(0.068, 0), [topPos[0], topPos[1] + rTop * 0.9, topPos[2]], [1.2, 0.65, 1.2]), C(0xffbe0b), 0.08, 0.4, seed + 2));
  }
  return out;
}

function succulentBlade(
  w: number,
  len: number,
  pitch: number,
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
  for (let i = 0; i < p.count; i++) {
    const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
    const s = Math.max(0, Math.min(1, (vy + len * 0.5) / len));
    const along = s * len;
    const u = vx * 1.15;
    const thick = vz * 0.34 * (1 - s * 0.4);
    const r = baseR + along * cP - thick * sP;
    const y = -0.02 + along * sP + thick * cP + 0.04 * s * s;
    p.setXYZ(i, ux * r + tx * u, y, uz * r + tz * u);
  }
  cone.computeVertexNormals();
  return paint(cone, C(hex), 0.1, 0.4, seed);
}

/** 5 distinct Saguaro & columnar desert cactus archetypes (`0..4`). */
export function makeSaguaroCactusGeo(seed = 53, variant = 0): G {
  const v = normalizeGroundVariantIndex(variant);
  const parts: G[] = [];
  if (v === 0) {
    parts.push(...desertColumn(0.14, 0.17, 2.24, [0, 1.06, 0], [0, 0, 0], 0x4c7c44, seed, true));
    parts.push(...armTube([[0, 0.95, 0], [0.35, 0.98, 0.04], [0.40, 1.56, 0.04]], 0.10, 0x55874b, seed + 5));
    parts.push(...armTube([[0, 1.22, 0], [-0.31, 1.26, -0.04], [-0.35, 1.82, -0.04]], 0.095, 0x487640, seed + 9));
  } else if (v === 1) {
    parts.push(...desertColumn(0.15, 0.19, 2.26, [0, 1.06, 0], [0, 0, 0], 0x497942, seed, true));
    const arms: [[number, number, number][], number, number][] = [
      [[[0, 0.78, 0], [0.34, 0.82, 0.05], [0.38, 1.48, 0.05]], 0.092, 0x56894b],
      [[[0, 0.96, 0], [-0.32, 1.00, -0.04], [-0.36, 1.66, -0.04]], 0.090, 0x4c7c44],
      [[[0, 1.24, 0], [0.04, 1.28, 0.34], [0.05, 1.84, 0.38]], 0.085, 0x5b8f50],
      [[[0, 1.38, 0], [-0.04, 1.42, -0.32], [-0.05, 1.94, -0.35]], 0.082, 0x47743f],
    ];
    arms.forEach(([pts, rad, hex], i) => {
      parts.push(...armTube(pts, rad, hex, seed + 4 + i * 3));
      if (i < 2) {
        const end = pts[2]!;
        parts.push(paint(xf(new THREE.IcosahedronGeometry(0.058, 0), [end[0], end[1] + 0.11, end[2]], [1.1, 0.6, 1.1]), C(0xffd166), 0.08, 0.4, seed + 30 + i));
      }
    });
  } else if (v === 2) {
    parts.push(paint(xf(new THREE.CylinderGeometry(0.15, 0.19, 0.24, 8, 1), [0, 0.04, 0]), C(0x45733e), 0.09, 0.3, seed));
    parts.push(...desertColumn(0.095, 0.118, 2.08, [0, 0.96, 0], [0, 0, 0], 0x487640, seed + 1, true));
    const topHeights = [1.74, 1.54, 1.36, 1.18, 0.98];
    for (let i = 0; i < topHeights.length; i++) {
      const a = i * ((Math.PI * 2) / topHeights.length) + 0.25;
      const rad = 0.22 + (i % 2) * 0.03;
      const ux = Math.cos(a), uz = Math.sin(a);
      const topH = topHeights[i]!;
      const tubeRad = 0.074 + (i % 2) * 0.008;
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0.06, 0),
        new THREE.Vector3(ux * rad * 0.85, 0.20, uz * rad * 0.85),
        new THREE.Vector3(ux * rad, 0.55, uz * rad),
        new THREE.Vector3(ux * rad, topH, uz * rad),
      ]);
      const pipeHex = i % 2 ? 0x588a4d : 0x4d7e44;
      parts.push(paint(new THREE.TubeGeometry(curve, 9, tubeRad, 7, false), C(pipeHex), 0.09, 0.32, seed + 6 + i * 3));
      parts.push(paint(xf(new THREE.SphereGeometry(tubeRad, 7, 5), [ux * rad, topH, uz * rad]), C(pipeHex), 0.08, 0.35, seed + 7 + i * 3));
      if (i < 2) {
        parts.push(paint(xf(new THREE.IcosahedronGeometry(0.056, 0), [ux * rad, topH + 0.08, uz * rad], [1.15, 0.65, 1.15]), C(0xffbe0b), 0.08, 0.4, seed + 30 + i));
      }
    }
  } else if (v === 3) {
    parts.push(...desertColumn(0.135, 0.175, 2.28, [0, 1.08, 0], [0, 0, 0], 0x45733e, seed, true));
    parts.push(...armTube([[0, 1.38, 0], [0.33, 1.42, 0.03], [0.37, 2.02, 0.03]], 0.088, 0x528348, seed + 6));
    parts.push(...desertColumn(0.082, 0.105, 0.88, [-0.21, 0.39, 0.08], [0, 0, 0.08], 0x5b8e50, seed + 12, true));
  } else {
    parts.push(...desertColumn(0.15, 0.21, 0.96, [0, 0.40, 0], [0, 0, 0], 0x4a7842, seed));
    const forks: [number, number, number, number][] = [
      [0.24, 0.06, 1.84, -0.16],
      [-0.22, 0.10, 1.66, 0.15],
      [0.02, -0.22, 1.48, 0.08],
    ];
    forks.forEach(([fx, fz, h, lean], i) => {
      parts.push(...armTube([[0, 0.56, 0], [fx * 0.95, 0.88, fz * 0.95], [fx + lean * 0.35, 0.58 + h * 0.65, fz]], 0.115 - i * 0.01, i % 2 ? 0x55874b : 0x47753f, seed + 5 + i * 4));
      parts.push(paint(xf(new THREE.IcosahedronGeometry(0.062, 0), [fx + lean * 0.35, 0.72 + h * 0.65, fz], [1.15, 0.65, 1.15]), C(0xffbe0b), 0.08, 0.4, seed + 25 + i));
    });
  }
  return clampGroundVariantBounds(mergeAll(parts), 0.49, 2.36, -0.10, -0.03);
}

/** 5 distinct Barrel, Prickly-Pear, Cholla & Agave succulent archetypes (`0..4`). */
export function makeBarrelCactusGeo(seed = 67, variant = 0): G {
  const v = normalizeGroundVariantIndex(variant);
  const parts: G[] = [];
  if (v === 0) {
    parts.push(paint(xf(new THREE.SphereGeometry(0.27, 8, 6), [0, 0.22, 0], [1, 1.12, 1]), C(0x548248), 0.1, 0.35, seed));
    parts.push(paint(xf(new THREE.IcosahedronGeometry(0.07, 0), [0, 0.52, 0], [1.2, 0.6, 1.2]), C(0xf77f00), 0.1, 0.4, seed + 1));
    parts.push(paint(xf(new THREE.SphereGeometry(0.17, 7, 5), [0.25, 0.14, 0.15], [1, 1.05, 1]), C(0x608f50), 0.1, 0.35, seed + 2));
    parts.push(paint(xf(new THREE.SphereGeometry(0.16, 7, 5), [-0.21, 0.32, 0.12], [1.1, 1.25, 0.38], [0.15, 0.4, -0.35]), C(0x5d8c4d), 0.1, 0.35, seed + 3));
  } else if (v === 1) {
    const pads: [number, number, number, number, [number, number, number]][] = [
      [0, 0.18, 0, 0.19, [0.1, 0.2, 0.1]],
      [0.18, 0.38, 0.06, 0.16, [0.15, 0.6, -0.45]],
      [-0.18, 0.36, -0.05, 0.16, [-0.15, -0.5, 0.42]],
      [0.05, 0.54, 0.14, 0.14, [0.35, 1.1, -0.22]],
      [-0.22, 0.56, 0.08, 0.13, [0.20, 0.2, 0.35]],
      [0.24, 0.55, -0.10, 0.13, [-0.22, -0.3, -0.32]],
    ];
    pads.forEach(([x, y, z, r, rot], i) => {
      parts.push(paint(xf(new THREE.SphereGeometry(r, 7, 5), [x, y, z], [1.0, 1.28, 0.35], rot), C(i % 2 ? 0x5c8b4c : 0x4f7d41), 0.09, 0.35, seed + i));
    });
    [[0.05, 0.72, 0.14], [-0.22, 0.72, 0.08], [0.24, 0.71, -0.10]].forEach(([x, y, z], i) => {
      parts.push(paint(xf(new THREE.IcosahedronGeometry(0.05, 0), [x, y, z], [1, 1.2, 1]), C(0xe63946), 0.08, 0.4, seed + 20 + i));
    });
  } else if (v === 2) {
    const domes: [number, number, number, number][] = [[0, 0.18, 0, 0.21], [0.23, 0.12, 0.10, 0.15], [-0.22, 0.13, -0.08, 0.16], [0.06, 0.11, -0.22, 0.14], [-0.10, 0.10, 0.22, 0.13]];
    domes.forEach(([x, y, z, r], i) => {
      parts.push(paint(xf(new THREE.SphereGeometry(r, 8, 6), [x, y, z], [1, 1.08, 1]), C(i % 2 ? 0x5d8d4a : 0x4d7a40), 0.1, 0.35, seed + i * 2));
      parts.push(paint(xf(new THREE.IcosahedronGeometry(r * 0.28, 0), [x, y + r * 1.06, z], [1.2, 0.6, 1.2]), C(i === 0 ? 0xff9f1c : 0xffbe0b), 0.08, 0.4, seed + 15 + i));
    });
  } else if (v === 3) {
    parts.push(...desertColumn(0.065, 0.085, 0.56, [0, 0.24, 0], [0, 0, 0], 0x628c50, seed));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.35;
      const ux = Math.cos(a), uz = Math.sin(a);
      const pts: [number, number, number][] = [[0, 0.26, 0], [ux * 0.16, 0.34, uz * 0.16], [ux * 0.21, 0.54, uz * 0.21]];
      parts.push(...armTube(pts, 0.052, i % 2 ? 0x6c9658 : 0x588247, seed + 4 + i * 3));
      if (i < 2) {
        parts.push(paint(xf(new THREE.IcosahedronGeometry(0.054, 0), [ux * 0.21, 0.60, uz * 0.21], [1.15, 0.65, 1.15]), C(0xffbe0b), 0.08, 0.4, seed + 25 + i));
      }
    }
  } else {
    for (let i = 0; i < 5; i++) {
      parts.push(succulentBlade(0.072, 0.34, 0.96, (i / 5) * Math.PI * 2, 0.03, 0x5f9473, seed + i));
    }
    for (let i = 0; i < 7; i++) {
      parts.push(succulentBlade(0.082, 0.42, 0.44, (i / 7) * Math.PI * 2 + 0.45, 0.04, 0x4d7e60, seed + 10 + i));
    }
    parts.push(...desertColumn(0.035, 0.055, 0.62, [0, 0.28, 0], [0, 0, 0], 0x7aa35e, seed + 20, true));
  }
  return clampGroundVariantBounds(mergeAll(parts), 0.45, 0.86, -0.10, -0.03);
}

/** 5 distinct geological Boulder Rock archetypes (`0..4`). */
export function makeBoulderGeo(seed: number, tint = new THREE.Color(1, 1, 1), variant = 0): G {
  const v = normalizeGroundVariantIndex(variant);
  const nz = new Noise2(seed + v * 17);
  const rockPart = (r: number, pos: [number, number, number], scale: [number, number, number], rot: [number, number, number], off: number, detail = 1) => {
    const g = blob(r, detail, nz, 0.36, seed * 1.7 + off);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y < -0.52 * r) p.setY(i, -0.52 * r + (y + 0.52 * r) * 0.15);
      else if (y > 0) p.setY(i, y * 1.12);
    }
    return paint(xf(g, pos, scale, rot), tint, 0.1, 0.3, seed + off);
  };
  let parts: G[];
  if (v === 0) parts = [rockPart(1, [0, 0, 0], [1, 1, 1], [0, 0, 0], 0)];
  else if (v === 1) parts = [rockPart(0.95, [0, -0.02, 0], [1.22, 0.58, 0.96], [0.18, 0.4, -0.16], 11), rockPart(0.62, [0.42, -0.14, 0.26], [1.05, 0.52, 0.9], [-0.1, 1.1, 0.12], 19, 0)];
  else if (v === 2) parts = [rockPart(0.76, [-0.28, 0.04, 0.08], [0.95, 1.05, 0.9], [0.12, 0.3, 0.22], 23), rockPart(0.68, [0.30, -0.02, -0.10], [0.92, 0.92, 0.88], [-0.14, 1.4, -0.24], 31)];
  else if (v === 3) {
    parts = [
      paint(xf(new THREE.CylinderGeometry(0.84, 1.02, 0.52, 7, 1), [0, -0.10, 0]), tint, 0.1, 0.25, seed + 40),
      paint(xf(new THREE.CylinderGeometry(0.58, 0.78, 0.40, 6, 1), [0.10, 0.28, -0.08], [1, 1, 1], [0.06, 0.5, -0.05]), tint.clone().multiplyScalar(1.06), 0.1, 0.3, seed + 41),
      paint(xf(new THREE.CylinderGeometry(0.32, 0.48, 0.30, 6, 1), [0.16, 0.56, -0.12]), tint.clone().multiplyScalar(1.10), 0.1, 0.35, seed + 42),
    ];
  } else {
    parts = [rockPart(0.82, [0, 0.04, 0], [1.02, 1.08, 0.96], [0.08, 0.2, -0.10], 51), rockPart(0.46, [0.56, -0.14, 0.30], [1, 0.85, 0.95], [0.2, 0.8, 0.1], 57, 0), rockPart(0.42, [-0.50, -0.16, -0.34], [0.95, 0.82, 1], [-0.15, 1.9, -0.1], 63, 0)];
  }
  return clampGroundVariantBounds(mergeAll(parts), 1.28, 1.22, -0.54, -0.24);
}

function kinkedPrism(rTop: number, rBot: number, h: number, pos: [number, number, number], rot: [number, number, number], nz: Noise2, seed: number, tint: THREE.Color): G {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, 6, 6);
  g.translate(0, h * 0.31, 0);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const yPos = Math.max(0, y);
    const k = 1 + 0.24 * nz.n(p.getX(i) * 3 + 5, y * 3 + p.getZ(i) * 3);
    p.setXYZ(i, p.getX(i) * k + yPos * yPos * 0.22 * nz.n(seed, 1), y, p.getZ(i) * k + yPos * yPos * 0.18 * nz.n(seed, 2));
  }
  return paint(xf(g, pos, [1, 1, 1], rot), tint, 0.12, 0.45, seed);
}

/** 5 distinct geological Rock Spire / Crag archetypes (`0..4`). */
export function makeSpireGeo(seed: number, tint = new THREE.Color(1, 1, 1), variant = 0): G {
  const v = normalizeGroundVariantIndex(variant);
  const nz = new Noise2(seed + v * 23);
  let parts: G[];
  if (v === 0) parts = [kinkedPrism(0.32, 0.90, 1.38, [0, 0, 0], [0, 0, 0], nz, seed, tint)];
  else if (v === 1) parts = [kinkedPrism(0.22, 0.64, 1.36, [-0.18, 0, 0.06], [0.06, 0.4, 0.14], nz, seed + 5, tint), kinkedPrism(0.18, 0.50, 0.98, [0.28, -0.04, -0.10], [-0.08, 1.2, -0.18], nz, seed + 11, tint.clone().multiplyScalar(0.94))];
  else if (v === 2) {
    parts = [
      kinkedPrism(0.26, 0.66, 0.92, [0, 0, 0], [0, 0, 0], nz, seed + 20, tint),
      paint(xf(blob(0.56, 1, nz, 0.28, seed + 29), [0, 0.86, 0], [1.14, 0.52, 1.06]), tint.clone().multiplyScalar(1.08), 0.1, 0.35, seed + 25),
    ];
  } else if (v === 3) {
    const c = new THREE.CatmullRomCurve3([new THREE.Vector3(0, -0.26, 0), new THREE.Vector3(0.10, 0.25, 0.04), new THREE.Vector3(0.30, 0.72, 0.12), new THREE.Vector3(0.46, 1.12, 0.16)]);
    const g = new THREE.TubeGeometry(c, 7, 0.64, 6, false);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const ring = Math.min(1, Math.floor(i / 7) / 7);
      const pt = c.getPoint(ring);
      const k = 1 - ring * 0.84;
      p.setXYZ(i, pt.x + (p.getX(i) - pt.x) * k, pt.y + (p.getY(i) - pt.y) * k, pt.z + (p.getZ(i) - pt.z) * k);
    }
    parts = [paint(g, tint, 0.12, 0.45, seed + 33)];
  } else {
    parts = [
      paint(xf(new THREE.CylinderGeometry(0.34, 0.44, 1.32, 6, 1), [0, 0.42, 0]), tint, 0.1, 0.35, seed + 40),
      paint(xf(new THREE.CylinderGeometry(0.26, 0.34, 0.98, 6, 1), [0.36, 0.25, 0.22], [1, 1, 1], [0.05, 0.5, -0.06]), tint.clone().multiplyScalar(0.95), 0.1, 0.35, seed + 41),
      paint(xf(new THREE.CylinderGeometry(0.24, 0.32, 0.78, 6, 1), [-0.32, 0.15, -0.24], [1, 1, 1], [-0.04, 1.1, 0.05]), tint.clone().multiplyScalar(1.05), 0.1, 0.35, seed + 42),
    ];
  }
  return clampGroundVariantBounds(mergeAll(parts), 1.08, 1.16, -0.30, -0.15);
}

/** 5-variant instanced atlas for boulders (`aBreed` 0..4). */
export function buildBoulderAtlasGeo(seed: number, tint: THREE.Color, darkTint = tint): THREE.BufferGeometry {
  return buildVariantAtlasGeo((v) => makeBoulderGeo(seed + v * 5, tint.clone().lerp(darkTint, (v % 3) * 0.14), v));
}

/** 5-variant instanced atlas for rock spires (`aBreed` 0..4). */
export function buildSpireAtlasGeo(seed: number, tint: THREE.Color, darkTint = tint): THREE.BufferGeometry {
  return buildVariantAtlasGeo((v) => makeSpireGeo(seed + v * 5, tint.clone().lerp(darkTint, (v % 3) * 0.12), v));
}
