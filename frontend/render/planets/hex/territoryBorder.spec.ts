import { describe, expect, it } from 'vitest';
import { hexCount, hexDistance, hexIndex } from '@terra/sim/grid/hex';
import {
  BORDER_Y_OFFSET,
  buildTerritoryBorderGeometry,
  createHexTerrain,
  DEFAULT_COLONY_COLORS,
  FROZEN_BORDER_WIDTH,
  HEX_PREP,
  HEX_TERRAIN,
  NORMAL_BORDER_WIDTH,
  resolveColonyColorRgb,
  specForPlanetType,
} from './index';

function makeFlatTiles(radius: number) {
  const count = hexCount(radius);
  const terrain = new Uint8Array(count).fill(HEX_TERRAIN.flat);
  const prep = new Uint8Array(count).fill(HEX_PREP.flat);
  const height = new Float32Array(count);
  const owner = new Int8Array(count).fill(-1);
  return { terrain, prep, height, owner };
}

describe('W01-30: Territory border acceptance (R 10 Hub claim)', () => {
  it('completing Command Hub claims R 10 (331 tiles) and renders the R 10 outline in colony 0 colour', () => {
    const radius = 16;
    const hx = hexIndex(radius);
    const tiles = makeFlatTiles(radius);
    const look = specForPlanetType('temperate');
    const terrain = createHexTerrain({ radius, tiles, look });

    const before = terrain.getTerritoryBorderStats();
    expect(before.ownedTileCount).toBe(0);
    expect(before.boundaryEdgeCount).toBe(0);
    expect(before.frozenEdgeCount).toBe(0);
    expect(terrain.borderMesh.visible).toBe(false);
    expect(terrain.borderMesh.name).toBe('territory-border');
    expect(terrain.group.children).toContain(terrain.borderMesh);

    const claimedIndices: number[] = [];
    for (let i = 0; i < hx.count; i++) {
      if (hexDistance(0, 0, hx.q[i]!, hx.r[i]!) <= 10) {
        tiles.owner[i] = 0;
        claimedIndices.push(i);
      }
    }
    expect(claimedIndices.length).toBe(331);

    terrain.updateTiles(claimedIndices);

    const after = terrain.getTerritoryBorderStats();
    expect(after.ownedTileCount).toBe(331);
    expect(after.boundaryEdgeCount).toBe(126);
    expect(after.frozenEdgeCount).toBe(0);
    expect(terrain.borderMesh.visible).toBe(true);

    const posAttr = terrain.borderMesh.geometry.getAttribute('position');
    const colAttr = terrain.borderMesh.geometry.getAttribute('color');
    expect(posAttr.count).toBe(after.boundaryEdgeCount * 4);
    expect(colAttr.count).toBe(after.boundaryEdgeCount * 4);

    const [er, eg, eb] = resolveColonyColorRgb(0);
    expect(DEFAULT_COLONY_COLORS[0]).toBe(0xff6a2a);
    for (let v = 0; v < colAttr.count; v++) {
      expect(colAttr.getX(v)).toBeCloseTo(er, 4);
      expect(colAttr.getY(v)).toBeCloseTo(eg, 4);
      expect(colAttr.getZ(v)).toBeCloseTo(eb, 4);
      expect(posAttr.getY(v)).toBeCloseTo(BORDER_Y_OFFSET, 4);
    }

    terrain.dispose();
  });
});

describe('W01-30: Frozen (contested) border thickness', () => {
  it('renders frozen borders between two colonies thicker (0.18m) than normal unclaimed borders (0.08m)', () => {
    const radius = 16;
    const hx = hexIndex(radius);
    const tiles = makeFlatTiles(radius);
    const look = specForPlanetType('temperate');

    for (let i = 0; i < hx.count; i++) {
      if (hexDistance(0, 0, hx.q[i]!, hx.r[i]!) <= 10) {
        tiles.owner[i] = 0;
      }
    }
    const col1Claimed: number[] = [];
    for (let i = 0; i < hx.count; i++) {
      if (tiles.owner[i] === -1 && hexDistance(12, 0, hx.q[i]!, hx.r[i]!) <= 5) {
        tiles.owner[i] = 1;
        col1Claimed.push(i);
      }
    }
    expect(col1Claimed.length).toBeGreaterThan(0);

    const terrain = createHexTerrain({ radius, tiles, look });
    const stats = terrain.getTerritoryBorderStats();
    expect(stats.frozenEdgeCount).toBeGreaterThan(0);
    expect(stats.boundaryEdgeCount).toBeGreaterThan(stats.frozenEdgeCount);

    const posAttr = terrain.borderMesh.geometry.getAttribute('position');
    const widthAttr = terrain.borderMesh.geometry.getAttribute('aBorderWidth');
    let normalQuads = 0;
    let frozenQuads = 0;

    for (let qIdx = 0; qIdx < stats.boundaryEdgeCount; qIdx++) {
      const v0 = qIdx * 4;
      const v3 = v0 + 3;
      const measuredWidth = Math.hypot(
        posAttr.getX(v0) - posAttr.getX(v3),
        posAttr.getZ(v0) - posAttr.getZ(v3),
      );
      const attrW = widthAttr.getX(v0);
      expect(measuredWidth).toBeCloseTo(attrW, 5);
      if (Math.abs(attrW - FROZEN_BORDER_WIDTH) < 1e-4) {
        frozenQuads++;
        expect(measuredWidth).toBeCloseTo(0.18, 4);
      } else {
        normalQuads++;
        expect(measuredWidth).toBeCloseTo(NORMAL_BORDER_WIDTH, 4);
        expect(measuredWidth).toBeCloseTo(0.08, 4);
      }
    }

    expect(frozenQuads).toBe(stats.frozenEdgeCount);
    expect(normalQuads).toBe(stats.boundaryEdgeCount - stats.frozenEdgeCount);
    expect(FROZEN_BORDER_WIDTH).toBeGreaterThan(NORMAL_BORDER_WIDTH * 2);

    terrain.dispose();
  });
});

describe('W01-30: Colour-blind hatch pattern and colony colour overrides', () => {
  it('generates colour-blind hatch segments along boundary edges and supports custom colony colours', () => {
    const radius = 8;
    const hx = hexIndex(radius);
    const tiles = makeFlatTiles(radius);
    const look = specForPlanetType('temperate');

    for (let i = 0; i < hx.count; i++) {
      const q = hx.q[i]!, r = hx.r[i]!;
      if (hexDistance(0, 0, q, r) <= 2) tiles.owner[i] = 0;
      else if (hexDistance(4, 0, q, r) <= 1) tiles.owner[i] = 3;
    }

    const terrain = createHexTerrain({ radius, tiles, look });
    const solidStats = terrain.getTerritoryBorderStats();
    expect(solidStats.colorBlindMode).toBe(false);
    expect(solidStats.hatchSegmentCount).toBe(0);
    const solidVerts = terrain.borderMesh.geometry.getAttribute('position').count;
    expect(solidVerts).toBe(solidStats.boundaryEdgeCount * 4);

    terrain.setColorBlindMode(true);
    const hatchStats = terrain.getTerritoryBorderStats();
    expect(hatchStats.colorBlindMode).toBe(true);
    expect(hatchStats.hatchSegmentCount).toBeGreaterThan(solidStats.boundaryEdgeCount * 2);
    const hatchVerts = terrain.borderMesh.geometry.getAttribute('position').count;
    expect(hatchVerts).toBe((hatchStats.boundaryEdgeCount + hatchStats.hatchSegmentCount) * 4);

    terrain.setColonyColors({ 0: 0x11ddaa });
    const colAttr = terrain.borderMesh.geometry.getAttribute('color');
    const [r0, g0, b0] = resolveColonyColorRgb(0, { 0: 0x11ddaa });
    expect(colAttr.getX(0)).toBeCloseTo(r0, 4);
    expect(colAttr.getY(0)).toBeCloseTo(g0, 4);
    expect(colAttr.getZ(0)).toBeCloseTo(b0, 4);

    const built = buildTerritoryBorderGeometry(radius, tiles, { colorBlindMode: true });
    expect(built.stats.hatchSegmentCount).toBe(hatchStats.hatchSegmentCount);
    built.geometry.dispose();

    terrain.dispose();
  });
});
