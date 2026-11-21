import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { hexDistance, hexIndex } from '@terra/sim/grid/hex';
import {
  clampToGroundHexagon,
  createHexTerrain,
  GROUND_FLORA_KINDS,
  HEX_DEPOSIT,
  HEX_PREP,
  HEX_PROP_EDGE_MARGIN_M,
  HEX_TERRAIN,
  hexEdgeMarginM,
  PROP_KINDS,
  specForPlanetType,
  tileXZ,
} from './index';
import { bucketMeta } from './propBuckets';

describe('hexEdgeMarginM & clampToGroundHexagon', () => {
  it('computes exact signed margin on perimeter, corners, interior, and exterior points', () => {
    const r = 12;
    const [cx, cz] = tileXZ(r, 0);
    expect(hexEdgeMarginM(r, cx, cz)).toBeCloseTo(0, 6);
    expect(hexEdgeMarginM(r, ...tileXZ(0, r))).toBeCloseTo(0, 6);
    expect(hexEdgeMarginM(r, ...tileXZ(-r, r))).toBeCloseTo(0, 6);
    expect(hexEdgeMarginM(r, 0, 0)).toBeGreaterThan(20);
    expect(hexEdgeMarginM(r, cx + 1, 0)).toBeLessThan(0);

    const interior: [number, number] = [4.2, -3.7];
    expect(clampToGroundHexagon(r, interior[0], interior[1])).toEqual(interior);

    for (const [cq, cr] of [[r, 0], [0, r], [-r, r], [-r, 0], [0, -r], [r, -r]] as const) {
      const [px, pz] = clampToGroundHexagon(r, ...tileXZ(cq, cr));
      expect(hexEdgeMarginM(r, px, pz)).toBeGreaterThanOrEqual(HEX_PROP_EDGE_MARGIN_M - 1e-6);
    }
  });
});

describe('Ground hexagon rim & corner prop containment', () => {
  const verifyRimFill = (
    planetType: 'temperate' | 'ocean' | 'desert',
    fillTerrain: number,
    depKind: number = HEX_DEPOSIT.none,
  ) => {
    const r = 12;
    const hx = hexIndex(r);
    const terrain = new Uint8Array(hx.count).fill(HEX_TERRAIN.flat);
    const prep = new Uint8Array(hx.count).fill(HEX_PREP.flat);
    const height = new Float32Array(hx.count);
    const deposit = new Uint8Array(hx.count);
    const depositTier = new Uint8Array(hx.count);
    const richness = new Uint16Array(hx.count).fill(10000);
    for (let i = 0; i < hx.count; i++) {
      const d = hexDistance(0, 0, hx.q[i]!, hx.r[i]!);
      if (d === r) {
        terrain[i] = fillTerrain;
        prep[i] = HEX_PREP.wild;
        deposit[i] = depKind;
        if (depKind !== HEX_DEPOSIT.none) depositTier[i] = 3;
      } else if (d === r - 1 && planetType !== 'desert' && depKind === HEX_DEPOSIT.none) {
        terrain[i] = HEX_TERRAIN.shallow;
        prep[i] = HEX_PREP.wild;
      }
    }
    const ht = createHexTerrain({
      radius: r,
      tiles: { terrain, prep, height, deposit, depositTier, richness },
      look: specForPlanetType(planetType),
    });
    let checkedInstances = 0;
    let checkedFloraInstances = 0;
    let minInstMargin = Infinity;
    let minVertexMargin = Infinity;
    const mat = new THREE.Matrix4();
    const v = new THREE.Vector3();
    for (const kind of PROP_KINDS) {
      for (const im of ht.props.meshes[kind]) {
        const placed = bucketMeta(im).placed;
        const pos = im.geometry.getAttribute('position');
        for (let k = 0; k < im.count; k++) {
          const inst = placed[k]!;
          minInstMargin = Math.min(minInstMargin, hexEdgeMarginM(r, inst.x, inst.z));
          im.getMatrixAt(k, mat);
          for (let vi = 0; vi < pos.count; vi++) {
            v.fromBufferAttribute(pos, vi).applyMatrix4(mat);
            minVertexMargin = Math.min(minVertexMargin, hexEdgeMarginM(r, v.x, v.z));
          }
          checkedInstances++;
        }
      }
    }
    for (const fk of GROUND_FLORA_KINDS) {
      for (const im of ht.flora.meshes[fk]) {
        const pos = im.geometry.getAttribute('position');
        for (let k = 0; k < im.count; k++) {
          im.getMatrixAt(k, mat);
          for (let vi = 0; vi < pos.count; vi++) {
            v.fromBufferAttribute(pos, vi).applyMatrix4(mat);
            minVertexMargin = Math.min(minVertexMargin, hexEdgeMarginM(r, v.x, v.z));
          }
          checkedFloraInstances++;
        }
      }
    }
    expect(checkedInstances + checkedFloraInstances).toBeGreaterThan(0);
    if (checkedInstances > 0) {
      expect(minInstMargin).toBeGreaterThanOrEqual(HEX_PROP_EDGE_MARGIN_M - 1e-4);
    }
    expect(minVertexMargin).toBeGreaterThanOrEqual(0);
    ht.dispose();
  };

  it('keeps every tree, ground flora mesh, boulder, spire, and tier-3 deposit node strictly inside the ground hexagon on rim & corner tiles', () => {
    verifyRimFill('temperate', HEX_TERRAIN.forest);
    verifyRimFill('ocean', HEX_TERRAIN.forest);
    verifyRimFill('desert', HEX_TERRAIN.forest);
    verifyRimFill('temperate', HEX_TERRAIN.flat);
    verifyRimFill('ocean', HEX_TERRAIN.flat);
    verifyRimFill('desert', HEX_TERRAIN.slope);
    verifyRimFill('temperate', HEX_TERRAIN.rock);
    verifyRimFill('desert', HEX_TERRAIN.rock);
    verifyRimFill('temperate', HEX_TERRAIN.flat, HEX_DEPOSIT.metals);
    verifyRimFill('temperate', HEX_TERRAIN.flat, HEX_DEPOSIT.minerals);
    verifyRimFill('temperate', HEX_TERRAIN.flat, HEX_DEPOSIT.oil);
  });
});
