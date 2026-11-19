import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PlanetKind } from '../../planets/PlanetSpec';
import { Noise2, mulberry32 } from './noise';

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
  { id: 'alpinePine', label: 'Alpine Conifer Pine', biome: 'forestRock', breedIndex: 0, windCompliance: 0.85, moisturePref: 'dry', canopyShape: 'conical', scaleRangeXZ: [0.85, 1.15], scaleRangeY: [0.95, 1.38] },
  { id: 'silverBirch', label: 'Silver Paper Birch', biome: 'forestRock', breedIndex: 1, windCompliance: 1.35, moisturePref: 'mesic', canopyShape: 'columnar', scaleRangeXZ: [0.76, 1.04], scaleRangeY: [0.92, 1.30] },
  { id: 'ancientOak', label: 'Gnarled Highland Oak', biome: 'forestRock', breedIndex: 2, windCompliance: 0.62, moisturePref: 'mesic', canopyShape: 'broadDome', scaleRangeXZ: [1.05, 1.42], scaleRangeY: [0.82, 1.16] },
  { id: 'weepingWillow', label: 'Riparian Weeping Willow', biome: 'forestRock', breedIndex: 3, windCompliance: 1.55, moisturePref: 'wet', canopyShape: 'pendulous', scaleRangeXZ: [1.02, 1.35], scaleRangeY: [0.84, 1.15] },
  // oceanForest (Tropical / Coastal Archipelago — 4 breeds)
  { id: 'coconutPalm', label: 'Coastal Coconut Palm', biome: 'oceanForest', breedIndex: 0, windCompliance: 1.60, moisturePref: 'mesic', canopyShape: 'palmCrown', scaleRangeXZ: [0.86, 1.22], scaleRangeY: [0.96, 1.36] },
  { id: 'stiltMangrove', label: 'Coastal Stilt Mangrove', biome: 'oceanForest', breedIndex: 1, windCompliance: 0.78, moisturePref: 'wet', canopyShape: 'broadDome', scaleRangeXZ: [0.98, 1.32], scaleRangeY: [0.78, 1.06] },
  { id: 'canopyBanyan', label: 'Emergent Rainforest Banyan', biome: 'oceanForest', breedIndex: 2, windCompliance: 0.58, moisturePref: 'mesic', canopyShape: 'broadDome', scaleRangeXZ: [1.08, 1.48], scaleRangeY: [0.92, 1.28] },
  { id: 'coralBlossom', label: 'Flowering Reef Coral-Tree', biome: 'oceanForest', breedIndex: 3, windCompliance: 1.12, moisturePref: 'dry', canopyShape: 'gnarled', scaleRangeXZ: [0.92, 1.28], scaleRangeY: [0.82, 1.14] },
  // dune (Arid Desert / Oasis / Badlands — 3 breeds = 11 total)
  { id: 'oasisDatePalm', label: 'Oasis Date Palm', biome: 'dune', breedIndex: 0, windCompliance: 1.25, moisturePref: 'wet', canopyShape: 'palmCrown', scaleRangeXZ: [0.88, 1.24], scaleRangeY: [0.92, 1.32] },
  { id: 'desertDrySnag', label: 'Sun-Bleached Dry Snag', biome: 'dune', breedIndex: 1, windCompliance: 0.28, moisturePref: 'dry', canopyShape: 'gnarled', scaleRangeXZ: [0.82, 1.25], scaleRangeY: [0.78, 1.18] },
  { id: 'joshuaAcacia', label: 'Twisted Thorn Joshua-Acacia', biome: 'dune', breedIndex: 2, windCompliance: 0.55, moisturePref: 'mesic', canopyShape: 'gnarled', scaleRangeXZ: [0.90, 1.30], scaleRangeY: [0.82, 1.16] },
] as const;

export const BREEDS_BY_BIOME: Readonly<Record<PlanetKind, readonly TreeBreedSpec[]>> = {
  forestRock: TREE_BREEDS.filter((b) => b.biome === 'forestRock'),
  oceanForest: TREE_BREEDS.filter((b) => b.biome === 'oceanForest'),
  dune: TREE_BREEDS.filter((b) => b.biome === 'dune'),
};

export function getTreeBreedSpec(id: TreeBreedId): TreeBreedSpec {
  return TREE_BREEDS.find((b) => b.id === id) ?? TREE_BREEDS[0]!;
}

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

function paintGeo(g: G, color: THREE.Color, jitter = 0.08, topBoost = 0.35, seed = 1, bark = 0): G {
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

function crownBlob(radius: number, nz: Noise2, amp: number, seedOff: number, detail?: number): G {
  const g = new THREE.IcosahedronGeometry(radius, detail ?? (radius >= 1.18 ? 1 : 0));
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const d = 1 + amp * nz.n(x * 1.7 + seedOff, y * 1.7 + z * 1.3);
    p.setXYZ(i, x * d, y * d, z * d);
  }
  g.computeVertexNormals();
  return g;
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
  if (minY > -0.05) merged.translate(0, -0.07 - minY, 0);
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
  const parts: G[] = [];
  const tiers: [number, number, number][] = [
    [1.76, 1.55, 0.70],
    [1.46, 1.48, 1.62],
    [1.16, 1.38, 2.52],
    [0.84, 1.28, 3.38],
    [0.48, 1.12, 4.18],
  ];
  tiers.forEach(([r, h, yCenter], i) => {
    const g = new THREE.ConeGeometry(r, h, 7, 1);
    const p = g.getAttribute('position');
    for (let k = 0; k < p.count; k++) {
      const s = 1 + 0.13 * Math.sin(k * 7.3 + i * 2.1);
      p.setX(k, p.getX(k) * s);
      p.setZ(k, p.getZ(k) * s);
    }
    parts.push(paintGeo(xf(g, [0, yCenter, 0]), i % 2 ? C(0x2b6238) : C(0x3d7a47), 0.08, 0.38, 30 + i));
  });
  return normalizeHeight(parts, 5.25);
}

function buildSilverBirch(nz: Noise2): G {
  const crowns: [number, number, number, number, [number, number, number], number][] = [
    [0, 0.42, 0, 0.76, [1.02, 0.66, 1.02], 0x6a9c3e],
    [0.16, 1.38, 0.08, 0.92, [0.88, 1.12, 0.88], 0x76a844],
    [-0.26, 2.02, -0.10, 0.86, [0.84, 1.15, 0.84], 0x92bf4e],
    [0.18, 2.86, 0.06, 0.88, [0.82, 1.18, 0.82], 0x88b84a],
    [-0.14, 3.68, -0.05, 0.78, [0.78, 1.16, 0.78], 0x9ec958],
    [0.08, 4.35, 0.02, 0.62, [0.74, 1.14, 0.74], 0xaed466],
  ];
  const parts = crowns.map(([x, y, z, r, sc, hex], i) =>
    paintGeo(xf(crownBlob(r, nz, 0.24, 10 + i * 2.7), [x, y, z], sc), C(hex), 0.10, 0.5, 50 + i),
  );
  return normalizeHeight(parts, 5.15);
}

function buildAncientOak(nz: Noise2): G {
  const domes: [number, number, number, number, [number, number, number], number][] = [
    [0, 0.56, 0, 1.06, [1.15, 0.62, 1.15], 0x336531],
    [0.72, 1.25, 0.32, 0.98, [1.08, 0.82, 1.08], 0x417838],
    [-0.74, 1.30, -0.28, 1.00, [1.08, 0.82, 1.08], 0x396e34],
    [0, 2.25, 0, 1.42, [1.14, 0.84, 1.14], 0x356933],
    [0.88, 2.10, 0.36, 1.02, [1.10, 0.80, 1.10], 0x487f3c],
    [-0.86, 2.15, -0.32, 1.04, [1.10, 0.80, 1.10], 0x3d7337],
    [0.20, 2.40, -0.78, 0.92, [1.06, 0.80, 1.06], 0x4d843f],
    [-0.22, 2.35, 0.78, 0.90, [1.06, 0.80, 1.06], 0x3a7036],
    [0.04, 3.38, 0.04, 1.04, [1.12, 0.84, 1.12], 0x548c44],
  ];
  const parts = domes.map(([x, y, z, r, sc, hex], i) =>
    paintGeo(xf(crownBlob(r, nz, 0.25, 25 + i * 3.1), [x, y, z], sc), C(hex), 0.09, 0.52, 70 + i),
  );
  return normalizeHeight(parts, 4.95);
}

function buildWeepingWillow(nz: Noise2): G {
  const parts: G[] = [
    paintGeo(xf(crownBlob(1.02, nz, 0.18, 38, 1), [0, 0.62, 0], [1.12, 0.68, 1.12]), C(0x4a8244), 0.08, 0.38, 81),
    paintGeo(xf(crownBlob(1.28, nz, 0.20, 40, 1), [0.06, 2.15, 0.04], [1.16, 0.92, 1.16]), C(0x5c9452), 0.08, 0.45, 82),
    paintGeo(xf(crownBlob(0.98, nz, 0.20, 44, 0), [-0.28, 3.05, -0.14], [1.10, 0.80, 1.10]), C(0x69a25c), 0.08, 0.45, 83),
  ];
  // Cascading pendulous willow foliage curtains sweeping directly down to ground level (stemless).
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.25;
    const ca = Math.cos(a), sa = Math.sin(a);
    parts.push(
      paintGeo(
        curveTube(
          [
            [0.04 + ca * 0.54, 3.10, 0.02 + sa * 0.54],
            [0.04 + ca * 1.06, 1.78, 0.02 + sa * 1.06],
            [0.04 + ca * 1.18, -0.06, 0.02 + sa * 1.18],
          ],
          0.28,
          0.11,
          5,
          5,
        ),
        i % 2 ? C(0x6da65f) : C(0x558c4b),
        0.09,
        0.42,
        85 + i,
      ),
    );
  }
  return normalizeHeight(parts, 4.75);
}

function buildStemlessPalm(baseHex: number, leafA: number, leafB: number, fruitHex: number, fronds = 10, scaleH = 4.35): G {
  const parts: G[] = [
    paintGeo(xf(new THREE.IcosahedronGeometry(0.66, 1), [0, 0.28, 0], [1.14, 0.56, 1.14]), C(baseHex), 0.10, 0.30, 91),
    paintGeo(xf(new THREE.IcosahedronGeometry(0.28, 0), [0, 0.56, 0]), C(fruitHex), 0.10, 0.25, 99),
  ];
  for (let i = 0; i < fronds; i++) {
    const inner = i % 2 === 0;
    const a = (i / fronds) * Math.PI * 2 + (inner ? 0.08 : 0.22);
    const len = inner ? 2.35 : 2.05;
    const leafG = new THREE.ConeGeometry(inner ? 0.32 : 0.36, len, 4, 3);
    const lp = leafG.getAttribute('position');
    for (let k = 0; k < lp.count; k++) {
      const t = Math.min(1, Math.max(0, (lp.getY(k) + len * 0.5) / len));
      lp.setXYZ(k, lp.getX(k) * (1.22 - 0.52 * t), t * (inner ? 2.15 : 1.48), -Math.pow(t, 1.7) * (inner ? 0.92 : 1.38));
    }
    leafG.rotateX(inner ? -0.34 : -0.58);
    leafG.rotateY(a);
    xf(leafG, [0, inner ? 0.42 : 0.28, 0]);
    parts.push(paintGeo(leafG, i % 2 ? C(leafA) : C(leafB), 0.10, 0.48, 95 + i));
  }
  return normalizeHeight(parts, scaleH);
}

function buildStiltMangrove(nz: Noise2): G {
  const domes: [number, number, number, number, [number, number, number], number][] = [
    [0, 0.48, 0, 1.04, [1.16, 0.55, 1.16], 0x246b42],
    [0.68, 0.72, 0.32, 0.84, [1.10, 0.72, 1.10], 0x2e8552],
    [-0.66, 0.75, -0.30, 0.86, [1.10, 0.72, 1.10], 0x36905b],
    [0, 1.65, 0, 1.32, [1.12, 0.82, 1.12], 0x28784a],
    [0.64, 1.52, -0.38, 0.88, [1.06, 0.78, 1.06], 0x3b945e],
    [-0.58, 1.58, 0.42, 0.88, [1.06, 0.78, 1.06], 0x2e8552],
    [0.06, 2.75, -0.06, 0.96, [1.08, 0.82, 1.08], 0x45a368],
  ];
  const parts = domes.map(([x, y, z, r, sc, hex], i) =>
    paintGeo(xf(crownBlob(r, nz, 0.22, 60 + i * 2.5), [x, y, z], sc), C(hex), 0.08, 0.48, 120 + i),
  );
  return normalizeHeight(parts, 4.45);
}

function buildCanopyBanyan(nz: Noise2): G {
  const tables: [number, number, number, number, [number, number, number], number][] = [
    [0, 0.52, 0, 1.12, [1.22, 0.54, 1.22], 0x296b30],
    [0.68, 1.05, 0.35, 0.96, [1.18, 0.62, 1.18], 0x34823b],
    [-0.66, 1.10, -0.32, 0.96, [1.18, 0.62, 1.18], 0x2e7a34],
    [0, 2.05, 0, 1.52, [1.24, 0.68, 1.24], 0x2f7d36],
    [0.86, 1.92, 0.36, 1.04, [1.20, 0.64, 1.20], 0x499946],
    [-0.84, 1.96, -0.34, 1.04, [1.20, 0.64, 1.20], 0x398c3e],
    [0.08, 3.12, -0.05, 1.18, [1.22, 0.68, 1.22], 0x52a64c],
  ];
  const parts = tables.map(([x, y, z, r, sc, hex], i) =>
    paintGeo(xf(crownBlob(r, nz, 0.24, 80 + i * 3.3), [x, y, z], sc), C(hex), 0.08, 0.52, 140 + i),
  );
  return normalizeHeight(parts, 4.90);
}

function buildCoralBlossom(nz: Noise2): G {
  const pads: [number, number, number, number, [number, number, number], number][] = [
    [0, 0.46, 0, 0.98, [1.22, 0.55, 1.22], 0x328f6a],
    [-0.58, 1.12, 0.24, 0.92, [1.24, 0.54, 1.24], 0xe06d70],
    [0.54, 1.38, -0.30, 0.90, [1.24, 0.54, 1.24], 0x3ca378],
    [0.14, 2.15, 0.10, 1.18, [1.28, 0.52, 1.28], 0x4db88a],
    [-0.36, 2.65, 0.22, 0.96, [1.22, 0.52, 1.22], 0xeb8878],
    [0.04, 3.25, -0.08, 0.92, [1.20, 0.52, 1.20], 0x56c496],
  ];
  const parts = pads.map(([x, y, z, r, sc, hex], i) =>
    paintGeo(xf(crownBlob(r, nz, 0.20, 95 + i * 2.9), [x, y, z], sc), C(hex), 0.10, 0.55, 155 + i),
  );
  return normalizeHeight(parts, 4.55);
}

function buildDesertDrySnag(nz: Noise2): G {
  const tufts: [number, number, number, number, [number, number, number], number][] = [
    [0, 0.36, 0, 0.72, [1.14, 0.62, 1.14], 0x8a7542],
    [0.42, 0.96, 0.18, 0.68, [1.12, 0.68, 1.12], 0x9c864e],
    [-0.38, 1.14, -0.16, 0.66, [1.10, 0.68, 1.10], 0x7f6c3d],
    [0.08, 1.82, 0.04, 0.78, [1.08, 0.76, 1.08], 0xa58d53],
    [-0.28, 2.38, -0.08, 0.62, [1.08, 0.68, 1.08], 0x8e7c44],
    [0.22, 2.86, 0.10, 0.56, [1.10, 0.62, 1.10], 0xb29a5d],
  ];
  const parts = tufts.map(([x, y, z, r, sc, hex], i) =>
    paintGeo(xf(crownBlob(r, nz, 0.28, 111 + i * 3.1), [x, y, z], sc), C(hex), 0.12, 0.40, 174 + i),
  );
  return normalizeHeight(parts, 4.10);
}

function buildJoshuaAcacia(nz: Noise2): G {
  const crowns: [number, number, number, number, [number, number, number], number][] = [
    [0, 0.40, 0, 0.80, [1.24, 0.60, 1.24], 0x677238],
    [0.54, 1.06, 0.24, 0.78, [1.28, 0.55, 1.28], 0x768242],
    [-0.52, 1.16, -0.22, 0.76, [1.28, 0.55, 1.28], 0x6f7b3d],
    [0.02, 1.88, -0.02, 0.96, [1.34, 0.54, 1.34], 0x828f48],
    [0.58, 2.25, 0.22, 0.76, [1.32, 0.52, 1.32], 0x8a944e],
    [-0.54, 2.48, -0.18, 0.74, [1.30, 0.52, 1.30], 0x768242],
  ];
  const parts = crowns.map(([x, y, z, r, sc, hex], i) =>
    paintGeo(xf(crownBlob(r, nz, 0.25, 130 + i * 3.7), [x, y, z], sc), C(hex), 0.10, 0.45, 185 + i),
  );
  return normalizeHeight(parts, 4.25);
}

export function buildTreeBreedGeo(breed: TreeBreedId, seed = 17): THREE.BufferGeometry {
  const nz = new Noise2(seed);
  switch (breed) {
    case 'alpinePine': return buildAlpinePine();
    case 'silverBirch': return buildSilverBirch(nz);
    case 'ancientOak': return buildAncientOak(nz);
    case 'weepingWillow': return buildWeepingWillow(nz);
    case 'coconutPalm': return buildStemlessPalm(0x327532, 0x3e9638, 0x5cb34c, 0x6b4a2a, 10, 4.45);
    case 'stiltMangrove': return buildStiltMangrove(nz);
    case 'canopyBanyan': return buildCanopyBanyan(nz);
    case 'coralBlossom': return buildCoralBlossom(nz);
    case 'oasisDatePalm': return buildStemlessPalm(0x55703c, 0x6b8e4e, 0x87a362, 0xd48c2a, 11, 4.20);
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
