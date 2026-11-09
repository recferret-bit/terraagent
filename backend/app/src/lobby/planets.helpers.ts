import {
  CANONICAL_PLANETS,
  canonicalPlanetById,
  deriveSectorOccupancy,
  deriveWorldAvailability,
  planetLookForType,
  type PlanetLook,
  type PlanetSummary,
  type PlanetSummaryV1,
  type PlanetType,
  type PublicColonySummaryV1,
  type PublicPlanetStatsV1,
  type SectorId,
  type SectorSummaryV1,
  type WorldAdmissionState,
  type WorldAvailability,
  type WorldHealthState,
  type WorldLifecycleState,
} from '@terra/contracts';
import { DEV_PLANET_RADIUS } from '@terra/sim';
import type { ColonyRecord, PlanetRecord } from '../core/home/home.store';
import { buildDefaultCanonicalAtlasManifest } from './atlas-manifest.helper';
import type {
  CanonicalWorldRecord,
  PlanetSectorRecord,
  SectorReservationRecord,
} from './lobby-persistence.types';

export const CANONICAL_PLANET_TYPES: readonly PlanetType[] = ['desert', 'ocean', 'temperate'] as const;

const SLUG_ALIAS_TO_TYPE: Readonly<Record<string, PlanetType>> = {
  desert: 'desert',
  ocean: 'ocean',
  temperate: 'temperate',
  planet_desert_prime: 'desert',
  planet_ocean_prime: 'ocean',
  planet_temperate_prime: 'temperate',
  [CANONICAL_PLANETS.desert.id]: 'desert',
  [CANONICAL_PLANETS.ocean.id]: 'ocean',
  [CANONICAL_PLANETS.temperate.id]: 'temperate',
};

export interface SectorLiveCountsInput {
  readonly livingColonies?: number | null;
  readonly presentColonies?: number | null;
  readonly onlinePlayers?: number | null;
}

export interface PlanetLiveCountsInput extends SectorLiveCountsInput {
  readonly sectors?: Readonly<Record<string, SectorLiveCountsInput>>;
}

export interface PublicStatsLiveCountsInput {
  readonly coloniesAlive?: number | null;
  readonly playersOnline?: number | null;
}

export interface PlanetLiveTelemetryProvider {
  getPlanetLiveCounts?(
    planetId: string,
    type: PlanetType,
  ): PlanetLiveCountsInput | Promise<PlanetLiveCountsInput | null> | null;
  getPublicStatsLiveCounts?():
    | PublicStatsLiveCountsInput
    | Promise<PublicStatsLiveCountsInput | null>
    | null;
}

export interface PlanetSectorsResponseV1 {
  readonly planetId: string;
  readonly type: PlanetType;
  readonly look: PlanetLook;
  readonly lifecycle: WorldLifecycleState;
  readonly health: WorldHealthState;
  readonly admission: WorldAdmissionState;
  readonly availability: WorldAvailability;
  readonly atlasVersion: number;
  readonly atlasHash: string;
  readonly configHash: string;
  readonly totalSectors: number;
  readonly landSectors: number;
  readonly oceanSectors: number;
  readonly nominalCapacity: number;
  readonly validatedCapacity: number;
  readonly reservedSeats: number;
  readonly foundedSeats: number;
  readonly freeSeats: number;
  readonly updatedAt: string;
  readonly sectors: SectorSummaryV1[];
}

export interface BuildPlanetSummaryOptions {
  readonly world: CanonicalWorldRecord | null;
  readonly sectors: readonly PlanetSectorRecord[];
  readonly fallbackPlanetId: string;
  readonly fallbackType: PlanetType;
  readonly planetRecord?: PlanetRecord | null;
  readonly reservations?: readonly SectorReservationRecord[];
  readonly repoColonies?: readonly ColonyRecord[];
  readonly planetLiveCounts?: PlanetLiveCountsInput | null;
  readonly sectorLiveCounts?: ReadonlyMap<string, SectorLiveCountsInput>;
}

/**
 * Resolves a canonical planet type from a canonical ID (`pl_01J...`), planet type (`desert` | `ocean` | `temperate`),
 * or canonical slug alias (`planet_desert_prime` | `planet_ocean_prime` | `planet_temperate_prime`).
 */
export function resolveCanonicalPlanetType(idOrType: string): PlanetType | null {
  const key = idOrType.trim();
  if (!key) return null;
  const direct = SLUG_ALIAS_TO_TYPE[key] ?? SLUG_ALIAS_TO_TYPE[key.toLowerCase()];
  if (direct) return direct;
  const byId = canonicalPlanetById(key);
  return byId ? byId.type : null;
}

function resolveSectorCounts(
  sec: Pick<
    PlanetSectorRecord,
    'sectorId' | 'kind' | 'foundingCapacity' | 'validatedCapacity' | 'reservedSeats' | 'foundedSeats'
  >,
  reservations: readonly SectorReservationRecord[],
  repoColonies: readonly ColonyRecord[],
): {
  readonly foundingCapacity: number;
  readonly validatedCapacity: number;
  readonly reservedSeats: number;
  readonly foundedSeats: number;
  readonly derivedLiving: number | null;
} {
  if (sec.kind === 'ocean') {
    return {
      foundingCapacity: 0,
      validatedCapacity: 0,
      reservedSeats: 0,
      foundedSeats: 0,
      derivedLiving: null,
    };
  }
  const foundingCapacity = sec.foundingCapacity;
  const validatedCapacity = Math.min(sec.foundingCapacity, sec.validatedCapacity);
  const heldInSec = reservations.filter((r) => r.sectorId === sec.sectorId && r.state === 'HELD');
  const committedInSec = reservations.filter(
    (r) => r.sectorId === sec.sectorId && r.state === 'COMMITTED',
  );
  const heldColonyIds = new Set(heldInSec.map((r) => r.colonyId));
  const repoInSec = repoColonies.filter(
    (c) => (c.foundingSectorId ?? 'sec_0_0') === sec.sectorId && !heldColonyIds.has(c.id),
  );

  const foundedColonyIds = new Set<string>([
    ...committedInSec.map((r) => r.colonyId),
    ...repoInSec.map((c) => c.id),
  ]);
  const foundedSeats = Math.min(validatedCapacity, Math.max(sec.foundedSeats, foundedColonyIds.size));
  const reservedSeats = Math.min(
    Math.max(0, validatedCapacity - foundedSeats),
    Math.max(sec.reservedSeats, heldInSec.length),
  );

  if (foundedSeats === 0) {
    return { foundingCapacity, validatedCapacity, reservedSeats, foundedSeats, derivedLiving: null };
  }
  const inactiveRepoIds = new Set(
    repoInSec
      .filter((c) => c.status !== 'ACTIVE' && c.status !== 'ALIVE' && c.status !== 'FOUNDING')
      .map((c) => c.id),
  );
  const derivedLiving = Math.max(0, foundedSeats - inactiveRepoIds.size);
  return { foundingCapacity, validatedCapacity, reservedSeats, foundedSeats, derivedLiving };
}

export function buildSectorSummaryV1(
  worldState: {
    readonly lifecycle: WorldLifecycleState;
    readonly health: WorldHealthState;
    readonly admission: WorldAdmissionState;
  },
  sec: Pick<
    PlanetSectorRecord,
    | 'sectorId'
    | 'continentId'
    | 'macroQ'
    | 'macroR'
    | 'centerQ'
    | 'centerR'
    | 'kind'
    | 'foundingCapacity'
    | 'validatedCapacity'
    | 'reservedSeats'
    | 'foundedSeats'
    | 'mainResource'
    | 'scarceResources'
  >,
  reservations: readonly SectorReservationRecord[] = [],
  repoColonies: readonly ColonyRecord[] = [],
  liveOverride?: SectorLiveCountsInput | null,
): SectorSummaryV1 {
  const counts = resolveSectorCounts(sec, reservations, repoColonies);
  const livingColonies =
    liveOverride && 'livingColonies' in liveOverride
      ? (liveOverride.livingColonies ?? null)
      : counts.derivedLiving;
  const presentColonies =
    liveOverride && 'presentColonies' in liveOverride
      ? (liveOverride.presentColonies ?? null)
      : livingColonies;
  const onlinePlayers =
    liveOverride && 'onlinePlayers' in liveOverride ? (liveOverride.onlinePlayers ?? null) : null;

  const occ = deriveSectorOccupancy({
    kind: sec.kind,
    foundingCapacity: counts.foundingCapacity,
    validatedCapacity: counts.validatedCapacity,
    reservedSeats: counts.reservedSeats,
    foundedSeats: counts.foundedSeats,
    livingColonies,
    presentColonies,
    onlinePlayers,
    lifecycle: worldState.lifecycle,
    health: worldState.health,
    admission: worldState.admission,
  });

  return {
    sectorId: sec.sectorId,
    continentId: sec.continentId,
    macroQ: sec.macroQ,
    macroR: sec.macroR,
    centerQ: sec.centerQ,
    centerR: sec.centerR,
    kind: sec.kind,
    foundingCapacity: counts.foundingCapacity,
    validatedCapacity: counts.validatedCapacity,
    reservedSeats: counts.reservedSeats,
    foundedSeats: counts.foundedSeats,
    freeSeats: occ.freeSeats,
    livingColonies,
    presentColonies,
    onlinePlayers,
    availability: occ.availability,
    ...(sec.mainResource ? { mainResource: sec.mainResource } : {}),
    ...(sec.scarceResources ? { scarceResources: [...sec.scarceResources] } : {}),
  };
}

function buildPublicColoniesList(
  reservations: readonly SectorReservationRecord[],
  repoColonies: readonly ColonyRecord[],
): PublicColonySummaryV1[] {
  const byId = new Map<string, PublicColonySummaryV1>();
  for (const col of repoColonies) {
    byId.set(col.id, {
      colonyId: col.id,
      displayName: col.name,
      foundingSectorId: col.foundingSectorId ?? 'sec_0_0',
      foundedAt: col.createdAt.toISOString(),
    });
  }
  for (const res of reservations) {
    if (res.state !== 'COMMITTED' || byId.has(res.colonyId)) continue;
    byId.set(res.colonyId, {
      colonyId: res.colonyId,
      displayName: `Colony-${res.playerId.slice(-4)}`,
      foundingSectorId: res.sectorId,
      foundedAt: res.createdAt.toISOString(),
    });
  }
  return [...byId.values()];
}

function resolvePlanetAggregateLiveCounts(
  effectiveSectors: readonly SectorSummaryV1[],
  foundedSeats: number,
  planetLive?: PlanetLiveCountsInput | null,
): {
  readonly livingColonies: number | null;
  readonly presentColonies: number | null;
  readonly onlinePlayers: number | null;
} {
  const sectorLivingKnown = effectiveSectors.some((s) => s.livingColonies !== null);
  const sectorPresentKnown = effectiveSectors.some((s) => s.presentColonies !== null);
  const sectorOnlineKnown = effectiveSectors.some((s) => s.onlinePlayers !== null);

  const sumSectorLiving = effectiveSectors.reduce((sum, s) => sum + (s.livingColonies ?? 0), 0);
  const sumSectorPresent = effectiveSectors.reduce((sum, s) => sum + (s.presentColonies ?? 0), 0);
  const sumSectorOnline = effectiveSectors.reduce((sum, s) => sum + (s.onlinePlayers ?? 0), 0);

  const defaultLiving = sectorLivingKnown ? sumSectorLiving : foundedSeats > 0 ? foundedSeats : null;
  const defaultPresent = sectorPresentKnown ? sumSectorPresent : defaultLiving;
  const defaultOnline = sectorOnlineKnown ? sumSectorOnline : null;

  return {
    livingColonies:
      planetLive && 'livingColonies' in planetLive
        ? (planetLive.livingColonies ?? null)
        : defaultLiving,
    presentColonies:
      planetLive && 'presentColonies' in planetLive
        ? (planetLive.presentColonies ?? null)
        : defaultPresent,
    onlinePlayers:
      planetLive && 'onlinePlayers' in planetLive ? (planetLive.onlinePlayers ?? null) : defaultOnline,
  };
}

type SourceSectorItem = Pick<
  PlanetSectorRecord,
  | 'sectorId'
  | 'continentId'
  | 'macroQ'
  | 'macroR'
  | 'centerQ'
  | 'centerR'
  | 'kind'
  | 'foundingCapacity'
  | 'validatedCapacity'
  | 'reservedSeats'
  | 'foundedSeats'
  | 'mainResource'
  | 'scarceResources'
>;

function resolveSourceSectors(
  type: PlanetType,
  sectors: readonly PlanetSectorRecord[],
): readonly SourceSectorItem[] {
  if (sectors.length > 0) return sectors;
  return buildDefaultCanonicalAtlasManifest(type).sectors.map((mSec) => ({
    sectorId: mSec.sectorId,
    continentId: mSec.continentId,
    macroQ: mSec.macroQ,
    macroR: mSec.macroR,
    centerQ: mSec.centerQ,
    centerR: mSec.centerR,
    kind: mSec.kind,
    foundingCapacity: mSec.kind === 'ocean' ? 0 : mSec.foundingCapacity,
    validatedCapacity: mSec.kind === 'ocean' ? 0 : mSec.validatedSafeSites,
    reservedSeats: 0,
    foundedSeats: 0,
    mainResource: mSec.resourceEndowment?.mainResource,
    scarceResources: mSec.resourceEndowment?.scarceResources,
  }));
}

/**
 * Builds a canonical planet summary object that satisfies both `PlanetSummaryV1Schema` and `PlanetSummary`.
 */
export function buildCanonicalPlanetSummaryV1(
  options: BuildPlanetSummaryOptions,
): PlanetSummaryV1 & PlanetSummary {
  const {
    world,
    sectors,
    fallbackPlanetId,
    fallbackType,
    planetRecord,
    reservations = [],
    repoColonies = [],
    planetLiveCounts,
    sectorLiveCounts,
  } = options;

  const canonicalDef = canonicalPlanetById(fallbackPlanetId) ?? CANONICAL_PLANETS[fallbackType];
  const type = world?.type ?? planetRecord?.type ?? canonicalDef.type;
  const isEndedRecord =
    planetRecord?.status === 'ENDED' ||
    planetRecord?.status === 'PLANET_ENDED' ||
    planetRecord?.state === 'ENDED' ||
    planetRecord?.state === 'PLANET_ENDED';
  const lifecycle: WorldLifecycleState = isEndedRecord ? 'ARCHIVED' : (world?.lifecycle ?? 'ACTIVE');
  const health: WorldHealthState = world?.health ?? 'OK';
  const admission: WorldAdmissionState = isEndedRecord ? 'ARCHIVED' : (world?.admission ?? 'OPEN');
  const worldState = { lifecycle, health, admission };

  const effectiveSectors: SectorSummaryV1[] = resolveSourceSectors(type, sectors).map((sec) => {
    const secLive =
      sectorLiveCounts?.get(sec.sectorId) ?? planetLiveCounts?.sectors?.[sec.sectorId] ?? null;
    return buildSectorSummaryV1(worldState, sec, reservations, repoColonies, secLive);
  });

  const landSectors = effectiveSectors.filter((s) => s.kind === 'land');
  const oceanSectors = effectiveSectors.filter((s) => s.kind === 'ocean');
  const nominalCapacity = landSectors.reduce((sum, s) => sum + s.foundingCapacity, 0);
  const validatedCapacity = landSectors.reduce((sum, s) => sum + s.validatedCapacity, 0);
  const reservedSeats = landSectors.reduce((sum, s) => sum + s.reservedSeats, 0);
  const foundedSeats = landSectors.reduce((sum, s) => sum + s.foundedSeats, 0);
  const freeSeats = Math.max(0, validatedCapacity - reservedSeats - foundedSeats);
  const taken = reservedSeats + foundedSeats;
  const stateStr = planetRecord?.status ?? lifecycle;
  const live = resolvePlanetAggregateLiveCounts(effectiveSectors, foundedSeats, planetLiveCounts);
  const publicColonies = buildPublicColoniesList(reservations, repoColonies);

  return {
    id: world?.id ?? fallbackPlanetId,
    name: world?.name ?? planetRecord?.name ?? canonicalDef.name,
    type,
    look: world?.look ?? planetLookForType(type),
    seed: world?.seed ?? planetRecord?.seed ?? canonicalDef.seed,
    radius: planetRecord?.radius ?? DEV_PLANET_RADIUS,
    state: stateStr,
    status: stateStr,
    lifecycle,
    health,
    admission,
    availability: deriveWorldAvailability({ lifecycle, health, admission, freeSeats }),
    atlasVersion: world?.atlasVersion || 1,
    atlasHash: world?.atlasHash || 'w11-canonical-atlas-v1',
    configHash: world?.configHash || 'w11-canonical-config-v1',
    totalSectors: effectiveSectors.length,
    landSectors: Math.max(1, landSectors.length),
    oceanSectors: oceanSectors.length,
    nominalCapacity,
    validatedCapacity,
    reservedSeats,
    foundedSeats,
    freeSeats,
    livingColonies: live.livingColonies,
    presentColonies: live.presentColonies,
    onlinePlayers: live.onlinePlayers,
    updatedAt: (world?.updatedAt ?? new Date()).toISOString(),
    sectors: effectiveSectors,
    ...(publicColonies.length > 0 ? { colonies: publicColonies } : {}),
    capacity: validatedCapacity,
    seatsTaken: taken,
    seats: { taken, capacity: validatedCapacity },
    ...(world?.faultCode ? { faultCode: world.faultCode } : {}),
  };
}

export function computePublicPlanetStatsV1(
  planets: readonly PlanetSummaryV1[],
  override?: PublicStatsLiveCountsInput | null,
  now: Date = new Date(),
): PublicPlanetStatsV1 {
  const activePlanets = planets.filter((p) => p.lifecycle === 'ACTIVE' && p.health === 'OK');
  const nonArchived = planets.filter((p) => p.lifecycle !== 'ARCHIVED');

  const hasLivingTelemetry = nonArchived.some((p) => p.livingColonies !== null);
  const hasOnlineTelemetry = nonArchived.some((p) => p.onlinePlayers !== null);

  const coloniesAlive =
    override && 'coloniesAlive' in override
      ? (override.coloniesAlive ?? null)
      : hasLivingTelemetry
        ? nonArchived.reduce((sum, p) => sum + (p.livingColonies ?? 0), 0)
        : null;

  const playersOnline =
    override && 'playersOnline' in override
      ? (override.playersOnline ?? null)
      : hasOnlineTelemetry
        ? nonArchived.reduce((sum, p) => sum + (p.onlinePlayers ?? 0), 0)
        : null;

  return {
    planetsActive: activePlanets.length,
    coloniesAlive,
    playersOnline,
    updatedAt: now.toISOString(),
  };
}

export type { SectorId };
