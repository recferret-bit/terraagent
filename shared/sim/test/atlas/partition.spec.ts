import { describe, expect, it } from 'vitest';
import {
  formatSectorId,
  SectorNeighbourV1Schema,
  W11_DEFAULT_SECTOR_RADIUS,
  W11_SEVEN_SECTOR_COORDS,
} from '@terra/contracts';
import {
  buildSmallAtlasPartition,
  enumerateSectorTiles,
  globalTileToSector,
   HEX_DIRS,
  hexCount,
  hexDistance,
  macroBasisVectors,
  macroNeighbors,
  oppositeHexDir,
  sectorCenterForId,
  sectorCenterForMacro,
  sectorIdLocalToGlobalTile,
  sectorLocalIndexToGlobalTile,
  sectorLocalToGlobalTile,
  tileCoordKey,
  tileSectorNeighbors,
  W11_OCEAN_HALO_SECTOR_COORDS,
  W11_SMALL_ATLAS_SECTOR_COORDS,
} from '../../src';

describe('W11-34 macro-hex partition basis and coordinate bijections', () => {
  it('computes exact basis vectors and determinant 3R(R+1)+1 for R=24', () => {
    const basis = macroBasisVectors(24);
    expect(basis.bq).toEqual([49, -24]);
    expect(basis.br).toEqual([24, 25]);
    const det = basis.bq[0] * basis.br[1] - basis.bq[1] * basis.br[0];
    expect(det).toBe(1_801);
    expect(basis.determinant).toBe(hexCount(24));

    const c00 = sectorCenterForMacro(0, 0, 24);
    expect(c00).toEqual({ centerQ: 0, centerR: 0 });
    const c10 = sectorCenterForMacro(1, 0, 24);
    expect(c10).toEqual({ centerQ: 49, centerR: -24 });
    expect(hexDistance(0, 0, c10.centerQ, c10.centerR)).toBe(49);

    const byId = sectorCenterForId('sec_-1_1', 24);
    expect(byId).toEqual({ macroQ: -1, macroR: 1, centerQ: -25, centerR: 49 });
  });

  it('maintains 100% symmetric macro-sector neighbour links across all 6 directions', () => {
    for (const [mq, mr] of W11_SMALL_ATLAS_SECTOR_COORDS) {
      const idA = formatSectorId(mq, mr);
      const neighborsA = macroNeighbors(mq, mr, W11_DEFAULT_SECTOR_RADIUS);
      expect(neighborsA).toHaveLength(6);

      for (const n of neighborsA) {
        expect(() => SectorNeighbourV1Schema.parse(n)).not.toThrow();
        const oppDir = oppositeHexDir(n.dir);
        expect(oppDir).toBe((n.dir + 3) % 6);
        const neighborsB = macroNeighbors(n.macroQ, n.macroR, W11_DEFAULT_SECTOR_RADIUS);
        const back = neighborsB[oppDir]!;
        expect(back.macroQ).toBe(mq);
        expect(back.macroR).toBe(mr);
        expect(back.sectorId).toBe(idA);
      }
    }
  });

  it('round-trips globalTileToSector and sectorLocalToGlobalTile across 7 land and 19 total sectors', () => {
    const landOnly = buildSmallAtlasPartition({ includeOceanHalo: false });
    expect(landOnly.sectors).toHaveLength(7);
    expect(landOnly.landSectorIds).toHaveLength(7);
    expect(landOnly.oceanSectorIds).toHaveLength(0);
    expect(landOnly.tilesPerSector).toBe(1_801);
    expect(landOnly.tiles).toHaveLength(7 * 1_801);
    expect(landOnly.tileByKey.size).toBe(12_607);

    const full = buildSmallAtlasPartition({ includeOceanHalo: true });
    expect(full.sectors).toHaveLength(19);
    expect(full.landSectorIds).toHaveLength(7);
    expect(full.oceanSectorIds).toHaveLength(12);
    expect(full.tiles).toHaveLength(19 * 1_801);
    expect(full.tileByKey.size).toBe(34_219);
    expect(full.bounds.totalTiles).toBe(34_219);

    for (const sector of full.sectors) {
      expect(sector.tiles).toHaveLength(1_801);
      const byIdTiles = enumerateSectorTiles(sector.sectorId, full.sectorRadius);
      expect(byIdTiles).toHaveLength(1_801);

      for (const t of sector.tiles) {
        expect(hexDistance(0, 0, t.localQ, t.localR)).toBeLessThanOrEqual(24);
        const resolved = globalTileToSector(t.q, t.r, 24);
        expect(resolved.sectorId).toBe(sector.sectorId);
        expect(resolved.macroQ).toBe(sector.macroQ);
        expect(resolved.macroR).toBe(sector.macroR);
        expect(resolved.localQ).toBe(t.localQ);
        expect(resolved.localR).toBe(t.localR);
        expect(resolved.localIndex).toBe(t.localIndex);

        const global1 = sectorLocalToGlobalTile(sector.macroQ, sector.macroR, t.localQ, t.localR, 24);
        expect(global1).toEqual({ q: t.q, r: t.r });
        const global2 = sectorLocalToGlobalTile(sector.sectorId, t.localQ, t.localR, 24);
        expect(global2).toEqual({ q: t.q, r: t.r });
        const global3 = sectorIdLocalToGlobalTile(sector.sectorId, t.localQ, t.localR, 24);
        expect(global3).toEqual({ q: t.q, r: t.r });
        const global4 = sectorLocalIndexToGlobalTile(sector.macroQ, sector.macroR, t.localIndex, 24);
        expect(global4).toEqual({ q: t.q, r: t.r, localQ: t.localQ, localR: t.localR });
      }
    }
  });
});

describe('W11-34 seam symmetry, 3-sector corners, and dense bounding-box partition proof', () => {
  it('assigns every integer tile in a dense bounding box covering all 7 land sectors to exactly one sector', () => {
    const landOnly = buildSmallAtlasPartition({ includeOceanHalo: false });
    const { minQ, maxQ, minR, maxR } = landOnly.bounds;
    const candidateMacros = W11_SMALL_ATLAS_SECTOR_COORDS.map(([mq, mr]) => ({
      mq,
      mr,
      ...sectorCenterForMacro(mq, mr, 24),
    }));

    let checkedCount = 0;
    for (let r = minR - 2; r <= maxR + 2; r++) {
      for (let q = minQ - 2; q <= maxQ + 2; q++) {
        const lookup = globalTileToSector(q, r, 24);
        expect(hexDistance(0, 0, lookup.localQ, lookup.localR)).toBeLessThanOrEqual(24);
        expect(lookup.centerQ + lookup.localQ).toBe(q);
        expect(lookup.centerR + lookup.localR).toBe(r);

        let matchingCenters = 0;
        for (const c of candidateMacros) {
          if (hexDistance(q, r, c.centerQ, c.centerR) <= 24) matchingCenters++;
        }
        if (matchingCenters > 0) expect(matchingCenters).toBe(1);
        checkedCount++;
      }
    }
    expect(checkedCount).toBeGreaterThan(20_000);
  });

  it('verifies symmetric 6-neighbours across every seam tile of the 19-sector small atlas', () => {
    const partition = buildSmallAtlasPartition({ includeOceanHalo: true });
    expect(partition.seamTiles).toHaveLength(19 * 6 * 24);

    for (const sector of partition.sectors) {
      expect(sector.seamTiles).toHaveLength(6 * 24);
    }

    for (const seam of partition.seamTiles) {
      expect(seam.neighbors).toHaveLength(6);
      expect(seam.crossSectorNeighbors.length).toBeGreaterThanOrEqual(2);
      expect(seam.crossSectorNeighbors.length).toBeLessThanOrEqual(3);

      for (const cross of seam.crossSectorNeighbors) {
        expect(cross.sectorId).not.toBe(seam.sectorId);
        const reverseNeighbors = tileSectorNeighbors(cross.q, cross.r, 24);
        const back = reverseNeighbors[cross.oppositeDir]!;
        expect(back.q).toBe(seam.q);
        expect(back.r).toBe(seam.r);
        expect(back.sectorId).toBe(seam.sectorId);
        expect(back.localQ).toBe(seam.localQ);
        expect(back.localR).toBe(seam.localR);
        expect(back.localIndex).toBe(seam.localIndex);
        expect(back.crossesSectorBoundary).toBe(true);
      }
    }
  });

  it('verifies all 3-sector corner triples have 3 pairwise-adjacent tiles from 3 distinct sectors with zero gaps', () => {
    const partition = buildSmallAtlasPartition({ includeOceanHalo: true });
    const internalCorners = partition.cornerTriples.filter((c) => c.allInAtlas);
    expect(internalCorners).toHaveLength(24);
    expect(partition.cornerTriples.length).toBeGreaterThanOrEqual(24);

    for (const corner of partition.cornerTriples) {
      const [t0, t1, t2] = corner.tiles;
      expect(new Set(corner.sectorIds).size).toBe(3);
      expect(hexDistance(t0.q, t0.r, t1.q, t1.r)).toBe(1);
      expect(hexDistance(t1.q, t1.r, t2.q, t2.r)).toBe(1);
      expect(hexDistance(t2.q, t2.r, t0.q, t0.r)).toBe(1);

      for (const t of corner.tiles) {
        expect(hexDistance(0, 0, t.localQ, t.localR)).toBe(24);
        const owner = globalTileToSector(t.q, t.r, 24);
        expect(owner.sectorId).toBe(t.sectorId);
      }
    }
  });
});

describe('W11-34 boundary, custom topology, and negative validation cases', () => {
  it('supports custom smaller radii (R=8) and custom oceanCoords / knownSectorIds', () => {
    const custom = buildSmallAtlasPartition({
      sectorRadius: 8,
      landCoords: [
        [0, 0],
        [1, 0],
      ],
      oceanCoords: [[0, 1]],
    });
    expect(custom.sectors).toHaveLength(3);
    expect(custom.tilesPerSector).toBe(hexCount(8));
    expect(custom.tiles).toHaveLength(3 * hexCount(8));
    expect(custom.getTile(0, 0)?.sectorId).toBe('sec_0_0');
    expect(custom.getTile(999, 999)).toBeNull();
    expect(tileCoordKey(-0, -0)).toBe('0,0');
    expect(HEX_DIRS).toHaveLength(6);
    expect(W11_SEVEN_SECTOR_COORDS).toHaveLength(7);
    expect(W11_OCEAN_HALO_SECTOR_COORDS).toHaveLength(12);

    const sec00 = custom.sectorById.get('sec_0_0')!;
    const inAtlasNeighbors = sec00.atlasNeighbors.filter((n) => n.sectorId !== null);
    expect(inAtlasNeighbors.map((n) => n.sectorId)).toEqual(['sec_1_0', 'sec_0_1']);
  });

  it('rejects invalid sectorRadius, out-of-range local coordinates, and malformed sectorIds', () => {
    expect(() => macroBasisVectors(0)).toThrow(RangeError);
    expect(() => macroBasisVectors(-5)).toThrow(RangeError);
    expect(() => macroBasisVectors(2.5)).toThrow(RangeError);
    expect(() => sectorCenterForMacro(0, 0, 0)).toThrow(RangeError);
    expect(() => sectorCenterForMacro(1.5, 0, 24)).toThrow(RangeError);
    expect(() => sectorCenterForId('invalid_id', 24)).toThrow(RangeError);
    expect(() => globalTileToSector(0, 0, 0)).toThrow(RangeError);
    expect(() => globalTileToSector(Number.NaN, 0, 24)).toThrow(RangeError);
    expect(() => sectorLocalToGlobalTile(0, 0, 25, 0, 24)).toThrow(RangeError);
    expect(() => sectorLocalToGlobalTile(0, 0, 15, 15, 24)).toThrow(RangeError);
    expect(() => sectorLocalToGlobalTile('sec_bad', 0, 0, 24)).toThrow(RangeError);
    expect(() => sectorIdLocalToGlobalTile('sec_01_0', 0, 0, 24)).toThrow(RangeError);
    expect(() => sectorLocalIndexToGlobalTile(0, 0, -1, 24)).toThrow(RangeError);
    expect(() => sectorLocalIndexToGlobalTile(0, 0, 1_801, 24)).toThrow(RangeError);
    expect(() => enumerateSectorTiles('bad', 24)).toThrow(RangeError);
    expect(() => oppositeHexDir(-1)).toThrow(RangeError);
    expect(() => oppositeHexDir(6)).toThrow(RangeError);
    expect(() => buildSmallAtlasPartition({ landCoords: [] })).toThrow(RangeError);
    expect(() =>
      buildSmallAtlasPartition({
        landCoords: [
          [0, 0],
          [0, 0],
        ],
      }),
    ).toThrow(RangeError);
    expect(() =>
      buildSmallAtlasPartition({
        landCoords: [[0, 0]],
        oceanCoords: [[0, 0]],
      }),
    ).toThrow(RangeError);
  });
});
