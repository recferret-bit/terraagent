import {
  CANONICAL_PLANET_IDS,
  CANONICAL_PLANETS,
  canonicalPlanetById,
  planetLookForType,
  W11_DEFAULT_FOUNDING_SEATS_PER_SECTOR,
  W11_DEFAULT_LAND_SECTORS,
  type AtlasConfigV1,
  type AtlasManifestV1,
  type CanonicalPlanetDef,
} from '@terra/contracts';
import {
  hexCount,
  isAtlasManifestV1,
  isGeneratedSmallAtlas,
  validateAtlasRolloutLimits,
  W11_DEFAULT_ROLLOUT_LIMITS,
  type GeneratedSmallAtlas,
} from '@terra/sim';
import {
  CANONICAL_WORLDS_CAP,
  CapacityGuardError,
  getSharedCapacityMetricsState,
  incrementSharedCapacityBlocked,
  isCapacityBlockedProcessResult,
  recordCapacityBlockedForProcessResult,
  W11_DEFAULT_CLUSTER_SEAT_CAP,
  W11_DEFAULT_WORLD_SEAT_CAP,
  W11_MAX_CLUSTER_SEAT_CAP,
  W11_MAX_WORLD_SEAT_CAP,
  type CanonicalWorldIdentityInput,
  type CapacityBudgetViolation,
  type CapacityGuardErrorCode,
  type WorldProvisionBudgetInput,
  type WorldProvisionBudgetLimits,
  type WorldProvisionBudgetResult,
  type WorldProvisionBudgetSectorInput,
} from './capacity-guard.types';
import { CANONICAL_PLANET_TYPES, resolveCanonicalPlanetType } from './planets.helpers';

export {
  getSharedCapacityMetricsState,
  incrementSharedCapacityBlocked,
  isCapacityBlockedProcessResult,
  recordCapacityBlockedForProcessResult,
};

function isWarmPoolHint(value: string | undefined): boolean {
  if (!value) return false;
  const lower = value.trim().toLowerCase();
  return lower.includes('warm_pool') || lower.includes('warm-pool') || lower.includes('warmpool');
}

function isOverflowHint(value: string | undefined): boolean {
  if (!value) return false;
  const lower = value.trim().toLowerCase();
  return lower === 'overflow' || lower === 'on_demand' || lower.includes('overflow');
}

function assertCanonicalWorldIdentityString(
  raw: string,
  existingWorldIds?: readonly string[],
): CanonicalPlanetDef {
  const trimmed = raw.trim();
  if (isWarmPoolHint(trimmed)) {
    throw new CapacityGuardError(
      'warm_pool_disabled',
      `warm-pool world "${trimmed}" is disabled; only the 3 canonical worlds may exist`,
      { requested: trimmed, allowedPlanetIds: CANONICAL_PLANET_IDS },
    );
  }
  const resolvedType = resolveCanonicalPlanetType(trimmed);
  if (!resolvedType) {
    throw new CapacityGuardError(
      'non_canonical_world_forbidden',
      `non-canonical world "${trimmed}" is forbidden; only desert, ocean, and temperate canonical identities are permitted`,
      { requested: trimmed, allowedPlanetIds: CANONICAL_PLANET_IDS, allowedTypes: CANONICAL_PLANET_TYPES },
    );
  }
  const def = CANONICAL_PLANETS[resolvedType];
  if (
    existingWorldIds &&
    existingWorldIds.length >= CANONICAL_WORLDS_CAP &&
    !existingWorldIds.includes(def.id)
  ) {
    throw new CapacityGuardError(
      'non_canonical_world_forbidden',
      `cannot provision a 4th world ("${trimmed}"); canonical world cap is ${CANONICAL_WORLDS_CAP}`,
      { requested: trimmed, existingWorldIds },
    );
  }
  return def;
}

/**
 * Enforces that a world identity belongs strictly to one of the 3 canonical planets (`desert`, `ocean`, `temperate`
 * in `CANONICAL_PLANETS`) and rejects warm-pool, overflow, or 4th-world identities (`MM-42..44`).
 */
export function assertCanonicalWorldIdentity(
  input: string | CanonicalWorldIdentityInput,
  existingWorldIds?: readonly string[],
): CanonicalPlanetDef {
  if (typeof input === 'string') return assertCanonicalWorldIdentityString(input, existingWorldIds);

  const rawId = input.id?.trim() ?? input.planetId?.trim();
  const rawType = input.type?.toString().trim() ?? input.planetType?.toString().trim();
  if (
    input.warmPool === true ||
    input.isWarmPool === true ||
    isWarmPoolHint(input.source) ||
    isWarmPoolHint(rawId) ||
    isWarmPoolHint(input.name)
  ) {
    throw new CapacityGuardError(
      'warm_pool_disabled',
      'warm-pool world creation and top-up/trimming are disabled in W11 (MM-42)',
      { id: rawId, type: rawType, source: input.source },
    );
  }
  if (
    input.overflow === true ||
    input.isOverflow === true ||
    isOverflowHint(input.source) ||
    isOverflowHint(rawId) ||
    isOverflowHint(input.name) ||
    (typeof input.worldIndex === 'number' && input.worldIndex >= CANONICAL_WORLDS_CAP)
  ) {
    throw new CapacityGuardError(
      'non_canonical_world_forbidden',
      'overflow and 4th-world creation are forbidden in W11 (MM-43); full canonical worlds queue players',
      { id: rawId, type: rawType, source: input.source, worldIndex: input.worldIndex },
    );
  }

  const typeFromField = rawType ? resolveCanonicalPlanetType(rawType) : null;
  if (rawType && !typeFromField) {
    throw new CapacityGuardError(
      'non_canonical_world_forbidden',
      `non-canonical planet type "${rawType}" is forbidden; expected desert, ocean, or temperate`,
      { type: rawType, allowedTypes: CANONICAL_PLANET_TYPES },
    );
  }
  const byId = rawId
    ? (canonicalPlanetById(rawId) ??
      (resolveCanonicalPlanetType(rawId)
        ? CANONICAL_PLANETS[resolveCanonicalPlanetType(rawId)!]
        : null))
    : null;
  if (rawId && (!byId || (rawId.startsWith('pl_') && rawId !== byId.id))) {
    throw new CapacityGuardError(
      'non_canonical_world_forbidden',
      `non-canonical planet id "${rawId}" is forbidden; expected one of ${CANONICAL_PLANET_IDS.join(', ')}`,
      { id: rawId, allowedPlanetIds: CANONICAL_PLANET_IDS },
    );
  }
  const effectiveType = typeFromField ?? byId?.type ?? null;
  if (!effectiveType) {
    throw new CapacityGuardError(
      'non_canonical_world_forbidden',
      'missing canonical planet identity (id or type)',
      { input },
    );
  }
  const canonical = CANONICAL_PLANETS[effectiveType];
  if (rawId && byId && byId.id !== canonical.id) {
    throw new CapacityGuardError(
      'non_canonical_world_forbidden',
      `planet id "${rawId}" (${byId.type}) does not match canonical world for "${effectiveType}" (${canonical.id})`,
      { id: rawId, type: effectiveType, expectedId: canonical.id },
    );
  }
  if (input.look && input.look !== planetLookForType(effectiveType)) {
    throw new CapacityGuardError(
      'non_canonical_world_forbidden',
      `planet look "${input.look}" does not match canonical look "${canonical.look}" for "${effectiveType}"`,
      { type: effectiveType, look: input.look, expectedLook: canonical.look },
    );
  }
  const knownIds = input.existingWorldIds ?? existingWorldIds;
  if (knownIds && knownIds.length >= CANONICAL_WORLDS_CAP && !knownIds.includes(canonical.id)) {
    throw new CapacityGuardError(
      'non_canonical_world_forbidden',
      `cannot provision world "${canonical.id}" beyond the ${CANONICAL_WORLDS_CAP} canonical worlds`,
      { id: canonical.id, existingWorldIds: knownIds },
    );
  }
  return canonical;
}

function isBudgetTargetObject(
  input: unknown,
): input is AtlasConfigV1 | AtlasManifestV1 | GeneratedSmallAtlas {
  return (
    typeof input === 'object' &&
    input !== null &&
    'sectors' in input &&
    Array.isArray((input as { sectors?: unknown }).sectors) &&
    'sectorRadius' in input &&
    'foundingSeatsPerSector' in input
  );
}

function checkSectorSafeSiteViolations(
  sectors: readonly WorldProvisionBudgetSectorInput[],
  maxFoundingPerSector: number,
  violations: CapacityBudgetViolation[],
): void {
  for (const sec of sectors) {
    const label = sec.sectorId ?? sec.kind;
    const valSites = sec.validatedSafeSites ?? sec.validatedCapacity ?? sec.foundingCapacity;
    const slotLen = sec.safeLandingSlots?.length;
    if (sec.kind === 'ocean') {
      if (sec.foundingCapacity > 0 || valSites > 0 || (slotLen ?? 0) > 0) {
        violations.push({
          field: 'oceanSectorSafeSites',
          actual: Math.max(sec.foundingCapacity, valSites, slotLen ?? 0),
          limit: 0,
          message: `ocean sector "${label}" cannot have founding seats or safe landing sites`,
        });
      }
      continue;
    }
    if (sec.foundingCapacity > maxFoundingPerSector) {
      violations.push({
        field: 'maxFoundingSeatsPerSector',
        actual: sec.foundingCapacity,
        limit: maxFoundingPerSector,
        message: `sector "${label}" foundingCapacity (${sec.foundingCapacity}) exceeds limit (${maxFoundingPerSector})`,
      });
    }
    if (valSites > sec.foundingCapacity || valSites < 0) {
      violations.push({
        field: 'validatedSafeSitesExceedsFoundingCapacity',
        actual: valSites,
        limit: sec.foundingCapacity,
        message: `sector "${label}" validatedSafeSites (${valSites}) exceeds foundingCapacity (${sec.foundingCapacity})`,
      });
    }
    if (slotLen !== undefined && slotLen !== valSites) {
      violations.push({
        field: 'landingSlotsMismatch',
        actual: slotLen,
        limit: valSites,
        message: `sector "${label}" safeLandingSlots.length (${slotLen}) does not match validatedSafeSites (${valSites})`,
      });
    }
  }
}

function resolveBudgetBagAndRollout(
  input: WorldProvisionBudgetInput | AtlasManifestV1 | AtlasConfigV1 | GeneratedSmallAtlas,
  overrideLimits?: WorldProvisionBudgetLimits,
) {
  const isDirectTarget = isBudgetTargetObject(input);
  const bag: WorldProvisionBudgetInput = isDirectTarget
    ? {
        planetId: input.planetId,
        planetType: input.planetType,
        sectorRadius: input.sectorRadius,
        foundingSeatsPerSector: input.foundingSeatsPerSector,
        ...(isAtlasManifestV1(input) ? { manifest: input } : {}),
        ...(isGeneratedSmallAtlas(input) ? { atlas: input } : {}),
        ...(!isAtlasManifestV1(input) && !isGeneratedSmallAtlas(input)
          ? { config: input as AtlasConfigV1 }
          : {}),
      }
    : input;
  const lim = overrideLimits ?? bag.limits;
  const resolvedLimits = {
    maxSectors: lim?.maxSectors ?? W11_DEFAULT_ROLLOUT_LIMITS.maxSectors,
    maxLandSectors: lim?.maxLandSectors ?? W11_DEFAULT_ROLLOUT_LIMITS.maxLandSectors,
    maxSectorRadius: lim?.maxSectorRadius ?? W11_DEFAULT_ROLLOUT_LIMITS.maxSectorRadius,
    maxTotalTiles: lim?.maxTotalTiles ?? W11_DEFAULT_ROLLOUT_LIMITS.maxTotalTiles,
    maxFoundingSeatsPerSector:
      lim?.maxFoundingSeatsPerSector ?? W11_DEFAULT_ROLLOUT_LIMITS.maxFoundingSeatsPerSector,
    maxColonies: lim?.maxColonies ?? W11_DEFAULT_ROLLOUT_LIMITS.maxColonies,
    maxCanonicalWorlds: lim?.maxCanonicalWorlds ?? CANONICAL_WORLDS_CAP,
    defaultWorldSeatsAtX4: W11_DEFAULT_WORLD_SEAT_CAP,
    defaultClusterSeatsAtX4: W11_DEFAULT_CLUSTER_SEAT_CAP,
    maxWorldSeatsAtX5: lim?.maxValidatedSafeSitesPerWorld ?? W11_MAX_WORLD_SEAT_CAP,
    maxClusterSeatsAtX5: lim?.maxClusterSafeSites ?? W11_MAX_CLUSTER_SEAT_CAP,
  };
  const target = bag.manifest ?? bag.atlas ?? bag.config ?? (isDirectTarget ? input : undefined);
  const rollout = target ? validateAtlasRolloutLimits(target, resolvedLimits) : null;
  const sectors: readonly WorldProvisionBudgetSectorInput[] =
    bag.sectors ?? (target ? (target.sectors as readonly WorldProvisionBudgetSectorInput[]) : []);
  const totalSectors = bag.totalSectors ?? rollout?.observed.totalSectors ?? (sectors.length || 19);
  const landSectors =
    bag.landSectors ??
    rollout?.observed.landSectors ??
    (sectors.length > 0 ? sectors.filter((s) => s.kind === 'land').length : W11_DEFAULT_LAND_SECTORS);
  const oceanSectors = bag.oceanSectors ?? rollout?.observed.oceanSectors ?? Math.max(0, totalSectors - landSectors);
  const sectorRadius = bag.sectorRadius ?? rollout?.observed.sectorRadius ?? W11_DEFAULT_ROLLOUT_LIMITS.maxSectorRadius;
  const foundingSeatsPerSector =
    bag.foundingSeatsPerSector ?? rollout?.observed.foundingSeatsPerSector ?? W11_DEFAULT_FOUNDING_SEATS_PER_SECTOR;
  const totalTiles = bag.totalTiles ?? rollout?.observed.totalTiles ?? totalSectors * hexCount(sectorRadius);
  const nominalCapacity = bag.nominalCapacity ?? rollout?.observed.nominalCapacity ?? landSectors * foundingSeatsPerSector;
  const validatedSafeSites =
    bag.validatedSafeSites ??
    bag.validatedCapacity ??
    (bag.validatedSeatsPerSector !== undefined
      ? landSectors * bag.validatedSeatsPerSector
      : (rollout?.observed.validatedCapacity ?? nominalCapacity));
  const maxColonies = bag.maxColonies ?? rollout?.observed.maxColonies ?? Math.max(nominalCapacity, validatedSafeSites);
  return {
    bag,
    resolvedLimits,
    rollout,
    sectors,
    observed: {
      totalSectors,
      landSectors,
      oceanSectors,
      sectorRadius,
      totalTiles,
      foundingSeatsPerSector,
      nominalCapacity,
      validatedSafeSites,
      validatedCapacity: validatedSafeSites,
      maxColonies,
    },
  };
}

/**
 * Validates that a world provisioning config or manifest satisfies canonical identity rules,
 * small-atlas rollout caps (`validateAtlasRolloutLimits`), and safe-site budgets (`MM-42..44`, `W11-15`).
 */
export function validateWorldProvisionBudget(
  input: WorldProvisionBudgetInput | AtlasManifestV1 | AtlasConfigV1 | GeneratedSmallAtlas,
  options?: { readonly limits?: WorldProvisionBudgetLimits; readonly throwOnError?: boolean },
): WorldProvisionBudgetResult {
  const { bag, resolvedLimits, rollout, sectors, observed } = resolveBudgetBagAndRollout(
    input,
    options?.limits,
  );
  const violations: CapacityBudgetViolation[] = [];
  let identityCode: CapacityGuardErrorCode | undefined;
  let canonical: CanonicalPlanetDef | null = null;
  try {
    canonical = assertCanonicalWorldIdentity(bag, bag.existingWorldIds);
  } catch (err) {
    identityCode = err instanceof CapacityGuardError ? err.code : 'non_canonical_world_forbidden';
    violations.push({
      field: identityCode === 'warm_pool_disabled' ? 'warmPoolDisabled' : 'canonicalIdentity',
      actual: String(bag.id ?? bag.planetId ?? bag.type ?? bag.planetType ?? 'unknown'),
      limit: CANONICAL_PLANET_IDS.join('|'),
      message: err instanceof Error ? err.message : String(err),
    });
  }

  if (rollout && !rollout.ok) {
    for (const v of rollout.violations) violations.push(v);
  } else if (!rollout) {
    const pushIf = (field: CapacityBudgetViolation['field'], actual: number, limit: number) => {
      if (actual > limit) violations.push({ field, actual, limit, message: `${field} (${actual}) exceeds limit (${limit})` });
    };
    pushIf('maxSectors', observed.totalSectors, resolvedLimits.maxSectors);
    pushIf('maxLandSectors', observed.landSectors, resolvedLimits.maxLandSectors);
    pushIf('maxSectorRadius', observed.sectorRadius, resolvedLimits.maxSectorRadius);
    pushIf('maxTotalTiles', observed.totalTiles, resolvedLimits.maxTotalTiles);
    pushIf('maxColonies', observed.maxColonies, resolvedLimits.maxColonies);
    if (observed.foundingSeatsPerSector > resolvedLimits.maxFoundingSeatsPerSector || observed.foundingSeatsPerSector < 1) {
      violations.push({
        field: 'maxFoundingSeatsPerSector',
        actual: observed.foundingSeatsPerSector,
        limit: resolvedLimits.maxFoundingSeatsPerSector,
        message: `foundingSeatsPerSector (${observed.foundingSeatsPerSector}) exceeds limit (${resolvedLimits.maxFoundingSeatsPerSector})`,
      });
    }
  }

  checkSectorSafeSiteViolations(sectors, resolvedLimits.maxFoundingSeatsPerSector, violations);
  const maxWorldSeats = Math.min(
    resolvedLimits.maxWorldSeatsAtX5,
    resolvedLimits.maxLandSectors * Math.min(observed.foundingSeatsPerSector, resolvedLimits.maxFoundingSeatsPerSector),
  );
  if (observed.validatedSafeSites > observed.nominalCapacity || observed.validatedSafeSites < 0) {
    violations.push({
      field: 'validatedSafeSitesExceedsFoundingCapacity',
      actual: observed.validatedSafeSites,
      limit: observed.nominalCapacity,
      message: `validatedSafeSites (${observed.validatedSafeSites}) exceeds nominalCapacity (${observed.nominalCapacity})`,
    });
  }
  if (observed.validatedSafeSites > maxWorldSeats || observed.nominalCapacity > resolvedLimits.maxWorldSeatsAtX5) {
    violations.push({
      field: 'worldSafeSiteCap',
      actual: Math.max(observed.validatedSafeSites, observed.nominalCapacity),
      limit: maxWorldSeats,
      message: `world seat budget (${Math.max(observed.validatedSafeSites, observed.nominalCapacity)}) exceeds supported world safe-site cap (${maxWorldSeats})`,
    });
  }
  if (bag.clusterValidatedSafeSites !== undefined && bag.clusterValidatedSafeSites > resolvedLimits.maxClusterSeatsAtX5) {
    violations.push({
      field: 'clusterSafeSiteCap',
      actual: bag.clusterValidatedSafeSites,
      limit: resolvedLimits.maxClusterSeatsAtX5,
      message: `cluster safe sites (${bag.clusterValidatedSafeSites}) exceed cluster cap (${resolvedLimits.maxClusterSeatsAtX5})`,
    });
  }

  const code: CapacityGuardErrorCode | undefined =
    violations.length === 0
      ? undefined
      : (identityCode ??
        (rollout && !rollout.ok ? 'rollout_limit_exceeded' : undefined) ??
        (violations.some((v) => v.field.startsWith('max'))
          ? 'rollout_limit_exceeded'
          : 'safe_site_budget_exceeded'));
  const result: WorldProvisionBudgetResult = {
    ok: violations.length === 0,
    ...(code ? { code, reason: violations[0]?.message ?? code } : {}),
    planetId: canonical?.id ?? null,
    planetType: canonical?.type ?? null,
    limits: resolvedLimits,
    observed,
    violations,
  };
  if (!result.ok && options?.throwOnError) {
    throw new CapacityGuardError(
      result.code ?? 'rollout_limit_exceeded',
      result.violations.map((v) => v.message).join('; '),
      { planetId: result.planetId, planetType: result.planetType, violations: result.violations },
    );
  }
  return result;
}

export function assertWorldProvisionBudget(
  input: WorldProvisionBudgetInput | AtlasManifestV1 | AtlasConfigV1 | GeneratedSmallAtlas,
  limits?: WorldProvisionBudgetLimits,
): WorldProvisionBudgetResult {
  return validateWorldProvisionBudget(input, { limits, throwOnError: true });
}
