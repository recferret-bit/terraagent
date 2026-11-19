import { describe, expect, it } from 'vitest';
import { hexCount, hexIndex } from '@terra/sim/grid/hex';
import { BREEDS_BY_BIOME, buildBiomeTreeAtlasGeo, TREE_BREEDS } from '../../../visuals/terrain/treeBreeds';
import {
  createHexTerrain,
  evaluateForestStand,
  generateCandidateTreePlaces,
  HEX_DEPOSIT,
  HEX_PREP,
  HEX_TERRAIN,
  runForestGenerationPipeline,
  specForPlanetType,
  stratifyStandSites,
  synthesizeTreePhenotype,
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
    expect(duneCounts.duneTree).toBeGreaterThan(5);
    expect(duneCounts.saguaro + duneCounts.barrelCactus).toBeGreaterThan(5);
    expect(duneCounts.bush).toBeGreaterThan(5);
    expect(duneCounts.reeds).toBe(0);
    dune.dispose();
  });
});
