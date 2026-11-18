import * as THREE from 'three';
import { hexDistance, hexIndex } from '@terra/sim/grid/hex';
import { cullToViewFocus, worldCellKey } from '../../core/focusCull';
import { WAVE_VERT_PEAK } from '../../visuals/water/waveModel';
import { TILE_M, tileXZ } from './hexMath';
import { WATER_CELL_M } from './waterBuckets';
import { WATERFALL_RENDER_ORDER } from './waterfallMaterial';

const SQRT3_2 = Math.sqrt(3) / 2;
const SIDE_STEPS: readonly (readonly [number, number])[] = [
  [-1, 1],
  [-1, 0],
  [0, -1],
  [1, -1],
  [1, 0],
  [0, 1],
];
const SIDE_NORMALS: readonly (readonly [number, number])[] = [
  [SQRT3_2, 0.5],
  [0, 1],
  [-SQRT3_2, 0.5],
  [-SQRT3_2, -0.5],
  [0, -1],
  [SQRT3_2, -0.5],
];

const CORNER_FILLET_R = 0.28;
const CORNER_TRIM_M = CORNER_FILLET_R / Math.sqrt(3);
const CORNER_FAN_STEPS = 4;
const HALF_EDGE_SUBDIVS = 3;
const BANK_FEATHER_FRAC = 0.55;
const WIND_BOUNDS_PAD_XZ = 0.8;

type ProfilePoint = readonly [outward: number, y: number, drop: number];

const MAIN_PROFILE: readonly ProfilePoint[] = [
  [-0.22, 0.012, 0.0],
  [-0.06, 0.0, 0.05],
  [0.05, -0.1, 0.12],
  [0.16, -0.38, 0.22],
  [0.27, -0.88, 0.36],
  [0.36, -1.62, 0.55],
  [0.42, -2.5, 0.77],
  [0.46, -3.4, 1.0],
];

const VEIL_PROFILE: readonly ProfilePoint[] = [
  [0.08, -0.04, 0.04],
  [0.18, -0.26, 0.14],
  [0.3, -0.68, 0.27],
  [0.42, -1.28, 0.43],
  [0.52, -2.02, 0.62],
  [0.6, -2.82, 0.81],
  [0.65, -3.3, 0.92],
  [0.68, -3.65, 1.0],
];

interface PerimeterNode {
  idx: number;
  x: number;
  z: number;
  isCorner: boolean;
  inNx: number;
  inNz: number;
  outNx: number;
  outNz: number;
}

interface RibbonSample {
  px: number;
  pz: number;
  nx: number;
  nz: number;
  arcM: number;
  bankFade: number;
  depth: number;
}

export interface HexWaterfallSet {
  readonly group: THREE.Group;
  readonly meshes: readonly THREE.Mesh[];
  readonly waterfallTileCount: number;
  readonly triangleCount: number;
  /** Rebuilds perimeter waterfalls from `codes`; skips work when `changedTiles` touches no rim tile. */
  rebuild(codes: ArrayLike<number>, changedTiles?: ArrayLike<number>): void;
  /** Hides waterfall buckets wholly outside the view focus; call once per frame. */
  cullToFocus(): void;
  dispose(): void;
}

function buildPerimeterRing(radius: number): PerimeterNode[] {
  if (radius < 1) return [];
  const hx = hexIndex(radius);
  const ring: PerimeterNode[] = [];
  let q = radius;
  let r = 0;
  for (let s = 0; s < 6; s++) {
    const [dq, dr] = SIDE_STEPS[s]!;
    const [inNx, inNz] = SIDE_NORMALS[(s + 5) % 6]!;
    const [outNx, outNz] = SIDE_NORMALS[s]!;
    for (let k = 0; k < radius; k++) {
      const [x, z] = tileXZ(q, r);
      ring.push({
        idx: hx.indexOf(q, r),
        x,
        z,
        isCorner: k === 0,
        inNx: k === 0 ? inNx : outNx,
        inNz: k === 0 ? inNz : outNz,
        outNx,
        outNz,
      });
      q += dq;
      r += dr;
    }
  }
  return ring;
}

function pushSample(
  out: RibbonSample[],
  px: number,
  pz: number,
  nx: number,
  nz: number,
  bankFade: number,
  depth: number,
): void {
  const prev = out[out.length - 1];
  const arcM = prev ? prev.arcM + Math.hypot(px - prev.px, pz - prev.pz) : 0;
  out.push({ px, pz, nx, nz, arcM, bankFade, depth });
}

function appendTileSamples(
  out: RibbonSample[],
  ring: readonly PerimeterNode[],
  codes: ArrayLike<number>,
  m: number,
  includeStart: boolean,
): void {
  const n = ring.length;
  const prev = ring[(m - 1 + n) % n]!;
  const curr = ring[m]!;
  const next = ring[(m + 1) % n]!;
  const prevWater = (codes[prev.idx] ?? 0) > 0;
  const nextWater = (codes[next.idx] ?? 0) > 0;
  const dCurr = codes[curr.idx] === 2 ? 1 : 0;
  const dPrev = prevWater ? (codes[prev.idx] === 2 ? 1 : 0) : dCurr;
  const dNext = nextWater ? (codes[next.idx] === 2 ? 1 : 0) : dCurr;

  const inMidX = 0.5 * (prev.x + curr.x);
  const inMidZ = 0.5 * (prev.z + curr.z);
  const outMidX = 0.5 * (curr.x + next.x);
  const outMidZ = 0.5 * (curr.z + next.z);
  const trimIn = curr.isCorner ? CORNER_TRIM_M / TILE_M : 0;
  const trimOut = curr.isCorner ? CORNER_TRIM_M / TILE_M : 0;
  const inEndX = inMidX + (curr.x - inMidX) * (1 - trimIn * 2);
  const inEndZ = inMidZ + (curr.z - inMidZ) * (1 - trimIn * 2);
  const outStartX = curr.x + (outMidX - curr.x) * (trimOut * 2);
  const outStartZ = curr.z + (outMidZ - curr.z) * (trimOut * 2);

  for (let s = includeStart ? 0 : 1; s <= HALF_EDGE_SUBDIVS; s++) {
    const t = s / HALF_EDGE_SUBDIVS;
    const bank = prevWater ? 1 : Math.min(1, t / BANK_FEATHER_FRAC);
    const depth = dPrev * (0.5 * (1 - t)) + dCurr * (0.5 + 0.5 * t);
    pushSample(
      out,
      inMidX + (inEndX - inMidX) * t,
      inMidZ + (inEndZ - inMidZ) * t,
      curr.inNx,
      curr.inNz,
      bank,
      prevWater ? depth : dCurr,
    );
  }

  if (curr.isCorner) {
    const bx0 = curr.inNx + curr.outNx;
    const bz0 = curr.inNz + curr.outNz;
    const bl = Math.hypot(bx0, bz0) || 1;
    const offset = CORNER_FILLET_R / SQRT3_2;
    const cx = curr.x - (bx0 / bl) * offset;
    const cz = curr.z - (bz0 / bl) * offset;
    for (let s = 1; s <= CORNER_FAN_STEPS; s++) {
      const t = s / CORNER_FAN_STEPS;
      const rx = curr.inNx * (1 - t) + curr.outNx * t;
      const rz = curr.inNz * (1 - t) + curr.outNz * t;
      const rl = Math.hypot(rx, rz) || 1;
      const nx = rx / rl;
      const nz = rz / rl;
      pushSample(out, cx + nx * CORNER_FILLET_R, cz + nz * CORNER_FILLET_R, nx, nz, 1, dCurr);
    }
  }

  for (let s = 1; s <= HALF_EDGE_SUBDIVS; s++) {
    const t = s / HALF_EDGE_SUBDIVS;
    const bank = nextWater ? 1 : Math.min(1, (1 - t) / BANK_FEATHER_FRAC);
    const depth = dCurr * (1 - 0.5 * t) + dNext * (0.5 * t);
    pushSample(
      out,
      outStartX + (outMidX - outStartX) * t,
      outStartZ + (outMidZ - outStartZ) * t,
      curr.outNx,
      curr.outNz,
      bank,
      nextWater ? depth : dCurr,
    );
  }
}

function collectPerimeterStrips(
  ring: readonly PerimeterNode[],
  codes: ArrayLike<number>,
): { strips: RibbonSample[][]; tileCount: number } {
  const n = ring.length;
  let tileCount = 0;
  for (let m = 0; m < n; m++) if ((codes[ring[m]!.idx] ?? 0) > 0) tileCount++;
  if (tileCount === 0) return { strips: [], tileCount: 0 };

  const strips: RibbonSample[][] = [];
  if (tileCount === n) {
    const strip: RibbonSample[] = [];
    for (let m = 0; m < n; m++) appendTileSamples(strip, ring, codes, m, m === 0);
    strips.push(strip);
    return { strips, tileCount };
  }

  for (let m = 0; m < n; m++) {
    const isStart = (codes[ring[m]!.idx] ?? 0) > 0 && (codes[ring[(m - 1 + n) % n]!.idx] ?? 0) === 0;
    if (!isStart) continue;
    const strip: RibbonSample[] = [];
    let k = 0;
    while (k < n && (codes[ring[(m + k) % n]!.idx] ?? 0) > 0) {
      appendTileSamples(strip, ring, codes, (m + k) % n, k === 0);
      k++;
    }
    if (strip.length >= 2) strips.push(strip);
  }
  return { strips, tileCount };
}

function profileNormals(profile: readonly ProfilePoint[]): Array<readonly [number, number]> {
  return profile.map((_, r) => {
    const a = profile[Math.max(0, r - 1)]!;
    const b = profile[Math.min(profile.length - 1, r + 1)]!;
    const dd = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dd, dy) || 1;
    return [-dy / len, dd / len];
  });
}

const MAIN_NORMALS = profileNormals(MAIN_PROFILE);
const VEIL_NORMALS = profileNormals(VEIL_PROFILE);

interface CellAccum {
  pos: number[];
  nor: number[];
  flow: number[];
  meta: number[];
  idx: number[];
}

function emitLayerSegment(
  acc: CellAccum,
  s0: RibbonSample,
  s1: RibbonSample,
  profile: readonly ProfilePoint[],
  normals: ReadonlyArray<readonly [number, number]>,
  layer: 0 | 1,
): void {
  const rows = profile.length;
  const base0 = acc.pos.length / 3;
  const pushCol = (s: RibbonSample) => {
    for (let r = 0; r < rows; r++) {
      const [outward, y, drop] = profile[r]!;
      const [nOut, nY] = normals[r]!;
      acc.pos.push(s.px + s.nx * outward, y, s.pz + s.nz * outward);
      acc.nor.push(s.nx * nOut, nY, s.nz * nOut);
      acc.flow.push(s.arcM, drop);
      acc.meta.push(s.bankFade, s.depth, layer);
    }
  };
  pushCol(s0);
  const base1 = base0 + rows;
  pushCol(s1);
  for (let r = 0; r < rows - 1; r++) {
    const a = base0 + r;
    const b = base1 + r;
    const c = base1 + r + 1;
    const d = base0 + r + 1;
    acc.idx.push(a, b, c, a, c, d);
  }
}

function buildWaterfallCellGeometry(acc: CellAccum): { geo: THREE.BufferGeometry; tris: number } {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(acc.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(acc.nor, 3));
  geo.setAttribute('aFlowUV', new THREE.Float32BufferAttribute(acc.flow, 2));
  geo.setAttribute('aWaterfallMeta', new THREE.Float32BufferAttribute(acc.meta, 3));
  geo.setIndex(acc.idx);
  geo.computeBoundingBox();
  const box = geo.boundingBox!;
  box.min.x -= WIND_BOUNDS_PAD_XZ;
  box.max.x += WIND_BOUNDS_PAD_XZ;
  box.min.z -= WIND_BOUNDS_PAD_XZ;
  box.max.z += WIND_BOUNDS_PAD_XZ;
  box.min.y -= WAVE_VERT_PEAK;
  box.max.y += WAVE_VERT_PEAK;
  geo.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
  return { geo, tris: acc.idx.length / 3 };
}

function buildCellAccumulators(strips: readonly RibbonSample[][]): Map<string, CellAccum> {
  const byCell = new Map<string, CellAccum>();
  for (const strip of strips) {
    for (let k = 0; k < strip.length - 1; k++) {
      const s0 = strip[k]!;
      const s1 = strip[k + 1]!;
      const key = worldCellKey(0.5 * (s0.px + s1.px), 0.5 * (s0.pz + s1.pz), WATER_CELL_M);
      let acc = byCell.get(key);
      if (!acc) {
        acc = { pos: [], nor: [], flow: [], meta: [], idx: [] };
        byCell.set(key, acc);
      }
      emitLayerSegment(acc, s0, s1, MAIN_PROFILE, MAIN_NORMALS, 0);
      emitLayerSegment(acc, s0, s1, VEIL_PROFILE, VEIL_NORMALS, 1);
    }
  }
  return byCell;
}

/**
 * Spatial buckets of 3D perimeter waterfalls for water tiles sitting along the outer boundary or 6 corners of the
 * ground hexagon. Shares one material and updates only when an outer-ring tile changes.
 */
export function createHexWaterfallSet(radius: number, material: THREE.Material): HexWaterfallSet {
  const hx = hexIndex(radius);
  const ring = buildPerimeterRing(radius);
  const group = new THREE.Group();
  group.name = 'hexWaterfalls';
  const buckets = new Map<string, { mesh: THREE.Mesh; tris: number }>();
  let meshes: THREE.Mesh[] = [];
  let waterfallTileCount = 0;
  let triangleCount = 0;

  const touchesRim = (tiles: ArrayLike<number>): boolean => {
    for (let i = 0; i < tiles.length; i++) {
      const idx = tiles[i]!;
      if (idx >= 0 && idx < hx.count && hexDistance(0, 0, hx.q[idx]!, hx.r[idx]!) === radius) return true;
    }
    return false;
  };

  return {
    group,
    get meshes() { return meshes; },
    get waterfallTileCount() { return waterfallTileCount; },
    get triangleCount() { return triangleCount; },
    rebuild(codes, changedTiles) {
      if (changedTiles && !touchesRim(changedTiles)) return;
      const { strips, tileCount } = collectPerimeterStrips(ring, codes);
      waterfallTileCount = tileCount;
      const nextCells = buildCellAccumulators(strips);

      for (const [key, old] of [...buckets.entries()]) {
        if (nextCells.has(key)) continue;
        triangleCount -= old.tris;
        old.mesh.geometry.dispose();
        old.mesh.removeFromParent();
        buckets.delete(key);
      }

      for (const [key, acc] of nextCells) {
        const built = buildWaterfallCellGeometry(acc);
        const prev = buckets.get(key);
        if (prev) {
          triangleCount += built.tris - prev.tris;
          prev.mesh.geometry.dispose();
          prev.mesh.geometry = built.geo;
          prev.tris = built.tris;
          continue;
        }
        triangleCount += built.tris;
        const mesh = new THREE.Mesh(built.geo, material);
        mesh.name = `hexWaterfall ${key}`;
        mesh.userData.waterfallCell = key;
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        mesh.renderOrder = WATERFALL_RENDER_ORDER;
        buckets.set(key, { mesh, tris: built.tris });
        group.add(mesh);
      }

      meshes = [...buckets.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, b]) => b.mesh);
      group.visible = meshes.length > 0;
    },
    cullToFocus() {
      cullToViewFocus(meshes, (m) => m.geometry.boundingSphere);
    },
    dispose() {
      for (const { mesh } of buckets.values()) {
        mesh.geometry.dispose();
        mesh.removeFromParent();
      }
      buckets.clear();
      meshes = [];
      waterfallTileCount = 0;
      triangleCount = 0;
    },
  };
}
