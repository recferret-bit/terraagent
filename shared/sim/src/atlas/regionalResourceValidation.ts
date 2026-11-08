import type {
  PlanetType,
  ResourceKey,
  SectorId,
  SectorKind,
} from '@terra/contracts';
import { hashAtlasCanonicalJson } from './manifestHash';
import {
  CANONICAL_RESOURCE_KEYS,
  ESSENTIAL_T1_STARTER_DEPOSIT_KEYS,
  isT1StarterEligibleResource,
  isT3Resource,
} from './regionalResourcePresets';
import type {
  RegionalResourceEntry,
  RegionalResourceLayerPatch,
  RegionalResourceResolutionConfig,
  RegionalResourceSourceLayer,
  RegionalResourceValidationIssue,
  RegionalResourceValidationReport,
  RegionalScopeBindingInput,
  ResolvedResourceEntry,
  ResolvedSectorResourceProfile,
  W13RegionProfileSnapshotInput,
  W13RegionResourceRowInput,
} from './regionalResourceTypes';

export function computeExpectedRecoverableOutput(entry: RegionalResourceEntry): number {
  if (entry.occurrenceWeightBp <= 0 || entry.extractionYieldBp <= 0) return 0;
  const meanReserve = Math.max(0, (entry.reserveUnitsMin + entry.reserveUnitsMax) * 0.5);
  const renewableEquivalent = Math.max(0, entry.renewableUnitsPerSimHour * 4);
  const yieldFactor = entry.extractionYieldBp / 10000;
  return Number(
    ((entry.occurrenceWeightBp * (meanReserve + renewableEquivalent) * yieldFactor) / 1000).toFixed(4),
  );
}

export function deriveMainResourceFromEntries(
  entries: Readonly<Record<ResourceKey, ResolvedResourceEntry>>,
): ResourceKey {
  let bestKey: ResourceKey = CANONICAL_RESOURCE_KEYS[0]!;
  let bestOutput = -1;
  let bestWeight = -1;
  for (const key of CANONICAL_RESOURCE_KEYS) {
    const r = entries[key];
    if (
      r.expectedRecoverableOutput > bestOutput ||
      (r.expectedRecoverableOutput === bestOutput && r.occurrenceWeightBp > bestWeight)
    ) {
      bestKey = key;
      bestOutput = r.expectedRecoverableOutput;
      bestWeight = r.occurrenceWeightBp;
    }
  }
  return bestKey;
}

export function deriveScarceResourcesFromEntries(
  entries: Readonly<Record<ResourceKey, ResolvedResourceEntry>>,
  mainResource: ResourceKey,
): ResourceKey[] {
  const candidates = CANONICAL_RESOURCE_KEYS.filter((k) => k !== mainResource);
  const lowWeight = candidates.filter((k) => entries[k].occurrenceWeightBp <= 35);
  const pool = lowWeight.length > 0 ? lowWeight : candidates.filter((k) => entries[k].occurrenceWeightBp <= 60);
  return [...pool]
    .sort((a, b) => {
      const wa = entries[a].occurrenceWeightBp;
      const wb = entries[b].occurrenceWeightBp;
      if (wa !== wb) return wa - wb;
      const oa = entries[a].expectedRecoverableOutput;
      const ob = entries[b].expectedRecoverableOutput;
      if (oa !== ob) return oa - ob;
      return CANONICAL_RESOURCE_KEYS.indexOf(a) - CANONICAL_RESOURCE_KEYS.indexOf(b);
    })
    .slice(0, 6);
}

const NUMERIC_RESOURCE_FIELDS = [
  'occurrenceWeightBp',
  'reserveUnitsMin',
  'reserveUnitsMax',
  'extractionYieldBp',
  'renewableUnitsPerSimHour',
  'terraformFindWeightBp',
] as const;

function validateSingleResourceEntry(
  sectorId: SectorId,
  key: ResourceKey,
  entry: ResolvedResourceEntry,
  issues: RegionalResourceValidationIssue[],
): void {
  for (const numField of NUMERIC_RESOURCE_FIELDS) {
    const val = entry[numField];
    if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) {
      issues.push({
        code: 'invalid_resource_field',
        sectorId,
        resourceKey: key,
        field: numField,
        message: `resource ${key} field ${numField} (${val}) must be a non-negative finite number`,
      });
    }
  }
  if (entry.reserveUnitsMin > entry.reserveUnitsMax) {
    issues.push({
      code: 'invalid_reserve_range',
      sectorId,
      resourceKey: key,
      field: 'reserveUnitsMin',
      message: `resource ${key} reserveUnitsMin (${entry.reserveUnitsMin}) exceeds reserveUnitsMax (${entry.reserveUnitsMax})`,
    });
  }
  if (!entry.starterGuarantee) return;
  if (isT3Resource(key)) {
    issues.push({
      code: 't3_starter_guarantee_forbidden',
      sectorId,
      resourceKey: key,
      field: 'starterGuarantee',
      message: `T3 resource ${key} cannot have starterGuarantee=true (no T3 starter giveaway allowed)`,
    });
  } else if (!isT1StarterEligibleResource(key)) {
    issues.push({
      code: 'non_t1_starter_guarantee_forbidden',
      sectorId,
      resourceKey: key,
      field: 'starterGuarantee',
      message: `non-T1 resource ${key} cannot have starterGuarantee=true`,
    });
  } else if (
    entry.occurrenceWeightBp <= 0 ||
    entry.extractionYieldBp <= 0 ||
    (entry.reserveUnitsMax <= 0 && entry.renewableUnitsPerSimHour <= 0)
  ) {
    issues.push({
      code: 'contradictory_starter_guarantee',
      sectorId,
      resourceKey: key,
      field: 'starterGuarantee',
      message: `resource ${key} has starterGuarantee=true with zero weight or recoverable supply`,
    });
  }
}

export function validateSectorResourceProfile(
  profile: ResolvedSectorResourceProfile,
  opts?: { readonly requireLandStarterGuarantees?: boolean },
): RegionalResourceValidationReport {
  const issues: RegionalResourceValidationIssue[] = [];
  const sectorId = profile.sectorId;

  if (!Number.isFinite(profile.depositDensityPer1000Tiles) || profile.depositDensityPer1000Tiles < 0) {
    issues.push({
      code: 'invalid_deposit_density',
      sectorId,
      field: 'depositDensityPer1000Tiles',
      message: `sector ${sectorId} depositDensityPer1000Tiles must be a non-negative finite number`,
    });
  }
  for (const key of CANONICAL_RESOURCE_KEYS) {
    validateSingleResourceEntry(sectorId, key, profile.resources[key], issues);
  }
  if (profile.kind === 'land' && (opts?.requireLandStarterGuarantees ?? true)) {
    for (const reqKey of ESSENTIAL_T1_STARTER_DEPOSIT_KEYS) {
      if (!profile.resources[reqKey].starterGuarantee) {
        issues.push({
          code: 'missing_essential_starter_guarantee',
          sectorId,
          resourceKey: reqKey,
          field: 'starterGuarantee',
          message: `land sector ${sectorId} must preserve starterGuarantee=true for essential T1 resource ${reqKey}`,
        });
      }
    }
  }

  const maxOutput = Math.max(...CANONICAL_RESOURCE_KEYS.map((k) => profile.resources[k].expectedRecoverableOutput));
  const maxWeight = Math.max(...CANONICAL_RESOURCE_KEYS.map((k) => profile.resources[k].occurrenceWeightBp));
  const mainEntry = profile.resources[profile.mainResource];
  if (!mainEntry || (maxWeight > 0 && (mainEntry.occurrenceWeightBp <= 0 || mainEntry.expectedRecoverableOutput <= 0))) {
    issues.push({
      code: 'contradictory_main_resource',
      sectorId,
      resourceKey: profile.mainResource,
      field: 'mainResource',
      message: `sector ${sectorId} mainResource ${profile.mainResource} has zero weight or zero recoverable output`,
    });
  } else if (maxOutput > 0 && mainEntry.expectedRecoverableOutput < maxOutput && mainEntry.occurrenceWeightBp < maxWeight) {
    issues.push({
      code: 'main_resource_mismatch',
      sectorId,
      resourceKey: profile.mainResource,
      field: 'mainResource',
      message: `sector ${sectorId} mainResource ${profile.mainResource} does not match top expected recoverable output or top abundance weight`,
    });
  }
  if (profile.scarceResources.includes(profile.mainResource)) {
    issues.push({
      code: 'contradictory_scarce_resource',
      sectorId,
      resourceKey: profile.mainResource,
      field: 'scarceResources',
      message: `sector ${sectorId} cannot list mainResource ${profile.mainResource} inside scarceResources`,
    });
  }
  return issues.length > 0 ? { ok: false, code: issues[0]!.code, issues } : { ok: true, issues: [] };
}

export function computeSectorResourceHash(params: {
  readonly profileId: string;
  readonly planetId: string;
  readonly planetType: PlanetType;
  readonly topologyVersion: number;
  readonly genVersion: number;
  readonly sectorId: SectorId;
  readonly kind: SectorKind;
  readonly archetype?: string;
  readonly sourceLayer: RegionalResourceSourceLayer;
  readonly depositDensityPer1000Tiles: number;
  readonly mainResource: ResourceKey;
  readonly scarceResources: readonly ResourceKey[];
  readonly resources: Readonly<Record<ResourceKey, RegionalResourceEntry>>;
  readonly sourceAttribution: Readonly<Record<ResourceKey, RegionalResourceSourceLayer>>;
}): string {
  const compactResources: Record<string, RegionalResourceEntry> = {};
  for (const key of CANONICAL_RESOURCE_KEYS) {
    const r = params.resources[key];
    compactResources[key] = {
      occurrenceWeightBp: r.occurrenceWeightBp,
      reserveUnitsMin: r.reserveUnitsMin,
      reserveUnitsMax: r.reserveUnitsMax,
      extractionYieldBp: r.extractionYieldBp,
      renewableUnitsPerSimHour: r.renewableUnitsPerSimHour,
      terraformFindWeightBp: r.terraformFindWeightBp,
      starterGuarantee: r.starterGuarantee,
    };
  }
  return hashAtlasCanonicalJson({
    profileId: params.profileId,
    planetId: params.planetId,
    planetType: params.planetType,
    topologyVersion: params.topologyVersion,
    genVersion: params.genVersion,
    sectorId: params.sectorId,
    kind: params.kind,
    ...(params.archetype ? { archetype: params.archetype } : {}),
    sourceLayer: params.sourceLayer,
    depositDensityPer1000Tiles: params.depositDensityPer1000Tiles,
    mainResource: params.mainResource,
    scarceResources: [...params.scarceResources],
    sourceAttribution: params.sourceAttribution,
    resources: compactResources,
  });
}

/**
 * Converts a `ResolvedSectorResourceProfile` into a pure-TS snapshot for W13's future
 * `economy.region_profile` and `economy.region_resource` database resolver (`ECONOMY.md` §5).
 */
export function toW13RegionProfileSnapshotInput(
  profile: ResolvedSectorResourceProfile,
): W13RegionProfileSnapshotInput {
  const rows: W13RegionResourceRowInput[] = CANONICAL_RESOURCE_KEYS.map((key) => {
    const r = profile.resources[key];
    return {
      regionProfileId: profile.profileId,
      resourceKey: key,
      sourceLayer: r.sourceLayer,
      occurrenceWeightBp: r.occurrenceWeightBp,
      reserveUnitsMin: r.reserveUnitsMin,
      reserveUnitsMax: r.reserveUnitsMax,
      extractionYieldBp: r.extractionYieldBp,
      renewableUnitsPerSimHour: r.renewableUnitsPerSimHour,
      terraformFindWeightBp: r.terraformFindWeightBp,
      starterGuarantee: r.starterGuarantee,
    };
  });

  return {
    regionProfileId: profile.profileId,
    planetId: profile.planetId,
    planetType: profile.planetType,
    sectorId: profile.sectorId,
    kind: profile.kind,
    ...(profile.archetype ? { sectorArchetype: profile.archetype } : {}),
    depositDensityPer1000Tiles: profile.depositDensityPer1000Tiles,
    resourceMapHash: profile.sectorResourceHash,
    endowmentHash: profile.endowmentHash,
    mainResource: profile.mainResource,
    scarceResources: [...profile.scarceResources],
    sourceLayer: profile.sourceLayer,
    sourceAttribution: { ...profile.sourceAttribution },
    rows,
  };
}

/**
 * Builds a `RegionalResourceResolutionConfig` from W13-compatible `RegionalScopeBindingInput` rows
 * without any runtime database dependency in `@terra/sim`.
 */
export function buildRegionalConfigFromScopeBindings(
  bindings: readonly RegionalScopeBindingInput[],
  profilesById: Readonly<Record<string, RegionalResourceLayerPatch>>,
): RegionalResourceResolutionConfig {
  let globalDefault: RegionalResourceLayerPatch | undefined;
  const planetTypePresets: Partial<Record<PlanetType, RegionalResourceLayerPatch>> = {};
  const planetIdOverrides: Record<string, RegionalResourceLayerPatch> = {};
  const sectorArchetypeOverrides: Record<string, RegionalResourceLayerPatch> = {};
  const sectorIdOverrides: Record<SectorId, RegionalResourceLayerPatch> = {};

  const sorted = [...bindings].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  for (const b of sorted) {
    const patch = profilesById[b.regionProfileId];
    if (!patch) continue;
    const tagged: RegionalResourceLayerPatch = { ...patch, profileId: patch.profileId ?? b.regionProfileId };
    if (b.scopeKind === 'global_default') globalDefault = tagged;
    else if (b.scopeKind === 'planet_type' && b.planetType) planetTypePresets[b.planetType] = tagged;
    else if (b.scopeKind === 'planet_id' && b.planetId) planetIdOverrides[b.planetId] = tagged;
    else if (b.scopeKind === 'sector_archetype' && b.sectorArchetype) {
      sectorArchetypeOverrides[b.sectorArchetype] = tagged;
    } else if (b.scopeKind === 'sector_id' && b.sectorId) sectorIdOverrides[b.sectorId] = tagged;
  }

  return {
    ...(globalDefault ? { globalDefault } : {}),
    planetTypePresets,
    planetIdOverrides,
    sectorArchetypeOverrides,
    sectorIdOverrides,
    namedProfiles: { ...profilesById },
  };
}
