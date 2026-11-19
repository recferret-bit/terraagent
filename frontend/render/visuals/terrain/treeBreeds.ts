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

function normalizeHeight(parts: G[], targetH = 5.45, maxRad = 1.80): G {
  const merged = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)))!;
  merged.computeBoundingBox();
  const bb = merged.boundingBox!;
  const curH = Math.max(0.5, bb.max.y);
  const s = targetH / curH;
  merged.scale(s, s, s);
  const pos = merged.getAttribute('position');
  let rMax = 0;
  for (let i = 0; i < pos.count; i++) {
    rMax = Math.max(rMax, Math.hypot(pos.getX(i), pos.getZ(i)));
  }
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
  const parts: G[] = [paintGeo(xf(new THREE.CylinderGeometry(0.10, 0.22, 1.8, 6, 1), [0, 0.85, 0]), C(0x4a3424), 0.1, 0.1, 2, 1)];
  const tiers: [number, number, number][] = [[1.65, 1.55, 1.15], [1.38, 1.48, 2.22], [1.08, 1.38, 3.22], [0.76, 1.28, 4.10], [0.42, 1.10, 4.88]];
  tiers.forEach(([r, h, y], i) => {
    const g = new THREE.ConeGeometry(r, h, 7, 1);
    const p = g.getAttribute('position');
    for (let k = 0; k < p.count; k++) {
      const s = 1 + 0.13 * Math.sin(k * 7.3 + i * 2.1);
      p.setX(k, p.getX(k) * s);
      p.setZ(k, p.getZ(k) * s);
    }
    parts.push(paintGeo(xf(g, [0, y + h / 2 - 0.18, 0]), i % 2 ? C(0x2b6238) : C(0x3d7a47), 0.08, 0.38, 30 + i));
  });
  return normalizeHeight(parts);
}

function buildSilverBirch(nz: Noise2): G {
  const parts: G[] = [
    paintGeo(curveTube([[0, -0.08, 0], [0.06, 1.5, 0.03], [0.22, 3.3, 0.08], [0.16, 4.6, 0.02]], 0.14, 0.05), C(0xdad6cc), 0.14, 0.15, 41, 1),
    paintGeo(curveTube([[0.03, 0.9, 0], [-0.24, 2.5, -0.10], [-0.36, 4.0, -0.14]], 0.09, 0.04, 5), C(0xcfcac0), 0.14, 0.15, 42, 1),
  ];
  const crowns: [number, number, number, number, number][] = [
    [0.18, 3.2, 0.08, 0.95, 0x76a844], [-0.34, 3.5, -0.12, 0.86, 0x92bf4e],
    [0.14, 4.4, 0.04, 0.88, 0x88b84a], [-0.15, 4.9, -0.04, 0.72, 0xa3cc5c], [0.38, 2.5, 0.18, 0.68, 0x6a9c3e],
  ];
  crowns.forEach(([x, y, z, r, hex], i) =>
    parts.push(paintGeo(xf(crownBlob(r, nz, 0.24, 10 + i * 2.7), [x, y, z], [0.86, 1.18, 0.86]), C(hex), 0.10, 0.5, 50 + i)),
  );
  return normalizeHeight(parts);
}

function buildAncientOak(nz: Noise2): G {
  const parts: G[] = [
    paintGeo(xf(new THREE.CylinderGeometry(0.22, 0.38, 1.9, 7, 1), [0, 0.88, 0]), C(0x473323), 0.12, 0.1, 61, 1),
    paintGeo(curveTube([[0, 1.5, 0], [0.65, 2.3, 0.28], [1.05, 2.9, 0.42]], 0.16, 0.07, 4), C(0x4a3525), 0.1, 0.1, 62, 1),
    paintGeo(curveTube([[0, 1.55, 0], [-0.68, 2.35, -0.22], [-1.02, 2.95, -0.35]], 0.15, 0.07, 4), C(0x4a3525), 0.1, 0.1, 63, 1),
  ];
  const domes: [number, number, number, number, number][] = [
    [0, 3.4, 0, 1.45, 0x356933], [0.95, 3.0, 0.38, 1.05, 0x487f3c], [-0.92, 3.05, -0.32, 1.08, 0x3d7337],
    [0.25, 3.2, -0.82, 0.95, 0x4d843f], [-0.28, 3.15, 0.84, 0.92, 0x3a7036], [0.05, 4.35, 0.05, 1.05, 0x548c44],
  ];
  domes.forEach(([x, y, z, r, hex], i) =>
    parts.push(paintGeo(xf(crownBlob(r, nz, 0.26, 25 + i * 3.1), [x, y, z], [1.14, 0.82, 1.14]), C(hex), 0.09, 0.52, 70 + i)),
  );
  return normalizeHeight(parts);
}

function buildWeepingWillow(nz: Noise2): G {
  const parts: G[] = [
    paintGeo(curveTube([[0, -0.08, 0], [0.12, 1.3, 0.05], [0.28, 2.6, 0.10], [0.18, 3.6, 0.06]], 0.22, 0.09, 6), C(0x564332), 0.1, 0.15, 81, 1),
    paintGeo(xf(crownBlob(1.32, nz, 0.2, 40, 1), [0.16, 3.85, 0.05], [1.18, 0.78, 1.18]), C(0x5c9452), 0.08, 0.45, 82),
    paintGeo(xf(crownBlob(0.96, nz, 0.2, 44, 0), [-0.36, 3.55, -0.18], [1.12, 0.72, 1.12]), C(0x69a25c), 0.08, 0.45, 83),
  ];
  // Cascading pendulous willow curtains: arch outward from the crown dome and taper down toward the water/ground.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.25;
    const ca = Math.cos(a), sa = Math.sin(a);
    const len = 2.1 + (i % 3) * 0.26;
    parts.push(
      paintGeo(
        curveTube(
          [
            [0.16 + ca * 0.62, 3.82, 0.05 + sa * 0.62],
            [0.16 + ca * 1.08, 2.95, 0.05 + sa * 1.08],
            [0.16 + ca * 1.16, 3.82 - len, 0.05 + sa * 1.16],
          ],
          0.26,
          0.06,
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
  return normalizeHeight(parts);
}

function buildPalmVariant(trunkHex: number, leafA: number, leafB: number, fruitHex: number, lean = 0.52, fronds = 8): G {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.08, 0),
    new THREE.Vector3(lean * 0.42, 1.45, 0.08),
    new THREE.Vector3(lean * 0.95, 2.95, 0.06),
    new THREE.Vector3(lean * 0.86, 4.30, 0.0),
  ]);
  const parts: G[] = [paintGeo(new THREE.TubeGeometry(curve, 8, 0.14, 6, false), C(trunkHex), 0.13, 0.22, 91, 1)];
  const top = curve.getPoint(1);
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + (i % 2) * 0.14;
    const leafG = new THREE.ConeGeometry(0.34, 2.15, 4, 3);
    const lp = leafG.getAttribute('position');
    for (let k = 0; k < lp.count; k++) {
      const t = Math.min(1, Math.max(0, (lp.getY(k) + 1.075) / 2.15));
      lp.setXYZ(k, lp.getX(k) * (1.2 - 0.5 * t), t * 1.65, -Math.pow(t, 1.75) * 1.25);
    }
    leafG.rotateX(-0.52);
    leafG.rotateY(a);
    xf(leafG, [top.x, top.y - 0.05, top.z]);
    parts.push(paintGeo(leafG, i % 2 ? C(leafA) : C(leafB), 0.10, 0.48, 95 + i));
  }
  parts.push(paintGeo(xf(new THREE.IcosahedronGeometry(0.24, 0), [top.x, top.y - 0.16, top.z]), C(fruitHex), 0.1, 0.2, 99));
  return normalizeHeight(parts);
}

function buildStiltMangrove(nz: Noise2): G {
  const parts: G[] = [paintGeo(xf(new THREE.CylinderGeometry(0.14, 0.22, 2.65, 6, 1), [0, 1.24, 0]), C(0x523b2a), 0.1, 0.15, 110, 1)];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.2;
    parts.push(
      paintGeo(
        curveTube(
          [[0, 1.25, 0], [Math.cos(a) * 0.52, 0.72, Math.sin(a) * 0.52], [Math.cos(a) * 0.78, -0.10, Math.sin(a) * 0.78]],
          0.08,
          0.045,
          5,
        ),
        C(0x5d4330),
        0.1,
        0.1,
        112 + i,
        1,
      ),
    );
  }
  const domes: [number, number, number, number, number][] = [
    [0, 3.05, 0, 1.35, 0x28784a], [0.72, 2.75, 0.35, 0.92, 0x3b945e], [-0.68, 2.80, -0.32, 0.95, 0x2e8552], [0.08, 3.85, -0.10, 0.96, 0x45a368],
  ];
  domes.forEach(([x, y, z, r, hex], i) =>
    parts.push(paintGeo(xf(crownBlob(r, nz, 0.22, 60 + i * 2.5), [x, y, z], [1.12, 0.80, 1.12]), C(hex), 0.08, 0.48, 120 + i)),
  );
  return normalizeHeight(parts);
}

function buildCanopyBanyan(nz: Noise2): G {
  const parts: G[] = [paintGeo(xf(new THREE.CylinderGeometry(0.24, 0.46, 2.4, 7, 1), [0, 1.12, 0]), C(0x5a402c), 0.12, 0.15, 130, 1)];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const x = Math.cos(a) * 0.65, z = Math.sin(a) * 0.65;
    parts.push(paintGeo(xf(new THREE.CylinderGeometry(0.035, 0.055, 2.2, 5, 1), [x, 1.02, z]), C(0x6b4d35), 0.1, 0.1, 132 + i, 1));
  }
  const tables: [number, number, number, number, number][] = [
    [0, 3.55, 0, 1.65, 0x2f7d36], [0.98, 3.15, 0.42, 1.10, 0x499946], [-0.95, 3.20, -0.38, 1.12, 0x398c3e],
    [0.12, 4.45, -0.08, 1.25, 0x52a64c], [-0.22, 2.95, 0.85, 0.92, 0x2c7333],
  ];
  tables.forEach(([x, y, z, r, hex], i) =>
    parts.push(paintGeo(xf(crownBlob(r, nz, 0.24, 80 + i * 3.3), [x, y, z], [1.24, 0.66, 1.24]), C(hex), 0.08, 0.52, 140 + i)),
  );
  return normalizeHeight(parts);
}

function buildCoralBlossom(nz: Noise2): G {
  const parts: G[] = [
    paintGeo(curveTube([[0, -0.08, 0], [-0.18, 1.35, 0.12], [0.16, 2.65, -0.08], [0.35, 3.55, 0.14]], 0.18, 0.07, 6), C(0x8e7966), 0.1, 0.18, 150, 1),
    paintGeo(curveTube([[-0.08, 1.65, 0.06], [-0.68, 2.75, 0.28], [-0.92, 3.25, 0.36]], 0.11, 0.05, 4), C(0x8e7966), 0.1, 0.18, 151, 1),
  ];
  const pads: [number, number, number, number, number][] = [
    [0.34, 3.75, 0.14, 1.22, 0x3ca378], [-0.90, 3.35, 0.36, 1.04, 0xe06d70],
    [-0.12, 4.35, -0.18, 1.10, 0x4db88a], [0.68, 3.05, -0.46, 0.88, 0xeb8878],
  ];
  pads.forEach(([x, y, z, r, hex], i) =>
    parts.push(paintGeo(xf(crownBlob(r, nz, 0.20, 95 + i * 2.9), [x, y, z], [1.28, 0.52, 1.28]), C(hex), 0.10, 0.55, 155 + i)),
  );
  return normalizeHeight(parts);
}

function buildDesertDrySnag(nz: Noise2): G {
  const wood = 0xa88760;
  const parts: G[] = [
    paintGeo(curveTube([[0, -0.08, 0], [0.08, 1.3, -0.04], [-0.12, 2.7, 0.08], [-0.28, 4.1, 0.16]], 0.20, 0.05, 6), C(wood), 0.14, 0.28, 170, 1),
    paintGeo(curveTube([[0.04, 1.5, -0.02], [0.58, 2.5, 0.26], [0.96, 3.45, 0.38]], 0.12, 0.035, 5), C(0xb5956c), 0.14, 0.28, 171, 1),
    paintGeo(curveTube([[-0.06, 2.1, 0.04], [-0.64, 2.95, -0.32], [-0.92, 3.65, -0.48]], 0.10, 0.03, 5), C(0x9c7b54), 0.14, 0.28, 172, 1),
    paintGeo(curveTube([[0.42, 2.25, 0.18], [0.48, 3.05, -0.28]], 0.065, 0.022, 4), C(0xb89870), 0.12, 0.25, 173, 1),
    paintGeo(xf(crownBlob(0.56, nz, 0.26, 111), [0.92, 3.55, 0.36], [1.2, 0.55, 1.2]), C(0x8c7f45), 0.12, 0.4, 174),
  ];
  return normalizeHeight(parts, 4.85);
}

function buildJoshuaAcacia(nz: Noise2): G {
  const parts: G[] = [
    paintGeo(curveTube([[0, -0.08, 0], [0.10, 1.4, 0.06], [0.02, 2.8, -0.04]], 0.19, 0.10, 5), C(0x7a5c3e), 0.12, 0.2, 180, 1),
    paintGeo(curveTube([[0.05, 1.9, 0.02], [0.72, 2.85, 0.28]], 0.11, 0.07, 4), C(0x7a5c3e), 0.12, 0.2, 181, 1),
    paintGeo(curveTube([[0.03, 2.1, -0.02], [-0.68, 2.95, -0.24]], 0.11, 0.07, 4), C(0x7a5c3e), 0.12, 0.2, 182, 1),
  ];
  const crowns: [number, number, number, number, number][] = [
    [0.02, 3.15, -0.04, 0.92, 0x768242], [0.75, 3.05, 0.30, 0.85, 0x8a944e], [-0.72, 3.12, -0.26, 0.82, 0x6f7b3d],
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
    case 'coconutPalm': return buildPalmVariant(0x8a6a46, 0x3e9638, 0x5cb34c, 0x6b4a2a, 0.56, 8);
    case 'stiltMangrove': return buildStiltMangrove(nz);
    case 'canopyBanyan': return buildCanopyBanyan(nz);
    case 'coralBlossom': return buildCoralBlossom(nz);
    case 'oasisDatePalm': return buildPalmVariant(0x7c5b3b, 0x6b8e4e, 0x87a362, 0xd48c2a, 0.24, 9);
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
