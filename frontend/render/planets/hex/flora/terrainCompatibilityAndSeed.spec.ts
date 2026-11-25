import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { fnv1a32, hexCount, hexIndex } from '@terra/sim/grid/hex';
import { buildTreeBreedGeo, TREE_BREEDS } from '../../../visuals/terrain/treeBreeds';
import { createPlanetSurface } from '../../surface';
import { PLANET_SPECS } from '../../PlanetSpec';
import {
  buildChunk,
  canFitObjectFootprint,
  canFitObjectOnTerrain,
  classifyHexSiteAtPoint,
  classifyHexTilePropSite,
  classifySurfaceSite,
  computeEffectiveHeights,
  createHexTerrain,
  GROUND_FLORA_KINDS,
  GROUND_OBJECT_SPECS,
  hashGroundSeed,
  HEX_DEPOSIT,
  HEX_PREP,
  HEX_TERRAIN,
  isHexBeachSandAtPoint,
  mixGroundSeed,
  parseGroundSeedInput,
  renderedFloraOuterRadius,
  sampleHexShoreAtPoint,
  specForPlanetType,
  tileAt,
  tileShoreFactor,
  tileXZ,
} from '../index';

describe('Stemmed tree breeds, 42-degree isometric stem visibility & organic connectivity', () => {
  it('builds visible grounded woody trunks (aBark = 1) unoccluded under 42° isometric camera across all 11 breeds and scale ranges', () => {
    const tan42 = Math.tan((42 * Math.PI) / 180);
    const sink = 0.08;
    for (const breed of TREE_BREEDS) {
      const geo = buildTreeBreedGeo(breed.id, 17);
      const pos = geo.getAttribute('position');
      const aBark = geo.getAttribute('aBark');
      expect(aBark).toBeDefined();
      let minY = Infinity;
      let maxY = -Infinity;
      let barkVerts = 0;
      let foliageVerts = 0;
      let minBarkY = Infinity;
      let minCoreBarkY = Infinity;
      let maxCoreBarkY = -Infinity;
      let minFolY = Infinity;
      let minCoreFolY = Infinity;
      let maxPeripheralBarkY = -Infinity;
      let outerTipY = -Infinity;
      let maxOuterR = 0;
      const foliageRZ: Array<[number, number]> = [];
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        const rad = Math.hypot(x, z);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        if (aBark.getX(i) > 0.5) {
          barkVerts++;
          minBarkY = Math.min(minBarkY, y);
          if (rad < 0.35) {
            minCoreBarkY = Math.min(minCoreBarkY, y);
            maxCoreBarkY = Math.max(maxCoreBarkY, y);
          }
          if (rad > 0.50) maxPeripheralBarkY = Math.max(maxPeripheralBarkY, y);
        } else {
          foliageVerts++;
          minFolY = Math.min(minFolY, y);
          if (rad < 0.45) minCoreFolY = Math.min(minCoreFolY, y);
          foliageRZ.push([rad, y]);
          if (rad > maxOuterR) {
            maxOuterR = rad;
            outerTipY = y;
          }
        }
      }
      expect(barkVerts).toBeGreaterThan(15);
      expect(foliageVerts).toBeGreaterThan(15);
      expect(minBarkY).toBeLessThanOrEqual(-0.04);
      expect(minCoreBarkY).toBeLessThanOrEqual(-0.06);
      if (Number.isFinite(minCoreFolY)) {
        expect(maxCoreBarkY).toBeGreaterThanOrEqual(minCoreFolY);
      }
      expect(minY).toBeLessThanOrEqual(-0.04);
      expect(minY).toBeGreaterThanOrEqual(-0.20);
      expect(maxY).toBeGreaterThan(4.2);
      expect(minFolY).toBeGreaterThanOrEqual(2.0);

      // 42° isometric camera ray clearance across breed worst-case (widest XZ + shortest Y) and world INST_OPTS
      const evalIsoStem = (sx: number, sy: number) => {
        let best = Infinity;
        for (const [r, y] of foliageRZ) {
          best = Math.min(best, (y - sink) * sy - r * sx * tan42);
        }
        return best;
      };
      const isoWorst = evalIsoStem(breed.scaleRangeXZ[1], breed.scaleRangeY[0]);
      const isoMean = evalIsoStem(
        (breed.scaleRangeXZ[0] + breed.scaleRangeXZ[1]) * 0.5,
        (breed.scaleRangeY[0] + breed.scaleRangeY[1]) * 0.5,
      );
      const worldWorst = evalIsoStem(0.48 * 1.06 * breed.scaleRangeXZ[1], 0.40 * breed.scaleRangeY[0]);
      expect(isoWorst).toBeGreaterThanOrEqual(1.0);
      expect(isoMean).toBeGreaterThanOrEqual(1.5);
      expect(worldWorst).toBeGreaterThanOrEqual(0.32);

      if (breed.id === 'canopyBanyan') {
        expect(maxPeripheralBarkY).toBeGreaterThanOrEqual(2.85);
      }
      if (breed.canopyShape === 'palmCrown') {
        expect(outerTipY).toBeLessThan(maxY - 0.55);
      }
      geo.dispose();
    }
  });
});

describe('Coastal sand exclusion & declarative object-to-terrain compatibility', () => {
  it('excludes bushes, wildflowers, grass tufts, and reeds from all dry coastal sand near water hexagons (1..6 water neighbors)', () => {
    const r = 8;
    const hx = hexIndex(r);
    const terrain = new Uint8Array(hx.count).fill(HEX_TERRAIN.flat);
    const prep = new Uint8Array(hx.count).fill(HEX_PREP.wild);
    const height = new Float32Array(hx.count).fill(0.08);

    for (const [wq, wr] of [[0, 0], [1, 0], [0, 1], [-1, 1]] as const) {
      const wi = hx.indexOf(wq, wr);
      terrain[wi] = HEX_TERRAIN.shallow;
      height[wi] = -0.24;
    }
    // Include an elevated coastal flat tile at y = 0.25 (above legacy 0.20, still within HEX_SHORE_BEACH_GLSL beach sand)
    const highSandIdx = hx.indexOf(-1, 0);
    height[highSandIdx] = 0.25;

    const coastalForestIdx = hx.indexOf(2, -1);
    terrain[coastalForestIdx] = HEX_TERRAIN.forest;
    height[coastalForestIdx] = 0.14;

    const layers = { terrain, prep, height, kind: 'oceanForest' as const, seed: hashGroundSeed('coastal-sand-test') };
    const shoreIdx = hx.indexOf(1, 1);
    const sf = tileShoreFactor(hx, shoreIdx, layers);
    expect(sf).toBeGreaterThan(0.70);
    expect(sf).toBeLessThanOrEqual(0.92);

    const chunk = buildChunk(r, Array.from({ length: hx.count }, (_, i) => i), layers);
    const vertPos = Array.from(chunk.vertexTile).indexOf(shoreIdx);
    expect(chunk.aHexShore[vertPos]).toBeCloseTo(sf, 4);

    const ht = createHexTerrain({ radius: r, tiles: layers, look: specForPlanetType('ocean', 'coastal-sand-test') });
    expect(ht.props.instancesForTile(coastalForestIdx).some((p) => p.kind === 'pine')).toBe(true);

    // RN-02: reclaiming an adjacent water tile next to a coastal forest hex never mutates the forest hex's trees
    const beforeCoastalTrees = ht.props.instancesForTile(coastalForestIdx).map(({ y: _y, ...rest }) => rest);
    ht.setTileState(1, 0, HEX_TERRAIN.flat, HEX_PREP.prepared, 0);
    const afterCoastalTrees = ht.props.instancesForTile(coastalForestIdx).map(({ y: _y, ...rest }) => rest);
    expect(afterCoastalTrees).toEqual(beforeCoastalTrees);
    ht.setTileState(1, 0, HEX_TERRAIN.shallow, HEX_PREP.wild, -0.24);

    const sandyLandTiles = new Set<number>();
    for (let i = 0; i < hx.count; i++) {
      if (terrain[i] !== HEX_TERRAIN.shallow && tileShoreFactor(hx, i, layers) > 0) sandyLandTiles.add(i);
    }
    expect(sandyLandTiles.has(highSandIdx)).toBe(true);
    expect(sandyLandTiles.size).toBeGreaterThanOrEqual(10);

    const mat = new THREE.Matrix4();
    for (const restricted of ['bush', 'wildflower', 'grassTuft', 'reeds'] as const) {
      for (const im of ht.flora.meshes[restricted]) {
        for (let k = 0; k < im.count; k++) {
          im.getMatrixAt(k, mat);
          const picked = tileAt(r, mat.elements[12]!, mat.elements[14]!);
          expect(picked).not.toBeNull();
          expect(sandyLandTiles.has(picked!.i)).toBe(false);
        }
      }
    }
    ht.dispose();
  });
});

describe('Declarative object-to-terrain compatibility across HexTerrain & PlanetSurface', () => {
  it('matches GPU lattice-interpolated vHexShore on inland neighbor edges and enforces substrate rules across props & PlanetSurface', () => {
    const r = 4;
    const hx = hexIndex(r);
    const terrain = new Uint8Array(hx.count).fill(HEX_TERRAIN.flat);
    const prep = new Uint8Array(hx.count).fill(HEX_PREP.wild);
    const height = new Float32Array(hx.count).fill(0.02);
    terrain[hx.indexOf(0, 0)] = HEX_TERRAIN.shallow;
    height[hx.indexOf(0, 0)] = -0.24;

    // Tile (2, 0) has 0 direct water neighbors, while (1, 0) has tileShoreFactor = 0.68; near their shared edge vHexShore > 0.30
    const inlandIdx = hx.indexOf(2, 0);
    const [sx, sz] = tileXZ(1, 0);
    const [ix, iz] = tileXZ(2, 0);
    const layers = { terrain, prep, height, kind: 'oceanForest' as const, seed: 42 };
    const px = ix * 0.44 + sx * 0.56;
    const pz = iz * 0.44 + sz * 0.56;
    expect(sampleHexShoreAtPoint(hx, px, pz, layers, 'oceanForest')).toBeGreaterThan(0.34);
    const edgePointSite = classifyHexSiteAtPoint({
      hx, tileIndex: inlandIdx, x: px, z: pz,
      layers, biome: 'oceanForest', planetSeed: 42, heightAt: () => 0.02,
    });
    expect(edgePointSite.substrate).toBe('coastalSand');
    expect(canFitObjectOnTerrain('bush', edgePointSite)).toBe(false);
    expect(canFitObjectOnTerrain('grassTuft', edgePointSite)).toBe(false);
    expect(canFitObjectOnTerrain('reeds', edgePointSite)).toBe(false);
    expect(canFitObjectOnTerrain('boulder', edgePointSite)).toBe(false);

    // Dune mesa rock rejects surface ore deposits, spires, and all mountain flora/cacti via declarative substrate rules
    const duneRockDep = classifyHexTilePropSite(0, 0, HEX_TERRAIN.rock, HEX_PREP.wild, HEX_DEPOSIT.metals, 'dune', 42);
    expect(duneRockDep.substrate).toBe('duneMesaCap');
    expect(canFitObjectOnTerrain('metals', duneRockDep)).toBe(false);
    expect(canFitObjectOnTerrain('spire', duneRockDep)).toBe(false);
    expect(canFitObjectOnTerrain('barrelCactus', duneRockDep)).toBe(false);
    for (const k of ['grassTuft', 'wildflower', 'bush', 'saguaro', 'barrelCactus', 'duneTree', 'pine', 'reeds'] as const) {
      expect(canFitObjectOnTerrain(k, duneRockDep)).toBe(false);
    }

    expect(GROUND_OBJECT_SPECS.bush.allowedSubstrates).not.toContain('coastalSand');
    expect(GROUND_OBJECT_SPECS.wildflower.allowedSubstrates).not.toContain('coastalSand');
    expect(GROUND_OBJECT_SPECS.grassTuft.allowedSubstrates).not.toContain('coastalSand');
    expect(GROUND_OBJECT_SPECS.boulder.allowedSubstrates).not.toContain('coastalSand');
    expect(GROUND_OBJECT_SPECS.reeds.allowedSubstrates).toEqual(['littoralWetland']);

    // Cross-tile jitter test: requesting from inland (2, 0) with waterProx=0 into coastal flat/slope (1, 0) resolves (1, 0)
    const [cx1, cz1] = tileXZ(1, 0);
    terrain[hx.indexOf(1, 0)] = HEX_TERRAIN.slope;
    height[hx.indexOf(1, 0)] = 0.35;
    const crossTileSlope = classifyHexSiteAtPoint({
      hx,
      tileIndex: inlandIdx,
      x: cx1 + 0.15,
      z: cz1,
      layers,
      biome: 'oceanForest',
      planetSeed: 42,
      heightAt: () => 0.35,
      waterProx: { waterNeighbors: 0, deepNeighbors: 0, landNeighbors: 6, shallowNeighbor: false },
    });
    expect(crossTileSlope.substrate).toBe('coastalSand');

    // Footprint substrateRadius clearance test: rendered outer tips of bush/wildflower/grassTuft never overhang coastalSand
    const fitNearSand = (kind: 'bush' | 'wildflower' | 'grassTuft', distFromSandM: number) =>
      canFitObjectFootprint(
        kind,
        distFromSandM,
        0,
        (qx) => ({
          biome: 'oceanForest',
          substrate: qx <= 0 ? 'coastalSand' : 'meadowTurf',
          slope: 0.05,
          ecotone: { moisture: 0.5, rockiness: 0.2, fertility: 0.6 },
        }),
        renderedFloraOuterRadius(kind, 1.0),
      );
    expect(fitNearSand('bush', 0.60)).toBe(false);
    expect(fitNearSand('wildflower', 0.39)).toBe(false);
    expect(fitNearSand('grassTuft', 0.42)).toBe(false);
    expect(fitNearSand('bush', 0.66)).toBe(true);
    expect(fitNearSand('wildflower', 0.44)).toBe(true);
    expect(fitNearSand('grassTuft', 0.47)).toBe(true);
  });
});

describe('Living turf shoreline sand exclusion', () => {
  it('keeps grassTuft and wildflower vertices off coastal beach sand rims on living tiles bordering water', () => {
    const r = 4;
    const hx = hexIndex(r);
    const livingNearWater = {
      terrain: new Uint8Array(hx.count).fill(HEX_TERRAIN.flat),
      prep: new Uint8Array(hx.count).fill(HEX_PREP.wild),
      height: new Float32Array(hx.count).fill(0.02),
      kind: 'oceanForest' as const,
      seed: 42,
    };
    livingNearWater.terrain[hx.indexOf(0, 0)] = HEX_TERRAIN.shallow;
    livingNearWater.height[hx.indexOf(0, 0)] = -0.24;
    livingNearWater.prep[hx.indexOf(1, 0)] = HEX_PREP.living;
    livingNearWater.height[hx.indexOf(1, 0)] = 0.04;
    const htLiving = createHexTerrain({ radius: r, tiles: livingNearWater, look: specForPlanetType('ocean', 42) });
    const shoreLiving = Float32Array.from({ length: hx.count }, (_, idx) => tileShoreFactor(hx, idx, livingNearWater));
    const vPos = new THREE.Vector3();
    const instMat = new THREE.Matrix4();
    expect(htLiving.flora.counts().grassTuft).toBeGreaterThan(0);
    for (const fk of ['grassTuft', 'wildflower'] as const) {
      for (const im of htLiving.flora.meshes[fk]) {
        const pos = im.geometry.getAttribute('position');
        for (let k = 0; k < im.count; k++) {
          im.getMatrixAt(k, instMat);
          for (let vi = 0; vi < pos.count; vi++) {
            vPos.fromBufferAttribute(pos, vi).applyMatrix4(instMat);
            expect(isHexBeachSandAtPoint(hx, vPos.x, vPos.z, htLiving.heightAt(vPos.x, vPos.z), livingNearWater, 'oceanForest', shoreLiving)).toBe(false);
          }
        }
      }
    }
    htLiving.dispose();
  });
});

describe('PlanetSurface coastal sand & slope-rock threshold parity', () => {
  it('keeps boulders and ground flora off moderate coastal sand slopes where terrainShader rockMask is zero', () => {
    const sandSurf = classifySurfaceSite({
      biome: 'oceanForest', x: 8, z: 8, y: 0.45, waterLevel: -1.0, slope: 0.08, planetSeed: 42, isWetlandCandidate: true,
    });
    expect(sandSurf.substrate).toBe('coastalSand');
    expect(canFitObjectOnTerrain('bush', sandSurf)).toBe(false);
    expect(canFitObjectOnTerrain('reeds', sandSurf)).toBe(false);
    expect(canFitObjectOnTerrain('boulder', sandSurf)).toBe(false);

    const slopedSandSurf = classifySurfaceSite({
      biome: 'oceanForest', x: 8, z: 8, y: -0.25, waterLevel: -1.0, slope: 0.72, planetSeed: 42,
    });
    expect(slopedSandSurf.substrate).toBe('coastalSand');
    expect(canFitObjectOnTerrain('boulder', slopedSandSurf)).toBe(false);

    const steepSurf = classifySurfaceSite({ biome: 'forestRock', x: 4, z: 4, y: 2.5, waterLevel: -0.85, slope: 0.72, planetSeed: 42 });
    expect(steepSurf.substrate).toBe('rockOutcrop');
    expect(canFitObjectOnTerrain('bush', steepSurf)).toBe(false);
    expect(canFitObjectOnTerrain('spire', steepSurf)).toBe(true);

    const surf = createPlanetSurface({ ...PLANET_SPECS.oceanForest, seed: hashGroundSeed('surf-seed-1') }, { halfSize: 48, quality: 'low' });
    expect(surf.group.children.length).toBeGreaterThan(3);
    const vPos = new THREE.Vector3();
    const instMat = new THREE.Matrix4();
    const instMeshes = surf.group.children.filter((c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh);
    for (const im of [...instMeshes.slice(0, 2), ...instMeshes.slice(-3)]) {
      const pos = im.geometry.getAttribute('position');
      for (let k = 0; k < im.count; k++) {
        im.getMatrixAt(k, instMat);
        for (let vi = 0; vi < pos.count; vi++) {
          vPos.fromBufferAttribute(pos, vi).applyMatrix4(instMat);
          const gy = surf.heightAt(vPos.x, vPos.z);
          expect(gy > -1.0 && gy - (-1.0) < 1.15).toBe(false);
        }
      }
    }
    surf.dispose();
  });
});

describe('Deterministic planet seed hashing, URL seed input parsing & incremental vs fresh-join parity', () => {
  it('hashes numeric and string seeds idempotently and keeps incremental 2-ring cell-border updates 100% identical to a fresh player join', () => {
    expect(fnv1a32('golden-1')).toBeGreaterThan(0);
    const seedA = hashGroundSeed('planet-thalassa-shared-seed');
    expect(seedA).toBeGreaterThan(0);
    expect(hashGroundSeed(seedA)).toBe(seedA);
    expect(hashGroundSeed('', 99)).toBe(99);
    expect(hashGroundSeed(null, 99)).toBe(99);
    expect(hashGroundSeed(undefined, 99)).toBe(99);
    expect(hashGroundSeed(Number.NaN, 99)).toBe(99);
    expect(hashGroundSeed(0, 99)).toBe(99);
    expect(mixGroundSeed(0, 31)).toBe(31);
    expect(mixGroundSeed(seedA, 31)).not.toBe(31);

    // URL / config seed parser handles empty, numeric, zero, and arbitrary string hashes without NaN
    expect(parseGroundSeedInput(null)).toBeUndefined();
    expect(parseGroundSeedInput(undefined)).toBeUndefined();
    expect(parseGroundSeedInput('   ')).toBeUndefined();
    expect(parseGroundSeedInput('42')).toBe(42);
    expect(parseGroundSeedInput(42)).toBe(42);
    expect(parseGroundSeedInput('0', 77)).toBe(hashGroundSeed('0', 77));
    const hashParsed = parseGroundSeedInput('alpha-colony-hash-9', 77);
    expect(hashParsed).toBe(hashGroundSeed('alpha-colony-hash-9', 77));
    expect(Number.isNaN(hashParsed)).toBe(false);

    // 2-ring cell-border stress test: x = 28 m (cell "0,0") turns shallow -> x = 30 m shore -> x = 32 m (cell "1,0")
    const R = 24;
    const count = hexCount(R);
    const hx = hexIndex(R);
    const look = specForPlanetType('ocean', 'exact-2ring-cell-border-seed');
    const lookOther = specForPlanetType('ocean', 'other-planet-seed');
    expect(look.seed).not.toBe(lookOther.seed);

    const tilesA = {
      terrain: new Uint8Array(count).fill(HEX_TERRAIN.flat),
      prep: new Uint8Array(count).fill(HEX_PREP.wild),
      height: new Float32Array(count).fill(0.02),
    };
    const playerA = createHexTerrain({ radius: R, tiles: tilesA, look });

    const changed: number[] = [];
    for (let rr = -16; rr <= 16; rr += 2) {
      const qq = 14 - rr / 2;
      const idx = hx.indexOf(qq, rr);
      if (idx >= 0) {
        tilesA.terrain[idx] = HEX_TERRAIN.shallow;
        tilesA.height[idx] = -0.24;
        changed.push(idx);
      }
    }
    const livingIdx = hx.indexOf(-6, 4);
    tilesA.prep[livingIdx] = HEX_PREP.living;
    changed.push(livingIdx);

    // Player A applies incremental dirty-cell update; Player B joins fresh from the resulting tile state
    playerA.updateTiles(tilesA, changed);
    const playerB = createHexTerrain({
      radius: R,
      tiles: {
        terrain: Uint8Array.from(tilesA.terrain),
        prep: Uint8Array.from(tilesA.prep),
        height: Float32Array.from(tilesA.height),
      },
      look,
    });

    expect(computeEffectiveHeights(R, { ...tilesA, kind: 'oceanForest', seed: playerA.seed })).toEqual(
      computeEffectiveHeights(R, { ...tilesA, kind: 'oceanForest', seed: playerB.seed }),
    );
    expect(playerA.flora.counts()).toEqual(playerB.flora.counts());
    expect(playerA.props.counts()).toEqual(playerB.props.counts());

    const dumpPositions = (ht: ReturnType<typeof createHexTerrain>) => {
      const mat = new THREE.Matrix4();
      return GROUND_FLORA_KINDS.map((kind) => {
        const coords: string[] = [];
        for (const im of ht.flora.meshes[kind]) {
          for (let i = 0; i < im.count; i++) {
            im.getMatrixAt(i, mat);
            coords.push(`${mat.elements[12]!.toFixed(4)},${mat.elements[13]!.toFixed(4)},${mat.elements[14]!.toFixed(4)}`);
          }
        }
        coords.sort();
        return `${kind}:${coords.join(';')}`;
      });
    };
    expect(dumpPositions(playerA)).toEqual(dumpPositions(playerB));

    playerA.dispose();
    playerB.dispose();
  });
});
