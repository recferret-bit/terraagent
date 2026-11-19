import * as THREE from 'three';
import { hexDistance, hexIndex } from '@terra/sim/grid/hex';
import { hexTileMask, hexTileRing, isHexTile, type HexTileLayers as HexGridLayers } from '@terra/sim/grid/hexTile';
import { HEX_PREP, HEX_TERRAIN, isDryShoreTile, isWaterAt, tileStyle, type HexTileLayers } from './chunkMesh';

export const TILE_STATE_PRESETS = ['prepared', 'irrigated', 'living', 'mixed'] as const;
export type TileStatePreset = (typeof TILE_STATE_PRESETS)[number];

/**
 * Applies a tile preparation state preset (`prepared`, `irrigated`, `living`, `mixed`) to the central flat arena
 * (`d <= maxCenterRadius`) of a hex planet and returns the changed tile indices.
 */
export function applyTileStatePreset(
  radius: number,
  prep: Uint8Array,
  terrain: ArrayLike<number>,
  preset: TileStatePreset,
  maxCenterRadius = 4,
): number[] {
  const hx = hexIndex(radius);
  const changed: number[] = [];
  for (let i = 0; i < hx.count; i++) {
    const q = hx.q[i]!, r = hx.r[i]!, d = hexDistance(0, 0, q, r);
    const t = terrain[i] ?? HEX_TERRAIN.flat;
    let nextPrep: number;
    if (d > maxCenterRadius) {
      nextPrep = t === HEX_TERRAIN.flat ? HEX_PREP.flat : HEX_PREP.wild;
    } else if (preset === 'prepared') {
      nextPrep = HEX_PREP.prepared;
    } else if (preset === 'irrigated') {
      nextPrep = HEX_PREP.irrigated;
    } else if (preset === 'living') {
      nextPrep = d <= Math.max(1, maxCenterRadius - 1) ? HEX_PREP.living : HEX_PREP.prepared;
    } else {
      nextPrep = (q < 0 || (q === 0 && r >= 0))
        ? HEX_PREP.living
        : r >= 0
          ? HEX_PREP.irrigated
          : HEX_PREP.prepared;
    }
    if (prep[i] !== nextPrep) {
      prep[i] = nextPrep;
      changed.push(i);
    }
  }
  return changed;
}

/** Tile layers the hex grid rule reads (`terrain` missing = an all-Flat test surface). */
const ALL_FLAT = new Map<number, Uint8Array>();
function gridLayers(l: HexTileLayers, count: number): HexGridLayers {
  let terrain = l.terrain;
  if (!terrain) {
    terrain = ALL_FLAT.get(count) ?? new Uint8Array(count);
    ALL_FLAT.set(count, terrain as Uint8Array);
  }
  return { terrain, prep: l.prep, height: l.height };
}

export interface PrecomputedTileTintBuffers {
  tintData: Uint8Array;
  terraformData: Uint8Array;
  hexGridData: Uint8Array;
  hexGrid: Uint8Array;
}

function cellShoreByte(
  hx: ReturnType<typeof hexIndex>,
  i: number,
  layers: HexTileLayers,
): number {
  if (isDryShoreTile(hx, i, layers)) return 255;
  if (isWaterAt(layers, i)) return 128;
  return 0;
}

export function computeTileTintBuffers(radius: number, layers: HexTileLayers): PrecomputedTileTintBuffers {
  const hx = hexIndex(radius);
  const n = 2 * radius + 1;
  const tintData = new Uint8Array(n * n * 4);
  const terraformData = new Uint8Array(n * n * 4);
  const hexGridData = new Uint8Array(n * n * 4);
  const hexGrid = new Uint8Array(hx.count);
  const gl = gridLayers(layers, hx.count);
  hexTileMask(radius, gl, hexGrid);
  for (let i = 0; i < hx.count; i++) {
    const q = hx.q[i]!, r = hx.r[i]!;
    const prepVal = layers.prep?.[i] ?? 0;
    const st = layers.terrain
      ? tileStyle(q, r, layers.terrain[i] ?? 0, prepVal, layers.deposit?.[i] ?? 0, layers.kind ?? 'forestRock')
      : tileStyle(q, r, HEX_TERRAIN.flat, prepVal, 0, layers.kind ?? 'forestRock');
    const o = ((r + radius) * n + (q + radius)) * 4;
    tintData[o] = Math.round(st.r * 255);
    tintData[o + 1] = Math.round(st.g * 255);
    tintData[o + 2] = Math.round(st.b * 255);
    tintData[o + 3] = 255;
    terraformData[o] = prepVal === HEX_PREP.living ? 255 : 0;
    terraformData[o + 1] = prepVal === HEX_PREP.irrigated ? 255 : 0;
    terraformData[o + 2] = prepVal === HEX_PREP.prepared ? 255 : 0;
    terraformData[o + 3] = 255;
    hexGridData[o] = hexGrid[i] ? 255 : 0;
    hexGridData[o + 1] = cellShoreByte(hx, i, layers);
    hexGridData[o + 3] = 255;
  }
  return { tintData, terraformData, hexGridData, hexGrid };
}

/** One `(2R+1)²` RGBA byte texture indexed by axial `(q + R, r + R)`, read per hex cell (nearest, no mips). */
function cellTexture(n: number, initial?: Uint8Array): { data: Uint8Array; texture: THREE.DataTexture } {
  const data = initial && initial.length === n * n * 4 ? initial : new Uint8Array(n * n * 4);
  const texture = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace; // raw bytes (the tint is sRGB, linearised in the shader)
  return { data, texture };
}

/**
 * Per-tile class tint, terraforming mask and hex grid mask as `(2R+1)²` textures indexed by axial `(q + R, r + R)`.
 * The hex shader looks them up for the hex cell a fragment lies in (plus the neighbour across the nearest edge,
 * blended over a thin band), so class tints and Living/Irrigated states stay inside their own hexagons. Alpha is 1 on
 * planet tiles and 0 on the unused corners of the square.
 */
export interface HexTileTint {
  readonly texture: THREE.DataTexture;
  /** Per-tile terraforming state texture (`R`: Living 255, `G`: Irrigated 255, `B`: Prepared 255, `A`: 255 on planet). */
  readonly terraformTexture: THREE.DataTexture;
  /**
   * Hex grid texture (`R`: 255 on a HEX TILE, 0 on wild ground; `A`: 255 on planet). The flag is the sim's one rule,
   * `hexTileMask` (`@terra/sim/grid/hexTile`): the shader draws grid lines only next to hex tiles.
   */
  readonly hexGridTexture: THREE.DataTexture;
  /** The hex tile flag per tile index (1 = hex tile), as last stamped into `hexGridTexture`. */
  readonly hexGrid: Uint8Array;
  /** `uTileTint`, `uTerraformMap`, `uHexGrid` (samplers) and `uTileTintR` (planet radius as float) for the material. */
  readonly uniforms: Record<string, THREE.IUniform>;
  /**
   * Restamps every tile (`changed` omitted) or only the tiles in `changed`; the hex grid flag also for their
   * neighbours (a tile's change can take its whole one-ring off the grid, or put it back).
   */
  update(layers: HexTileLayers, changed?: ArrayLike<number>): void;
  dispose(): void;
}

export function createHexTileTint(
  radius: number,
  layers: HexTileLayers,
  precomputed?: PrecomputedTileTintBuffers,
): HexTileTint {
  const hx = hexIndex(radius);
  const n = 2 * radius + 1;
  const tint = cellTexture(n, precomputed?.tintData);
  const tf = cellTexture(n, precomputed?.terraformData);
  const grid = cellTexture(n, precomputed?.hexGridData);
  const hexGrid = precomputed?.hexGrid && precomputed.hexGrid.length === hx.count
    ? precomputed.hexGrid
    : new Uint8Array(hx.count);
  const texel = (i: number) => ((hx.r[i]! + radius) * n + (hx.q[i]! + radius)) * 4;

  const stamp = (l: HexTileLayers, i: number) => {
    const q = hx.q[i]!, r = hx.r[i]!;
    const prepVal = l.prep?.[i] ?? 0;
    const st = l.terrain
      ? tileStyle(q, r, l.terrain[i] ?? 0, prepVal, l.deposit?.[i] ?? 0, l.kind ?? 'forestRock')
      : tileStyle(q, r, HEX_TERRAIN.flat, prepVal, 0, l.kind ?? 'forestRock');
    const o = texel(i);
    tint.data.set([Math.round(st.r * 255), Math.round(st.g * 255), Math.round(st.b * 255), 255], o);
    tf.data[o] = prepVal === HEX_PREP.living ? 255 : 0;
    tf.data[o + 1] = prepVal === HEX_PREP.irrigated ? 255 : 0;
    tf.data[o + 2] = prepVal === HEX_PREP.prepared ? 255 : 0;
    tf.data[o + 3] = 255;
  };
  const writeGrid = (l: HexTileLayers, i: number) => {
    const o = texel(i);
    grid.data[o] = hexGrid[i] ? 255 : 0;
    grid.data[o + 1] = cellShoreByte(hx, i, l);
    grid.data[o + 3] = 255;
  };

  const update = (l: HexTileLayers, changed?: ArrayLike<number>) => {
    const gl = gridLayers(l, hx.count);
    if (changed) {
      for (let k = 0; k < changed.length; k++) stamp(l, changed[k]!);
      const ring = new Set<number>();
      for (let k = 0; k < changed.length; k++) for (const j of hexTileRing(radius, changed[k]!)) ring.add(j);
      for (const j of ring) { hexGrid[j] = isHexTile(radius, j, gl) ? 1 : 0; writeGrid(l, j); }
    } else {
      for (let i = 0; i < hx.count; i++) stamp(l, i);
      hexTileMask(radius, gl, hexGrid);
      for (let i = 0; i < hx.count; i++) writeGrid(l, i);
    }
    tint.texture.needsUpdate = true;
    tf.texture.needsUpdate = true;
    grid.texture.needsUpdate = true;
  };
  if (precomputed) {
    tint.texture.needsUpdate = true;
    tf.texture.needsUpdate = true;
    grid.texture.needsUpdate = true;
  } else {
    update(layers);
  }

  return {
    texture: tint.texture,
    terraformTexture: tf.texture,
    hexGridTexture: grid.texture,
    hexGrid,
    uniforms: {
      uTileTint: { value: tint.texture },
      uTerraformMap: { value: tf.texture },
      uHexGrid: { value: grid.texture },
      uTileTintR: { value: radius },
    },
    update,
    dispose: () => {
      tint.texture.dispose();
      tf.texture.dispose();
      grid.texture.dispose();
    },
  };
}
