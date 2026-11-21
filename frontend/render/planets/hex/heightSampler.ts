import { hexIndex, type HexIndex } from '@terra/sim/grid/hex';
import { TILE_M } from './hexMath';

const S3 = Math.sqrt(3);

/**
 * Zero-allocation fast path sampling an `ArrayLike<number>` per-tile field over the exact `(A, B, C)` / `(B, D, C)`
 * lattice triangles rendered by `buildChunk`. Tiles outside the planet read `0`.
 */
export function sampleHexLatticeFieldArray(
  hx: HexIndex,
  x: number,
  z: number,
  values: ArrayLike<number>,
): number {
  const r = (2 * z) / (TILE_M * S3);
  const q = x / TILE_M - r / 2;
  const q0 = Math.floor(q);
  const r0 = Math.floor(r);
  const fq = q - q0;
  const fr = r - r0;
  const iB = hx.indexOf(q0 + 1, r0);
  const iC = hx.indexOf(q0, r0 + 1);
  const b = iB < 0 ? 0 : (values[iB] ?? 0);
  const c = iC < 0 ? 0 : (values[iC] ?? 0);
  if (fq + fr <= 1) {
    const iA = hx.indexOf(q0, r0);
    const a = iA < 0 ? 0 : (values[iA] ?? 0);
    return a + fq * (b - a) + fr * (c - a);
  }
  const iD = hx.indexOf(q0 + 1, r0 + 1);
  const d = iD < 0 ? 0 : (values[iD] ?? 0);
  return d + (1 - fq) * (c - d) + (1 - fr) * (b - d);
}

/**
 * Samples any per-tile vertex scalar at world `(x, z)` using the exact lattice triangles rendered by `buildChunk`
 * (`(A, B, C)` when `fq + fr <= 1`, else `(B, D, C)`). Tiles outside the planet read `0`.
 */
export function sampleHexLatticeField(
  hx: HexIndex,
  x: number,
  z: number,
  readTile: (tileIndex: number) => number,
): number {
  const r = (2 * z) / (TILE_M * S3);
  const q = x / TILE_M - r / 2;
  const q0 = Math.floor(q);
  const r0 = Math.floor(r);
  const fq = q - q0;
  const fr = r - r0;
  const iB = hx.indexOf(q0 + 1, r0);
  const iC = hx.indexOf(q0, r0 + 1);
  const b = iB < 0 ? 0 : readTile(iB);
  const c = iC < 0 ? 0 : readTile(iC);
  if (fq + fr <= 1) {
    const iA = hx.indexOf(q0, r0);
    const a = iA < 0 ? 0 : readTile(iA);
    return a + fq * (b - a) + fr * (c - a);
  }
  const iD = hx.indexOf(q0 + 1, r0 + 1);
  const d = iD < 0 ? 0 : readTile(iD);
  return d + (1 - fq) * (c - d) + (1 - fr) * (b - d);
}

/**
 * Height at world `(x, z)` from the tile height layer, interpolated over the SAME lattice triangles the chunks render.
 */
export function makeHeightSampler(radius: number, height: () => ArrayLike<number>): (x: number, z: number) => number {
  const hx = hexIndex(radius);
  return (x: number, z: number): number => sampleHexLatticeFieldArray(hx, x, z, height());
}
