import { SECTOR_TILES, sectorIndex } from '@terra/sim/grid/sectors';
import { CHUNK_TILES } from './hexMath';

export interface ChunkDef {
  /** Chunk coordinates: floor(q / 32), floor(r / 32). */
  cq: number;
  cr: number;
  /** Tile indices owned by this chunk, in tile order. */
  tiles: Int32Array;
}

if (CHUNK_TILES % SECTOR_TILES !== 0) throw new Error(`CHUNK_TILES (${CHUNK_TILES}) must be a multiple of SECTOR_TILES (${SECTOR_TILES})`);

/**
 * Partitions the planet's tiles into 32x32 axial render chunks, each a block of whole sim sectors (D-38: one sector
 * index drives generation, deltas and rendering); every tile belongs to exactly one chunk.
 */
export function chunkLayout(radius: number): ChunkDef[] {
  const per = CHUNK_TILES / SECTOR_TILES;
  const byKey = new Map<string, number[]>();
  for (const s of sectorIndex(radius).sectors) {
    const k = `${Math.floor(s.sq / per)},${Math.floor(s.sr / per)}`;
    const list = byKey.get(k);
    if (list) list.push(...s.tiles); else byKey.set(k, [...s.tiles]);
  }
  return [...byKey.entries()].map(([k, list]) => {
    const [cq, cr] = k.split(',').map(Number) as [number, number];
    return { cq, cr, tiles: Int32Array.from(list.sort((a, b) => a - b)) };
  });
}

/** Chunk key of the tile at (q, r), the same key `chunkLayout` groups by. */
export const chunkKey = (q: number, r: number) => `${Math.floor(q / CHUNK_TILES)},${Math.floor(r / CHUNK_TILES)}`;
