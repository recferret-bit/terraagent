import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { hexIndex } from '@terra/sim/grid/hex';
import {
  buildGroundFloraAtlasGeo,
  GROUND_VARIANT_COUNT,
  makeBarrelCactusGeo,
  makeBoulderGeo,
  makeBushGeo,
  makeGrassTuftGeo,
  makeSaguaroCactusGeo,
  makeShoreReedsGeo,
  makeSpireGeo,
  makeWildflowerGeo,
} from '../../../visuals/terrain/groundFloraGeos';
import { createHexTerrain, HEX_PREP, HEX_TERRAIN, specForPlanetType } from '../index';

describe('5-variant ground object geometry atlases & seeded scatter diversity', () => {
  it('builds 5 distinct variants (0..4) for all 8 ground object families and selects all 5 across seeded hex planets', () => {
    const atlasKinds = ['grassTuft', 'wildflower', 'bush', 'saguaro', 'barrelCactus', 'reeds'] as const;
    for (const fk of atlasKinds) {
      const atlas = buildGroundFloraAtlasGeo(fk, 'oceanForest', 42);
      const aBreed = atlas.getAttribute('aBreed');
      expect(aBreed).toBeDefined();
      const seen = new Set<number>();
      for (let i = 0; i < aBreed.count; i++) seen.add(Math.round(aBreed.getX(i)));
      expect(seen.size).toBe(GROUND_VARIANT_COUNT);
      atlas.dispose();
    }

    const triSig = (g: THREE.BufferGeometry) => {
      const n = g.getAttribute('position').count;
      g.dispose();
      return n;
    };
    const families = [
      (v: number) => makeGrassTuftGeo('forestRock', 11, v),
      (v: number) => makeWildflowerGeo('forestRock', 23, v),
      (v: number) => makeBushGeo('forestRock', 37, v),
      (v: number) => makeSaguaroCactusGeo(53, v),
      (v: number) => makeBarrelCactusGeo(67, v),
      (v: number) => makeShoreReedsGeo(79, v),
      (v: number) => makeBoulderGeo(11, new THREE.Color(1, 1, 1), v),
      (v: number) => makeSpireGeo(7, new THREE.Color(1, 1, 1), v),
    ];
    for (const make of families) {
      const counts = new Set(Array.from({ length: GROUND_VARIANT_COUNT }, (_, v) => triSig(make(v))));
      expect(counts.size).toBeGreaterThanOrEqual(4);
    }

    // Seeded hex planets assign all 5 variants (encoded in instanceColor.r via floor(r / 8))
    const R = 16;
    const hx = hexIndex(R);
    const makeRich = (pType: 'ocean' | 'desert') => {
      const terrain = new Uint8Array(hx.count).fill(HEX_TERRAIN.flat);
      const prep = new Uint8Array(hx.count).fill(HEX_PREP.wild);
      const height = new Float32Array(hx.count).fill(0.15);
      for (let i = 0; i < hx.count; i++) {
        if (i % 7 === 0) terrain[i] = HEX_TERRAIN.rock;
        else if (i % 5 === 0) terrain[i] = HEX_TERRAIN.forest;
        else if (pType === 'ocean' && i % 11 === 0) {
          terrain[i] = HEX_TERRAIN.shallow;
          height[i] = -0.24;
        }
      }
      return createHexTerrain({ radius: R, tiles: { terrain, prep, height }, look: specForPlanetType(pType, 101) });
    };

    const oceanHt = makeRich('ocean');
    const duneHt = makeRich('desert');
    const seenVariants = (meshes: readonly THREE.InstancedMesh[]) => {
      const c = new THREE.Color();
      const out = new Set<number>();
      for (const im of meshes) {
        for (let i = 0; i < im.count; i++) {
          im.getColorAt(i, c);
          out.add(Math.floor((c.r + 0.01) / 8));
        }
      }
      return out;
    };

    expect(seenVariants(oceanHt.flora.meshes.grassTuft).size).toBe(GROUND_VARIANT_COUNT);
    expect(seenVariants(oceanHt.flora.meshes.bush).size).toBe(GROUND_VARIANT_COUNT);
    expect(seenVariants(duneHt.flora.meshes.saguaro).size).toBe(GROUND_VARIANT_COUNT);
    expect(seenVariants(duneHt.flora.meshes.barrelCactus).size).toBe(GROUND_VARIANT_COUNT);
    expect(seenVariants(oceanHt.props.meshes.boulder).size).toBe(GROUND_VARIANT_COUNT);
    expect(seenVariants(oceanHt.props.meshes.spire).size).toBe(GROUND_VARIANT_COUNT);

    oceanHt.dispose();
    duneHt.dispose();
  });
});
