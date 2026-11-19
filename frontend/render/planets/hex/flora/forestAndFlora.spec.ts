import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HEX_DIRS, hexCount, hexDistance, hexIndex } from '@terra/sim/grid/hex';
import { BREEDS_BY_BIOME, buildBiomeTreeAtlasGeo, buildTreeBreedGeo, TREE_BREEDS } from '../../../visuals/terrain/treeBreeds';
import {
  applySurfaceForestPipeline,
  buildChunk,
  createHexTerrain,
  evaluateForestStand,
  FLORA_FOOTPRINTS,
  generateCandidateTreePlaces,
  GROUND_FLORA_KINDS,
  HEX_DEPOSIT,
  HEX_PREP,
  HEX_TERRAIN,
  hexEdgeMarginM,
  PROP_EXCLUSION_RADIUS,
  runForestGenerationPipeline,
  specForPlanetType,
  stratifyStandSites,
  synthesizeTreePhenotype,
  tileShoreFactor,
  tileStyle,
  type GroundFloraKind,
} from '../index';

function makeBiomeTiles(radius: number) {
  const count = hexCount(radius);
  const hx = hexIndex(radius);
  const terrain = new Uint8Array(count).fill(HEX_TERRAIN.flat);
  const prep = new Uint8Array(count).fill(HEX_PREP.wild);
  const height = new Float32Array(count).fill(0.35);
  const deposit = new Uint8Array(count);

  for (let i = 0; i < count; i++) {
    const q = hx.q[i]!, r = hx.r[i]!;
    if ((q + r * 2) % 5 === 0) terrain[i] = HEX_TERRAIN.shallow;
    else if ((q * 3 - r) % 3 === 0) terrain[i] = HEX_TERRAIN.forest;
    else if ((q - r * 2) % 7 === 0) terrain[i] = HEX_TERRAIN.rock;
    else if ((q + r) % 6 === 0) {
      terrain[i] = HEX_TERRAIN.slope;
      height[i] = 0.30;
    }
  }
  return { terrain, prep, height, deposit };
}

describe('11 biome-endemic tree breeds & 4-stage ecological forest generation pipeline', () => {
  it('defines 11 distinct 3D tree breeds partitioned across forestRock, oceanForest, and dune', () => {
    expect(TREE_BREEDS).toHaveLength(11);
    expect(BREEDS_BY_BIOME.forestRock.map((b) => b.id)).toEqual([
      'alpinePine',
      'silverBirch',
      'ancientOak',
      'weepingWillow',
    ]);
    expect(BREEDS_BY_BIOME.oceanForest.map((b) => b.id)).toEqual([
      'coconutPalm',
      'stiltMangrove',
      'canopyBanyan',
      'coralBlossom',
    ]);
    expect(BREEDS_BY_BIOME.dune.map((b) => b.id)).toEqual([
      'oasisDatePalm',
      'desertDrySnag',
      'joshuaAcacia',
    ]);

    for (const biome of ['forestRock', 'oceanForest', 'dune'] as const) {
      const geo = buildBiomeTreeAtlasGeo(biome, 42);
      const breedAttr = geo.getAttribute('aBreed');
      expect(breedAttr).toBeDefined();
      const seen = new Set<number>();
      for (let i = 0; i < breedAttr.count; i++) seen.add(Math.round(breedAttr.getX(i)));
      expect(seen.size).toBe(BREEDS_BY_BIOME[biome].length);
      geo.dispose();
    }
  });

  it('forms both single-breed monocultures and mixed stands while giving same-breed trees distinct phenotypes', () => {
    const radius = 18;
    const tiles = makeBiomeTiles(radius);
    const look = specForPlanetType('temperate');
    const result = runForestGenerationPipeline(radius, { ...tiles, kind: look.kind, seed: look.seed }, look, () => 0.4);

    expect(result.candidatePlaces.length).toBeGreaterThan(80);
    expect(result.trees.length).toBe(result.candidatePlaces.length);

    let monocultureTiles = 0;
    let mixedTiles = 0;
    const breedsSpawned = new Set<string>();

    for (const [tileIdx, stand] of result.standsByTile.entries()) {
      const tileTrees = result.trees.filter((t) => t.tileIndex === tileIdx);
      for (const tr of tileTrees) breedsSpawned.add(tr.breedId);
      if (stand.regime === 'monoculture') {
        monocultureTiles++;
        // Every tree inside a monoculture stand tile shares the stand's primary breed
        const uniqueInTile = new Set(tileTrees.map((t) => t.breedId));
        expect(uniqueInTile.size).toBe(1);
        if (tileTrees.length >= 2) {
          const [a, b] = tileTrees;
          expect(a!.rot).not.toBeCloseTo(b!.rot, 3);
          expect(Math.hypot(a!.x - b!.x, a!.z - b!.z)).toBeGreaterThan(0.35);
          expect(a!.scaleY).not.toBeCloseTo(b!.scaleY!, 3);
          expect(a!.windPhase).not.toBeCloseTo(b!.windPhase, 3);
        }
      } else {
        mixedTiles++;
      }
    }

    expect(monocultureTiles).toBeGreaterThan(5);
    expect(mixedTiles).toBeGreaterThan(5);
    expect(breedsSpawned.size).toBeGreaterThanOrEqual(3);
  });

  it('handles empty/cleared tiles and deposit tiles as negative/boundary cases without spawning trees', () => {
    const places = generateCandidateTreePlaces(2, -1, 10, 3);
    const stand = evaluateForestStand(2, -1, 'oceanForest', 99);
    const strat = stratifyStandSites(places, stand);
    const pheno = strat.map((s) => synthesizeTreePhenotype(s, () => 1.2));
    expect(pheno).toHaveLength(3);
    expect(pheno.every((p) => p.y === 1.2 && p.windMul! > 0.2)).toBe(true);

    const r = 6;
    const count = hexCount(r);
    const cleared = {
      terrain: new Uint8Array(count).fill(HEX_TERRAIN.forest),
      prep: new Uint8Array(count).fill(HEX_PREP.prepared),
      height: new Float32Array(count),
      deposit: new Uint8Array(count).fill(HEX_DEPOSIT.metals),
    };
    const emptyRes = runForestGenerationPipeline(r, cleared, specForPlanetType('ocean'));
    expect(emptyRes.trees).toHaveLength(0);
  });
});

describe('HexFloraLayer grass hex variations, bushes, cactuses, reeds, and dune palms', () => {
  it('populates biome-appropriate ground flora and removes wild flora when a tile is cleared', () => {
    const radius = 12;
    const lushTiles = makeBiomeTiles(radius);
    const temperate = createHexTerrain({ radius, tiles: lushTiles, look: specForPlanetType('temperate') });
    const lushCounts = temperate.flora.counts();
    expect(lushCounts.grassTuft).toBeGreaterThan(20);
    expect(lushCounts.wildflower).toBeGreaterThan(5);
    expect(lushCounts.bush).toBeGreaterThan(5);
    expect(lushCounts.reeds).toBeGreaterThan(3);
    expect(lushCounts.saguaro).toBe(0);
    expect(lushCounts.duneTree).toBe(0);

    // Clearing a flat meadow tile removes its wild grass/wildflower flora; living prep regrows turf tufts
    const hx = hexIndex(radius);
    let flatIdx = -1;
    for (let i = 0; i < hx.count; i++) {
      if (lushTiles.terrain[i] === HEX_TERRAIN.flat) { flatIdx = i; break; }
    }
    expect(flatIdx).toBeGreaterThanOrEqual(0);
    const beforeGrass = lushCounts.grassTuft;
    temperate.setTileState(hx.q[flatIdx]!, hx.r[flatIdx]!, HEX_TERRAIN.flat, HEX_PREP.prepared);
    expect(temperate.flora.counts().grassTuft).toBeLessThanOrEqual(beforeGrass);
    temperate.dispose();

    const duneTiles = makeBiomeTiles(radius);
    const dune = createHexTerrain({ radius, tiles: duneTiles, look: specForPlanetType('desert') });
    const duneCounts = dune.flora.counts();
    expect(dune.props.counts().pine).toBe(0);
    expect(dune.props.counts().duneTree).toBeGreaterThan(15);
    expect(dune.props.counts().boulder).toBeGreaterThan(0);
    expect(duneCounts.saguaro + duneCounts.barrelCactus).toBeGreaterThan(5);
    expect(duneCounts.bush).toBeGreaterThan(5);
    expect(duneCounts.reeds).toBe(0);

    // Dune HEX_TERRAIN.forest tiles expose duneTree via instancesForTile, never collide with boulders, and ray-pick via pickProp
    let checkedForestTile = false;
    for (let i = 0; i < hx.count; i++) {
      if (duneTiles.terrain[i] !== HEX_TERRAIN.forest) continue;
      const insts = dune.props.instancesForTile(i);
      const trees = insts.filter((p) => p.kind === 'duneTree');
      const boulders = insts.filter((p) => p.kind === 'boulder');
      expect(trees.length).toBeGreaterThanOrEqual(1);
      for (const tr of trees) {
        for (const bd of boulders) {
          expect(Math.hypot(tr.x - bd.x, tr.z - bd.z)).toBeGreaterThanOrEqual(0.70);
        }
      }
      if (!checkedForestTile) {
        dune.group.updateMatrixWorld(true);
        const tr = trees[0]!;
        const ray = new THREE.Raycaster(new THREE.Vector3(tr.x, tr.y + 8, tr.z), new THREE.Vector3(0, -1, 0));
        const hit = dune.props.pickProp(ray);
        expect(hit).not.toBeNull();
        expect(hit!.q).toBe(hx.q[i]);
        expect(hit!.r).toBe(hx.r[i]);
        checkedForestTile = true;
      }
    }
    expect(checkedForestTile).toBe(true);
    dune.dispose();

    // Fortification ridges, dug moats, and colony-owned graded base pads never sprout wild bushes or cactuses
    const fortCount = hexCount(8);
    const fortTiles = {
      terrain: new Uint8Array(fortCount).fill(HEX_TERRAIN.flat),
      prep: new Uint8Array(fortCount).fill(HEX_PREP.flat),
      height: new Float32Array(fortCount),
      owner: new Int8Array(fortCount).fill(0),
    };
    fortTiles.prep[0] = HEX_PREP.ridge;
    fortTiles.prep[1] = HEX_PREP.moat;
    const baseTerrain = createHexTerrain({ radius: 8, tiles: fortTiles, look: specForPlanetType('desert') });
    const baseFlora = baseTerrain.flora.counts();
    expect(baseFlora.bush + baseFlora.saguaro + baseFlora.barrelCactus + baseFlora.grassTuft).toBe(0);
    baseTerrain.dispose();
  });
});

describe('Ground flora rim containment, wild grass hex ecotypes & surface pipeline parity', () => {
  it('clamps outer-rim ground flora vertices inside the ground hexagon and varies wild grass hex tints per biome', () => {
    const r = 10;
    const hx = hexIndex(r);
    const terrain = new Uint8Array(hx.count).fill(HEX_TERRAIN.flat);
    const prep = new Uint8Array(hx.count).fill(HEX_PREP.wild);
    const height = new Float32Array(hx.count).fill(0.2);
    for (let i = 0; i < hx.count; i++) {
      if (hexDistance(0, 0, hx.q[i]!, hx.r[i]!) === r && i % 2 === 0) terrain[i] = HEX_TERRAIN.slope;
    }
    for (const pType of ['temperate', 'ocean', 'desert'] as const) {
      const ht = createHexTerrain({ radius: r, tiles: { terrain, prep, height }, look: specForPlanetType(pType) });
      const mat = new THREE.Matrix4();
      const v = new THREE.Vector3();
      let minVertMargin = Infinity;
      let checked = 0;
      for (const kind of GROUND_FLORA_KINDS) {
        for (const im of ht.flora.meshes[kind]) {
          const pos = im.geometry.getAttribute('position');
          for (let k = 0; k < im.count; k++) {
            im.getMatrixAt(k, mat);
            for (let vi = 0; vi < pos.count; vi++) {
              v.fromBufferAttribute(pos, vi).applyMatrix4(mat);
              minVertMargin = Math.min(minVertMargin, hexEdgeMarginM(r, v.x, v.z));
            }
            checked++;
          }
        }
      }
      expect(checked).toBeGreaterThan(10);
      expect(minVertMargin).toBeGreaterThanOrEqual(0);
      ht.dispose();
    }

    // Wild grass hexagon ecotypes vary across >= 4 distinct palettes per biome while graded/prepared remain identical
    for (const kind of ['forestRock', 'oceanForest', 'dune'] as const) {
      const seen = new Set<string>();
      for (let q = -12; q <= 12; q += 2) {
        for (let rr = -12; rr <= 12; rr += 2) {
          const st = tileStyle(q, rr, HEX_TERRAIN.flat, HEX_PREP.wild, 0, kind);
          seen.add(`${Math.round(st.r * 20)},${Math.round(st.g * 20)},${Math.round(st.b * 20)}`);
        }
      }
      expect(seen.size).toBeGreaterThanOrEqual(4);
      expect(tileStyle(3, -2, HEX_TERRAIN.flat, HEX_PREP.prepared, 0, kind)).toEqual(
        tileStyle(3, -2, HEX_TERRAIN.flat, HEX_PREP.flat, 0, kind),
      );
    }

    // Continuous PlanetSurface 4-stage forest pipeline parity + empty-input boundary
    expect(applySurfaceForestPipeline([], 'forestRock', 17, 0)).toEqual([]);
    const cands = [];
    for (let z = -30; z <= 30; z += 2.2) {
      for (let x = -30; x <= 30; x += 2.2) {
        cands.push({ x, y: 1.4, z, rot: 0, s: 0.5, r: 0.5 });
      }
    }
    const surfTrees = applySurfaceForestPipeline(cands, 'oceanForest', 42, 0);
    expect(surfTrees.length).toBeGreaterThan(40);
    expect(new Set(surfTrees.map((t) => t.standRegime)).size).toBe(2);
    expect(new Set(surfTrees.map((t) => t.cohort)).size).toBeGreaterThanOrEqual(2);
  });
});

describe('Collision-free flora & prop placement across biomes', () => {
  it('enforces zero pairwise overlaps between props and flora across desert, ocean, and temperate biomes', () => {
    const r = 16;
    const hx = hexIndex(r);
    const mat = new THREE.Matrix4();

    for (const pType of ['desert', 'ocean', 'temperate'] as const) {
      const tiles = makeBiomeTiles(r);
      const ht = createHexTerrain({ radius: r, tiles, look: specForPlanetType(pType) });

      const propsList: Array<{ kind: string; x: number; z: number }> = [];
      for (let i = 0; i < hx.count; i++) {
        for (const p of ht.props.instancesForTile(i)) {
          propsList.push({ kind: p.kind, x: p.x, z: p.z });
        }
      }

      const floraList: Array<{ kind: GroundFloraKind; x: number; z: number }> = [];
      for (const kind of GROUND_FLORA_KINDS) {
        for (const im of ht.flora.meshes[kind]) {
          for (let k = 0; k < im.count; k++) {
            im.getMatrixAt(k, mat);
            floraList.push({ kind, x: mat.elements[12]!, z: mat.elements[14]! });
          }
        }
      }

      expect(floraList.length).toBeGreaterThan(40);
      for (let a = 0; a < floraList.length; a++) {
        const fa = floraList[a]!;
        const fpa = FLORA_FOOTPRINTS[fa.kind];
        for (const p of propsList) {
          if (Math.abs(fa.x - p.x) > 2.2 || Math.abs(fa.z - p.z) > 2.2) continue;
          const pr = PROP_EXCLUSION_RADIUS[p.kind] ?? 0.52;
          expect(Math.hypot(fa.x - p.x, fa.z - p.z)).toBeGreaterThanOrEqual(fpa.radius + pr + 0.12);
        }
        for (let b = a + 1; b < floraList.length; b++) {
          const fb = floraList[b]!;
          if (Math.abs(fa.x - fb.x) > 2.2 || Math.abs(fa.z - fb.z) > 2.2) continue;
          const fpb = FLORA_FOOTPRINTS[fb.kind];
          const minReq = fa.kind === fb.kind ? Math.max(fpa.radius + fpb.radius + 0.12, fpa.sameKindDist - 0.02) : fpa.radius + fpb.radius + 0.12;
          expect(Math.hypot(fa.x - fb.x, fa.z - fb.z)).toBeGreaterThanOrEqual(minReq);
        }
      }

      // Incremental dirty-cell update stays collision-free
      ht.setTileState(0, 0, HEX_TERRAIN.flat, HEX_PREP.prepared);
      const dirtyFlora: Array<{ kind: GroundFloraKind; x: number; z: number }> = [];
      for (const kind of GROUND_FLORA_KINDS) {
        for (const im of ht.flora.meshes[kind]) {
          for (let k = 0; k < im.count; k++) {
            im.getMatrixAt(k, mat);
            dirtyFlora.push({ kind, x: mat.elements[12]!, z: mat.elements[14]! });
          }
        }
      }
      for (let a = 0; a < dirtyFlora.length; a++) {
        const fa = dirtyFlora[a]!;
        const fpa = FLORA_FOOTPRINTS[fa.kind];
        for (let b = a + 1; b < dirtyFlora.length; b++) {
          const fb = dirtyFlora[b]!;
          if (Math.abs(fa.x - fb.x) > 2.5 || Math.abs(fa.z - fb.z) > 2.5) continue;
          const minReq = Math.max(fpa.radius + FLORA_FOOTPRINTS[fb.kind].radius + 0.12, fa.kind === fb.kind ? fpa.sameKindDist - 0.02 : 0);
          expect(Math.hypot(fa.x - fb.x, fa.z - fb.z)).toBeGreaterThanOrEqual(minReq);
        }
      }
      ht.dispose();
    }
  });
});

describe('Stemless tree geometry & sanded coastal corners', () => {
  it('builds completely stemless grounded foliage geometry across all 11 tree breeds', () => {
    for (const breed of TREE_BREEDS) {
      const geo = buildTreeBreedGeo(breed.id, 17);
      const pos = geo.getAttribute('position');
      const aBark = geo.getAttribute('aBark');
      expect(aBark).toBeDefined();
      let minY = Infinity;
      let maxBark = 0;
      for (let i = 0; i < pos.count; i++) {
        minY = Math.min(minY, pos.getY(i));
        maxBark = Math.max(maxBark, aBark.getX(i));
      }
      expect(maxBark).toBe(0);
      expect(minY).toBeLessThanOrEqual(-0.04);
      expect(minY).toBeGreaterThanOrEqual(-0.20);
      geo.dispose();
    }
  });

  it('sands jutting water corners (tileShoreFactor <= 0.92) and excludes grass/bushes on >= 3 water-neighbor corners', () => {
    const r = 6;
    const hx = hexIndex(r);
    const terrain = new Uint8Array(hx.count).fill(HEX_TERRAIN.flat);
    const prep = new Uint8Array(hx.count).fill(HEX_PREP.wild);
    const height = new Float32Array(hx.count).fill(0.18);
    // Tile 0 at (0, 0) becomes a pointy corner bordered by 4 water neighbors
    for (let k = 0; k < 4; k++) {
      const [dq, dr] = HEX_DIRS[k]!;
      const j = hx.indexOf(dq, dr);
      expect(j).toBeGreaterThanOrEqual(0);
      terrain[j] = HEX_TERRAIN.shallow;
      height[j] = -0.35;
    }
    const layers = { terrain, prep, height, kind: 'oceanForest' as const };
    const cornerIdx = hx.indexOf(0, 0);
    const sf = tileShoreFactor(hx, cornerIdx, layers);
    expect(sf).toBeGreaterThan(0.80);
    expect(sf).toBeLessThanOrEqual(0.92);

    const chunk = buildChunk(r, Array.from({ length: hx.count }, (_, i) => i), layers);
    const vertPos = Array.from(chunk.vertexTile).indexOf(cornerIdx);
    expect(vertPos).toBeGreaterThanOrEqual(0);
    expect(chunk.aHexShore[vertPos]).toBeCloseTo(sf, 4);

    // Build full terrain around the headland corner and verify zero grass/wildflower/bush at corner (0,0)
    const ht = createHexTerrain({ radius: r, tiles: layers, look: specForPlanetType('ocean') });
    const mat = new THREE.Matrix4();
    for (const restricted of ['grassTuft', 'wildflower', 'bush'] as const) {
      for (const im of ht.flora.meshes[restricted]) {
        for (let k = 0; k < im.count; k++) {
          im.getMatrixAt(k, mat);
          expect(Math.hypot(mat.elements[12]!, mat.elements[14]!)).toBeGreaterThan(1.05);
        }
      }
    }
    ht.dispose();
  });
});
