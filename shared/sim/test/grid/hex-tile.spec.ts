import { describe, expect, it } from 'vitest';
import { HEX_DIRS, hexIndex } from '../../src/grid/hex';
import { HEX_LEVEL_EPS_M, hexTileMask, hexTileRing, isHexTile, isOpenGround } from '../../src/grid/hexTile';
import { PREP, TERRAIN } from '../../src/grid/layers';

const R = 4;
const hx = hexIndex(R);
const flatWorld = () => ({
  terrain: new Uint8Array(hx.count).fill(TERRAIN.flat),
  prep: new Uint8Array(hx.count).fill(PREP.wild),
  height: new Float32Array(hx.count),
});
const at = (q: number, r: number) => hx.indexOf(q, r);
const ring = (q: number, r: number) => HEX_DIRS.map(([dq, dr]) => at(q + dq, r + dr));

describe('hex tiles (one rule for the hex grid)', () => {
  it('R1: open ground is Flat or cleared prep, never a ridge or moat', () => {
    expect(isOpenGround(TERRAIN.flat, PREP.wild)).toBe(true);
    expect(isOpenGround(TERRAIN.slope, PREP.prepared)).toBe(true);
    for (const t of [TERRAIN.forest, TERRAIN.rock, TERRAIN.slope, TERRAIN.hole, TERRAIN.shallow, TERRAIN.deep]) {
      expect(isOpenGround(t, PREP.wild)).toBe(false);
    }
    expect(isOpenGround(TERRAIN.flat, PREP.ridge)).toBe(false);
    expect(isOpenGround(TERRAIN.flat, PREP.moat)).toBe(false);
  });

  it('R2: a level open field is hex tiles, except the planet rim (missing neighbours)', () => {
    const mask = hexTileMask(R, flatWorld());
    for (let i = 0; i < hx.count; i++) {
      const rim = Math.max(Math.abs(hx.q[i]!), Math.abs(hx.r[i]!), Math.abs(hx.q[i]! + hx.r[i]!)) === R;
      expect(mask[i]).toBe(rim ? 0 : 1);
    }
  });

  it('R3: an obstacle takes its own tile and its whole one-ring off the grid', () => {
    for (const t of [TERRAIN.forest, TERRAIN.rock, TERRAIN.slope, TERRAIN.hole, TERRAIN.shallow]) {
      const w = flatWorld();
      w.terrain[at(0, 0)] = t;
      expect(isHexTile(R, at(0, 0), w)).toBe(false);
      for (const j of ring(0, 0)) expect(isHexTile(R, j, w)).toBe(false);
      expect(isHexTile(R, at(2, 0), w)).toBe(true); // two steps away it is level grid again
    }
  });

  it('R2: a step in height takes both sides of the step off the grid; a sub-epsilon step does not', () => {
    const w = flatWorld();
    for (let i = 0; i < hx.count; i++) if (hx.q[i]! > 0) w.height[i] = 1.5; // a plateau east of q = 0
    expect(isHexTile(R, at(0, 0), w)).toBe(false);
    expect(isHexTile(R, at(1, 0), w)).toBe(false);
    expect(isHexTile(R, at(-2, 0), w)).toBe(true);
    expect(isHexTile(R, at(2, 0), w)).toBe(true); // on top of the plateau
    const small = flatWorld();
    for (let i = 0; i < hx.count; i++) if (hx.q[i]! > 0) small.height[i] = 1.5 + (hx.q[i]! === 1 ? HEX_LEVEL_EPS_M / 2 : 0);
    expect(isHexTile(R, at(2, 0), small)).toBe(true);
  });

  it('cleared prep on former obstacles is open ground; a ridge breaks the ring', () => {
    const w = flatWorld();
    w.terrain[at(0, 0)] = TERRAIN.rock;
    w.prep[at(0, 0)] = PREP.prepared;
    expect(isHexTile(R, at(1, 0), w)).toBe(true);
    w.prep[at(0, 0)] = PREP.ridge;
    w.terrain[at(0, 0)] = TERRAIN.flat;
    expect(isHexTile(R, at(1, 0), w)).toBe(false);
  });

  it('hexTileRing lists the tile and the neighbours whose state it can change', () => {
    expect(hexTileRing(R, at(0, 0)).sort()).toEqual([at(0, 0), ...ring(0, 0)].sort());
    expect(hexTileRing(R, -1)).toEqual([]);
  });
});
