import * as THREE from 'three';
import { hexIndex } from '@terra/sim/grid/hex';
import { HEX_TERRAIN, tileStyle, type HexTileLayers } from './chunkMesh';

/**
 * Per-tile class tint as a `(2R+1)²` texture indexed by axial `(q + R, r + R)`. The hex shader looks the tint up for the
 * hex cell a fragment lies in (plus the neighbour across the nearest edge, blended over a thin band), so a rock or
 * slope tint stays inside its own hexagon instead of being smeared over the six lattice triangles around the tile
 * centre, as a per-vertex colour was. Alpha is 1 on planet tiles and 0 on the unused corners of the square.
 */
export interface HexTileTint {
  readonly texture: THREE.DataTexture;
  /** `uTileTint` (sampler) and `uTileTintR` (planet radius as float) for the hex terrain material. */
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

  const stamp = (l: HexTileLayers, i: number) => {
    const q = hx.q[i]!, r = hx.r[i]!;
    const st = l.terrain
      ? tileStyle(q, r, l.terrain[i] ?? 0, l.prep?.[i] ?? 0, l.deposit?.[i] ?? 0, l.kind ?? 'forestRock')
      : tileStyle(q, r, HEX_TERRAIN.flat, 0, 0, l.kind ?? 'forestRock');
    const o = ((r + radius) * n + (q + radius)) * 4;
    data[o] = Math.round(st.r * 255);
    data[o + 1] = Math.round(st.g * 255);
    data[o + 2] = Math.round(st.b * 255);
    data[o + 3] = 255;
  };

  const update = (l: HexTileLayers, changed?: ArrayLike<number>) => {
    if (changed) for (let k = 0; k < changed.length; k++) stamp(l, changed[k]!);
    else for (let i = 0; i < hx.count; i++) stamp(l, i);
    texture.needsUpdate = true;
  };
  update(layers);

  return {
    texture,
    uniforms: { uTileTint: { value: texture }, uTileTintR: { value: radius } },
    update,
    dispose: () => texture.dispose(),
  };
}
