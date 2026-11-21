import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PlanetKind } from '../../planets/PlanetSpec';
import {
  botanicalColor as C,
  makeBotanicalBlob,
  paintBotanical as paintGeo,
  xfBotanical as xf,
  type BotanicalGeo as G,
} from './botanicalGeo';
import { Noise2 } from './noise';

export type TreeBreedId =
  | 'alpinePine'
  | 'silverBirch'
  | 'ancientOak'
  | 'weepingWillow'
  | 'coconutPalm'
  | 'stiltMangrove'
  | 'canopyBanyan'
  | 'coralBlossom'
  | 'oasisDatePalm'
  | 'desertDrySnag'
  | 'joshuaAcacia';

export interface TreeBreedSpec {
  id: TreeBreedId;
  label: string;
  biome: PlanetKind;
  breedIndex: number;
  windCompliance: number;
  moisturePref: 'dry' | 'mesic' | 'wet';
  canopyShape: 'conical' | 'columnar' | 'broadDome' | 'pendulous' | 'palmCrown' | 'gnarled';
  scaleRangeXZ: readonly [number, number];
  scaleRangeY: readonly [number, number];
}

export const TREE_BREEDS: readonly TreeBreedSpec[] = [
  // forestRock (Highland / Boreal-Montane — 4 breeds)
  { id: 'alpinePine', label: 'Alpine Conifer Pine', biome: 'forestRock', breedIndex: 0, windCompliance: 0.85, moisturePref: 'dry', canopyShape: 'conical', scaleRangeXZ: [0.84, 1.08], scaleRangeY: [0.98, 1.36] },
  { id: 'silverBirch', label: 'Silver Paper Birch', biome: 'forestRock', breedIndex: 1, windCompliance: 1.35, moisturePref: 'mesic', canopyShape: 'columnar', scaleRangeXZ: [0.78, 1.02], scaleRangeY: [0.96, 1.30] },
  { id: 'ancientOak', label: 'Gnarled Highland Oak', biome: 'forestRock', breedIndex: 2, windCompliance: 0.62, moisturePref: 'mesic', canopyShape: 'broadDome', scaleRangeXZ: [0.92, 1.18], scaleRangeY: [0.94, 1.22] },
  { id: 'weepingWillow', label: 'Riparian Weeping Willow', biome: 'forestRock', breedIndex: 3, windCompliance: 1.55, moisturePref: 'wet', canopyShape: 'pendulous', scaleRangeXZ: [0.86, 1.08], scaleRangeY: [0.98, 1.26] },
  // oceanForest (Tropical / Coastal Archipelago — 4 breeds)
  { id: 'coconutPalm', label: 'Coastal Coconut Palm', biome: 'oceanForest', breedIndex: 0, windCompliance: 1.60, moisturePref: 'mesic', canopyShape: 'palmCrown', scaleRangeXZ: [0.86, 1.18], scaleRangeY: [0.98, 1.36] },
  { id: 'stiltMangrove', label: 'Coastal Stilt Mangrove', biome: 'oceanForest', breedIndex: 1, windCompliance: 0.78, moisturePref: 'wet', canopyShape: 'broadDome', scaleRangeXZ: [0.88, 1.14], scaleRangeY: [0.94, 1.20] },
  { id: 'canopyBanyan', label: 'Emergent Rainforest Banyan', biome: 'oceanForest', breedIndex: 2, windCompliance: 0.58, moisturePref: 'mesic', canopyShape: 'broadDome', scaleRangeXZ: [0.94, 1.20], scaleRangeY: [0.96, 1.26] },
  { id: 'coralBlossom', label: 'Flowering Reef Coral-Tree', biome: 'oceanForest', breedIndex: 3, windCompliance: 1.12, moisturePref: 'dry', canopyShape: 'gnarled', scaleRangeXZ: [0.88, 1.14], scaleRangeY: [0.94, 1.22] },
  // dune (Arid Desert / Oasis / Badlands — 3 breeds = 11 total)
  { id: 'oasisDatePalm', label: 'Oasis Date Palm', biome: 'dune', breedIndex: 0, windCompliance: 1.25, moisturePref: 'wet', canopyShape: 'palmCrown', scaleRangeXZ: [0.88, 1.20], scaleRangeY: [0.94, 1.32] },
  { id: 'desertDrySnag', label: 'Sun-Bleached Dry Snag', biome: 'dune', breedIndex: 1, windCompliance: 0.28, moisturePref: 'dry', canopyShape: 'gnarled', scaleRangeXZ: [0.82, 1.18], scaleRangeY: [0.88, 1.20] },
  { id: 'joshuaAcacia', label: 'Twisted Thorn Joshua-Acacia', biome: 'dune', breedIndex: 2, windCompliance: 0.55, moisturePref: 'mesic', canopyShape: 'gnarled', scaleRangeXZ: [0.88, 1.20], scaleRangeY: [0.90, 1.20] },
] as const;

export const BREEDS_BY_BIOME: Readonly<Record<PlanetKind, readonly TreeBreedSpec[]>> = {
  forestRock: TREE_BREEDS.filter((b) => b.biome === 'forestRock'),
  oceanForest: TREE_BREEDS.filter((b) => b.biome === 'oceanForest'),
  dune: TREE_BREEDS.filter((b) => b.biome === 'dune'),
};

export function getTreeBreedSpec(id: TreeBreedId): TreeBreedSpec {
  return TREE_BREEDS.find((b) => b.id === id) ?? TREE_BREEDS[0]!;
}

function crownBlob(radius: number, nz: Noise2, amp: number, seedOff: number, detail?: number): G {
  return makeBotanicalBlob(radius, detail ?? (radius >= 1.18 ? 1 : 0), nz, amp, seedOff);
}

function curveTube(pts: [number, number, number][], radBot: number, radTop: number, segs = 6, radial = 5): G {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  const g = new THREE.TubeGeometry(curve, segs, radBot, radial, false);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const ring = Math.min(1, Math.floor(i / (radial + 1)) / segs);
    const c = curve.getPoint(ring);
    const k = 1 - ring * (1 - radTop / Math.max(0.01, radBot));
    p.setXYZ(i, c.x + (p.getX(i) - c.x) * k, c.y + (p.getY(i) - c.y) * k, c.z + (p.getZ(i) - c.z) * k);
  }
  g.computeVertexNormals();
  return g;
}

function normalizeHeight(parts: G[], targetH = 5.20, maxRad = 1.80): G {
  const merged = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)))!;
  merged.computeBoundingBox();
  const bb = merged.boundingBox!;
  const curH = Math.max(0.5, bb.max.y);
  const s = targetH / curH;
  merged.scale(s, s, s);
  const pos = merged.getAttribute('position');
  let rMax = 0;
  let minY = Infinity;
  for (let i = 0; i < pos.count; i++) {
    rMax = Math.max(rMax, Math.hypot(pos.getX(i), pos.getZ(i)));
    minY = Math.min(minY, pos.getY(i));
  }
  if (minY > -0.05) merged.translate(0, -0.08 - minY, 0);
  else if (minY < -0.14) merged.translate(0, -0.10 - minY, 0);
  if (rMax > maxRad) {
    const k = maxRad / rMax;
    merged.scale(k, 1, k);
  }
  merged.computeVertexNormals();
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

function buildAlpinePine(): G {
  const parts: G[] = [
    paintGeo(xf(new THREE.CylinderGeometry(0.20, 0.34, 0.46, 7, 1), [0, 0.11, 0]), C(0x432d1e), 0.10, 0.10, 1, 1),
    paintGeo(xf(new THREE.CylinderGeometry(0.10, 0.23, 3.36, 7, 1), [0, 1.58, 0]), C(0x4e3625), 0.10, 0.12, 2, 1),
    paintGeo(curveTube([[0, 1.52, 0], [0.28, 1.72, 0.10]], 0.062, 0.026, 3, 4), C(0x4a3222), 0.10, 0.10, 3, 1),
    paintGeo(curveTube([[0, 1.88, 0], [-0.26, 2.08, -0.12]], 0.056, 0.024, 3, 4), C(0x4a3222), 0.10, 0.10, 4, 1),
  ];
  const tiers: [number, number, number][] = [
    [1.04, 1.16, 3.04],
    [0.92, 1.12, 3.68],
    [0.74, 1.06, 4.28],
    [0.54, 0.98, 4.84],
    [0.32, 0.86, 5.32],
  ];
  tiers.forEach(([r, h, yCenter], i) => {
    const g = new THREE.ConeGeometry(r, h, 7, 1);
    const p = g.getAttribute('position');
    for (let k = 0; k < p.count; k++) {
      const s = 1 + 0.10 * Math.sin(k * 7.3 + i * 2.1);
      p.setX(k, p.getX(k) * s);
      p.setZ(k, p.getZ(k) * s);
    }
    parts.push(paintGeo(xf(g, [0, yCenter, 0]), i % 2 ? C(0x2b6238) : C(0x3d7a47), 0.08, 0.38, 30 + i));
  });
  return normalizeHeight(parts, 5.30);
}

function buildSilverBirch(nz: Noise2): G {
  const parts: G[] = [
    paintGeo(curveTube([[0, -0.09, 0], [0.06, 1.55, 0.03], [0.18, 3.25, 0.08], [0.14, 4.58, 0.02]], 0.15, 0.055, 6), C(0xdad6cc), 0.14, 0.15, 41, 1),
    paintGeo(curveTube([[0.08, 1.85, 0.04], [-0.22, 2.75, -0.10], [-0.32, 3.92, -0.14]], 0.10, 0.042, 5), C(0xcfcac0), 0.14, 0.15, 42, 1),
    paintGeo(curveTube([[0.12, 2.05, 0.04], [0.34, 2.95, 0.16]], 0.07, 0.035, 4), C(0xd4d0c6), 0.12, 0.14, 43, 1),
  ];
  const crowns: [number, number, number, number, number][] = [
    [0.18, 3.45, 0.08, 0.88, 0x76a844],
    [-0.32, 3.68, -0.12, 0.82, 0x92bf4e],
    [0.14, 4.44, 0.04, 0.84, 0x88b84a],
    [-0.14, 4.92, -0.04, 0.70, 0xa3cc5c],
    [0.34, 3.04, 0.16, 0.62, 0x6a9c3e],
  ];
  crowns.forEach(([x, y, z, r, hex], i) =>
    parts.push(paintGeo(xf(crownBlob(r, nz, 0.24, 10 + i * 2.7), [x, y, z], [0.84, 1.16, 0.84]), C(hex), 0.10, 0.50, 50 + i)),
  );
  return normalizeHeight(parts, 5.20);
}

function buildAncientOak(nz: Noise2): G {
  const parts: G[] = [
    paintGeo(xf(new THREE.CylinderGeometry(0.32, 0.52, 0.44, 7, 1), [0, 0.08, 0]), C(0x412e1f), 0.12, 0.10, 60, 1),
    paintGeo(curveTube([[0, -0.10, 0], [0.06, 0.96, 0.03], [-0.04, 2.02, -0.02], [0.02, 3.12, 0.02]], 0.36, 0.18, 6), C(0x473323), 0.12, 0.10, 61, 1),
    paintGeo(curveTube([[0, 1.72, 0], [0.54, 2.54, 0.24], [0.84, 3.22, 0.34]], 0.17, 0.078, 4), C(0x4a3525), 0.10, 0.10, 62, 1),
    paintGeo(curveTube([[0, 1.78, 0], [-0.56, 2.58, -0.20], [-0.82, 3.26, -0.30]], 0.16, 0.078, 4), C(0x4a3525), 0.10, 0.10, 63, 1),
    paintGeo(curveTube([[0, 1.82, 0], [0.14, 2.60, -0.44], [0.20, 3.26, -0.68]], 0.14, 0.068, 4), C(0x4d3726), 0.10, 0.10, 64, 1),
    paintGeo(curveTube([[0, 1.84, 0], [-0.14, 2.58, 0.42], [-0.20, 3.24, 0.62]], 0.14, 0.068, 4), C(0x4d3726), 0.10, 0.10, 65, 1),
  ];
  const domes: [number, number, number, number, number][] = [
    [0, 3.68, 0, 1.28, 0x356933],
    [0.78, 3.38, 0.32, 0.90, 0x487f3c],
    [-0.76, 3.42, -0.28, 0.92, 0x3d7337],
    [0.20, 3.50, -0.66, 0.84, 0x4d843f],
    [-0.22, 3.46, 0.68, 0.82, 0x3a7036],
    [0.04, 4.44, 0.04, 0.98, 0x548c44],
  ];
  domes.forEach(([x, y, z, r, hex], i) =>
    parts.push(paintGeo(xf(crownBlob(r, nz, 0.22, 25 + i * 3.1), [x, y, z], [1.08, 0.80, 1.08]), C(hex), 0.09, 0.52, 70 + i)),
  );
  return normalizeHeight(parts, 5.10, 1.56);
}

function buildWeepingWillow(nz: Noise2): G {
  const parts: G[] = [
    paintGeo(xf(new THREE.CylinderGeometry(0.24, 0.40, 0.44, 7, 1), [0, 0.10, 0]), C(0x4d3b2b), 0.10, 0.12, 80, 1),
    paintGeo(curveTube([[0, -0.10, 0], [0.09, 1.08, 0.04], [0.18, 2.15, 0.08], [0.10, 3.32, 0.03]], 0.25, 0.11, 6), C(0x564332), 0.10, 0.15, 81, 1),
    paintGeo(curveTube([[0.15, 1.98, 0.06], [-0.52, 2.95, -0.22], [-0.74, 3.38, -0.30]], 0.14, 0.062, 5), C(0x5b4634), 0.10, 0.14, 82, 1),
    paintGeo(curveTube([[0.16, 2.04, 0.07], [0.56, 2.94, 0.24], [0.76, 3.36, 0.32]], 0.135, 0.060, 5), C(0x5b4634), 0.10, 0.14, 83, 1),
    paintGeo(curveTube([[0.14, 2.08, 0.06], [-0.18, 2.98, 0.50], [-0.26, 3.40, 0.68]], 0.12, 0.055, 5), C(0x5b4634), 0.10, 0.14, 84, 1),
    paintGeo(curveTube([[0.15, 2.10, 0.06], [0.26, 3.00, -0.48], [0.34, 3.42, -0.66]], 0.12, 0.055, 5), C(0x5b4634), 0.10, 0.14, 85, 1),
  ];
  // Layered, full pendulous foliage mounds (no thin hanging tubes)
  const crownDomes: [number, number, number, number, [number, number, number], number][] = [
    [0.08, 3.68, 0.03, 1.12, [1.08, 0.96, 1.08], 0x558e4c],
    [0.08, 4.38, 0.02, 0.92, [1.02, 0.88, 1.02], 0x76b066],
    [-0.62, 3.16, -0.26, 0.86, [0.96, 1.24, 0.96], 0x67a05a],
    [0.64, 3.12, 0.26, 0.84, [0.96, 1.22, 0.96], 0x5e9751],
    [-0.22, 3.18, 0.60, 0.82, [0.96, 1.24, 0.96], 0x5c9450],
    [0.28, 3.20, -0.58, 0.80, [0.96, 1.20, 0.96], 0x6ba45e],
    [-0.36, 2.96, 0.34, 0.66, [0.92, 1.24, 0.92], 0x4f8647],
    [0.42, 2.94, -0.28, 0.64, [0.92, 1.22, 0.92], 0x578f4d],
  ];
  crownDomes.forEach(([x, y, z, r, scale, hex], i) =>
    parts.push(paintGeo(xf(crownBlob(r, nz, 0.22, 40 + i * 3.1, r >= 0.95 ? 1 : 0), [x, y, z], scale), C(hex), 0.08, 0.46, 86 + i)),
  );
  return normalizeHeight(parts, 5.10, 1.56);
}

function buildStemmedPalm(trunkHex: number, leafA: number, leafB: number, fruitHex: number, lean = 0.52, fronds = 10): G {
  const trunkPts: [number, number, number][] = [
    [0, -0.10, 0],
    [lean * 0.40, 1.48, 0.07],
    [lean * 0.90, 2.98, 0.05],
    [lean * 0.82, 4.32, 0.0],
  ];
  const top = trunkPts[3]!;
  const parts: G[] = [
    paintGeo(xf(new THREE.CylinderGeometry(0.18, 0.29, 0.36, 7, 1), [0, 0.06, 0]), C(trunkHex).multiplyScalar(0.88), 0.10, 0.12, 90, 1),
    paintGeo(curveTube(trunkPts, 0.195, 0.115, 8, 6), C(trunkHex), 0.13, 0.22, 91, 1),
    paintGeo(xf(new THREE.IcosahedronGeometry(0.24, 0), [top[0], top[1] - 0.14, top[2]]), C(fruitHex), 0.10, 0.20, 99),
  ];
  const L = 1.95;
  for (let i = 0; i < fronds; i++) {
    const upperWhorl = i % 2;
    const a = (i / fronds) * Math.PI * 2 + upperWhorl * 0.12;
    const leafG = new THREE.ConeGeometry(0.32, L, 4, 5);
    const lp = leafG.getAttribute('position');
    for (let k = 0; k < lp.count; k++) {
      const u = Math.min(1, Math.max(0, (lp.getY(k) + L * 0.5) / L));
      const widthEnv = Math.sin(Math.min(1, u * 0.92 + 0.08) * Math.PI) * 1.12 + 0.16 * (1 - u);
      const wx = lp.getX(k) * widthEnv;
      const outR = u * (1.52 + upperWhorl * 0.16);
      const archY = Math.sin(u * Math.PI * 0.72) * (0.46 + upperWhorl * 0.18) - u * u * (0.78 - upperWhorl * 0.14);
      lp.setXYZ(k, wx, archY - Math.abs(wx) * 0.18 + lp.getZ(k) * 0.22 * (1 - u * 0.7), -outR);
    }
    leafG.computeVertexNormals();
    leafG.rotateY(a);
    xf(leafG, [top[0], top[1] - 0.02, top[2]]);
    parts.push(paintGeo(leafG, upperWhorl ? C(leafA) : C(leafB), 0.10, 0.48, 95 + i));
  }
  return normalizeHeight(parts, 5.20);
}

function buildStiltMangrove(nz: Noise2): G {
  const parts: G[] = [
    // Single grounded flared stem curving organically into forked canopy branches
    paintGeo(xf(new THREE.CylinderGeometry(0.20, 0.34, 0.42, 7, 1), [0, 0.08, 0]), C(0x4c3626), 0.10, 0.12, 111, 1),
    paintGeo(curveTube([[0, -0.10, 0], [0.05, 1.15, 0.03], [-0.04, 2.25, -0.02], [0.02, 3.22, 0.02]], 0.21, 0.11, 6), C(0x523b2a), 0.10, 0.15, 110, 1),
    paintGeo(curveTube([[0, 2.18, 0], [0.58, 2.95, 0.28]], 0.115, 0.06, 4), C(0x583f2d), 0.10, 0.14, 118, 1),
    paintGeo(curveTube([[0, 2.24, 0], [-0.56, 3.00, -0.26]], 0.115, 0.06, 4), C(0x583f2d), 0.10, 0.14, 119, 1),
    paintGeo(curveTube([[0, 2.26, 0], [-0.20, 2.96, 0.52]], 0.105, 0.055, 4), C(0x583f2d), 0.10, 0.14, 117, 1),
  ];
  const domes: [number, number, number, number, number][] = [
    [0, 3.38, 0, 1.22, 0x28784a],
    [0.64, 3.10, 0.30, 0.88, 0x3b945e],
    [-0.60, 3.16, -0.28, 0.90, 0x2e8552],
    [-0.22, 3.08, 0.54, 0.80, 0x328c56],
    [0.08, 4.06, -0.06, 0.94, 0x45a368],
  ];
  domes.forEach(([x, y, z, r, hex], i) =>
    parts.push(paintGeo(xf(crownBlob(r, nz, 0.21, 60 + i * 2.5), [x, y, z], [1.10, 0.78, 1.10]), C(hex), 0.08, 0.48, 120 + i)),
  );
  return normalizeHeight(parts, 4.95, 1.54);
}

function buildCanopyBanyan(nz: Noise2): G {
  const parts: G[] = [
    // Single flared buttressed main trunk + wide spreading upper canopy boughs
    paintGeo(xf(new THREE.CylinderGeometry(0.32, 0.54, 0.46, 7, 1), [0, 0.11, 0]), C(0x4f3826), 0.12, 0.12, 129, 1),
    paintGeo(curveTube([[0, -0.10, 0], [0.06, 1.12, 0.04], [-0.04, 2.24, -0.02], [0.02, 3.30, 0.02]], 0.34, 0.16, 6), C(0x5a402c), 0.12, 0.15, 130, 1),
    paintGeo(curveTube([[0, 2.10, 0], [0.58, 2.66, 0.24], [1.02, 3.20, 0.40]], 0.18, 0.085, 5), C(0x5e432e), 0.10, 0.14, 136, 1),
    paintGeo(curveTube([[0, 2.16, 0], [-0.56, 2.70, -0.22], [-0.98, 3.24, -0.36]], 0.18, 0.085, 5), C(0x5e432e), 0.10, 0.14, 137, 1),
    paintGeo(curveTube([[0, 2.08, 0], [-0.14, 2.64, 0.52], [-0.24, 3.14, 0.86]], 0.15, 0.075, 5), C(0x5e432e), 0.10, 0.14, 138, 1),
    paintGeo(curveTube([[0, 2.14, 0], [0.30, 2.68, -0.42], [0.50, 3.20, -0.70]], 0.15, 0.075, 5), C(0x5e432e), 0.10, 0.14, 139, 1),
  ];
  const tables: [number, number, number, number, number][] = [
    [0, 3.64, 0, 1.48, 0x2f7d36],
    [0.98, 3.32, 0.40, 0.98, 0x499946],
    [-0.96, 3.36, -0.36, 1.00, 0x398c3e],
    [0.10, 4.34, -0.06, 1.16, 0x52a64c],
    [-0.24, 3.26, 0.84, 0.88, 0x2c7333],
    [0.48, 3.30, -0.68, 0.86, 0x3f9141],
  ];
  tables.forEach(([x, y, z, r, hex], i) =>
    parts.push(paintGeo(xf(crownBlob(r, nz, 0.22, 80 + i * 3.3), [x, y, z], [1.18, 0.64, 1.18]), C(hex), 0.08, 0.52, 140 + i)),
  );
  return normalizeHeight(parts, 5.10, 1.66);
}

function buildCoralBlossom(nz: Noise2): G {
  const parts: G[] = [
    paintGeo(curveTube([[0, -0.09, 0], [-0.16, 1.45, 0.10], [0.15, 2.82, -0.07], [0.30, 3.74, 0.12]], 0.19, 0.075, 6), C(0x8e7966), 0.10, 0.18, 150, 1),
    paintGeo(curveTube([[-0.08, 1.88, 0.06], [-0.62, 2.98, 0.26], [-0.82, 3.48, 0.32]], 0.115, 0.052, 4), C(0x8e7966), 0.10, 0.18, 151, 1),
    paintGeo(curveTube([[0.10, 2.38, -0.04], [0.58, 3.34, -0.40]], 0.095, 0.048, 4), C(0x8a7562), 0.10, 0.18, 152, 1),
  ];
  const pads: [number, number, number, number, number][] = [
    [0.30, 3.92, 0.12, 1.08, 0x3ca378],
    [-0.82, 3.58, 0.32, 0.92, 0xe06d70],
    [-0.10, 4.46, -0.16, 1.00, 0x4db88a],
    [0.58, 3.46, -0.42, 0.80, 0xeb8878],
  ];
  pads.forEach(([x, y, z, r, hex], i) =>
    parts.push(paintGeo(xf(crownBlob(r, nz, 0.18, 95 + i * 2.9), [x, y, z], [1.18, 0.50, 1.18]), C(hex), 0.10, 0.55, 155 + i)),
  );
  return normalizeHeight(parts, 5.05, 1.48);
}

function buildDesertDrySnag(nz: Noise2): G {
  const parts: G[] = [
    paintGeo(curveTube([[0, -0.09, 0], [0.08, 1.30, -0.04], [-0.12, 2.70, 0.08], [-0.26, 4.18, 0.15]], 0.21, 0.018, 6), C(0xa88760), 0.14, 0.28, 170, 1),
    paintGeo(curveTube([[0.04, 1.50, -0.02], [0.58, 2.50, 0.26], [0.96, 3.45, 0.38]], 0.12, 0.034, 5), C(0xb5956c), 0.14, 0.28, 171, 1),
    paintGeo(curveTube([[-0.06, 2.10, 0.04], [-0.64, 2.95, -0.32], [-0.92, 3.65, -0.48]], 0.10, 0.028, 5), C(0x9c7b54), 0.14, 0.28, 172, 1),
    paintGeo(curveTube([[0.42, 2.25, 0.18], [0.52, 3.12, -0.30]], 0.068, 0.016, 4), C(0xb89870), 0.12, 0.25, 173, 1),
    paintGeo(xf(crownBlob(0.58, nz, 0.26, 111), [0.92, 3.55, 0.36], [1.22, 0.56, 1.22]), C(0x8c7f45), 0.12, 0.40, 174),
    paintGeo(xf(crownBlob(0.48, nz, 0.24, 116), [-0.88, 3.72, -0.46], [1.16, 0.54, 1.16]), C(0x9b8a4e), 0.12, 0.40, 175),
  ];
  return normalizeHeight(parts, 4.85);
}

function buildJoshuaAcacia(nz: Noise2): G {
  const parts: G[] = [
    paintGeo(xf(new THREE.CylinderGeometry(0.18, 0.30, 0.38, 6, 1), [0, 0.08, 0]), C(0x6c5035), 0.12, 0.16, 179, 1),
    paintGeo(curveTube([[0, -0.09, 0], [0.14, 1.32, 0.07], [-0.03, 2.48, -0.05], [0.02, 3.04, -0.04]], 0.20, 0.10, 6), C(0x7a5c3e), 0.12, 0.20, 180, 1),
    paintGeo(curveTube([[0.04, 1.92, 0.02], [0.72, 2.86, 0.28]], 0.115, 0.072, 4), C(0x7a5c3e), 0.12, 0.20, 181, 1),
    paintGeo(curveTube([[0.01, 2.08, -0.02], [-0.68, 2.96, -0.24]], 0.115, 0.072, 4), C(0x7a5c3e), 0.12, 0.20, 182, 1),
  ];
  const crowns: [number, number, number, number, number][] = [
    [0.02, 3.16, -0.04, 0.92, 0x768242],
    [0.75, 3.06, 0.30, 0.85, 0x8a944e],
    [-0.72, 3.12, -0.26, 0.82, 0x6f7b3d],
  ];
  crowns.forEach(([x, y, z, r, hex], i) =>
    parts.push(paintGeo(xf(crownBlob(r, nz, 0.25, 130 + i * 3.7), [x, y, z], [1.35, 0.54, 1.35]), C(hex), 0.10, 0.45, 185 + i)),
  );
  return normalizeHeight(parts, 4.95);
}

export function buildTreeBreedGeo(breed: TreeBreedId, seed = 17): THREE.BufferGeometry {
  const nz = new Noise2(seed);
  switch (breed) {
    case 'alpinePine': return buildAlpinePine();
    case 'silverBirch': return buildSilverBirch(nz);
    case 'ancientOak': return buildAncientOak(nz);
    case 'weepingWillow': return buildWeepingWillow(nz);
    case 'coconutPalm': return buildStemmedPalm(0x8a6a46, 0x3e9638, 0x5cb34c, 0x6b4a2a, 0.54, 10);
    case 'stiltMangrove': return buildStiltMangrove(nz);
    case 'canopyBanyan': return buildCanopyBanyan(nz);
    case 'coralBlossom': return buildCoralBlossom(nz);
    case 'oasisDatePalm': return buildStemmedPalm(0x7c5b3b, 0x6b8e4e, 0x87a362, 0xd48c2a, 0.24, 10);
    case 'desertDrySnag': return buildDesertDrySnag(nz);
    case 'joshuaAcacia': return buildJoshuaAcacia(nz);
  }
}

export function buildBiomeTreeAtlasGeo(biome: PlanetKind, seed = 17): THREE.BufferGeometry {
  const specs = BREEDS_BY_BIOME[biome];
  const parts: THREE.BufferGeometry[] = [];
  for (const spec of specs) {
    const g = buildTreeBreedGeo(spec.id, seed + spec.breedIndex * 13);
    const nonIdx = g.index ? g.toNonIndexed() : g;
    const vCount = nonIdx.getAttribute('position').count;
    const breedAttr = new Float32Array(vCount).fill(spec.breedIndex);
    nonIdx.setAttribute('aBreed', new THREE.BufferAttribute(breedAttr, 1));
    parts.push(nonIdx);
  }
  const merged = mergeGeometries(parts)!;
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}
