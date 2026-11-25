import * as THREE from 'three';
import { hexIndex } from '@terra/sim/grid/hex';
import { describe, expect, it } from 'vitest';
import { specForPlanetType } from '../planetKind';
import { createHexTerrain } from '../createHexTerrain';
import { HEX_PREP, HEX_TERRAIN } from '../chunkMesh';
import { tileAt, tileXZ } from '../hexMath';
import { GROUND_FLORA_KINDS } from './groundObjectCatalog';
import { classifyHexSiteAtPoint, classifySurfaceSite, canFitObjectOnTerrain, isDuneWadiSlope } from './terrainCompatibility';

describe('Mountain & steep cliff flora/object exclusion across all biomes', () => {
  it('places zero grass, trees, shrubs, cacti, or wildflowers on HEX_TERRAIN.rock mountains or steep rocky border slopes', () => {
    const r = 10;
    const hx = hexIndex(r);

    for (const biomeType of ['desert', 'temperate', 'ocean'] as const) {
      const terrain = new Uint8Array(hx.count).fill(HEX_TERRAIN.flat);
      const prep = new Uint8Array(hx.count).fill(HEX_PREP.wild);
      const height = new Float32Array(hx.count).fill(0.08);

      const mountainTiles = new Set<number>();
      for (let i = 0; i < hx.count; i++) {
        const q = hx.q[i]!;
        const rr = hx.r[i]!;
        const dist = Math.max(Math.abs(q), Math.abs(rr), Math.abs(q + rr));
        if (dist <= 2) {
          terrain[i] = HEX_TERRAIN.rock;
          height[i] = 2.8;
          mountainTiles.add(i);
        } else if (dist === 3) {
          terrain[i] = HEX_TERRAIN.slope;
          height[i] = 1.45;
          mountainTiles.add(i);
        } else if (dist === 5 && (q + rr) % 2 === 0) {
          terrain[i] = HEX_TERRAIN.forest;
          height[i] = 0.12;
        }
      }

      const ht = createHexTerrain({
        radius: r,
        tiles: { terrain, prep, height },
        look: specForPlanetType(biomeType),
      });

      const mat = new THREE.Matrix4();
      for (const fk of GROUND_FLORA_KINDS) {
        for (const im of ht.flora.meshes[fk]) {
          for (let idx = 0; idx < im.count; idx++) {
            im.getMatrixAt(idx, mat);
            const wx = mat.elements[12]!;
            const wz = mat.elements[14]!;
            const hit = ht.pick(new THREE.Raycaster(new THREE.Vector3(wx, 10, wz), new THREE.Vector3(0, -1, 0)));
            if (hit) {
              expect(
                mountainTiles.has(hit.i),
                `${biomeType} flora ${fk} landed on mountain/cliff tile (${hit.q},${hit.r})`,
              ).toBe(false);
            }
          }
        }
      }

      // Desert mesas must also carry zero props/objects on HEX_TERRAIN.rock
      if (biomeType === 'desert') {
        for (const ti of mountainTiles) {
          if (terrain[ti] === HEX_TERRAIN.rock) {
            expect(ht.props.instancesForTile(ti)).toHaveLength(0);
          }
        }
      }

      // Open outer lowland/desert tiles still generate expected flora cleanly
      const counts = ht.flora.counts();
      const totalFlora = GROUND_FLORA_KINDS.reduce((acc, k) => acc + counts[k], 0);
      expect(totalFlora).toBeGreaterThan(0);
      ht.dispose();
    }
  });

  it('rejects flora and shrubs on steep PlanetSurface mountain slopes', () => {
    const desertCliff = classifySurfaceSite({ biome: 'dune', x: 4, z: 4, y: 4.0, waterLevel: null, slope: 0.52, planetSeed: 7 });
    expect(desertCliff.substrate).toBe('rockOutcrop');
    for (const k of GROUND_FLORA_KINDS) expect(canFitObjectOnTerrain(k, desertCliff)).toBe(false);

    const alpineCliff = classifySurfaceSite({ biome: 'forestRock', x: 4, z: 4, y: 6.0, waterLevel: 0, slope: 0.60, planetSeed: 7 });
    expect(alpineCliff.substrate).toBe('rockOutcrop');
    for (const k of GROUND_FLORA_KINDS) expect(canFitObjectOnTerrain(k, alpineCliff)).toBe(false);
  });
});

describe('Diagonal desert cliffs and elevated plateau wadi-tree guard', () => {
  it('detects diagonal desert mountain cliff slopes and blocks high-elevation wadi trees', () => {
    const hx = hexIndex(4);
    const layers = {
      terrain: new Uint8Array(hx.count).fill(HEX_TERRAIN.slope),
      prep: new Uint8Array(hx.count).fill(HEX_PREP.wild),
      height: new Float32Array(hx.count).fill(2.4),
    };
    const diagRamp = (x: number, z: number) => 0.36 * x + 0.36 * z; // per-axis 0.36 < 0.45, hypot gradient ~0.51 >= 0.45
    const site = classifyHexSiteAtPoint({
      hx,
      tileIndex: hx.indexOf(0, 0),
      x: 0,
      z: 0,
      layers,
      biome: 'dune',
      planetSeed: 7,
      heightAt: diagRamp,
    });
    expect(site.slope).toBeGreaterThanOrEqual(0.45);
    expect(site.substrate).toBe('duneMesaCap');
    for (const k of GROUND_FLORA_KINDS) expect(canFitObjectOnTerrain(k, site)).toBe(false);
    expect(isDuneWadiSlope(0, 0, 2.5, { moisture: 1, rockiness: 0, fertility: 1 }, 7)).toBe(false);
  });
});

describe('Mountain living-turf rejection & flat/dune cliff boundary guards', () => {
  it('rejects living turf flora on HEX_TERRAIN.rock even when prep is HEX_PREP.living across all biomes', () => {
    const r = 4;
    const hx = hexIndex(r);

    for (const biomeType of ['desert', 'temperate', 'ocean'] as const) {
      const look = specForPlanetType(biomeType);
      const terrain = new Uint8Array(hx.count).fill(HEX_TERRAIN.flat);
      const prep = new Uint8Array(hx.count).fill(HEX_PREP.living);
      const height = new Float32Array(hx.count).fill(0.15);

      const rockTile = hx.indexOf(0, 0);
      terrain[rockTile] = HEX_TERRAIN.rock;
      height[rockTile] = 2.6;

      const [rx, rz] = tileXZ(0, 0);
      const rockSite = classifyHexSiteAtPoint({
        hx,
        tileIndex: rockTile,
        x: rx,
        z: rz,
        layers: { terrain, prep, height, kind: look.kind, seed: look.seed },
        biome: look.kind,
        planetSeed: look.seed,
        heightAt: () => 2.6,
      });
      expect(rockSite.substrate).toBe(biomeType === 'desert' ? 'duneMesaCap' : 'rockOutcrop');
      for (const fk of GROUND_FLORA_KINDS) expect(canFitObjectOnTerrain(fk, rockSite)).toBe(false);

      const ht = createHexTerrain({ radius: r, tiles: { terrain, prep, height }, look });
      const mat = new THREE.Matrix4();
      const v = new THREE.Vector3();
      for (const fk of GROUND_FLORA_KINDS) {
        for (const im of ht.flora.meshes[fk]) {
          const pos = im.geometry.getAttribute('position');
          for (let idx = 0; idx < im.count; idx++) {
            im.getMatrixAt(idx, mat);
            const cHit = tileAt(r, mat.elements[12]!, mat.elements[14]!);
            expect(cHit?.i).not.toBe(rockTile);
            for (let vi = 0; vi < pos.count; vi++) {
              v.fromBufferAttribute(pos, vi).applyMatrix4(mat);
              const vHit = tileAt(r, v.x, v.z);
              expect(vHit?.i, `${biomeType} living ${fk} vertex landed on rock`).not.toBe(rockTile);
            }
          }
        }
      }
      expect(ht.flora.counts().grassTuft).toBeGreaterThan(0);
      ht.dispose();
    }
  });
});

describe('Flat cliff shoulder & wild dune slope mountain boundary guards', () => {
  it('classifies steep flat cliff shoulders as rockOutcrop (non-dune) and steep wild dunes as duneMesaCap (dune)', () => {
    const hx = hexIndex(4);
    const center = hx.indexOf(0, 0);
    const neighbor = hx.indexOf(1, 0);

    // Non-dune HEX_TERRAIN.flat beside rock: slope >= 0.36 -> rockOutcrop; gentle slope < 0.36 -> meadowTurf
    const nonDuneWithRock = {
      terrain: new Uint8Array(hx.count).fill(HEX_TERRAIN.flat),
      prep: new Uint8Array(hx.count).fill(HEX_PREP.wild),
      height: new Float32Array(hx.count).fill(0.5),
    };
    nonDuneWithRock.terrain[neighbor] = HEX_TERRAIN.rock;
    for (const biome of ['forestRock', 'oceanForest'] as const) {
      const shoulder = classifyHexSiteAtPoint({
        hx, tileIndex: center, x: 0, z: 0, layers: nonDuneWithRock, biome, planetSeed: 11, heightAt: (x) => 0.36 * x,
      });
      expect(shoulder.substrate).toBe('rockOutcrop');
      for (const fk of GROUND_FLORA_KINDS) expect(canFitObjectOnTerrain(fk, shoulder)).toBe(false);

      const gentle = classifyHexSiteAtPoint({
        hx, tileIndex: center, x: 0, z: 0, layers: nonDuneWithRock, biome, planetSeed: 11, heightAt: (x) => 0.35 * x,
      });
      expect(gentle.substrate).toBe('meadowTurf');

      // Non-dune HEX_TERRAIN.flat without rock neighbor: slope >= 0.48 -> rockOutcrop; 0.47 -> meadowTurf
      const noRockLayers = {
        terrain: new Uint8Array(hx.count).fill(HEX_TERRAIN.flat),
        prep: new Uint8Array(hx.count).fill(HEX_PREP.wild),
        height: new Float32Array(hx.count).fill(0.5),
      };
      const steepNoRock = classifyHexSiteAtPoint({
        hx, tileIndex: center, x: 0, z: 0, layers: noRockLayers, biome, planetSeed: 11, heightAt: (x) => 0.48 * x,
      });
      expect(steepNoRock.substrate).toBe('rockOutcrop');
      const moderateNoRock = classifyHexSiteAtPoint({
        hx, tileIndex: center, x: 0, z: 0, layers: noRockLayers, biome, planetSeed: 11, heightAt: (x) => 0.47 * x,
      });
      expect(moderateNoRock.substrate).toBe('meadowTurf');
    }

    // Wild dune terrain (flat & shallow) with slope >= 0.40 classifies as duneMesaCap; 0.39 stays aridDune
    for (const tCode of [HEX_TERRAIN.flat, HEX_TERRAIN.shallow] as const) {
      const duneLayers = {
        terrain: new Uint8Array(hx.count).fill(tCode),
        prep: new Uint8Array(hx.count).fill(HEX_PREP.wild),
        height: new Float32Array(hx.count).fill(0.4),
      };
      const steepDune = classifyHexSiteAtPoint({
        hx, tileIndex: center, x: 0, z: 0, layers: duneLayers, biome: 'dune', planetSeed: 11, heightAt: (x) => 0.40 * x,
      });
      expect(steepDune.substrate).toBe('duneMesaCap');
      for (const fk of GROUND_FLORA_KINDS) expect(canFitObjectOnTerrain(fk, steepDune)).toBe(false);

      const gentleDune = classifyHexSiteAtPoint({
        hx, tileIndex: center, x: 0, z: 0, layers: duneLayers, biome: 'dune', planetSeed: 11, heightAt: (x) => 0.39 * x,
      });
      expect(gentleDune.substrate).toBe('aridDune');
      expect(canFitObjectOnTerrain('barrelCactus', gentleDune)).toBe(true);
    }
  });
});
