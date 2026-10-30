import { hexIndex } from '@terra/sim/grid/hex';
import { CHUNK_TILES } from './hexMath';

export interface ChunkDef {
  /** Chunk coordinates: floor(q / 32), floor(r / 32). */
  cq: number;
  cr: number;
  /** Tile indices owned by this chunk, in tile order. */
  tiles: Int32Array;
}

/** Partitions the planet's tiles into 32x32 axial blocks; every tile belongs to exactly one chunk. */
export function chunkLayout(radius: number): ChunkDef[] {
  const hx = hexIndex(radius);
  const byKey = new Map<string, number[]>();
  const keyOf = (q: number, r: number) => `${Math.floor(q / CHUNK_TILES)},${Math.floor(r / CHUNK_TILES)}`;
  for (let i = 0; i < hx.count; i++) {
    const k = keyOf(hx.q[i]!, hx.r[i]!);
    const list = byKey.get(k);
    if (list) list.push(i); else byKey.set(k, [i]);
  }
  return [...byKey.entries()].map(([k, list]) => {
    const [cq, cr] = k.split(',').map(Number) as [number, number];
    return { cq, cr, tiles: Int32Array.from(list) };
  });
}

/** Chunk key of the tile at (q, r), the same key `chunkLayout` groups by. */
export const chunkKey = (q: number, r: number) => `${Math.floor(q / CHUNK_TILES)},${Math.floor(r / CHUNK_TILES)}`;
