import {
  CANONICAL_PLANETS,
  SafeLandingSlotV1Schema,
  W11_SUPPORTED_FOUNDING_SEATS,
  type LandingSlotId,
  type SafeLandingSlotV1,
  type SectorId,
} from '@terra/contracts';
import { hexDistance } from '../grid/hex';
import type { PlanetType } from '../kernel/state';
import { generateSmallAtlas } from './generateAtlas';
import { maxAchievableSlotsInSector } from './landingPlan';
import { buildSlotDetails } from './landingTileCheck';
import { globalTileToSector } from './partition';
import {
  W11_DEFAULT_MIN_BUILDABLE_R4,
  W11_DEFAULT_MIN_SLOT_SEPARATION,
  W11_DEFAULT_STARTER_RESOURCE_MAX_DIST,
  W11_DEFAULT_STARTER_RESOURCE_MIN_DIST,
  type AtlasLandingValidationReport,
  type GeneratedSmallAtlas,
  type LandingSiteValidationIssue,
  type SectorLandingValidationSummary,
  type SeedCorpusEntryReport,
  type SeedCorpusValidationOptions,
  type SeedCorpusValidationReport,
  type ValidateAtlasLandingSitesOptions,
} from './types';

export * from './landingTypes';
export * from './landingPlan';
export * from './landingTileCheck';

export const W11_DEFAULT_SEED_CORPUS_BY_TYPE: Readonly<Record<PlanetType, readonly string[]>> = {
  desert: [CANONICAL_PLANETS.desert.seed, 'w11-corpus-desert-alpha'],
  ocean: [CANONICAL_PLANETS.ocean.seed, 'w11-corpus-ocean-alpha'],
  temperate: [CANONICAL_PLANETS.temperate.seed, 'w11-corpus-temperate-alpha'],
} as const;

function resolveSectorCapacityOverride(
  sectorId: SectorId,
  opts?: ValidateAtlasLandingSitesOptions,
): number | undefined {
  if (!opts?.sectorCapacities) return undefined;
  if (opts.sectorCapacities instanceof Map) return opts.sectorCapacities.get(sectorId);
  return (opts.sectorCapacities as Readonly<Record<SectorId, number>>)[sectorId];
}

function collectSlotsToValidate(
  atlas: GeneratedSmallAtlas,
  opts?: ValidateAtlasLandingSitesOptions,
): { slotsBySector: Map<SectorId, SafeLandingSlotV1[]>; allSlots: SafeLandingSlotV1[] } {
  const slotsBySector = new Map<SectorId, SafeLandingSlotV1[]>();
  for (const sec of atlas.sectors) slotsBySector.set(sec.sectorId, []);

  if (opts?.slots) {
    const allSlots = [...opts.slots];
    for (const s of allSlots) {
      const list = slotsBySector.get(s.sectorId) ?? [];
      list.push(s);
      slotsBySector.set(s.sectorId, list);
    }
    return { slotsBySector, allSlots };
  }

  const allSlots: SafeLandingSlotV1[] = [];
  const readSec = (id: SectorId): readonly SafeLandingSlotV1[] | undefined => {
    if (!opts?.sectorSlots) return undefined;
    return opts.sectorSlots instanceof Map
      ? opts.sectorSlots.get(id)
      : (opts.sectorSlots as Readonly<Record<SectorId, readonly SafeLandingSlotV1[]>>)[id];
  };
  for (const sec of atlas.sectors) {
    const list = [...(readSec(sec.sectorId) ?? sec.safeLandingSlots)];
    slotsBySector.set(sec.sectorId, list);
    allSlots.push(...list);
  }
  return { slotsBySector, allSlots };
}

function checkCapacitiesAndOwnership(
  atlas: GeneratedSmallAtlas,
  slotsBySector: ReadonlyMap<SectorId, readonly SafeLandingSlotV1[]>,
  allSlots: readonly SafeLandingSlotV1[],
  foundingSeatsPerSector: number,
  minSlotSeparation: number,
  opts: ValidateAtlasLandingSitesOptions | undefined,
  oceanIssues: LandingSiteValidationIssue[],
  mismatchIssues: LandingSiteValidationIssue[],
  capacityIssues: LandingSiteValidationIssue[],
): void {
  const maxAchievable = maxAchievableSlotsInSector(atlas.sectorRadius, minSlotSeparation);
  const checkCapacity =
    opts?.foundingSeatsPerSector !== undefined ||
    opts?.sectorCapacities !== undefined ||
    (!opts?.slots && !opts?.sectorSlots);

  for (const sec of atlas.sectors) {
    const capOverride = resolveSectorCapacityOverride(sec.sectorId, opts);
    const reqCap = capOverride ?? (sec.kind === 'land' ? foundingSeatsPerSector : sec.foundingCapacity);
    const secSlots = slotsBySector.get(sec.sectorId) ?? [];
    if (sec.kind === 'ocean') {
      if (reqCap > 0 || secSlots.length > 0) {
        oceanIssues.push({
          reason: 'ocean_sector',
          sectorId: sec.sectorId,
          slotId: secSlots[0]?.slotId,
          q: secSlots[0]?.q,
          r: secSlots[0]?.r,
          requestedCapacity: reqCap,
          achievedCapacity: 0,
          message: `ocean sector ${sec.sectorId} cannot have founding capacity or safe landing slots`,
        });
      }
    } else if ((checkCapacity && (reqCap > maxAchievable || secSlots.length < reqCap)) || secSlots.length > maxAchievable) {
      capacityIssues.push({
        reason: 'capacity_unachievable',
        sectorId: sec.sectorId,
        requestedCapacity: reqCap,
        achievedCapacity: secSlots.length,
        minRequiredDistance: minSlotSeparation,
        message: `land sector ${sec.sectorId} cannot achieve capacity ${reqCap} with separation>=${minSlotSeparation}`,
      });
    }
  }

  for (const slot of allSlots) {
    if (!SafeLandingSlotV1Schema.safeParse(slot).success) {
      mismatchIssues.push({
        reason: 'sector_mismatch',
        sectorId: slot.sectorId,
        slotId: slot.slotId,
        q: slot.q,
        r: slot.r,
        message: `invalid SafeLandingSlotV1 format for ${slot.slotId}`,
      });
      continue;
    }
    const actual = globalTileToSector(slot.q, slot.r, atlas.sectorRadius);
    const declaredSec = atlas.sectorById.get(slot.sectorId);
    const actualSec = atlas.sectorById.get(actual.sectorId);
    if (declaredSec?.kind === 'ocean' || actualSec?.kind === 'ocean') {
      if (!oceanIssues.some((i) => i.slotId === slot.slotId)) {
        oceanIssues.push({
          reason: 'ocean_sector',
          sectorId: actualSec?.kind === 'ocean' ? actual.sectorId : slot.sectorId,
          slotId: slot.slotId,
          q: slot.q,
          r: slot.r,
          message: `slot ${slot.slotId} at (${slot.q},${slot.r}) lies in ocean sector ${actual.sectorId}`,
        });
      }
    } else if (actual.sectorId !== slot.sectorId) {
      mismatchIssues.push({
        reason: 'sector_mismatch',
        sectorId: slot.sectorId,
        otherSectorId: actual.sectorId,
        slotId: slot.slotId,
        q: slot.q,
        r: slot.r,
        message: `slot ${slot.slotId} declares sector ${slot.sectorId} but tile (${slot.q},${slot.r}) belongs to ${actual.sectorId}`,
      });
    }
  }
}

function checkPairwiseSlotSeparation(
  allSlots: readonly SafeLandingSlotV1[],
  minSlotSeparation: number,
  collisionIssues: LandingSiteValidationIssue[],
): {
  minObservedSeparation: number | null;
  minObservedCrossSectorSeparation: number | null;
  minObservedIntraSectorSeparation: number | null;
  nearestBySlotId: Map<LandingSlotId, { id: LandingSlotId; sec: SectorId; dist: number }>;
} {
  let minObservedSeparation: number | null = null;
  let minObservedCrossSectorSeparation: number | null = null;
  let minObservedIntraSectorSeparation: number | null = null;
  const nearestBySlotId = new Map<LandingSlotId, { id: LandingSlotId; sec: SectorId; dist: number }>();

  for (let i = 0; i < allSlots.length; i++) {
    const a = allSlots[i]!;
    for (let j = i + 1; j < allSlots.length; j++) {
      const b = allSlots[j]!;
      const d = hexDistance(a.q, a.r, b.q, b.r);
      if (minObservedSeparation === null || d < minObservedSeparation) minObservedSeparation = d;
      const isCross = a.sectorId !== b.sectorId;
      if (isCross) {
        if (minObservedCrossSectorSeparation === null || d < minObservedCrossSectorSeparation) {
          minObservedCrossSectorSeparation = d;
        }
      } else if (minObservedIntraSectorSeparation === null || d < minObservedIntraSectorSeparation) {
        minObservedIntraSectorSeparation = d;
      }

      const prevA = nearestBySlotId.get(a.slotId);
      if (!prevA || d < prevA.dist) nearestBySlotId.set(a.slotId, { id: b.slotId, sec: b.sectorId, dist: d });
      const prevB = nearestBySlotId.get(b.slotId);
      if (!prevB || d < prevB.dist) nearestBySlotId.set(b.slotId, { id: a.slotId, sec: a.sectorId, dist: d });

      if (d < minSlotSeparation) {
        collisionIssues.push({
          reason: isCross ? 'cross_sector_collision' : 'intra_sector_collision',
          sectorId: a.sectorId,
          otherSectorId: b.sectorId,
          slotId: a.slotId,
          otherSlotId: b.slotId,
          q: a.q,
          r: a.r,
          otherQ: b.q,
          otherR: b.r,
          distance: d,
          minRequiredDistance: minSlotSeparation,
          message: `slot collision between ${a.slotId} (${a.sectorId}) and ${b.slotId} (${b.sectorId}) at distance ${d}`,
        });
      }
    }
  }

  return { minObservedSeparation, minObservedCrossSectorSeparation, minObservedIntraSectorSeparation, nearestBySlotId };
}

export function validateAtlasLandingSites(
  atlas: GeneratedSmallAtlas,
  opts?: ValidateAtlasLandingSitesOptions,
): AtlasLandingValidationReport {
  const minSlotSeparation = opts?.minSlotSeparation ?? W11_DEFAULT_MIN_SLOT_SEPARATION;
  const minBuildableR4 = opts?.minBuildableR4 ?? W11_DEFAULT_MIN_BUILDABLE_R4;
  const minResDist = opts?.starterResourceMinDist ?? W11_DEFAULT_STARTER_RESOURCE_MIN_DIST;
  const maxResDist = opts?.starterResourceMaxDist ?? W11_DEFAULT_STARTER_RESOURCE_MAX_DIST;
  const foundingSeatsPerSector = opts?.foundingSeatsPerSector ?? atlas.foundingSeatsPerSector;
  const { slotsBySector, allSlots } = collectSlotsToValidate(atlas, opts);

  const oceanIssues: LandingSiteValidationIssue[] = [];
  const mismatchIssues: LandingSiteValidationIssue[] = [];
  const capacityIssues: LandingSiteValidationIssue[] = [];
  const collisionIssues: LandingSiteValidationIssue[] = [];
  const groundIssues: LandingSiteValidationIssue[] = [];
  const resourceIssues: LandingSiteValidationIssue[] = [];

  checkCapacitiesAndOwnership(
    atlas,
    slotsBySector,
    allSlots,
    foundingSeatsPerSector,
    minSlotSeparation,
    opts,
    oceanIssues,
    mismatchIssues,
    capacityIssues,
  );
  const sep = checkPairwiseSlotSeparation(allSlots, minSlotSeparation, collisionIssues);
  const { slotDetails, detailsBySector } = buildSlotDetails(
    atlas,
    allSlots,
    minBuildableR4,
    minResDist,
    maxResDist,
    sep.nearestBySlotId,
    groundIssues,
    resourceIssues,
  );

  const issues: LandingSiteValidationIssue[] = [
    ...oceanIssues,
    ...mismatchIssues,
    ...capacityIssues,
    ...collisionIssues,
    ...groundIssues,
    ...resourceIssues,
  ];

  const sectors: SectorLandingValidationSummary[] = atlas.sectors.map((sec) => {
    const secSlots = slotsBySector.get(sec.sectorId) ?? [];
    const secIssues = issues.filter((i) => i.sectorId === sec.sectorId || i.otherSectorId === sec.sectorId);
    const fCap = resolveSectorCapacityOverride(sec.sectorId, opts) ?? (sec.kind === 'land' ? foundingSeatsPerSector : 0);
    return {
      sectorId: sec.sectorId,
      kind: sec.kind,
      foundingCapacity: fCap,
      validatedSafeSites: secIssues.length === 0 ? secSlots.length : 0,
      safeLandingSlots: secSlots,
      slotDetails: detailsBySector.get(sec.sectorId) ?? [],
      ok: secIssues.length === 0,
      ...(secIssues[0] ? { reason: secIssues[0].reason } : {}),
      issues: secIssues,
    };
  });

  return {
    ok: issues.length === 0,
    ...(issues[0] ? { reason: issues[0].reason } : {}),
    planetId: atlas.planetId,
    planetType: atlas.planetType,
    seed: atlas.seed,
    sectorRadius: atlas.sectorRadius,
    foundingSeatsPerSector,
    nominalCapacity: sectors.reduce((sum, s) => sum + s.foundingCapacity, 0),
    validatedCapacity: issues.length === 0 ? allSlots.length : sectors.reduce((sum, s) => sum + s.validatedSafeSites, 0),
    minSlotSeparation,
    minBuildableR4,
    minObservedSeparation: sep.minObservedSeparation,
    minObservedCrossSectorSeparation: sep.minObservedCrossSectorSeparation,
    minObservedIntraSectorSeparation: sep.minObservedIntraSectorSeparation,
    safeLandingSlots: allSlots,
    slotDetails,
    sectors,
    issues,
  };
}

export function validateSeedCorpusLandingSites(opts?: SeedCorpusValidationOptions): SeedCorpusValidationReport {
  const capacities = opts?.capacities ?? W11_SUPPORTED_FOUNDING_SEATS;
  const planetTypes: readonly PlanetType[] = opts?.planetTypes ?? ['desert', 'ocean', 'temperate'];
  const entries: SeedCorpusEntryReport[] = [];
  const failures: SeedCorpusEntryReport[] = [];
  let minSep: number | null = null;
  let minCrossSep: number | null = null;
  let minIntraSep: number | null = null;

  for (const planetType of planetTypes) {
    const seeds = opts?.seeds ?? W11_DEFAULT_SEED_CORPUS_BY_TYPE[planetType];
    for (const seed of seeds) {
      for (const cap of capacities) {
        const atlas = generateSmallAtlas({ planetType, seed, foundingSeatsPerSector: cap });
        const v = validateAtlasLandingSites(atlas, {
          foundingSeatsPerSector: cap,
          minSlotSeparation: opts?.minSlotSeparation,
          minBuildableR4: opts?.minBuildableR4,
        });
        if (v.minObservedSeparation !== null && (minSep === null || v.minObservedSeparation < minSep)) minSep = v.minObservedSeparation;
        if (v.minObservedCrossSectorSeparation !== null && (minCrossSep === null || v.minObservedCrossSectorSeparation < minCrossSep)) {
          minCrossSep = v.minObservedCrossSectorSeparation;
        }
        if (v.minObservedIntraSectorSeparation !== null && (minIntraSep === null || v.minObservedIntraSectorSeparation < minIntraSep)) {
          minIntraSep = v.minObservedIntraSectorSeparation;
        }
        const entry: SeedCorpusEntryReport = {
          planetType,
          seed,
          foundingSeatsPerSector: cap,
          nominalCapacity: v.nominalCapacity,
          validatedCapacity: v.validatedCapacity,
          validation: v,
        };
        entries.push(entry);
        if (!v.ok) failures.push(entry);
      }
    }
  }

  return {
    ok: failures.length === 0,
    ...(failures[0]?.validation.reason ? { reason: failures[0].validation.reason } : {}),
    totalRuns: entries.length,
    passedRuns: entries.length - failures.length,
    failedRuns: failures.length,
    capacities: [...capacities],
    planetTypes: [...planetTypes],
    minObservedSeparation: minSep,
    minObservedCrossSectorSeparation: minCrossSep,
    minObservedIntraSectorSeparation: minIntraSep,
    entries,
    failures,
  };
}
