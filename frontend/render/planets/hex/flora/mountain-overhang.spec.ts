import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { hexCount, hexIndex } from '@terra/sim/grid/hex';
import { bakeWreckGeometry } from '../../../combat/wreckGeometry';
import { ArchetypeCatalog } from '../../../kitbash';
import { HEX_DEPOSIT, HEX_PREP, HEX_TERRAIN, tileXZ } from '../index';
import { canFitObjectFootprint, classifyHexSiteAtPoint } from './terrainCompatibility';

describe('Mountain cliff-shoulder overhang and rock-deposit exclusion', () => {
  it('rejects overhanging flora whose perimeter reaches a steep non-dune cliff shoulder even with substrateOnly=true', () => {
    const r = 4;
    const count = hexCount(r);
    const hx = hexIndex(r);
    const terrain = new Uint8Array(count).fill(HEX_TERRAIN.flat);
    const prep = new Uint8Array(count).fill(HEX_PREP.wild);
    const deposit = new Uint8Array(count);
    const height = new Float32Array(count);

    // Hex (0, 0) is wild flat meadow; hex (1, 0) is flat next to rock at (2, 0), sloping steeply at x > 1.0
    const centerIdx = hx.indexOf(0, 0);
    const shoulderIdx = hx.indexOf(1, 0);
    terrain[hx.indexOf(2, 0)] = HEX_TERRAIN.rock;

    const cliffHeightAt = (x: number) => (x > 1.0 ? (x - 1.0) * 0.45 : 0);
    const sample = (px: number, pz: number, substrateOnly?: boolean) => {
      const idx = px > 1.0 ? shoulderIdx : centerIdx;
      return classifyHexSiteAtPoint({
        hx,
        tileIndex: idx,
        x: px,
        z: pz,
        layers: { terrain, prep, deposit, height },
        biome: 'forestRock',
        planetSeed: 7,
        heightAt: cliffHeightAt,
        substrateOnly,
      });
    };

    const [cx, cz] = tileXZ(0, 0);
    // Center is completely flat meadow turf and accepts bushes
    expect(canFitObjectFootprint('bush', cx, cz, sample)).toBe(true);
    // Edge of (0,0) overhangs into (1,0) cliff shoulder where slope = 0.45 >= 0.36 next to rock
    expect(sample(1.3, 0, false).substrate).toBe('rockOutcrop');
    expect(sample(1.3, 0, true).substrate).toBe('rockOutcrop');
    expect(canFitObjectFootprint('bush', cx + 0.72, cz, sample)).toBe(false);
  });

  it('rejects overhanging flora whose perimeter reaches a steep dune shoulder (slope >= 0.40)', () => {
    const r = 4;
    const count = hexCount(r);
    const hx = hexIndex(r);
    const terrain = new Uint8Array(count).fill(HEX_TERRAIN.flat);
    const prep = new Uint8Array(count).fill(HEX_PREP.wild);
    const deposit = new Uint8Array(count);
    const height = new Float32Array(count);

    const centerIdx = hx.indexOf(0, 0);
    const shoulderIdx = hx.indexOf(1, 0);
    const duneCliffHeightAt = (x: number) => (x > 1.0 ? (x - 1.0) * 0.44 : 0);
    const sample = (px: number, pz: number, substrateOnly?: boolean) =>
      classifyHexSiteAtPoint({
        hx,
        tileIndex: px > 1.0 ? shoulderIdx : centerIdx,
        x: px,
        z: pz,
        layers: { terrain, prep, deposit, height },
        biome: 'dune',
        planetSeed: 11,
        heightAt: duneCliffHeightAt,
        substrateOnly,
      });

    const [cx, cz] = tileXZ(0, 0);
    expect(canFitObjectFootprint('saguaro', cx, cz, sample)).toBe(true);
    expect(sample(1.3, 0, true).substrate).toBe('duneMesaCap');
    expect(canFitObjectFootprint('saguaro', cx + 0.72, cz, sample)).toBe(false);
    expect(canFitObjectFootprint('bush', cx + 0.72, cz, sample)).toBe(false);
  });
});

describe('Rocky mountain deposit precedence', () => {
  it('classifies rocky mountain hexes as rockOutcrop even if a deposit byte is present on forestRock/oceanForest', () => {
    const r = 4;
    const count = hexCount(r);
    const hx = hexIndex(r);
    const terrain = new Uint8Array(count).fill(HEX_TERRAIN.flat);
    const prep = new Uint8Array(count).fill(HEX_PREP.wild);
    const deposit = new Uint8Array(count);
    const height = new Float32Array(count);

    const rockIdx = hx.indexOf(0, 0);
    terrain[rockIdx] = HEX_TERRAIN.rock;
    deposit[rockIdx] = HEX_DEPOSIT.metals;

    const site = classifyHexSiteAtPoint({
      hx,
      tileIndex: rockIdx,
      x: 0,
      z: 0,
      layers: { terrain, prep, deposit, height },
      biome: 'forestRock',
      planetSeed: 3,
      heightAt: () => 1.2,
    });
    expect(site.substrate).toBe('rockOutcrop');
  });
});

describe('Solar array charred wreck optics & panel blackening', () => {
  it('blackens solarCell panels and gloss optics across the whole mesh in bakeWreckGeometry', () => {
    const solarGeo = ArchetypeCatalog.getGeometry('building.solar');
    const baked = bakeWreckGeometry(solarGeo);
    const color = baked.getAttribute('color') as THREE.BufferAttribute;
    const pbr = baked.getAttribute('aSurfacePBR') as THREE.BufferAttribute;
    expect(color).toBeDefined();
    expect(pbr).toBeDefined();

    for (let i = 0; i < color.count; i++) {
      const r = color.getX(i);
      const g = color.getY(i);
      const b = color.getZ(i);
      const a = color.itemSize >= 4 ? color.getW(i) : 0;
      expect(a).toBe(0);
      expect(pbr.getX(i)).toBeGreaterThanOrEqual(0.91);
      expect(pbr.getY(i)).toBe(0);
      expect(b - r).toBeLessThanOrEqual(0.03);
      expect(Math.max(r, g, b)).toBeLessThanOrEqual(0.18);
    }
  });
});
