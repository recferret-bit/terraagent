import { describe, expect, it } from 'vitest';
import {
  CANONICAL_PLANETS,
  W11_SEVEN_SECTOR_COORDS,
  type SectorId,
} from '@terra/contracts';
import {
  buryWildDeposits,
  createAtlasPlanetState,
  createAtlasSamplerContext,
  DEPOSIT,
  depositGroundMask,
  GEN_VERSION,
  generateSmallAtlas,
  getAtlasBlob,
  hexDistance,
  hexIndex,
  isGlobalHexTile,
  PREP,
  snapshot,
  TERRAIN,
  W11_OCEAN_HALO_SECTOR_COORDS,
  type GeneratedSmallAtlas,
  type PlanetType,
} from '../../src';

const BIOMES: readonly PlanetType[] = ['desert', 'ocean', 'temperate'];

function deterministicShuffle<T>(items: readonly T[], seedNum: number): T[] {
  const out = [...items];
  let s = seedNum >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

function assertTypedArrayBitIdentical(
  a: Uint8Array | Float32Array,
  b: Uint8Array | Float32Array,
  label: string,
): void {
  expect(a.length, label).toBe(b.length);
  const bytesA = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const bytesB = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 0; i < bytesA.length; i++) {
    if (bytesA[i] !== bytesB[i]) {
      expect(bytesA[i], `${label} byte ${i}`).toBe(bytesB[i]);
    }
  }
}

function assertIdenticalAtlas(a: GeneratedSmallAtlas, b: GeneratedSmallAtlas): void {
  assertTypedArrayBitIdentical(a.terrain, b.terrain, 'atlas.terrain');
  assertTypedArrayBitIdentical(a.prep, b.prep, 'atlas.prep');
  assertTypedArrayBitIdentical(a.height, b.height, 'atlas.height');
  assertTypedArrayBitIdentical(a.deposit, b.deposit, 'atlas.deposit');
  assertTypedArrayBitIdentical(a.depositTier, b.depositTier, 'atlas.depositTier');
  assertTypedArrayBitIdentical(a.richness, b.richness, 'atlas.richness');
  assertTypedArrayBitIdentical(a.subDeposit, b.subDeposit, 'atlas.subDeposit');
  assertTypedArrayBitIdentical(a.subRichness, b.subRichness, 'atlas.subRichness');

  for (const secA of a.sectors) {
    const secB = b.sectorById.get(secA.sectorId)!;
    expect(secB).toBeDefined();
    assertTypedArrayBitIdentical(secA.terrain, secB.terrain, `${secA.sectorId}.terrain`);
    assertTypedArrayBitIdentical(secA.prep, secB.prep, `${secA.sectorId}.prep`);
    assertTypedArrayBitIdentical(secA.height, secB.height, `${secA.sectorId}.height`);
    assertTypedArrayBitIdentical(secA.deposit, secB.deposit, `${secA.sectorId}.deposit`);
    assertTypedArrayBitIdentical(secA.depositTier, secB.depositTier, `${secA.sectorId}.depositTier`);
    assertTypedArrayBitIdentical(secA.richness, secB.richness, `${secA.sectorId}.richness`);
  }

  for (const seam of a.partition.seamTiles) {
    const tileA = a.getTile(seam.q, seam.r)!;
    const tileB = b.getTile(seam.q, seam.r)!;
    if (
      tileB.terrain !== tileA.terrain ||
      tileB.prep !== tileA.prep ||
      !Object.is(tileB.height, tileA.height) ||
      tileB.deposit !== tileA.deposit ||
      tileB.depositTier !== tileA.depositTier ||
      tileB.richness !== tileA.richness
    ) {
      expect(tileB).toEqual(tileA);
    }
  }
}

describe('W11-35 shuffled sector order invariance and global coordinate sampling', () => {
  it('produces bit-for-bit identical tiles and seam edges under reversed and shuffled sector orders across all 3 biomes', () => {
    const defaultDesert = generateSmallAtlas({
      planetId: CANONICAL_PLANETS.desert.id,
      planetType: 'desert',
      seed: CANONICAL_PLANETS.desert.seed,
      worldSalt: 'w11-salt-check',
    });
    expect(defaultDesert.sectorRadius).toBe(48);
    expect(defaultDesert.sectors[0]?.tileCount).toBe(7_057);
    expect(defaultDesert.partition.bounds.totalTiles).toBe(134_083);

    for (const planetType of BIOMES) {
      const canonical = CANONICAL_PLANETS[planetType];
      const baseline = generateSmallAtlas({
        planetId: canonical.id,
        planetType,
        seed: canonical.seed,
        worldSalt: 'w11-salt-check',
        sectorRadius: 16,
      });
      expect(baseline.sectors).toHaveLength(19);
      expect(baseline.landSectorIds).toHaveLength(7);
      expect(baseline.oceanSectorIds).toHaveLength(12);

      const defaultIds = baseline.sectors.map((s) => s.sectorId);
      const reversedOrder = [...defaultIds].reverse();
      const reversedAtlas = generateSmallAtlas({
        planetId: canonical.id,
        planetType,
        seed: canonical.seed,
        worldSalt: 'w11-salt-check',
        sectorRadius: 16,
        sectorOrder: reversedOrder,
      });
      expect(reversedAtlas.generationOrder).toEqual(reversedOrder);
      assertIdenticalAtlas(baseline, reversedAtlas);

      for (const permSeed of [101, 202]) {
        const shuffledOrder: SectorId[] = deterministicShuffle(defaultIds, permSeed);
        const permutedAtlas = generateSmallAtlas({
          planetId: canonical.id,
          planetType,
          seed: canonical.seed,
          worldSalt: 'w11-salt-check',
          sectorRadius: 16,
          sectorOrder: shuffledOrder,
        });
        expect(permutedAtlas.generationOrder).toEqual(shuffledOrder);
        assertIdenticalAtlas(baseline, permutedAtlas);
      }

      const shuffledLand = deterministicShuffle(W11_SEVEN_SECTOR_COORDS, 777);
      const shuffledOcean = deterministicShuffle(W11_OCEAN_HALO_SECTOR_COORDS, 888);
      const coordShuffledAtlas = generateSmallAtlas({
        planetId: canonical.id,
        planetType,
        seed: canonical.seed,
        worldSalt: 'w11-salt-check',
        sectorRadius: 16,
        landCoords: shuffledLand,
        oceanCoords: shuffledOcean,
      });
      assertIdenticalAtlas(baseline, coordShuffledAtlas);
    }
  });

  it('keeps land sector tiles identical whether the ring-2 ocean halo is included or omitted', () => {
    for (const planetType of BIOMES) {
      const withHalo = generateSmallAtlas({
        planetType,
        seed: `halo-parity-${planetType}`,
        sectorRadius: 16,
        includeOceanHalo: true,
      });
      const landOnly = generateSmallAtlas({
        planetType,
        seed: `halo-parity-${planetType}`,
        sectorRadius: 16,
        includeOceanHalo: false,
      });
      expect(landOnly.sectors).toHaveLength(7);

      for (const sectorId of landOnly.landSectorIds) {
        const secFull = withHalo.sectorById.get(sectorId)!;
        const secLand = landOnly.sectorById.get(sectorId)!;
        assertTypedArrayBitIdentical(secLand.terrain, secFull.terrain, `${sectorId}.terrain`);
        assertTypedArrayBitIdentical(secLand.prep, secFull.prep, `${sectorId}.prep`);
        assertTypedArrayBitIdentical(secLand.height, secFull.height, `${sectorId}.height`);
        assertTypedArrayBitIdentical(secLand.deposit, secFull.deposit, `${sectorId}.deposit`);
        assertTypedArrayBitIdentical(secLand.richness, secFull.richness, `${sectorId}.richness`);
      }
    }
  });
});

describe('W11-35 seam continuity and connected continent verification', () => {
  it('verifies continuous heights and coastlines across all shared sector borders for all 3 profiles', () => {
    for (const planetType of BIOMES) {
      for (const seed of [CANONICAL_PLANETS[planetType].seed, `alt-${planetType}-1`]) {
        const atlas = generateSmallAtlas({
          planetType,
          seed,
          sectorRadius: seed === CANONICAL_PLANETS[planetType].seed ? 48 : 24,
        });
        const seamReport = atlas.verifySeamContinuity();
        expect(seamReport.violations, `${planetType}:${seed}`).toEqual([]);
        expect(seamReport.ok).toBe(true);
        expect(seamReport.totalSeamPairs).toBeGreaterThan(1_000);
        expect(seamReport.landToLandPairs).toBeGreaterThan(250);
        expect(seamReport.landToOceanPairs).toBeGreaterThan(400);
        expect(seamReport.oceanToOceanPairs).toBeGreaterThan(250);
        expect(seamReport.maxLandToLandHeightDeltaM).toBeLessThanOrEqual(1.25);
        expect(seamReport.meanLandToLandHeightDeltaM).toBeLessThan(0.35);
        expect(seamReport.maxLandToOceanHeightDeltaM).toBeLessThanOrEqual(1.1);
        expect(seamReport.maxOceanToOceanHeightDeltaM).toBeLessThanOrEqual(0.35);
      }
    }
  });

  it('verifies all 7 land sectors form a single connected continent and all 12 ocean halo sectors are water with 0 capacity', () => {
    for (const planetType of BIOMES) {
      const atlas = generateSmallAtlas({ planetType, seed: CANONICAL_PLANETS[planetType].seed });
      const report = atlas.verifyConnectedContinent();
      expect(report.ok).toBe(true);
      expect(report.reasons).toEqual([]);
      expect(report.continentId).toBe('cont_0');
      expect(report.landSectorCount).toBe(7);
      expect(report.reachedLandSectorIds).toHaveLength(7);
      expect(report.crossSectorLandEdges).toBeGreaterThan(100);
      expect(report.connectedShare).toBeGreaterThanOrEqual(0.85);
      expect(report.oceanHaloAllWater).toBe(true);
      expect(report.oceanHaloZeroCapacity).toBe(true);

      let oceanShallow = 0;
      let oceanDeep = 0;
      for (const oceanId of atlas.oceanSectorIds) {
        const sec = atlas.sectorById.get(oceanId)!;
        expect(sec.foundingCapacity).toBe(0);
        expect(sec.continentId).toBeNull();
        for (let i = 0; i < sec.tileCount; i++) {
          if (sec.terrain[i] === TERRAIN.shallow) oceanShallow++;
          else if (sec.terrain[i] === TERRAIN.deep) oceanDeep++;
          expect(sec.height[i]).toBeLessThan(0);
        }
      }
      expect(oceanShallow).toBeGreaterThan(1_000);
      expect(oceanDeep).toBeGreaterThan(5_000);
    }
  });
});

describe('W11-35 distinct biome signatures and hex-tile deposit rules', () => {
  it('produces distinct biome terrain distributions and D-33 richness modifiers across desert, ocean, and temperate', () => {
    const desert = generateSmallAtlas({ planetType: 'desert', seed: CANONICAL_PLANETS.desert.seed });
    const ocean = generateSmallAtlas({ planetType: 'ocean', seed: CANONICAL_PLANETS.ocean.seed });
    const temperate = generateSmallAtlas({ planetType: 'temperate', seed: CANONICAL_PLANETS.temperate.seed });

    const countLandTerrain = (atlas: GeneratedSmallAtlas, code: number): number => {
      let count = 0;
      for (const id of atlas.landSectorIds) {
        const sec = atlas.sectorById.get(id)!;
        for (let i = 0; i < sec.tileCount; i++) if (sec.terrain[i] === code) count++;
      }
      return count;
    };

    const landTotal = 7 * 7_057;
    expect(countLandTerrain(desert, TERRAIN.forest)).toBe(0);
    expect(countLandTerrain(desert, TERRAIN.slope) / landTotal).toBeGreaterThan(0.5);
    expect(countLandTerrain(desert, TERRAIN.rock) / landTotal).toBeGreaterThan(0.03);
    expect(countLandTerrain(desert, TERRAIN.flat) / landTotal).toBeGreaterThan(0.08);
    expect(desert.height.reduce((m, v) => (v > m ? v : m), -Infinity)).toBeGreaterThan(4.5);

    const oceanWaterOnLand = countLandTerrain(ocean, TERRAIN.shallow) + countLandTerrain(ocean, TERRAIN.deep);
    const tempWaterOnLand = countLandTerrain(temperate, TERRAIN.shallow) + countLandTerrain(temperate, TERRAIN.deep);
    const desertWaterOnLand = countLandTerrain(desert, TERRAIN.shallow) + countLandTerrain(desert, TERRAIN.deep);
    expect(oceanWaterOnLand).toBeGreaterThan(tempWaterOnLand);
    expect(tempWaterOnLand).toBeGreaterThan(desertWaterOnLand);
    expect(countLandTerrain(temperate, TERRAIN.forest) / landTotal).toBeGreaterThan(0.12);
    expect(countLandTerrain(temperate, TERRAIN.flat) / landTotal).toBeGreaterThan(0.3);
  });

  it('places visible deposits exclusively on global hex tiles with hexDistance >= 2 spacing and valid subsurface veins', () => {
    for (const planetType of BIOMES) {
      const seed = CANONICAL_PLANETS[planetType].seed;
      const sectorRadius = planetType === 'desert' ? 48 : 24;
      const atlas = generateSmallAtlas({ planetType, seed, worldSalt: 'sub-salt', sectorRadius });
      const samplerCtx = createAtlasSamplerContext({ planetType, seed, worldSalt: 'sub-salt', sectorRadius });
      const depositCoords: Array<{ q: number; r: number; kind: number }> = [];
      let subCount = 0;

      for (const owner of atlas.partition.tiles) {
        const tile = atlas.getTile(owner.q, owner.r)!;
        if (tile.subDeposit !== DEPOSIT.none) {
          subCount++;
          expect(tile.deposit).toBe(DEPOSIT.none);
          expect(tile.subRichness).toBeGreaterThan(9_000);
        }
        if (tile.deposit === DEPOSIT.none) continue;
        expect(tile.kind).toBe('land');
        expect(tile.terrain).toBe(TERRAIN.flat);
        expect(tile.prep).toBe(PREP.flat);
        expect(isGlobalHexTile(tile.q, tile.r, samplerCtx)).toBe(true);
        expect(tile.richness).toBeGreaterThan(7_000);
        depositCoords.push({ q: tile.q, r: tile.r, kind: tile.deposit });
      }

      expect(depositCoords.length).toBeGreaterThan(25);
      expect(subCount).toBeGreaterThan(100);
      const kinds = new Set(depositCoords.map((d) => d.kind));
      expect(kinds.has(DEPOSIT.metals)).toBe(true);
      expect(kinds.has(DEPOSIT.minerals)).toBe(true);
      expect(kinds.has(DEPOSIT.oil)).toBe(true);

      for (let i = 0; i < depositCoords.length; i++) {
        for (let j = i + 1; j < depositCoords.length; j++) {
          const a = depositCoords[i]!;
          const b = depositCoords[j]!;
          expect(hexDistance(a.q, a.r, b.q, b.r)).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });
});

describe('W11-35 PlanetState integration and option validation', () => {
  it('populates PlanetState deterministically via createAtlasPlanetState with intact hex-tile deposits and atlas blob', () => {
    const atlas = generateSmallAtlas({ planetType: 'temperate', seed: 'state-check-seed' });
    const stateA = createAtlasPlanetState({ atlas });
    const stateB = createAtlasPlanetState({ planetType: 'temperate', seed: 'state-check-seed' });

    expect(stateA.meta.genVersion).toBe(GEN_VERSION);
    expect(stateA.grid.radius).toBe(48);
    expect(stateA.grid.count).toBe(7_057);
    expect(snapshot(stateA)).toEqual(snapshot(stateB));

    const blob = getAtlasBlob(stateA);
    expect(blob).not.toBeNull();
    expect(blob?.sectors).toHaveLength(19);
    expect(blob?.landSectorIds).toHaveLength(7);
    expect(blob?.oceanSectorIds).toHaveLength(12);

    const hx = hexIndex(stateA.grid.radius);
    const groundMask = depositGroundMask(stateA);
    let checkedLandTiles = 0;
    const sec00 = atlas.sectorById.get('sec_0_0')!;
    for (const st of sec00.tiles) {
      const gIdx = hx.indexOf(st.q, st.r);
      expect(gIdx).toBeGreaterThanOrEqual(0);
      expect(stateA.grid.layers.terrain[gIdx]).toBe(sec00.terrain[st.localIndex]);
      expect(stateA.grid.layers.height[gIdx]).toBe(sec00.height[st.localIndex]);
      expect(stateA.grid.layers.deposit[gIdx]).toBe(sec00.deposit[st.localIndex]);
      if (sec00.deposit[st.localIndex] !== DEPOSIT.none) {
        expect(groundMask[gIdx]).toBe(1);
      }
      checkedLandTiles++;
    }
    expect(checkedLandTiles).toBe(7_057);
    expect(buryWildDeposits(stateA)).toBe(0);
  });

  it('rejects invalid sectorOrder, foundingSeatsPerSector, and gridRadius options', () => {
    expect(() => generateSmallAtlas({ foundingSeatsPerSector: 0 })).toThrow(RangeError);
    expect(() => generateSmallAtlas({ sectorOrder: ['sec_0_0'] })).toThrow(RangeError);
    const atlas = generateSmallAtlas({ includeOceanHalo: false });
    const badOrder = [...atlas.landSectorIds.slice(0, 6), 'sec_9_9'];
    expect(() => generateSmallAtlas({ includeOceanHalo: false, sectorOrder: badOrder })).toThrow(RangeError);
    const dupOrder = [atlas.landSectorIds[0]!, ...atlas.landSectorIds.slice(0, 6)];
    expect(() => generateSmallAtlas({ includeOceanHalo: false, sectorOrder: dupOrder })).toThrow(RangeError);
    expect(() => createAtlasPlanetState({ gridRadius: 0 })).toThrow(RangeError);
  });
});
