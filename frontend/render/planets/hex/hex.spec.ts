import { describe, expect, it } from 'vitest';
import { hexCount, hexIndex } from '@terra/sim/grid/hex';
import { buildChunk, fanNormal } from './chunkMesh';
import { chunkLayout } from './chunks';
import { makeHeightSampler } from './heightSampler';
import { TILE_M, planetExtent, rayGround, tileAt, tileXZ } from './hexMath';
import { kindForPlanetType, specForPlanetType } from './planetKind';

const R = 56;

describe('chunking', () => {
  it('splits the radius-56 planet (9577 tiles) into 32x32 blocks, each tile in exactly one chunk', () => {
    const chunks = chunkLayout(R);
    expect(hexCount(R)).toBe(9577);
    const seen = new Uint8Array(9577);
    for (const c of chunks) for (const i of c.tiles) seen[i]++;
    expect(seen.every((n) => n === 1)).toBe(true);
    expect(chunks.length).toBe(14); // q and r each fall in blocks -2..1 (4x4 = 16); the hexagon leaves two corner blocks empty
    for (const c of chunks) expect(c.tiles.length).toBeLessThanOrEqual(32 * 32);
  });

  it('builds every lattice triangle exactly once across chunks', () => {
    const h = new Float32Array(hexCount(R));
    const tris = chunkLayout(R).reduce((n, c) => n + buildChunk(R, c.tiles, h).index.length / 3, 0);
    // the hexagon of lattice points has 6 R^2 unit triangles
    expect(tris).toBe(6 * R * R);
  });

  it('a flat planet has up-facing normals and y = height', () => {
    const h = new Float32Array(hexCount(R)).fill(1.5);
    const b = buildChunk(R, chunkLayout(R)[0]!.tiles, h);
    for (let v = 0; v < b.position.length / 3; v++) {
      expect(b.position[v * 3 + 1]).toBeCloseTo(1.5);
      expect(b.normal[v * 3 + 1]).toBeCloseTo(1);
    }
  });

  it('a slope tilts the normal towards -gradient', () => {
    const hx = hexIndex(8);
    const h = new Float32Array(hx.count);
    for (let i = 0; i < hx.count; i++) h[i] = 0.5 * tileXZ(hx.q[i]!, hx.r[i]!)[0]; // rises with x
    const out = new Float32Array(3);
    fanNormal(8, hx.indexOf(0, 0), h, out, 0);
    expect(out[0]).toBeLessThan(-0.1);
    expect(out[1]).toBeGreaterThan(0.5);
    expect(out[2]).toBeCloseTo(0, 4);
  });
});

describe('picking math', () => {
  it('maps world xz to the tile whose centre is there, and null off-planet', () => {
    for (const [q, r] of [[0, 0], [3, -2], [-10, 7], [R, 0], [0, -R]] as const) {
      const [x, z] = tileXZ(q, r);
      expect(tileAt(R, x, z)).toMatchObject({ q, r, i: hexIndex(R).indexOf(q, r) });
      expect(tileAt(R, x + 0.4, z - 0.3)).toMatchObject({ q, r });
    }
    const far = planetExtent(R).x * 2;
    expect(tileAt(R, far, 0)).toBeNull();
  });

  it('tile centres are 2 m apart', () => {
    const [x0, z0] = tileXZ(0, 0), [x1, z1] = tileXZ(1, 0), [x2, z2] = tileXZ(0, 1);
    expect(Math.hypot(x1 - x0, z1 - z0)).toBeCloseTo(TILE_M);
    expect(Math.hypot(x2 - x0, z2 - z0)).toBeCloseTo(TILE_M);
  });

  it('rayGround hits the flat plane at the right point and misses upward rays', () => {
    const d = { x: 0.5, y: -0.7, z: 0.5 }, l = Math.hypot(d.x, d.y, d.z);
    const dir = { x: d.x / l, y: d.y / l, z: d.z / l };
    const hit = rayGround({ x: 0, y: 40, z: 0 }, dir, () => 0)!;
    expect(hit.y).toBeCloseTo(0, 3);
    expect(hit.x).toBeCloseTo((40 * 0.5) / 0.7, 2);
    expect(rayGround({ x: 0, y: 40, z: 0 }, { x: 0, y: 1, z: 0 }, () => 0)).toBeNull();
  });

  it('rayGround follows relief: a raised tile is hit earlier', () => {
    const h = new Float32Array(hexCount(R)); const hx = hexIndex(R);
    for (let i = 0; i < hx.count; i++) h[i] = hx.q[i]! >= 5 ? 3 : 0;
    const at = makeHeightSampler(R, () => h);
    const hit = rayGround({ x: 0, y: 30, z: 0 }, { x: 0.6, y: -0.8, z: 0 }, at)!;
    expect(hit.y).toBeGreaterThan(2.5);
    const t = tileAt(R, hit.x, hit.z)!;
    expect(t.q).toBeGreaterThanOrEqual(4);
  });

  it('height sampler interpolates tile heights and equals them at tile centres', () => {
    const hx = hexIndex(R), h = new Float32Array(hx.count);
    h[hx.indexOf(2, 1)] = 4;
    const at = makeHeightSampler(R, () => h);
    const [x, z] = tileXZ(2, 1);
    expect(at(x, z)).toBeCloseTo(4);
    expect(at(x + 1, z)).toBeCloseTo(2, 1); // halfway to the neighbour at 2 m
    expect(at(tileXZ(-4, 0)[0], 0)).toBeCloseTo(0);
  });
});

describe('planet look', () => {
  it('maps sim planet types to render kinds (D-33)', () => {
    expect(kindForPlanetType('desert')).toBe('dune');
    expect(kindForPlanetType('ocean')).toBe('oceanForest');
    expect(kindForPlanetType('temperate')).toBe('forestRock');
    expect(specForPlanetType('desert').biomeKey).toBe('dune');
  });
});
