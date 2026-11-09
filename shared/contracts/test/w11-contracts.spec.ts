import { describe, expect, it } from 'vitest';
import {
  AtlasConfigV1Schema,
  AtlasManifestV1Schema,
  CANONICAL_PLANETS,
  CANONICAL_PLANET_IDS,
  CANONICAL_PLANET_LIST,
  ContinentIdSchema,
  HomePlanetId,
  LandingSlotIdSchema,
  PlanetId,
  PlanetListV1Schema,
  PlanetSummaryV1Schema,
  PublicPlanetStatsV1Schema,
  SectorConfigV1Schema,
  SectorIdSchema,
  SectorManifestV1Schema,
  W11_DEFAULT_FOUNDING_SEATS_PER_SECTOR,
  W11_DEFAULT_LAND_SECTORS,
  W11_DEFAULT_SECTOR_RADIUS,
  W11_SEVEN_SECTOR_COORDS,
  canonicalPlanetById,
  canonicalPlanetForType,
  deriveSectorOccupancy,
  deriveWorldAvailability,
  formatContinentId,
  formatLandingSlotId,
  formatSectorId,
  isCanonicalPlanetId,
  parseLandingSlotId,
  parseSectorId,
  planetLookForType,
  planetTypeForLook,
  type PlanetSummaryV1,
  type PlanetType,
  type SectorSummaryV1,
} from '../src';

export const NOW_ISO = '2026-11-08T10:00:00.000Z';

export function makeSectorSummaryFixture(
  macroQ: number,
  macroR: number,
  opts: Partial<SectorSummaryV1> = {},
): SectorSummaryV1 {
  const sectorId = formatSectorId(macroQ, macroR);
  const kind = opts.kind ?? 'land';
  const foundingCapacity = opts.foundingCapacity ?? (kind === 'ocean' ? 0 : W11_DEFAULT_FOUNDING_SEATS_PER_SECTOR);
  const validatedCapacity = opts.validatedCapacity ?? foundingCapacity;
  const reservedSeats = opts.reservedSeats ?? 0;
  const foundedSeats = opts.foundedSeats ?? 0;
  const { freeSeats, availability } = deriveSectorOccupancy({
    kind,
    foundingCapacity,
    validatedCapacity,
    reservedSeats,
    foundedSeats,
    livingColonies: opts.livingColonies ?? 0,
    presentColonies: opts.presentColonies ?? 0,
    onlinePlayers: opts.onlinePlayers ?? 0,
  });
  return {
    sectorId,
    continentId: kind === 'land' ? 'cont_0' : null,
    macroQ,
    macroR,
    centerQ: macroQ * 37,
    centerR: macroR * 37,
    kind,
    foundingCapacity,
    validatedCapacity,
    reservedSeats,
    foundedSeats,
    freeSeats: opts.freeSeats ?? freeSeats,
    livingColonies: opts.livingColonies !== undefined ? opts.livingColonies : 0,
    presentColonies: opts.presentColonies !== undefined ? opts.presentColonies : 0,
    onlinePlayers: opts.onlinePlayers !== undefined ? opts.onlinePlayers : 0,
    availability: opts.availability ?? availability,
    ...(opts.mainResource ? { mainResource: opts.mainResource } : {}),
    ...(opts.scarceResources ? { scarceResources: opts.scarceResources } : {}),
  };
}

export function makePlanetSummaryFixture(
  type: PlanetType,
  overrides: Partial<PlanetSummaryV1> = {},
): PlanetSummaryV1 {
  const def = canonicalPlanetForType(type);
  const sectors =
    overrides.sectors ?? W11_SEVEN_SECTOR_COORDS.map(([mq, mr]) => makeSectorSummaryFixture(mq, mr));
  const nominalCapacity = sectors.reduce((s, x) => s + x.foundingCapacity, 0);
  const validatedCapacity = sectors.reduce((s, x) => s + x.validatedCapacity, 0);
  const reservedSeats = overrides.reservedSeats ?? sectors.reduce((s, x) => s + x.reservedSeats, 0);
  const foundedSeats = overrides.foundedSeats ?? sectors.reduce((s, x) => s + x.foundedSeats, 0);
  const freeSeats = overrides.freeSeats ?? Math.max(0, validatedCapacity - reservedSeats - foundedSeats);
  const lifecycle = overrides.lifecycle ?? 'ACTIVE';
  const health = overrides.health ?? 'OK';
  const admission = overrides.admission ?? 'OPEN';
  const availability =
    overrides.availability ?? deriveWorldAvailability({ lifecycle, health, admission, freeSeats });
  return {
    id: def.id,
    name: def.name,
    type: def.type,
    look: def.look,
    lifecycle,
    health,
    admission,
    availability,
    atlasVersion: 1,
    atlasHash: `atlas_${def.type}_v1`,
    configHash: `cfg_${def.type}_v1`,
    totalSectors: sectors.length,
    landSectors: sectors.filter((s) => s.kind === 'land').length,
    oceanSectors: sectors.filter((s) => s.kind === 'ocean').length,
    nominalCapacity,
    validatedCapacity,
    reservedSeats,
    foundedSeats,
    freeSeats,
    livingColonies: overrides.livingColonies !== undefined ? overrides.livingColonies : 0,
    presentColonies: overrides.presentColonies !== undefined ? overrides.presentColonies : 0,
    onlinePlayers: overrides.onlinePlayers !== undefined ? overrides.onlinePlayers : 0,
    updatedAt: NOW_ISO,
    sectors,
    ...overrides,
  };
}

function makeNeighbours(mq: number, mr: number) {
  return [
    [1, 0],
    [1, -1],
    [0, -1],
    [-1, 0],
    [-1, 1],
    [0, 1],
  ].map(([dq, dr], dir) => ({
    dir,
    macroQ: mq + dq!,
    macroR: mr + dr!,
    sectorId: formatSectorId(mq + dq!, mr + dr!),
  }));
}

function makeManifestSector(mq: number, mr: number) {
  const sectorId = formatSectorId(mq, mr);
  return {
    sectorId,
    continentId: 'cont_0',
    macroQ: mq,
    macroR: mr,
    centerQ: mq * 37,
    centerR: mr * 37,
    kind: 'land' as const,
    radius: 48,
    tileCount: 7057,
    foundingCapacity: 4,
    validatedSafeSites: 4,
    safeLandingSlots: [0, 1, 2, 3].map((idx) => ({
      slotId: formatLandingSlotId(sectorId, idx),
      sectorId,
      slotIndex: idx,
      q: mq * 37 + idx * 4,
      r: mr * 37,
    })),
    neighbours: makeNeighbours(mq, mr),
    resourceEndowment: {
      profileId: 'desert-baseline-v1',
      endowmentHash: 'sha256:endow_desert_0',
      sourceLayer: 'planetType' as const,
      depositDensityPer1000Tiles: 18,
      mainResource: 'metals.t1' as const,
      scarceResources: ['bio.water' as const, 'minerals.t3' as const],
    },
  };
}

describe('W11-01 · Canonical planets and IDs', () => {
  it('defines the three canonical persistent worlds with stable ULID-compatible planet IDs', () => {
    expect(CANONICAL_PLANET_LIST).toHaveLength(3);
    expect(new Set(CANONICAL_PLANET_IDS).size).toBe(3);
    expect(CANONICAL_PLANETS.desert.name).toBe('Kharon Dunes');
    expect(CANONICAL_PLANETS.ocean.name).toBe('Thalassa Verde');
    expect(CANONICAL_PLANETS.temperate.name).toBe('Granite Hollow');

    for (const def of CANONICAL_PLANET_LIST) {
      expect(PlanetId.safeParse(def.id).success).toBe(true);
      expect(HomePlanetId.safeParse(def.id).success).toBe(true);
      expect(isCanonicalPlanetId(def.id)).toBe(true);
      expect(canonicalPlanetById(def.id)).toEqual(def);
      expect(canonicalPlanetForType(def.type)).toEqual(def);
      expect(planetLookForType(def.type)).toBe(def.look);
      expect(planetTypeForLook(def.look)).toBe(def.type);
    }
    expect(isCanonicalPlanetId('pl_dev')).toBe(false);
    expect(canonicalPlanetById('pl_unknown')).toBeNull();
  });

  it('formats and parses canonical sector IDs, continent IDs, and landing slot IDs', () => {
    expect(W11_DEFAULT_SECTOR_RADIUS).toBe(48);
    expect(W11_DEFAULT_LAND_SECTORS).toBe(7);
    for (const [mq, mr] of W11_SEVEN_SECTOR_COORDS) {
      const sid = formatSectorId(mq, mr);
      expect(SectorIdSchema.safeParse(sid).success).toBe(true);
      expect(parseSectorId(sid)).toEqual({ macroQ: mq, macroR: mr });
      const slot0 = formatLandingSlotId(sid, 0);
      expect(LandingSlotIdSchema.safeParse(slot0).success).toBe(true);
      expect(parseLandingSlotId(slot0)).toEqual({ sectorId: sid, macroQ: mq, macroR: mr, slotIndex: 0 });
    }
    expect(formatSectorId(-0, -0)).toBe('sec_0_0');
    expect(formatContinentId(0)).toBe('cont_0');
    expect(ContinentIdSchema.safeParse('cont_main_1').success).toBe(true);
    for (const badSec of ['sec_00_0', 'sec_-0_1', 'sec_1.5_0', 'sector_0_0', '']) {
      expect(SectorIdSchema.safeParse(badSec).success).toBe(false);
      expect(parseSectorId(badSec)).toBeNull();
    }
    for (const badSlot of ['slot_sec_0_0_-1', 'slot_sec_00_0_0', 'slot_sec_0_0_01', 'slot_0_0']) {
      expect(LandingSlotIdSchema.safeParse(badSlot).success).toBe(false);
      expect(parseLandingSlotId(badSlot)).toBeNull();
    }
    expect(() => formatSectorId(1.2, 0)).toThrow(RangeError);
    expect(() => formatLandingSlotId('sec_0_0', -1)).toThrow(RangeError);
  });
});

describe('W11-01 · AtlasConfigV1 and AtlasManifestV1 validation', () => {
  it('parses valid seven-sector + ocean-halo atlas config and manifest fixtures', () => {
    const landConfigs = W11_SEVEN_SECTOR_COORDS.map(([mq, mr]) => ({
      sectorId: formatSectorId(mq, mr),
      continentId: 'cont_0',
      macroQ: mq,
      macroR: mr,
      kind: 'land' as const,
      radius: 48,
      foundingCapacity: 4,
      archetype: mq === 0 && mr === 0 ? 'heartland' : 'frontier',
      resourceProfileId: 'desert-baseline-v1',
    }));
    const oceanConfig = {
      sectorId: 'sec_2_0',
      continentId: null,
      macroQ: 2,
      macroR: 0,
      kind: 'ocean' as const,
      radius: 48,
      foundingCapacity: 0,
    };
    const cfg = AtlasConfigV1Schema.parse({
      planetId: CANONICAL_PLANETS.desert.id,
      planetType: 'desert',
      seed: CANONICAL_PLANETS.desert.seed,
      topologyVersion: 1,
      genVersion: 10,
      configVersion: 1,
      sectorRadius: 48,
      foundingSeatsPerSector: 4,
      sectors: [...landConfigs, oceanConfig],
      resourceProfileId: 'desert-baseline-v1',
    });
    expect(cfg.sectors).toHaveLength(8);

    const manifest = AtlasManifestV1Schema.parse({
      planetId: CANONICAL_PLANETS.desert.id,
      planetType: 'desert',
      look: 'dune',
      seed: CANONICAL_PLANETS.desert.seed,
      atlasVersion: 1,
      topologyVersion: 1,
      genVersion: 10,
      configVersion: 1,
      configHash: 'sha256:cfg_1',
      atlasHash: 'sha256:atlas_1',
      resourceProfileId: 'desert-baseline-v1',
      resourceProfileHash: 'sha256:res_1',
      sectorRadius: 48,
      foundingSeatsPerSector: 4,
      totalSectors: 8,
      landSectors: 7,
      oceanSectors: 1,
      nominalCapacity: 28,
      validatedCapacity: 28,
      bounds: { minQ: -100, maxQ: 100, minR: -100, maxR: 100, totalTiles: 134083, maxColonies: 64, maxSectors: 19 },
      sectors: [
        ...W11_SEVEN_SECTOR_COORDS.map(([mq, mr]) => makeManifestSector(mq, mr)),
        {
          sectorId: 'sec_2_0',
          continentId: null,
          macroQ: 2,
          macroR: 0,
          centerQ: 74,
          centerR: 0,
          kind: 'ocean' as const,
          radius: 48,
          tileCount: 7057,
          foundingCapacity: 0,
          validatedSafeSites: 0,
          safeLandingSlots: [],
          neighbours: makeNeighbours(2, 0),
        },
      ],
    });
    expect(manifest.validatedCapacity).toBe(28);
  });
});

describe('W11-01 · AtlasConfigV1 and SectorManifestV1 negative checks', () => {
  it('rejects ocean sectors with founding seats, mismatched sector IDs, or inconsistent capacity totals', () => {
    expect(
      SectorConfigV1Schema.safeParse({
        sectorId: 'sec_2_0',
        continentId: null,
        macroQ: 2,
        macroR: 0,
        kind: 'ocean',
        radius: 24,
        foundingCapacity: 4,
      }).success,
    ).toBe(false);
    expect(
      SectorConfigV1Schema.safeParse({
        sectorId: 'sec_1_0',
        continentId: 'cont_0',
        macroQ: 0,
        macroR: 0,
        kind: 'land',
        radius: 24,
        foundingCapacity: 4,
      }).success,
    ).toBe(false);
    expect(
      SectorManifestV1Schema.safeParse({
        ...makeManifestSector(0, 0),
        validatedSafeSites: 2,
        safeLandingSlots: [],
      }).success,
    ).toBe(false);
  });
});

describe('W11-01 · PlanetSummaryV1, PlanetListV1, Occupancy, and Availability', () => {
  it('derives availability and parses PlanetListV1 with all three canonical worlds while rejecting legacy fields', () => {
    expect(deriveWorldAvailability({ lifecycle: 'ACTIVE', health: 'OK', admission: 'OPEN', freeSeats: 4 })).toBe('open');
    expect(deriveWorldAvailability({ lifecycle: 'ACTIVE', health: 'OK', admission: 'OPEN', freeSeats: 0 })).toBe('full');
    expect(deriveWorldAvailability({ lifecycle: 'ACTIVE', health: 'OK', admission: 'PAUSED', freeSeats: 4 })).toBe('paused');
    expect(deriveWorldAvailability({ lifecycle: 'ACTIVE', health: 'FAULTED', admission: 'OPEN', freeSeats: 4 })).toBe('faulted');
    expect(deriveWorldAvailability({ lifecycle: 'ARCHIVED', health: 'OK', admission: 'ARCHIVED', freeSeats: 4 })).toBe('archived');

    const desert = makePlanetSummaryFixture('desert');
    const ocean = makePlanetSummaryFixture('ocean', {
      reservedSeats: 14,
      foundedSeats: 14,
      freeSeats: 0,
      availability: 'full',
      livingColonies: null,
      presentColonies: null,
      onlinePlayers: null,
    });
    const temperate = makePlanetSummaryFixture('temperate', { admission: 'PAUSED', availability: 'paused' });

    const list = PlanetListV1Schema.parse({
      planets: [desert, ocean, temperate],
      queuePaused: false,
      updatedAt: NOW_ISO,
    });
    expect(list.planets.map((p) => p.availability)).toEqual(['open', 'full', 'paused']);
    expect(list.planets[1]?.livingColonies).toBeNull();

    expect(
      PlanetListV1Schema.safeParse({
        planets: [desert, ocean, temperate],
        newPlanet: [{ type: 'desert', available: true, etaS: 0 }],
        queuePaused: false,
        updatedAt: NOW_ISO,
      }).success,
    ).toBe(false);
    expect(PlanetSummaryV1Schema.safeParse({ ...desert, admissionClosesAt: NOW_ISO }).success).toBe(false);
    expect(
      PublicPlanetStatsV1Schema.parse({ planetsActive: 3, coloniesAlive: 12, playersOnline: 5, updatedAt: NOW_ISO })
        .planetsActive,
    ).toBe(3);
  });
});
