import { describe, expect, it } from 'vitest';
import {
  changedTileIndices,
  createPlanet,
  hexIndex,
  noteTileStamp,
  restore,
  SECTOR_TILES,
  sectorIndex,
  setTileTerrain,
  snapshot,
  TERRAIN,
  touchTile,
} from '../../src';

const scan = (changedAt: ArrayLike<number>, from: number) => {
  const out: number[] = [];
  for (let i = 0; i < changedAt.length; i++) if (changedAt[i] > from) out.push(i);
  return out;
};

describe('planet sectors + quadtree (D-38)', () => {
  it('partitions every tile into exactly one sector of at most SECTOR_TILES² tiles', () => {
    for (const radius of [6, 56, 120]) {
      const idx = sectorIndex(radius);
      const seen = new Uint8Array(hexIndex(radius).count);
      for (const s of idx.sectors) {
        expect(s.tiles.length).toBeLessThanOrEqual(SECTOR_TILES * SECTOR_TILES);
        for (const t of s.tiles) { seen[t]++; expect(idx.sectorOfTile[t]).toBe(s.id); }
      }
      expect(seen.every((v) => v === 1)).toBe(true);
    }
  });

  it('quadtree query returns exactly the sectors that hold tiles in the box', () => {
    const idx = sectorIndex(56), hx = hexIndex(56);
    for (const [q0, r0, q1, r1] of [[-5, -5, 5, 5], [20, -40, 40, -10], [-56, 0, -40, 20]]) {
      const want = new Set<number>();
      for (let i = 0; i < hx.count; i++) if (hx.q[i] >= q0 && hx.q[i] <= q1 && hx.r[i] >= r0 && hx.r[i] <= r1) want.add(idx.sectorOfTile[i]);
      const got = new Set(idx.query(q0, r0, q1, r1));
      for (const s of want) expect(got.has(s)).toBe(true);
    }
  });

  it('changedTileIndices (sector-skipping) equals a full scan after random stamps, setters and a restore', () => {
    const s = createPlanet({ id: 'p', seed: 'sect', type: 'temperate', radius: 56 });
    expect(Array.from(changedTileIndices(s, 0))).toEqual(scan(s.grid.layers.changedAt, 0)); // builds the stamps
    let x = 7;
    for (let tick = 1; tick <= 40; tick++) {
      for (let k = 0; k < 25; k++) {
        x = (x * 1103515245 + 12345) >>> 0;
        const i = x % s.grid.count;
        if (k % 2) touchTile(s, i, tick); else setTileTerrain(s.grid, i, TERRAIN.flat, tick);
      }
      for (const from of [0, tick - 1, tick - 5, tick]) {
        expect(Array.from(changedTileIndices(s, from))).toEqual(scan(s.grid.layers.changedAt, from));
      }
    }
    const r = restore(snapshot(s));
    expect(Array.from(changedTileIndices(r, 10))).toEqual(scan(r.grid.layers.changedAt, 10));
    noteTileStamp(r.grid.layers.changedAt, 0, 99); // a stamp hook without a write is harmless (scan still filters)
    expect(Array.from(changedTileIndices(r, 10))).toEqual(scan(r.grid.layers.changedAt, 10));
  });
});
