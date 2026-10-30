import { hexIndex } from '@terra/sim/grid/hex';
import { TILE_M } from './hexMath';

const S3 = Math.sqrt(3);

/**
 * Height at world (x, z) from the tile height layer, interpolated over the SAME lattice triangles the chunks render
 * (tile centres are the vertices; each unit cell splits into A,B,C and B,D,C). Outside the planet vertices read 0.
 */
export function makeHeightSampler(radius: number, height: () => ArrayLike<number>) {
  const hx = hexIndex(radius);
  const at = (q: number, r: number) => { const i = hx.indexOf(q, r); return i < 0 ? 0 : (height() as ArrayLike<number>)[i]!; };
  return (x: number, z: number): number => {
    const r = (2 * z) / (TILE_M * S3), q = x / TILE_M - r / 2;
    const q0 = Math.floor(q), r0 = Math.floor(r), fq = q - q0, fr = r - r0;
    if (fq + fr <= 1) {
      const a = at(q0, r0);
      return a + fq * (at(q0 + 1, r0) - a) + fr * (at(q0, r0 + 1) - a);
    }
    const d = at(q0 + 1, r0 + 1);
    return d + (1 - fq) * (at(q0, r0 + 1) - d) + (1 - fr) * (at(q0 + 1, r0) - d);
  };
}
