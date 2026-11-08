import { describe, expect, it } from 'vitest';
import {
  CANONICAL_PLANETS,
  formatLandingSlotId,
  SafeLandingSlotV1Schema,
  W11_SUPPORTED_FOUNDING_SEATS,
  type SafeLandingSlotV1,
} from '@terra/contracts';
import {
  buildPipeline,
  createAtlasPlanetState,
  DEPOSIT,
  generateSmallAtlas,
  getAtlasBlob,
  getSpawnSlots,
  globalTileToSector,
  hexDistance,
  hexIndex,
  isAtlasHexTile,
  maxAchievableSlotsInSector,
  planSectorLandingSites,
  PREP,
  prepareAtlasLandingSites,
  spawnColonyLanding,
  step,
  TERRAIN,
  validateAtlasLandingSites,
  validateSeedCorpusLandingSites,
  W11_DEFAULT_MIN_BUILDABLE_R4,
  W11_DEFAULT_MIN_SLOT_SEPARATION,
  type PlanetType,
} from '../../src';

const BIOMES: readonly PlanetType[] = ['desert', 'ocean', 'temperate'];

describe('W11-36 seed corpus validation across desert, ocean, and temperate for X=3, 4, 5', () => {
  it(
    'validates the full seed corpus across desert/ocean/temperate and X=3/4/5 with 100% separated valid sites',
    { timeout: 15_000 },
    () => {
      const corpus = validateSeedCorpusLandingSites();
      expect(corpus.ok).toBe(true);
      expect(corpus.failedRuns).toBe(0);
      expect(corpus.failures).toEqual([]);
      expect(corpus.capacities).toEqual([3, 4, 5]);
      expect(corpus.planetTypes).toEqual(['desert', 'ocean', 'temperate']);
      expect(corpus.totalRuns).toBe(18);
      expect(corpus.passedRuns).toBe(18);
      expect(corpus.minObservedSeparation).toBeGreaterThanOrEqual(W11_DEFAULT_MIN_SLOT_SEPARATION);
      expect(corpus.minObservedCrossSectorSeparation).toBeGreaterThanOrEqual(W11_DEFAULT_MIN_SLOT_SEPARATION);
      expect(corpus.minObservedIntraSectorSeparation).toBeGreaterThanOrEqual(W11_DEFAULT_MIN_SLOT_SEPARATION);

      for (const entry of corpus.entries) {
        const expectedTotal = 7 * entry.foundingSeatsPerSector;
        expect(entry.nominalCapacity).toBe(expectedTotal);
        expect(entry.validatedCapacity).toBe(expectedTotal);
        expect(entry.validation.ok).toBe(true);
        expect(entry.validation.issues).toEqual([]);
        expect(entry.validation.safeLandingSlots).toHaveLength(expectedTotal);
      }
    },
  );

  it(
    'verifies exact per-sector slot counts (21, 28, 35 on 7 land sectors, 0 on 12 ocean sectors), R1/R4 ground, and starter resources',
    { timeout: 15_000 },
    () => {
      for (const planetType of BIOMES) {
        const canonical = CANONICAL_PLANETS[planetType];
        for (const x of W11_SUPPORTED_FOUNDING_SEATS) {
          const atlas = generateSmallAtlas({
            planetId: canonical.id,
            planetType,
            seed: canonical.seed,
            foundingSeatsPerSector: x,
          });
          const expectedTotal = 7 * x;
          expect(atlas.nominalCapacity).toBe(expectedTotal);
          expect(atlas.validatedCapacity).toBe(expectedTotal);
          expect(atlas.safeLandingSlots).toHaveLength(expectedTotal);
          expect(atlas.landingValidation.ok).toBe(true);

          for (const oceanId of atlas.oceanSectorIds) {
            const oceanSec = atlas.sectorById.get(oceanId)!;
            expect(oceanSec.foundingCapacity).toBe(0);
            expect(oceanSec.validatedSafeSites).toBe(0);
            expect(oceanSec.safeLandingSlots).toEqual([]);
          }

          for (const landId of atlas.landSectorIds) {
            const landSec = atlas.sectorById.get(landId)!;
            expect(landSec.foundingCapacity).toBe(x);
            expect(landSec.validatedSafeSites).toBe(x);
            expect(landSec.safeLandingSlots).toHaveLength(x);
            for (let idx = 0; idx < x; idx++) {
              const slot = landSec.safeLandingSlots[idx]!;
              expect(() => SafeLandingSlotV1Schema.parse(slot)).not.toThrow();
              expect(slot.slotId).toBe(formatLandingSlotId(landId, idx));
              expect(slot.sectorId).toBe(landId);
              expect(slot.slotIndex).toBe(idx);
              const resolved = globalTileToSector(slot.q, slot.r, atlas.sectorRadius);
              expect(resolved.sectorId).toBe(landId);
            }
          }

          for (const detail of atlas.landingValidation.slotDetails) {
            expect(detail.padFlatR1).toBe(true);
            expect(detail.buildableR4Count).toBeGreaterThanOrEqual(W11_DEFAULT_MIN_BUILDABLE_R4);
            expect(detail.buildableHexTileR4Count).toBeGreaterThanOrEqual(W11_DEFAULT_MIN_BUILDABLE_R4);
            expect(detail.metalsTile).not.toBeNull();
            expect(detail.mineralsTile).not.toBeNull();
            expect(detail.metalsTile!.distance).toBeGreaterThanOrEqual(2);
            expect(detail.metalsTile!.distance).toBeLessThanOrEqual(6);
            expect(detail.mineralsTile!.distance).toBeGreaterThanOrEqual(2);
            expect(detail.mineralsTile!.distance).toBeLessThanOrEqual(6);
            expect(detail.nearestSlotDistance).toBeGreaterThanOrEqual(W11_DEFAULT_MIN_SLOT_SEPARATION);
          }
        }
      }
    },
  );
});

describe('W11-36 cross-sector starter resource access across sector boundaries', () => {
  it('validates starter metals and minerals across a shared land-sector boundary in global coordinates', () => {
    const atlas = generateSmallAtlas({ planetType: 'temperate', seed: 'cross-seam-res-seed', foundingSeatsPerSector: 3 });
    const seamSlot: SafeLandingSlotV1 = {
      slotId: 'slot_sec_0_0_0',
      sectorId: 'sec_0_0',
      slotIndex: 0,
      q: 20,
      r: -10,
    };
    expect(globalTileToSector(seamSlot.q, seamSlot.r, 24).sectorId).toBe('sec_0_0');

    prepareAtlasLandingSites(atlas, [seamSlot]);
    const crossDepositCoord = { q: 25, r: -12 };
    const crossOwner = atlas.partition.getTile(crossDepositCoord.q, crossDepositCoord.r)!;
    expect(crossOwner.sectorId).toBe('sec_1_0');
    expect(hexDistance(seamSlot.q, seamSlot.r, crossDepositCoord.q, crossDepositCoord.r)).toBe(5);

    for (let dr = -6; dr <= 6; dr++) {
      for (let dq = -6; dq <= 6; dq++) {
        const owner = atlas.partition.getTile(seamSlot.q + dq, seamSlot.r + dr);
        if (!owner) continue;
        const sec = atlas.sectorById.get(owner.sectorId)!;
        if (sec.deposit[owner.localIndex] === DEPOSIT.minerals) {
          sec.deposit[owner.localIndex] = DEPOSIT.none;
          sec.richness[owner.localIndex] = 0;
          atlas.deposit[owner.atlasIndex] = DEPOSIT.none;
          atlas.richness[owner.atlasIndex] = 0;
        }
      }
    }

    for (const [dq, dr] of [[0, 0], [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]] as const) {
      const nOwner = atlas.partition.getTile(crossDepositCoord.q + dq, crossDepositCoord.r + dr)!;
      const nSec = atlas.sectorById.get(nOwner.sectorId)!;
      nSec.terrain[nOwner.localIndex] = TERRAIN.flat;
      nSec.prep[nOwner.localIndex] = PREP.flat;
      nSec.height[nOwner.localIndex] = Math.fround(0.08);
      atlas.terrain[nOwner.atlasIndex] = TERRAIN.flat;
      atlas.prep[nOwner.atlasIndex] = PREP.flat;
      atlas.height[nOwner.atlasIndex] = Math.fround(0.08);
    }
    const sec10 = atlas.sectorById.get('sec_1_0')!;
    sec10.deposit[crossOwner.localIndex] = DEPOSIT.minerals;
    sec10.richness[crossOwner.localIndex] = 10_500;
    atlas.deposit[crossOwner.atlasIndex] = DEPOSIT.minerals;
    atlas.richness[crossOwner.atlasIndex] = 10_500;
    expect(isAtlasHexTile(atlas, crossDepositCoord.q, crossDepositCoord.r)).toBe(true);

    const report = validateAtlasLandingSites(atlas, { slots: [seamSlot] });
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
    const detail = report.slotDetails[0]!;
    expect(detail.crossSectorResourceAccess).toBe(true);
    expect(detail.mineralsTile?.sectorId).toBe('sec_1_0');
    expect(detail.mineralsTile?.q).toBe(25);
    expect(detail.mineralsTile?.r).toBe(-12);
    expect(detail.metalsTile?.sectorId).toBe('sec_0_0');
  });
});

describe('W11-36 PlanetState spawnSlots and spawnColony integration', () => {
  it('populates PlanetState spawnSlots and supports spawning colonies by landingSlotId, sectorId, and (q, r) beyond 8 colonies', () => {
    const state = createAtlasPlanetState({
      planetType: 'desert',
      seed: CANONICAL_PLANETS.desert.seed,
      foundingSeatsPerSector: 4,
    });
    const blob = getAtlasBlob(state)!;
    expect(blob.nominalCapacity).toBe(28);
    expect(blob.validatedCapacity).toBe(28);
    expect(blob.safeLandingSlots).toHaveLength(28);

    const slots = getSpawnSlots(state);
    expect(slots).toHaveLength(28);
    expect(slots[0]?.landingSlotId).toBe('slot_sec_0_0_0');
    expect(slots[0]?.sectorId).toBe('sec_0_0');

    const bySlotId = spawnColonyLanding(state, {
      colonyId: 0,
      colonyIdStr: 'col_0',
      name: 'Alpha',
      landingSlotId: 'slot_sec_1_0_2',
    });
    expect(bySlotId.ok).toBe(true);
    if (bySlotId.ok) {
      const target = blob.safeLandingSlots.find((s) => s.slotId === 'slot_sec_1_0_2')!;
      expect({ q: bySlotId.q, r: bySlotId.r }).toEqual({ q: target.q, r: target.r });
    }

    const bySector = spawnColonyLanding(state, {
      colonyId: 1,
      colonyIdStr: 'col_1',
      name: 'Beta',
      sectorId: 'sec_-1_1',
      slotIndex: 1,
    });
    expect(bySector.ok).toBe(true);
    if (bySector.ok) {
      const target = blob.safeLandingSlots.find((s) => s.slotId === 'slot_sec_-1_1_1')!;
      expect({ q: bySector.q, r: bySector.r }).toEqual({ q: target.q, r: target.r });
    }

    const highColony = spawnColonyLanding(state, {
      colonyId: 12,
      colonyIdStr: 'col_12',
      name: 'Twelfth',
      landingSlotId: 'slot_sec_0_1_3',
    });
    expect(highColony.ok).toBe(true);

    const oceanAttempt = spawnColonyLanding(state, {
      colonyId: 2,
      colonyIdStr: 'col_2',
      name: 'OceanFail',
      sectorId: 'sec_2_0',
    });
    expect(oceanAttempt).toEqual({ ok: false, code: 'landing_site_taken' });

    const cmdStep = step(
      state,
      [
        {
          commandId: 'cmd_spawn_w11',
          kind: 'system.spawnColony',
          colonyIndex: 9,
          source: 'system',
          args: {
            colonyId: 'col_01JTESTCOLONY000000000009',
            colonyIndex: 9,
            name: 'CmdColony',
            landingSlotId: 'slot_sec_0_-1_0',
          },
        },
      ],
      1,
      buildPipeline(['W01'], {}),
    );
    expect(cmdStep.outcomes[0]?.code).toBeUndefined();

    const hx = hexIndex(state.grid.radius);
    const slot0 = blob.safeLandingSlots.find((s) => s.slotId === 'slot_sec_1_0_2')!;
    let hasMetals = false;
    let hasMinerals = false;
    for (let dr = -6; dr <= 6; dr++) {
      for (let dq = -6; dq <= 6; dq++) {
        const d = hexDistance(0, 0, dq, dr);
        if (d < 2 || d > 6) continue;
        const idx = hx.indexOf(slot0.q + dq, slot0.r + dr);
        if (idx < 0) continue;
        if (state.grid.layers.deposit[idx] === DEPOSIT.metals) hasMetals = true;
        if (state.grid.layers.deposit[idx] === DEPOSIT.minerals) hasMinerals = true;
      }
    }
    expect(hasMetals).toBe(true);
    expect(hasMinerals).toBe(true);
  });
});

describe('W11-36 structured rejection for cross-sector, intra-sector, and sector-mismatch collisions', () => {
  it('rejects two slots placed near a shared sector boundary or 3-sector corner with cross_sector_collision', () => {
    const atlas = generateSmallAtlas({ planetType: 'desert', seed: CANONICAL_PLANETS.desert.seed });
    const slotA: SafeLandingSlotV1 = {
      slotId: 'slot_sec_0_0_0',
      sectorId: 'sec_0_0',
      slotIndex: 0,
      q: 23,
      r: -11,
    };
    const slotB: SafeLandingSlotV1 = {
      slotId: 'slot_sec_1_0_0',
      sectorId: 'sec_1_0',
      slotIndex: 0,
      q: 26,
      r: -13,
    };
    expect(globalTileToSector(slotA.q, slotA.r, 24).sectorId).toBe('sec_0_0');
    expect(globalTileToSector(slotB.q, slotB.r, 24).sectorId).toBe('sec_1_0');
    expect(hexDistance(slotA.q, slotA.r, slotB.q, slotB.r)).toBeLessThan(W11_DEFAULT_MIN_SLOT_SEPARATION);

    const report = validateAtlasLandingSites(atlas, { slots: [slotA, slotB] });
    expect(report.ok).toBe(false);
    expect(report.reason).toBe('cross_sector_collision');
    const collision = report.issues.find((i) => i.reason === 'cross_sector_collision')!;
    expect(collision).toBeDefined();
    expect(collision.slotId).toBe('slot_sec_0_0_0');
    expect(collision.otherSlotId).toBe('slot_sec_1_0_0');
    expect(collision.sectorId).toBe('sec_0_0');
    expect(collision.otherSectorId).toBe('sec_1_0');

    const landCorner = atlas.partition.cornerTriples.find((c) =>
      c.sectorIds.every((id) => atlas.landSectorIds.includes(id)),
    )!;
    expect(landCorner).toBeDefined();
    const cornerSlots: SafeLandingSlotV1[] = landCorner.tiles.map((t) => ({
      slotId: formatLandingSlotId(t.sectorId, 0),
      sectorId: t.sectorId,
      slotIndex: 0,
      q: t.q,
      r: t.r,
    }));
    const cornerReport = validateAtlasLandingSites(atlas, { slots: cornerSlots });
    expect(cornerReport.ok).toBe(false);
    expect(cornerReport.reason).toBe('cross_sector_collision');
    expect(cornerReport.issues.filter((i) => i.reason === 'cross_sector_collision')).toHaveLength(3);
  });

  it('rejects intra-sector collisions and sector ownership mismatches with structured issues', () => {
    const atlas = generateSmallAtlas({ planetType: 'temperate', seed: CANONICAL_PLANETS.temperate.seed });
    const intraA: SafeLandingSlotV1 = {
      slotId: 'slot_sec_0_0_0',
      sectorId: 'sec_0_0',
      slotIndex: 0,
      q: 0,
      r: 0,
    };
    const intraB: SafeLandingSlotV1 = {
      slotId: 'slot_sec_0_0_1',
      sectorId: 'sec_0_0',
      slotIndex: 1,
      q: 5,
      r: 0,
    };
    const intraReport = validateAtlasLandingSites(atlas, { slots: [intraA, intraB] });
    expect(intraReport.ok).toBe(false);
    expect(intraReport.reason).toBe('intra_sector_collision');

    const wrongSectorSlot: SafeLandingSlotV1 = {
      slotId: 'slot_sec_0_0_0',
      sectorId: 'sec_0_0',
      slotIndex: 0,
      q: 49,
      r: -24,
    };
    const mismatchReport = validateAtlasLandingSites(atlas, { slots: [wrongSectorSlot] });
    expect(mismatchReport.ok).toBe(false);
    expect(mismatchReport.reason).toBe('sector_mismatch');
    expect(mismatchReport.issues[0]?.otherSectorId).toBe('sec_1_0');
  });
});

describe('W11-36 structured rejection for ocean sectors and water tiles', () => {
  it('rejects slots placed in an ocean sector or on water with ocean_sector or insufficient_buildable_ground', () => {
    const atlas = generateSmallAtlas({ planetType: 'ocean', seed: CANONICAL_PLANETS.ocean.seed });

    const planOcean = planSectorLandingSites({
      sectorId: 'sec_2_0',
      kind: 'ocean',
      macroQ: 2,
      macroR: 0,
      foundingCapacity: 3,
    });
    expect(planOcean.ok).toBe(false);
    if (!planOcean.ok) {
      expect(planOcean.reason).toBe('ocean_sector');
      expect(planOcean.validatedSafeSites).toBe(0);
      expect(planOcean.safeLandingSlots).toEqual([]);
    }

    const oceanSlot: SafeLandingSlotV1 = {
      slotId: 'slot_sec_2_0_0',
      sectorId: 'sec_2_0',
      slotIndex: 0,
      q: 98,
      r: -48,
    };
    const oceanReport = validateAtlasLandingSites(atlas, { slots: [oceanSlot] });
    expect(oceanReport.ok).toBe(false);
    expect(oceanReport.reason).toBe('ocean_sector');

    const sec00 = atlas.sectorById.get('sec_0_0')!;
    const waterTile = sec00.tiles.find(
      (t) =>
        (sec00.terrain[t.localIndex] === TERRAIN.shallow || sec00.terrain[t.localIndex] === TERRAIN.deep) &&
        hexDistance(0, 0, t.localQ, t.localR) <= 20,
    );
    const badCoord = waterTile ? { q: waterTile.q, r: waterTile.r } : { q: 8, r: 0 };
    if (!waterTile) {
      const owner = atlas.partition.getTile(badCoord.q, badCoord.r)!;
      sec00.terrain[owner.localIndex] = TERRAIN.shallow;
      atlas.terrain[owner.atlasIndex] = TERRAIN.shallow;
    }

    const waterSlot: SafeLandingSlotV1 = {
      slotId: 'slot_sec_0_0_0',
      sectorId: 'sec_0_0',
      slotIndex: 0,
      q: badCoord.q,
      r: badCoord.r,
    };
    const waterReport = validateAtlasLandingSites(atlas, { slots: [waterSlot] });
    expect(waterReport.ok).toBe(false);
    expect(waterReport.reason).toBe('insufficient_buildable_ground');
    expect(waterReport.issues[0]?.slotId).toBe('slot_sec_0_0_0');
  });
});

describe('W11-36 structured rejection for missing starter resources and unachievable capacity', () => {
  it('rejects slots missing starter metals or minerals and unachievable capacities', () => {
    const atlas = generateSmallAtlas({ planetType: 'desert', seed: CANONICAL_PLANETS.desert.seed });
    const targetSlot = atlas.safeLandingSlots[0]!;

    for (let dr = -6; dr <= 6; dr++) {
      for (let dq = -6; dq <= 6; dq++) {
        if (hexDistance(0, 0, dq, dr) > 6) continue;
        const owner = atlas.partition.getTile(targetSlot.q + dq, targetSlot.r + dr);
        if (!owner) continue;
        const sec = atlas.sectorById.get(owner.sectorId)!;
        sec.deposit[owner.localIndex] = DEPOSIT.none;
        sec.richness[owner.localIndex] = 0;
        atlas.deposit[owner.atlasIndex] = DEPOSIT.none;
        atlas.richness[owner.atlasIndex] = 0;
      }
    }

    const report = validateAtlasLandingSites(atlas, { slots: [targetSlot] });
    expect(report.ok).toBe(false);
    expect(report.reason).toBe('missing_starter_resources');
    expect(report.issues[0]?.slotId).toBe(targetSlot.slotId);
    expect(report.issues[0]?.missingResources).toEqual(['metals', 'minerals']);

    expect(maxAchievableSlotsInSector(24, 14)).toBeLessThan(20);
    const sectorPlan = planSectorLandingSites({
      sectorId: 'sec_0_0',
      kind: 'land',
      macroQ: 0,
      macroR: 0,
      sectorRadius: 24,
      foundingCapacity: 20,
      minSlotSeparation: 14,
    });
    expect(sectorPlan.ok).toBe(false);
    if (!sectorPlan.ok) {
      expect(sectorPlan.reason).toBe('capacity_unachievable');
      expect(sectorPlan.validatedSafeSites).toBeLessThan(20);
    }

    const overloadedAtlas = generateSmallAtlas({
      planetType: 'temperate',
      seed: CANONICAL_PLANETS.temperate.seed,
      foundingSeatsPerSector: 20,
      skipPerfCaps: true,
    });
    expect(overloadedAtlas.landingValidation.ok).toBe(false);
    expect(overloadedAtlas.landingValidation.reason).toBe('capacity_unachievable');

    const corpusOverload = validateSeedCorpusLandingSites({
      capacities: [20],
      planetTypes: ['temperate'],
      seeds: [CANONICAL_PLANETS.temperate.seed],
    });
    expect(corpusOverload.ok).toBe(false);
    expect(corpusOverload.reason).toBe('capacity_unachievable');
    expect(corpusOverload.failedRuns).toBe(1);
  });
});
