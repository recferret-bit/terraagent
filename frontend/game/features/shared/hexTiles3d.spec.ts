import { HEX_WATER_LEVEL, tileXZ } from '@terra/render/planets/hex';
import { makeHeightSampler } from '@terra/render/planets/hex/heightSampler';
import { HEX_DIRS, hexIndex } from '@terra/sim/grid/hex';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { hexDrapeKey, hexTileTriangles } from './hexTiles3d';
import type { Scene3dService } from './scene3d';

const RADIUS = 8;
const LIFT = 0.04;
const EDGE_LIFT = 0.06;
const DIRS = HEX_DIRS;

/** A bumpy ground: a tilted plane plus a per-tile hash bump, drawn by the same lattice sampler the chunks render. */
function ground(edit?: (q: number, r: number, h: number) => number) {
  const hx = hexIndex(RADIUS);
  const heights = new Float32Array(hx.count);
  for (let i = 0; i < hx.count; i++) {
    const q = hx.q[i], r = hx.r[i];
    const bump = (((q * 73856093) ^ (r * 19349663)) >>> 0) % 97 / 97;
    const h = 0.6 * q - 0.35 * r + 0.8 * bump;
    heights[i] = edit ? edit(q, r, h) : h;
  }
  const sampler = makeHeightSampler(RADIUS, () => heights);
  const s3: Scene3dService = {
    scene: new THREE.Scene(),
    tileToWorld: (q, r) => { const [x, z] = tileXZ(q, r); return { x, y: sampler(x, z), z }; },
    biomeKey: () => 'dune',
  };
  return { s3, sampler, heights, hx };
}

/** Every vertex and every triangle centroid of `tris` lies `lift` above `surface`. */
function expectDraped(tris: number[], surface: (x: number, z: number) => number, lift: number): void {
  expect(tris.length % 9).toBe(0);
  expect(tris.length).toBeGreaterThan(0);
  for (let t = 0; t < tris.length; t += 9) {
    let cx = 0, cy = 0, cz = 0;
    for (let v = 0; v < 3; v++) {
      const [x, y, z] = [tris[t + v * 3], tris[t + v * 3 + 1], tris[t + v * 3 + 2]];
      expect(y).toBeCloseTo(surface(x, z) + lift, 5);
      cx += x / 3; cy += y / 3; cz += z / 3;
    }
    // the centroid on the surface too: the piece lies in one planar lattice triangle, not across a fold
    expect(cy).toBeCloseTo(surface(cx, cz) + lift, 5);
  }
}

const disc = (q: number, r: number) => [{ q, r }, ...DIRS.map(([dq, dr]) => ({ q: q + dq, r: r + dr }))];
const opts = { lift: LIFT, edgeLift: EDGE_LIFT };

describe('hexTileTriangles drapes hex marks on the rendered ground', () => {
  it('a tile on a bumpy slope: fill and outline follow the surface exactly', () => {
    const { s3, sampler } = ground();
    const { fill, edge } = hexTileTriangles(s3, [{ q: 1, r: 2 }], opts);
    expect(fill.length).toBe(12 * 9);
    expect(edge.length).toBe(6 * 4 * 9);
    expectDraped(fill, sampler, LIFT);
    expectDraped(edge, sampler, EDGE_LIFT);
    // and it is not flat (the old builder put every vertex at the centre's height)
    const ys = fill.filter((_, i) => i % 3 === 1);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.5);
  });

  it('a disc next to a 3 m cliff step: no piece cuts into the step or floats over it', () => {
    const { s3, sampler } = ground((q, r, h) => (q >= 2 ? h + 3 : h));
    const { fill, edge } = hexTileTriangles(s3, disc(1, 0), opts);
    expect(fill.length).toBe(7 * 12 * 9);
    expect(edge.length).toBe(18 * 4 * 9); // a 7-hex disc has 18 outline sides
    expectDraped(fill, sampler, LIFT);
    expectDraped(edge, sampler, EDGE_LIFT);
  });

  it('a shrunk footprint (placement ghost) stays on the ground too', () => {
    const { s3, sampler } = ground();
    const { fill, edge } = hexTileTriangles(s3, disc(-2, 1), { ...opts, shrink: 0.96, edge: false });
    expect(edge).toEqual([]);
    expectDraped(fill, sampler, LIFT);
  });

  it('a water tile lies on the water surface, never under it', () => {
    const lake = new Set(['0,0', ...DIRS.map(([q, r]) => `${q},${r}`)]);
    // a lake: its bed is 1-2 m under the surface, the shore around it above
    const { s3, sampler } = ground((q, r, h) => (lake.has(`${q},${r}`) ? -1 - 0.5 * ((q + r) & 1) : Math.abs(h) + 0.3));
    const isWater = (q: number, r: number) => lake.has(`${q},${r}`);
    const water = (x: number, z: number) => Math.max(sampler(x, z), HEX_WATER_LEVEL);
    // the centre tile: all its corners are inside the lake, so the whole mark is flat on the surface
    expectDraped(hexTileTriangles(s3, [{ q: 0, r: 0 }], { ...opts, isWater }).fill, water, LIFT);
    // a shore water tile: vertices on the surface or the shore, never on the lakebed
    const { fill } = hexTileTriangles(s3, [{ q: 1, r: 0 }], { ...opts, isWater });
    for (let i = 0; i < fill.length; i += 3) {
      expect(fill[i + 1]).toBeCloseTo(water(fill[i], fill[i + 2]) + LIFT, 5);
      expect(fill[i + 1]).toBeGreaterThanOrEqual(HEX_WATER_LEVEL + LIFT - 1e-9);
    }
    // a land tile is never lifted
    expectDraped(hexTileTriangles(s3, [{ q: 3, r: 0 }], { ...opts, isWater }).fill, sampler, LIFT);
  });
});

describe('hexDrapeKey', () => {
  it('changes when the ground under the mark moves (also a neighbour), not when a far tile does', () => {
    const tiles = [{ q: 0, r: 0 }];
    const base = hexDrapeKey(ground().s3, tiles);
    expect(hexDrapeKey(ground().s3, tiles)).toBe(base);
    expect(hexDrapeKey(ground((q, r, h) => (q === 0 && r === 0 ? h + 0.5 : h)).s3, tiles)).not.toBe(base);
    expect(hexDrapeKey(ground((q, r, h) => (q === 1 && r === -1 ? h - 0.3 : h)).s3, tiles)).not.toBe(base);
    expect(hexDrapeKey(ground((q, r, h) => (q === 4 && r === 0 ? h + 2 : h)).s3, tiles)).toBe(base);
    expect(hexDrapeKey(ground().s3, tiles, () => true)).not.toBe(base);
  });
});
