import * as THREE from 'three';
import { HEX_DIRS, hexIndex } from '@terra/sim/grid/hex';
import { PLAYER_COLORS } from '../globe/terraform';
import { computeEffectiveHeights, type HexTileLayers } from './chunkMesh';
import { tileXZ } from './hexMath';

/** Normal territory boundary ribbon width in metres (unclaimed neighbour). */
export const NORMAL_BORDER_WIDTH = 0.08;
/** Frozen (contested) territory boundary ribbon width in metres (foreign-owned neighbour, §13.1). */
export const FROZEN_BORDER_WIDTH = 0.18;
/** Vertical offset (m) lifting the territory border ribbon above the tile surface to prevent z-fighting. */
export const BORDER_Y_OFFSET = 0.035;

/**
 * Default colony border colour palette (6-colony distinct hex colours, aligned with `PLAYER_COLORS` from `globe/terraform.ts`
 * starting with ignition orange `0xff6a2a`).
 */
export const DEFAULT_COLONY_COLORS: readonly number[] = [
  0xff6a2a,
  0x2ec4b6,
  0xe71d36,
  0xff9f1c,
  0x8338ec,
  0x3a86ff,
];

/** Globe player colours reference (`render/planets/globe/terraform.ts`). */
export const GLOBE_PLAYER_COLORS = PLAYER_COLORS;

const INV_SQRT3 = 1 / Math.sqrt(3);
const HATCH_LENGTH = 0.14;
const HATCH_HALF_THICK = 0.026;
const HATCH_Y_LIFT = 0.002;

export interface TerritoryBorderStats {
  ownedTileCount: number;
  boundaryEdgeCount: number;
  frozenEdgeCount: number;
  hatchSegmentCount: number;
  colorBlindMode: boolean;
}

export interface TerritoryBorderOptions {
  effHeights?: ArrayLike<number>;
  colorBlindMode?: boolean;
  colonyColors?: Record<number, number>;
}

export interface TerritoryBorderBuildResult {
  geometry: THREE.BufferGeometry;
  stats: TerritoryBorderStats;
  edgeWidths: Float32Array;
}

interface HatchPatternSpec {
  readonly offsets: readonly number[];
  readonly skew: number;
}

const HATCH_PATTERNS: readonly HatchPatternSpec[] = [
  { offsets: [-0.22, 0.22], skew: 0.0 },
  { offsets: [-0.22, 0.22], skew: 0.09 },
  { offsets: [-0.22, 0.22], skew: -0.09 },
  { offsets: [-0.3, 0.0, 0.3], skew: 0.0 },
];

export function resolveColonyColorHex(owner: number, customColors?: Record<number, number>): number {
  if (customColors && customColors[owner] !== undefined) {
    return customColors[owner]!;
  }
  const len = DEFAULT_COLONY_COLORS.length;
  const idx = ((owner % len) + len) % len;
  return DEFAULT_COLONY_COLORS[idx]!;
}

export function resolveColonyColorRgb(
  owner: number,
  customColors?: Record<number, number>,
): [number, number, number] {
  const hex = resolveColonyColorHex(owner, customColors);
  return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255];
}

interface BorderAccum {
  positions: number[];
  normals: number[];
  colors: number[];
  borderWidths: number[];
  indices: number[];
  edgeWidths: number[];
}

function pushQuad(
  acc: BorderAccum,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  x3: number,
  z3: number,
  y: number,
  rgb: readonly [number, number, number],
  widthAttr: number,
): void {
  const base = acc.positions.length / 3;
  acc.positions.push(x0, y, z0, x1, y, z1, x2, y, z2, x3, y, z3);
  acc.normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
  acc.colors.push(
    rgb[0], rgb[1], rgb[2],
    rgb[0], rgb[1], rgb[2],
    rgb[0], rgb[1], rgb[2],
    rgb[0], rgb[1], rgb[2],
  );
  acc.borderWidths.push(widthAttr, widthAttr, widthAttr, widthAttr);
  acc.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function emitEdgeHatchSegments(
  acc: BorderAccum,
  cx: number,
  cz: number,
  ux: number,
  uz: number,
  y: number,
  width: number,
  owner: number,
  rgb: readonly [number, number, number],
): number {
  const patIdx = ((owner % HATCH_PATTERNS.length) + HATCH_PATTERNS.length) % HATCH_PATTERNS.length;
  const pat = HATCH_PATTERNS[patIdx]!;
  const etx = uz;
  const etz = -ux;
  const inx = -ux;
  const inz = -uz;
  const innerDist = 1 - width;
  const hy = y + HATCH_Y_LIFT;
  for (const t of pat.offsets) {
    const bx = cx + ux * innerDist + etx * t;
    const bz = cz + uz * innerDist + etz * t;
    const px = bx + inx * HATCH_LENGTH + etx * pat.skew;
    const pz = bz + inz * HATCH_LENGTH + etz * pat.skew;
    pushQuad(
      acc,
      bx - etx * HATCH_HALF_THICK,
      bz - etz * HATCH_HALF_THICK,
      bx + etx * HATCH_HALF_THICK,
      bz + etz * HATCH_HALF_THICK,
      px + etx * HATCH_HALF_THICK,
      pz + etz * HATCH_HALF_THICK,
      px - etx * HATCH_HALF_THICK,
      pz - etz * HATCH_HALF_THICK,
      hy,
      rgb,
      width,
    );
  }
  return pat.offsets.length;
}

/**
 * Builds the 3D territory border ribbon mesh geometry across all owned hex tiles.
 * - Normal borders (`nOwner < 0`) use `NORMAL_BORDER_WIDTH` (`0.08`).
 * - Frozen/contested borders (`nOwner >= 0 && nOwner !== owner`) use `FROZEN_BORDER_WIDTH` (`0.18`).
 * - When `colorBlindMode` is enabled, adds per-colony angled hatch ribs along each boundary edge.
 */
export function buildTerritoryBorderGeometry(
  radius: number,
  tiles: HexTileLayers,
  opts: TerritoryBorderOptions = {},
): TerritoryBorderBuildResult {
  const hx = hexIndex(radius);
  const effHeights = opts.effHeights ?? computeEffectiveHeights(radius, tiles);
  const colorBlindMode = Boolean(opts.colorBlindMode);
  const ownerArr = tiles.owner;

  const acc: BorderAccum = {
    positions: [],
    normals: [],
    colors: [],
    borderWidths: [],
    indices: [],
    edgeWidths: [],
  };

  let ownedTileCount = 0;
  let boundaryEdgeCount = 0;
  let frozenEdgeCount = 0;
  let hatchSegmentCount = 0;

  if (ownerArr) {
    for (let i = 0; i < hx.count; i++) {
      const owner = ownerArr[i] ?? -1;
      if (owner < 0) continue;
      ownedTileCount++;
      const q = hx.q[i]!;
      const r = hx.r[i]!;
      const [cx, cz] = tileXZ(q, r);
      const y = (effHeights[i] ?? 0) + BORDER_Y_OFFSET;
      const rgb = resolveColonyColorRgb(owner, opts.colonyColors);

      for (let dir = 0; dir < 6; dir++) {
        const [dq, dr] = HEX_DIRS[dir]!;
        const nIdx = hx.indexOf(q + dq, r + dr);
        const nOwner = nIdx >= 0 ? (ownerArr[nIdx] ?? -1) : -1;
        if (nOwner === owner) continue;

        boundaryEdgeCount++;
        const isFrozen = nOwner >= 0 && nOwner !== owner;
        if (isFrozen) frozenEdgeCount++;
        const width = isFrozen ? FROZEN_BORDER_WIDTH : NORMAL_BORDER_WIDTH;
        acc.edgeWidths.push(width);

        const [nx, nz] = tileXZ(q + dq, r + dr);
        const ux = (nx - cx) * 0.5;
        const uz = (nz - cz) * 0.5;
        const tx = uz * INV_SQRT3;
        const tz = -ux * INV_SQRT3;

        const c0x = cx + ux - tx;
        const c0z = cz + uz - tz;
        const c1x = cx + ux + tx;
        const c1z = cz + uz + tz;
        const i0x = c0x - ux * width;
        const i0z = c0z - uz * width;
        const i1x = c1x - ux * width;
        const i1z = c1z - uz * width;

        pushQuad(acc, c0x, c0z, c1x, c1z, i1x, i1z, i0x, i0z, y, rgb, width);
        if (colorBlindMode) {
          hatchSegmentCount += emitEdgeHatchSegments(acc, cx, cz, ux, uz, y, width, owner, rgb);
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(acc.positions), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(acc.normals), 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(acc.colors), 3));
  geometry.setAttribute('aBorderWidth', new THREE.BufferAttribute(new Float32Array(acc.borderWidths), 1));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(acc.indices), 1));
  if (acc.positions.length > 0) {
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
  }

  const stats: TerritoryBorderStats = {
    ownedTileCount,
    boundaryEdgeCount,
    frozenEdgeCount,
    hatchSegmentCount,
    colorBlindMode,
  };
  const edgeWidths = new Float32Array(acc.edgeWidths);
  geometry.userData.stats = stats;
  geometry.userData.edgeWidths = edgeWidths;

  return { geometry, stats, edgeWidths };
}

export function createTerritoryBorderMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
}
