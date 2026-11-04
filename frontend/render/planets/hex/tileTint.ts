import * as THREE from 'three';
import { hexDistance, hexIndex } from '@terra/sim/grid/hex';
import { HEX_PREP, HEX_TERRAIN, tileStyle, type HexTileLayers } from './chunkMesh';

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

/**
 * Per-tile class tint and terraforming mask as `(2R+1)²` textures indexed by axial `(q + R, r + R)`. The hex shader
 * looks them up for the hex cell a fragment lies in (plus the neighbour across the nearest edge, blended over a thin
 * band), so class tints and Living/Irrigated states stay inside their own hexagons. Alpha is 1 on planet tiles and 0
 * on the unused corners of the square.
 */
export interface HexTileTint {
  readonly texture: THREE.DataTexture;
  /** Per-tile terraforming state texture (`R`: Living 255, `G`: Irrigated 255, `B`: Prepared 255, `A`: 255 on planet). */
  readonly terraformTexture: THREE.DataTexture;
  /** `uTileTint`, `uTerraformMap` (samplers) and `uTileTintR` (planet radius as float) for the hex terrain material. */
  readonly uniforms: Record<string, THREE.IUniform>;
  /** Restamps every tile (`changed` omitted) or only the tiles in `changed`. */
  update(layers: HexTileLayers, changed?: ArrayLike<number>): void;
  dispose(): void;
}

export function createHexTileTint(radius: number, layers: HexTileLayers): HexTileTint {
  const hx = hexIndex(radius);
  const n = 2 * radius + 1;
  const data = new Uint8Array(n * n * 4);
  const texture = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace; // sRGB bytes, linearised in the shader like the old vertex colour

  const tfData = new Uint8Array(n * n * 4);
  const terraformTexture = new THREE.DataTexture(tfData, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  terraformTexture.magFilter = THREE.NearestFilter;
  terraformTexture.minFilter = THREE.NearestFilter;
  terraformTexture.generateMipmaps = false;
  terraformTexture.colorSpace = THREE.NoColorSpace;

  const stamp = (l: HexTileLayers, i: number) => {
    const q = hx.q[i]!, r = hx.r[i]!;
    const prepVal = l.prep?.[i] ?? 0;
    const st = l.terrain
      ? tileStyle(q, r, l.terrain[i] ?? 0, prepVal, l.deposit?.[i] ?? 0, l.kind ?? 'forestRock')
      : tileStyle(q, r, HEX_TERRAIN.flat, prepVal, 0, l.kind ?? 'forestRock');
    const o = ((r + radius) * n + (q + radius)) * 4;
    data[o] = Math.round(st.r * 255);
    data[o + 1] = Math.round(st.g * 255);
    data[o + 2] = Math.round(st.b * 255);
    data[o + 3] = 255;
    tfData[o] = prepVal === HEX_PREP.living ? 255 : 0;
    tfData[o + 1] = prepVal === HEX_PREP.irrigated ? 255 : 0;
    tfData[o + 2] = prepVal === HEX_PREP.prepared ? 255 : 0;
    tfData[o + 3] = 255;
  };

  const update = (l: HexTileLayers, changed?: ArrayLike<number>) => {
    if (changed) for (let k = 0; k < changed.length; k++) stamp(l, changed[k]!);
    else for (let i = 0; i < hx.count; i++) stamp(l, i);
    texture.needsUpdate = true;
    terraformTexture.needsUpdate = true;
  };
  update(layers);

  return {
    texture,
    terraformTexture,
    uniforms: {
      uTileTint: { value: texture },
      uTerraformMap: { value: terraformTexture },
      uTileTintR: { value: radius },
    },
    update,
    dispose: () => {
      texture.dispose();
      terraformTexture.dispose();
    },
  };
}
