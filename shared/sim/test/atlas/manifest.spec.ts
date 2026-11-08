import { describe, expect, it } from 'vitest';
import {
  AtlasConfigV1Schema,
  AtlasManifestV1Schema,
  CANONICAL_PLANETS,
  formatSectorId,
  W11_DEFAULT_FOUNDING_SEATS_PER_SECTOR,
  W11_DEFAULT_LAND_SECTORS,
  W11_DEFAULT_SECTOR_RADIUS,
  W11_MAX_SMALL_ATLAS_COLONIES,
  W11_MAX_SMALL_ATLAS_SECTORS,
  W11_MAX_SMALL_ATLAS_TILES,
  type PlanetType,
} from '@terra/contracts';
import {
  buildAtlasManifest,
  buildDefaultAtlasConfig,
  canonicalizeManifestJson,
  computeAtlasConfigHash,
  computeAtlasManifestHash,
  createAtlasPlanetState,
  createAtlasQueryView,
  createPlanetStateFromPinnedManifest,
  extractPinnedAtlasManifest,
  GEN_VERSION,
  generateSmallAtlas,
  getAtlasBlob,
  getSpawnSlots,
  resolvePinnedOrDefaultAtlasManifest,
  restore,
  sha256Hex,
  snapshot,
  validateAtlasRolloutLimits,
} from '../../src';

const BIOMES: readonly PlanetType[] = ['desert', 'ocean', 'temperate'];

describe('W11-38 · Deterministic AtlasConfigV1, AtlasManifestV1, and pure-TS SHA-256 hashing', () => {
  it('computes standard FIPS 180-4 SHA-256 digests and canonical JSON serialization', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(canonicalizeManifestJson({ b: 1, a: -0, c: undefined })).toBe('{"a":0,"b":1}');
    expect(canonicalizeManifestJson({ a: 0, b: 1 })).toBe('{"a":0,"b":1}');
  });

  it('builds schema-valid AtlasConfigV1 and AtlasManifestV1 across all 3 canonical worlds with identical hashes from config or GeneratedSmallAtlas', () => {
    const hashes = new Set<string>();
    for (const planetType of BIOMES) {
      const canonical = CANONICAL_PLANETS[planetType];
      const config = buildDefaultAtlasConfig(planetType);
      expect(() => AtlasConfigV1Schema.parse(config)).not.toThrow();
      expect(config.planetId).toBe(canonical.id);
      expect(config.planetType).toBe(planetType);
      expect(config.seed).toBe(canonical.seed);
      expect(config.genVersion).toBe(GEN_VERSION);
      expect(config.sectorRadius).toBe(W11_DEFAULT_SECTOR_RADIUS);
      expect(config.foundingSeatsPerSector).toBe(W11_DEFAULT_FOUNDING_SEATS_PER_SECTOR);
      expect(config.sectors).toHaveLength(19);
      expect(config.sectors.filter((s) => s.kind === 'land')).toHaveLength(7);
      expect(config.sectors.filter((s) => s.kind === 'ocean')).toHaveLength(12);

      const manifestFromConfig = buildAtlasManifest(config);
      expect(() => AtlasManifestV1Schema.parse(manifestFromConfig)).not.toThrow();
      expect(manifestFromConfig.configHash).toBe(computeAtlasConfigHash(config));
      expect(manifestFromConfig.atlasHash).toBe(computeAtlasManifestHash(manifestFromConfig));
      expect(manifestFromConfig.configHash.startsWith('sha256:')).toBe(true);
      expect(manifestFromConfig.atlasHash.startsWith('sha256:')).toBe(true);
      expect(manifestFromConfig.resourceProfileHash.startsWith('sha256:')).toBe(true);
      expect(manifestFromConfig.totalSectors).toBe(19);
      expect(manifestFromConfig.landSectors).toBe(7);
      expect(manifestFromConfig.oceanSectors).toBe(12);
      expect(manifestFromConfig.nominalCapacity).toBe(28);
      expect(manifestFromConfig.validatedCapacity).toBe(28);
      expect(manifestFromConfig.bounds.totalTiles).toBe(34_219);

      const atlas = generateSmallAtlas({ planetType });
      const manifestFromAtlas = buildAtlasManifest(atlas);
      expect(manifestFromAtlas).toEqual(manifestFromConfig);
      expect(manifestFromAtlas.configHash).toBe(manifestFromConfig.configHash);
      expect(manifestFromAtlas.atlasHash).toBe(manifestFromConfig.atlasHash);

      hashes.add(manifestFromConfig.atlasHash);
    }
    expect(hashes.size).toBe(3);
  });
});

describe('W11-38 · Pinned manifest immutability on restart when default rollout parameters change', () => {
  it('preserves an existing world exact manifest, hashes, capacity, and 28 landing slots when restart defaults change to X=3 or X=5', () => {
    const initialState = createAtlasPlanetState({
      planetType: 'desert',
      seed: CANONICAL_PLANETS.desert.seed,
      foundingSeatsPerSector: 4,
    });
    const initialBlob = getAtlasBlob(initialState)!;
    const pinnedManifest = initialBlob.manifest!;
    expect(pinnedManifest).toBeDefined();
    expect(pinnedManifest.foundingSeatsPerSector).toBe(4);
    expect(pinnedManifest.validatedCapacity).toBe(28);
    expect(initialBlob.atlasHash).toBe(pinnedManifest.atlasHash);
    expect(initialBlob.configHash).toBe(pinnedManifest.configHash);

    const changedDefaultsX3 = {
      planetType: 'desert' as const,
      seed: 'w11-kharon-dunes-v2-changed-seed',
      foundingSeatsPerSector: 3,
      resourceProfileId: 'w11-bootstrap-desert-v99',
      configVersion: 9,
    };
    const changedDefaultsX5 = {
      planetType: 'desert' as const,
      seed: 'w11-kharon-dunes-v3-changed-seed',
      foundingSeatsPerSector: 5,
      resourceProfileId: 'w11-bootstrap-desert-v100',
      configVersion: 10,
    };

    const resolvedFromManifest = resolvePinnedOrDefaultAtlasManifest(pinnedManifest, changedDefaultsX3);
    expect(resolvedFromManifest).toEqual(pinnedManifest);
    expect(resolvedFromManifest.atlasHash).toBe(pinnedManifest.atlasHash);
    expect(resolvedFromManifest.configHash).toBe(pinnedManifest.configHash);
    expect(resolvedFromManifest.validatedCapacity).toBe(28);

    const savedSnapshot = snapshot(initialState);
    const restoredState = restore(savedSnapshot);
    const resolvedFromSnapshotState = resolvePinnedOrDefaultAtlasManifest(restoredState, changedDefaultsX5);
    expect(resolvedFromSnapshotState).toEqual(pinnedManifest);

    const legacyBlobWithoutManifest = { ...initialBlob, manifest: undefined };
    const resolvedFromLegacyBlob = resolvePinnedOrDefaultAtlasManifest(
      legacyBlobWithoutManifest,
      changedDefaultsX3,
    );
    expect(resolvedFromLegacyBlob).toEqual(pinnedManifest);
  });

  it('recreates identical PlanetState and spawnSlots from pinned manifest despite changed runtime defaults, while new unpinned worlds use new defaults', () => {
    const initialState = createAtlasPlanetState({
      planetType: 'ocean',
      seed: CANONICAL_PLANETS.ocean.seed,
      foundingSeatsPerSector: 4,
    });
    const pinnedManifest = extractPinnedAtlasManifest(initialState)!;
    expect(pinnedManifest.validatedCapacity).toBe(28);

    const resumedState = createPlanetStateFromPinnedManifest(
      { pinnedManifest },
      {
        planetType: 'ocean',
        seed: 'completely-different-restart-seed',
        foundingSeatsPerSector: 3,
      },
    );
    const resumedBlob = getAtlasBlob(resumedState)!;
    expect(resumedBlob.manifest).toEqual(pinnedManifest);
    expect(resumedBlob.atlasHash).toBe(pinnedManifest.atlasHash);
    expect(resumedBlob.configHash).toBe(pinnedManifest.configHash);
    expect(resumedBlob.validatedCapacity).toBe(28);
    expect(resumedBlob.safeLandingSlots).toEqual( getAtlasBlob(initialState)!.safeLandingSlots );
    expect(getSpawnSlots(resumedState)).toEqual(getSpawnSlots(initialState));
    expect(snapshot(resumedState)).toEqual(snapshot(initialState));

    const freshWorldManifest = resolvePinnedOrDefaultAtlasManifest(null, {
      planetType: 'ocean',
      foundingSeatsPerSector: 3,
    });
    expect(freshWorldManifest.foundingSeatsPerSector).toBe(3);
    expect(freshWorldManifest.validatedCapacity).toBe(21);
    expect(freshWorldManifest.atlasHash).not.toBe(pinnedManifest.atlasHash);
  });
});

describe('W11-38 · Small-atlas rollout limit validation (validateAtlasRolloutLimits)', () => {
  it('accepts valid 7-land + 12-ocean R=24 configs and manifests for X=3, 4, and 5', () => {
    for (const seats of [3, 4, 5]) {
      const cfg = buildDefaultAtlasConfig({ planetType: 'temperate', foundingSeatsPerSector: seats });
      const cfgCheck = validateAtlasRolloutLimits(cfg);
      expect(cfgCheck.ok).toBe(true);
      expect(cfgCheck.code).toBeUndefined();
      expect(cfgCheck.violations).toEqual([]);
      expect(cfgCheck.observed.totalSectors).toBe(19);
      expect(cfgCheck.observed.landSectors).toBe(7);
      expect(cfgCheck.observed.oceanSectors).toBe(12);
      expect(cfgCheck.observed.sectorRadius).toBe(24);
      expect(cfgCheck.observed.totalTiles).toBe(34_219);
      expect(cfgCheck.observed.foundingSeatsPerSector).toBe(seats);

      const manifest = buildAtlasManifest(cfg);
      const manifestCheck = validateAtlasRolloutLimits(manifest);
      expect(manifestCheck.ok).toBe(true);
      expect(manifestCheck.violations).toEqual([]);
    }
  });

  it('rejects configs and manifests exceeding maxSectors, maxLandSectors, maxSectorRadius, maxTotalTiles, maxFoundingSeatsPerSector, or maxColonies', () => {
    const baseCfg = buildDefaultAtlasConfig('desert');

    const extraSectorCfg = {
      ...baseCfg,
      sectors: [
        ...baseCfg.sectors,
        {
          sectorId: formatSectorId(3, 0),
          continentId: 'cont_0',
          macroQ: 3,
          macroR: 0,
          kind: 'land' as const,
          radius: 24,
          foundingCapacity: 4,
        },
      ],
    };
    const extraCheck = validateAtlasRolloutLimits(extraSectorCfg);
    expect(extraCheck.ok).toBe(false);
    expect(extraCheck.code).toBe('rollout_limit_exceeded');
    expect(extraCheck.violations.map((v) => v.field)).toEqual([
      'maxSectors',
      'maxLandSectors',
      'maxTotalTiles',
    ]);
    expect(extraCheck.violations.find((v) => v.field === 'maxSectors')?.limit).toBe(
      W11_MAX_SMALL_ATLAS_SECTORS,
    );
    expect(extraCheck.violations.find((v) => v.field === 'maxLandSectors')?.limit).toBe(
      W11_DEFAULT_LAND_SECTORS,
    );
    expect(extraCheck.violations.find((v) => v.field === 'maxTotalTiles')?.limit).toBe(
      W11_MAX_SMALL_ATLAS_TILES,
    );

    const bigRadiusCfg = buildDefaultAtlasConfig({
      planetType: 'desert',
      sectorRadius: 25,
      foundingSeatsPerSector: 6,
    });
    const bigRadiusCheck = validateAtlasRolloutLimits(bigRadiusCfg);
    expect(bigRadiusCheck.ok).toBe(false);
    expect(bigRadiusCheck.code).toBe('rollout_limit_exceeded');
    expect(bigRadiusCheck.violations.map((v) => v.field)).toContain('maxSectorRadius');
    expect(bigRadiusCheck.violations.map((v) => v.field)).toContain('maxTotalTiles');
    expect(bigRadiusCheck.violations.map((v) => v.field)).toContain('maxFoundingSeatsPerSector');

    const baseManifest = buildAtlasManifest(baseCfg);
    const overColoniesManifest = {
      ...baseManifest,
      bounds: { ...baseManifest.bounds, maxColonies: W11_MAX_SMALL_ATLAS_COLONIES + 10 },
    };
    const colCheck = validateAtlasRolloutLimits(overColoniesManifest);
    expect(colCheck.ok).toBe(false);
    expect(colCheck.code).toBe('rollout_limit_exceeded');
    expect(colCheck.violations.map((v) => v.field)).toEqual(['maxColonies']);
    expect(colCheck.violations[0]?.actual).toBe(74);
    expect(colCheck.violations[0]?.limit).toBe(W11_MAX_SMALL_ATLAS_COLONIES);
  });
});

describe('W11-38 · Shared AtlasQueryInterface (createAtlasQueryView)', () => {
  it('supports sector, land/ocean, tile-to-sector, safe-landing-slot, and neighbour queries across manifest, atlas, config, and PlanetState', () => {
    const state = createAtlasPlanetState({ planetType: 'temperate' });
    const manifest = extractPinnedAtlasManifest(state)!;
    const viewFromManifest = createAtlasQueryView(manifest);
    const viewFromState = createAtlasQueryView(state);
    const viewFromConfig = createAtlasQueryView(buildDefaultAtlasConfig('temperate'));

    expect(viewFromState.getManifest()).toEqual(manifest);
    expect(viewFromConfig.getManifest()).toEqual(manifest);

    // Defensive clone check
    const mutatedManifest = viewFromManifest.getManifest();
    mutatedManifest.sectors[0]!. safeLandingSlots.pop();
    expect(viewFromManifest.getSector('sec_0_0')?.safeLandingSlots).toHaveLength(4);

    expect(viewFromManifest.getLandSectors()).toHaveLength(7);
    expect(viewFromManifest.getOceanSectors()).toHaveLength(12);
    expect(viewFromManifest.getSector('sec_0_0')?.kind).toBe('land');
    expect(viewFromManifest.getSector('sec_2_0')?.kind).toBe('ocean');
    expect(viewFromManifest.getSector('sec_9_9')).toBeNull();

    // Tile-to-sector lookups across center, ring-1 land, ring-2 ocean halo, and outside atlas
    expect(viewFromManifest.getSectorForTile(0, 0)?.sectorId).toBe('sec_0_0');
    expect(viewFromManifest.getSectorForTile(49, -24)?.sectorId).toBe('sec_1_0');
    const oceanSec = viewFromManifest.getSector('sec_2_0')!;
    expect(viewFromManifest.getSectorForTile(oceanSec.centerQ, oceanSec.centerR)?.sectorId).toBe('sec_2_0');
    expect(viewFromManifest.getSectorForTile(500, 500)).toBeNull();
    expect(viewFromManifest.getSectorForTile(Number.NaN, 0)).toBeNull();

    // Safe landing slots
    for (const landSec of viewFromManifest.getLandSectors()) {
      for (const slot of landSec.safeLandingSlots) {
        const lookedUp = viewFromManifest.getSafeLandingSlot(slot.slotId);
        expect(lookedUp).toEqual(slot);
        expect(viewFromManifest.getSectorForTile(slot.q, slot.r)?.sectorId).toBe(landSec.sectorId);
      }
    }
    expect(viewFromManifest.getSafeLandingSlot('slot_sec_0_0_99')).toBeNull();
    expect(viewFromManifest.getSafeLandingSlot('slot_sec_2_0_0')).toBeNull();

    // Sector neighbours
    const centerNeighbours = viewFromManifest.getSectorNeighbours('sec_0_0');
    expect(centerNeighbours).toHaveLength(6);
    expect(centerNeighbours.every((n) => n.sectorId !== null)).toBe(true);
    expect(viewFromManifest.getSectorNeighbors('sec_0_0')).toEqual(centerNeighbours);

    const haloNeighbours = viewFromManifest.getSectorNeighbours('sec_2_0');
    expect(haloNeighbours).toHaveLength(6);
    expect(haloNeighbours.some((n) => n.sectorId === 'sec_1_0')).toBe(true);
    expect(haloNeighbours.some((n) => n.sectorId === null)).toBe(true);
    expect(viewFromManifest.getSectorNeighbours('sec_9_9')).toEqual([]);
  });
});
