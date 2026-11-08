import { RESOURCE_KEYS, type ResourceKey, type SectorId } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { DEPOSIT } from '../../src/grid/layers';
import {
  buildAtlasManifest,
  buildDefaultAtlasConfig,
  buildRegionalConfigFromScopeBindings,
  CANONICAL_RESOURCE_KEYS,
  createAtlasPlanetState,
  depositKindAndTierToResourceKey,
  generateSmallAtlas,
  getAtlasBlob,
  GLOBAL_DEFAULT_RESOURCE_MAP,
  packAtlasCoord,
  PLANET_TYPE_RESOURCE_PRESETS,
  REGIONAL_RESOURCE_SOURCE_LAYERS,
  RegionalResourceValidationError,
  resolveAtlasRegionalResources,
  resolveDepositTileAttribution,
  resolveFootprintDepositAttribution,
  resolvePinnedOrDefaultAtlasManifest,
  resolveSectorResourceProfile,
  resolveTerraformDiscoveryResource,
  toW13RegionProfileSnapshotInput,
  validateSectorResourceProfile,
} from '../../src/atlas';

describe('W11-46 · 5-layer regional resource hierarchy and source attribution', () => {
  it('resolves all 10 canonical ResourceKeys in strict 5-layer order with field inheritance, explicit 0 overrides, and source attribution', () => {
    expect(CANONICAL_RESOURCE_KEYS).toEqual(RESOURCE_KEYS);
    expect(CANONICAL_RESOURCE_KEYS).toHaveLength(10);
    expect(REGIONAL_RESOURCE_SOURCE_LAYERS).toEqual([
      'global_default',
      'planet_type',
      'planet_id',
      'sector_archetype',
      'sector_id',
    ]);

    const resolved = resolveSectorResourceProfile({
      planetId: 'pl_desert_alpha',
      planetType: 'desert',
      sectorId: 'sec_1_0',
      kind: 'land',
      archetype: 'desert_crystal_ridge',
      layers: {
        global_default: {
          resources: { 'metals.t3': { occurrenceWeightBp: 40, reserveUnitsMin: 300, reserveUnitsMax: 600 } },
        },
        planet_type: {
          resources: { 'metals.t1': { occurrenceWeightBp: 150, extractionYieldBp: 12000 } },
        },
        planet_id: {
          resources: { 'oil.t2': { occurrenceWeightBp: 95, extractionYieldBp: 11500 } },
        },
        sector_archetype: {
          resources: { 'crystals.t3': { occurrenceWeightBp: 80, reserveUnitsMax: 700 } },
        },
        sector_id: {
          depositDensityPer1000Tiles: 16,
          resources: {
            'biomass.t1': { occurrenceWeightBp: 0, renewableUnitsPerSimHour: 0, terraformFindWeightBp: 0 },
            'crystals.t3': { extractionYieldBp: 13500 },
          },
        },
      },
    });

    expect(Object.keys(resolved.resources).sort()).toEqual([...RESOURCE_KEYS].sort());
    expect(resolved.sourceLayer).toBe('sector_id');
    expect(resolved.contractSourceLayer).toBe('sectorId');
    expect(resolved.depositDensityPer1000Tiles).toBe(16);
    expect(resolved.depositDensitySourceLayer).toBe('sector_id');

    expect(resolved.resources['metals.t3'].occurrenceWeightBp).toBe(40);
    expect(resolved.resources['metals.t3'].sourceLayer).toBe('global_default');
    expect(resolved.sourceAttribution['metals.t3']).toBe('global_default');

    expect(resolved.resources['metals.t1'].occurrenceWeightBp).toBe(150);
    expect(resolved.resources['metals.t1'].extractionYieldBp).toBe(12000);
    expect(resolved.resources['metals.t1'].sourceLayer).toBe('planet_type');

    expect(resolved.resources['bio.t2'].occurrenceWeightBp).toBe(95);
    expect(resolved.resources['bio.t2'].extractionYieldBp).toBe(11500);
    expect(resolved.resources['bio.t2'].reserveUnitsMin).toBe(700);
    expect(resolved.resources['bio.t2'].sourceLayer).toBe('planet_id');
    expect(resolved.resources['bio.t2'].fieldSources.occurrenceWeightBp).toBe('planet_id');
    expect(resolved.resources['bio.t2'].fieldSources.reserveUnitsMin).toBe('planet_type');

    expect(resolved.resources['minerals.t3'].occurrenceWeightBp).toBe(80);
    expect(resolved.resources['minerals.t3'].reserveUnitsMax).toBe(700);
    expect(resolved.resources['minerals.t3'].extractionYieldBp).toBe(13500);
    expect(resolved.resources['minerals.t3'].starterGuarantee).toBe(false);
    expect(resolved.resources['minerals.t3'].sourceLayer).toBe('sector_id');
    expect(resolved.resources['minerals.t3'].fieldSources.occurrenceWeightBp).toBe('sector_archetype');
    expect(resolved.resources['minerals.t3'].fieldSources.extractionYieldBp).toBe('sector_id');

    expect(resolved.resources['bio.biomass'].occurrenceWeightBp).toBe(0);
    expect(resolved.resources['bio.biomass'].renewableUnitsPerSimHour).toBe(0);
    expect(resolved.resources['bio.biomass'].terraformFindWeightBp).toBe(0);
    expect(resolved.resources['bio.biomass'].expectedRecoverableOutput).toBe(0);
    expect(resolved.resources['bio.biomass'].reserveUnitsMin).toBe(250);
    expect(resolved.resources['bio.biomass'].sourceLayer).toBe('sector_id');
  });
});

describe('W11-46 · ECONOMY.md §2.2 presets and W13 DB snapshot inputs', () => {
  it('matches ECONOMY.md §2.2 presets (desert, ocean, temperate, desert_crystal_ridge) and exports W13 DB snapshot inputs', () => {
    const desertBase = resolveSectorResourceProfile({ planetType: 'desert', sectorId: 'sec_0_0' });
    expect(desertBase.resources['metals.t1'].occurrenceWeightBp).toBe(150);
    expect(desertBase.resources['minerals.t1'].occurrenceWeightBp).toBe(160);
    expect(desertBase.resources['bio.water'].occurrenceWeightBp).toBe(30);
    expect(desertBase.resources['bio.biomass'].occurrenceWeightBp).toBe(20);
    expect(desertBase.resources['minerals.t3'].occurrenceWeightBp).toBe(15);
    expect(desertBase.mainResource).toBe('metals.t1');
    expect(desertBase.scarceResources).toContain('bio.water');
    expect(desertBase.resources['minerals.t3'].starterGuarantee).toBe(false);

    const crystalRidge = resolveSectorResourceProfile({
      planetType: 'desert',
      sectorId: 'sec_1_0',
      archetype: 'desert_crystal_ridge',
    });
    expect(crystalRidge.resources['minerals.t3'].occurrenceWeightBp).toBe(80);
    expect(crystalRidge.resources['metals.t1'].occurrenceWeightBp).toBe(150);
    expect(crystalRidge.sourceLayer).toBe('sector_archetype');
    expect(crystalRidge.sourceAttribution['minerals.t3']).toBe('sector_archetype');
    expect(crystalRidge.sourceAttribution['metals.t1']).toBe('planet_type');
    expect(crystalRidge.sectorResourceHash).not.toBe(desertBase.sectorResourceHash);

    const oceanLand = resolveSectorResourceProfile({ planetType: 'ocean', sectorId: 'sec_0_0' });
    expect(oceanLand.resources['bio.water'].occurrenceWeightBp).toBe(180);
    expect(oceanLand.resources['bio.biomass'].occurrenceWeightBp).toBe(150);
    expect(oceanLand.mainResource).toBe('bio.water');

    const temperateLand = resolveSectorResourceProfile({ planetType: 'temperate', sectorId: 'sec_0_0' });
    expect(temperateLand.resources['metals.t1'].occurrenceWeightBp).toBe(100);
    expect(temperateLand.resources['minerals.t1'].occurrenceWeightBp).toBe(120);
    expect(temperateLand.resources['bio.water'].occurrenceWeightBp).toBe(110);
    expect(temperateLand.resources['bio.biomass'].occurrenceWeightBp).toBe(100);
    expect(temperateLand.resources['minerals.t3'].occurrenceWeightBp).toBe(100);
    expect(temperateLand.mainResource).toBe('minerals.t1');

    const w13Snap = toW13RegionProfileSnapshotInput(crystalRidge);
    expect(w13Snap.resourceMapHash).toBe(crystalRidge.sectorResourceHash);
    expect(w13Snap.rows).toHaveLength(10);
    expect(GLOBAL_DEFAULT_RESOURCE_MAP['metals.t1'].starterGuarantee).toBe(true);
    expect(PLANET_TYPE_RESOURCE_PRESETS.desert.profileId).toBe('w11-bootstrap-desert-v1');

    const boundCfg = buildRegionalConfigFromScopeBindings(
      [
        { scopeKind: 'sector_archetype', sectorArchetype: 'custom_ridge', regionProfileId: 'prof_ridge' },
        { scopeKind: 'sector_id', sectorId: 'sec_0_1', regionProfileId: 'prof_sec_0_1' },
      ],
      {
        prof_ridge: { resources: { 'minerals.t3': { occurrenceWeightBp: 90 } } },
        prof_sec_0_1: { resources: { 'metals.t2': { occurrenceWeightBp: 140 } } },
      },
    );
    const viaBindings = resolveSectorResourceProfile({
      planetType: 'desert',
      sectorId: 'sec_0_1',
      archetype: 'custom_ridge',
      config: boundCfg,
    });
    expect(viaBindings.resources['minerals.t3'].occurrenceWeightBp).toBe(90);
    expect(viaBindings.resources['metals.t2'].occurrenceWeightBp).toBe(140);
    expect(viaBindings.sourceAttribution['minerals.t3']).toBe('sector_archetype');
    expect(viaBindings.sourceAttribution['metals.t2']).toBe('sector_id');
  });
});

describe('W11-46 · Shuffled sector load order reproduction and starter T1 protection', () => {
  it('reproduces identical hashes, mainResource, scarceResources, and deposits across shuffled sector load orders without T3 starter giveaways', () => {
    const sectorArchetypes: Readonly<Record<SectorId, string>> = {
      sec_1_0: 'desert_crystal_ridge',
      'sec_-1_1': 'desert_crystal_ridge',
    };
    const sectorResourceOverrides = {
      sec_0_1: {
        profileId: 'desert-water-basin-v1',
        resources: {
          'bio.water': {
            occurrenceWeightBp: 220,
            reserveUnitsMin: 1200,
            reserveUnitsMax: 2000,
            extractionYieldBp: 13000,
          },
        },
      },
    };

    const canonicalAtlas = generateSmallAtlas({
      planetType: 'desert',
      seed: 'w11-46-shuffle-seed',
      resourceProfileId: 'w11-desert-regional-v1',
      sectorArchetypes,
      sectorResourceOverrides,
    });

    const canonicalOrder = canonicalAtlas.partition.sectors.map((s) => s.sectorId);
    const reversedOrder = [...canonicalOrder].reverse();
    const interleavedOrder = [
      ...canonicalOrder.filter((_, i) => i % 2 === 1),
      ...canonicalOrder.filter((_, i) => i % 2 === 0),
    ];

    for (const sectorOrder of [reversedOrder, interleavedOrder]) {
      const shuffledAtlas = generateSmallAtlas({
        planetType: 'desert',
        seed: 'w11-46-shuffle-seed',
        resourceProfileId: 'w11-desert-regional-v1',
        sectorArchetypes,
        sectorResourceOverrides,
        sectorOrder,
      });

      expect(shuffledAtlas.resourceProfileId).toBe(canonicalAtlas.resourceProfileId);
      expect(shuffledAtlas.resourceProfileHash).toBe(canonicalAtlas.resourceProfileHash);
      expect(Array.from(shuffledAtlas.deposit)).toEqual(Array.from(canonicalAtlas.deposit));
      expect(Array.from(shuffledAtlas.depositTier)).toEqual(Array.from(canonicalAtlas.depositTier));
      expect(Array.from(shuffledAtlas.richness)).toEqual(Array.from(canonicalAtlas.richness));

      for (const sec of canonicalAtlas.sectors) {
        const other = shuffledAtlas.sectorById.get(sec.sectorId)!;
        expect(other.sectorResourceHash).toBe(sec.sectorResourceHash);
        expect(other.mainResource).toBe(sec.mainResource);
        expect(other.scarceResources).toEqual(sec.scarceResources);
        expect(other.resourceEndowment).toEqual(sec.resourceEndowment);
        expect(Array.from(other.deposit)).toEqual(Array.from(sec.deposit));
        expect(Array.from(other.depositTier)).toEqual(Array.from(sec.depositTier));
        expect(Array.from(other.richness)).toEqual(Array.from(sec.richness));
      }
    }

    const sec10 = canonicalAtlas.sectorById.get('sec_1_0')!;
    expect(sec10.archetype).toBe('desert_crystal_ridge');
    expect(sec10.resourceProfile.resources['minerals.t3'].occurrenceWeightBp).toBe(80);
    const sec01 = canonicalAtlas.sectorById.get('sec_0_1')!;
    expect(sec01.mainResource).toBe('bio.water');
    expect(sec01.resourceEndowment.sourceLayer).toBe('sectorId');

    const landingValidation = canonicalAtlas.validateLandingSites();
    expect(landingValidation.ok).toBe(true);
    expect(landingValidation.slotDetails.length).toBeGreaterThan(0);
    for (const detail of landingValidation.slotDetails) {
      expect(detail.metalsTile).not.toBeNull();
      expect(detail.mineralsTile).not.toBeNull();
      for (const ref of [detail.metalsTile!, detail.mineralsTile!]) {
        const tile = canonicalAtlas.getTile(ref.q, ref.r)!;
        expect([DEPOSIT.metals, DEPOSIT.minerals]).toContain(tile.deposit);
        expect(tile.depositTier).toBe(0);
        const key = depositKindAndTierToResourceKey(tile.deposit, tile.depositTier);
        expect(['metals.t1', 'minerals.t1']).toContain(key);
        expect(key).not.toBe('minerals.t3');
      }
    }
    expect(packAtlasCoord(0, 0)).toBeTypeOf('number');
  });
});

describe('W11-46 · Absent optional profile baseline preservation', () => {
  it('preserves baseline planet-type profile and atlas behavior when optional profile overrides are absent', () => {
    for (const planetType of ['desert', 'ocean', 'temperate'] as const) {
      const resolved = resolveAtlasRegionalResources({ planetType });
      expect(resolved.hasCustomOverrides).toBe(false);
      expect(resolved.resourceProfileId).toBe(`w11-bootstrap-${planetType}-v1`);
      expect(resolved.resourceProfileHash).toMatch(/^sha256:[0-9a-f]{64}$/);

      const atlas = generateSmallAtlas({
        planetType,
        seed: `w11-46-base-${planetType}`,
        sectorRadius: 12,
        foundingSeatsPerSector: 2,
      });
      const manifest = buildAtlasManifest(atlas);
      const cfgManifest = buildAtlasManifest(
        buildDefaultAtlasConfig({
          planetType,
          seed: `w11-46-base-${planetType}`,
          sectorRadius: 12,
          foundingSeatsPerSector: 2,
        }),
      );
      expect(manifest).toEqual(cfgManifest);
      expect(manifest.resourceProfileId).toBe(`w11-bootstrap-${planetType}-v1`);
      expect(manifest.resourceProfileHash).toBe(atlas.resourceProfileHash);

      const expectedMain: ResourceKey =
        planetType === 'desert' ? 'metals.t1' : planetType === 'ocean' ? 'bio.water' : 'minerals.t1';
      for (const sec of manifest.sectors) {
        expect(sec.resourceEndowment?.mainResource).toBe(expectedMain);
        expect(sec.resourceEndowment?.sourceLayer).toBe('planetType');
        expect(sec.resourceEndowment?.endowmentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
      }

      const state = createAtlasPlanetState({ atlas, manifest, gridRadius: 10 });
      const blob = getAtlasBlob(state)!;
      expect(blob.resourceProfileId).toBe(manifest.resourceProfileId);
      expect(blob.resourceProfileHash).toBe(manifest.resourceProfileHash);
      expect(blob.sectors[0]?.mainResource).toBe(expectedMain);
      expect(blob.sectors[0]?.scarceResources?.length).toBeGreaterThan(0);
      expect(resolvePinnedOrDefaultAtlasManifest({ blob: { ...blob, manifest: undefined } })).toEqual(manifest);
    }
  });
});

describe('W11-46 · Contradictory profile rejection', () => {
  it('rejects contradictory profiles (0-weight mainResource, mismatched mainResource badge, T3/T2 starterGuarantee giveaway, missing land T1 starter guarantee)', () => {
    expect(() =>
      resolveSectorResourceProfile({
        planetType: 'desert',
        sectorId: 'sec_0_0',
        sectorIdOverride: { resources: { 'minerals.t3': { starterGuarantee: true } } },
      }),
    ).toThrowError(RegionalResourceValidationError);

    try {
      resolveSectorResourceProfile({
        planetType: 'desert',
        sectorId: 'sec_0_0',
        sectorIdOverride: { resources: { 'crystals.t3': { starterGuarantee: true } } },
      });
    } catch (err) {
      expect(err).toBeInstanceOf(RegionalResourceValidationError);
      expect((err as RegionalResourceValidationError).code).toBe('t3_starter_guarantee_forbidden');
    }

    expect(() =>
      resolveSectorResourceProfile({
        planetType: 'temperate',
        sectorId: 'sec_0_0',
        sectorIdOverride: { resources: { 'metals.t2': { starterGuarantee: true } } },
      }),
    ).toThrow(/non-T1 resource metals\.t2 cannot have starterGuarantee=true/);

    expect(() =>
      resolveSectorResourceProfile({
        planetType: 'desert',
        sectorId: 'sec_1_0',
        sectorIdOverride: {
          mainResource: 'minerals.t3',
          resources: { 'minerals.t3': { occurrenceWeightBp: 0 } },
        },
      }),
    ).toThrow(/mainResource minerals\.t3 has zero weight or zero recoverable output/);

    expect(() =>
      resolveSectorResourceProfile({
        planetType: 'desert',
        sectorId: 'sec_1_0',
        sectorIdOverride: { mainResource: 'minerals.t3' },
      }),
    ).toThrow(/does not match top expected recoverable output or top abundance weight/);

    const unvalidated = resolveSectorResourceProfile({
      planetType: 'desert',
      sectorId: 'sec_0_0',
      kind: 'land',
      validate: false,
      sectorIdOverride: { resources: { 'metals.t1': { starterGuarantee: false } } },
    });
    const report = validateSectorResourceProfile(unvalidated);
    expect(report.ok).toBe(false);
    expect(report.code).toBe('missing_essential_starter_guarantee');
  });
});

describe('W11-46 · Cross-border footprint deposit attribution and terraforming discovery', () => {
  it('attributes cross-border footprint deposits strictly by each deposit tile sectorId, never building centroid, anchor, colony, or depot sector', () => {
    const regional = resolveAtlasRegionalResources({
      planetType: 'desert',
      sectorArchetypes: { sec_1_0: 'desert_crystal_ridge' },
      sectorResourceOverrides: {
        sec_1_0: { resources: { 'minerals.t3': { occurrenceWeightBp: 85, extractionYieldBp: 14000 } } },
      },
    });

    const tilesForward = [
      { q: 23, r: 0, depositKind: DEPOSIT.none, depositTier: 0, richness: 0 },
      { q: 24, r: 0, depositKind: DEPOSIT.none, depositTier: 0, richness: 0 },
      { q: 23, r: 1, depositKind: DEPOSIT.none, depositTier: 0, richness: 0 },
      { q: 25, r: 0, depositKind: DEPOSIT.minerals, depositTier: 2, richness: 10000 },
    ] as const;

    const attrForward = resolveFootprintDepositAttribution({
      anchorQ: 23,
      anchorR: 0,
      tiles: tilesForward,
      regionalResources: regional,
      planetType: 'desert',
      ownerColonyIndex: 0,
      ownerFoundingSectorId: 'sec_0_0',
      depotSectorId: 'sec_0_0',
    });
    const attrReversed = resolveFootprintDepositAttribution({
      anchorQ: 23,
      anchorR: 0,
      tiles: [...tilesForward].reverse(),
      regionalResources: regional,
      planetType: 'desert',
      ownerColonyIndex: 0,
      ownerFoundingSectorId: 'sec_0_0',
      depotSectorId: 'sec_0_0',
    });

    expect(attrForward).toEqual(attrReversed);
    expect(attrForward.anchorSectorId).toBe('sec_0_0');
    expect(attrForward.centroidSectorId).toBe('sec_0_0');
    expect(attrForward.ownerFoundingSectorId).toBe('sec_0_0');
    expect(attrForward.depotSectorId).toBe('sec_0_0');
    expect(attrForward.straddlesSectorBoundary).toBe(true);
    expect(attrForward.footprintSectorIds).toEqual(['sec_0_0', 'sec_1_0']);

    expect(attrForward.attributedSectorIds).toEqual(['sec_1_0']);
    expect(attrForward.primaryAttributedSectorId).toBe('sec_1_0');
    expect(attrForward.depositTiles).toHaveLength(1);
    expect(attrForward.depositTiles[0]?.sectorId).toBe('sec_1_0');
    expect(attrForward.depositTiles[0]?.resourceKey).toBe('minerals.t3');
    expect(attrForward.depositTiles[0]?.extractionYieldBp).toBe(14000);
    expect(attrForward.depositTiles[0]?.sourceLayer).toBe('sector_id');
    expect(attrForward.productionBySector['sec_1_0']?.totalWeightedRichnessBp).toBe(14000);
    expect(attrForward.productionBySector['sec_0_0']).toBeUndefined();

    const singleTileAttr = resolveDepositTileAttribution({
      q: 25,
      r: 0,
      depositKind: DEPOSIT.minerals,
      depositTier: 2,
      richness: 10000,
      regionalResources: regional,
      planetType: 'desert',
    });
    expect(singleTileAttr.sectorId).toBe('sec_1_0');
    expect(singleTileAttr.sectorResourceHash).toBe(
      regional.sectorById.get('sec_1_0')!.sectorResourceHash,
    );

    const sec10Profile = regional.sectorById.get('sec_1_0')!;
    const find1 = resolveTerraformDiscoveryResource({
      seed: 'w11-46-find',
      q: 25,
      r: 0,
      unlockTier: 1,
      sectorProfile: sec10Profile,
    });
    const find2 = resolveTerraformDiscoveryResource({
      seed: 'w11-46-find',
      q: 25,
      r: 0,
      unlockTier: 1,
      sectorProfile: sec10Profile,
    });
    expect(find1).toEqual(find2);
    expect(['metals.t1', 'minerals.t1', 'bio.water', 'bio.biomass']).toContain(find1.resourceKey);
  });
});
