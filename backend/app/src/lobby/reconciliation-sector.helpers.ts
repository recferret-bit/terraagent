import {
  deriveSectorOccupancy,
  deriveWorldAvailability,
  newId,
  type PlanetType,
} from '@terra/contracts';
import type { ColonyRecord, HomeRepository } from '../core/home/home.repository';
import type { LobbyPersistenceService } from './lobby-persistence.service';
import type {
  CanonicalWorldRecord,
  PinnedAtlasVersionRecord,
  PlanetSectorRecord,
  SectorLandingSlotRecord,
  SectorReservationRecord,
} from './lobby-persistence.types';
import { computeFreeSectorSeats } from './lobby-store.helpers';
import type { CanonicalWorldProvisioningService } from './provisioning.service';
import type { CanonicalWorldProvisionOutcome } from './provisioning.types';
import type {
  HandlePlanetEventOptions,
  PlanetEventOutcomeResult,
  PlanetLifecycleEventKind,
  ReconciliationSweepOptions,
  RecordedPlanetOutcome,
  SectorCounterDriftRepairRecord,
  SectorReconciliationSnapshot,
  WorldReconciliationSnapshot,
} from './reconciliation.types';

function classifyFoundedColonies(
  foundedColonyIds: ReadonlySet<string>,
  foundedSeats: number,
  secColonies: readonly ColonyRecord[],
  eliminatedColonyIds: ReadonlySet<string>,
  settledColonyIds: ReadonlySet<string>,
  releasedEliminatedCount = 0,
): {
  readonly livingColonies: number;
  readonly eliminatedColonies: number;
  readonly settledColonies: number;
} {
  const repoById = new Map(secColonies.map((c) => [c.id, c]));
  let settledColonies = 0;
  let eliminatedInFounded = 0;
  for (const colId of foundedColonyIds) {
    const status = repoById.get(colId)?.status ?? 'ACTIVE';
    if (settledColonyIds.has(colId) || status === 'TRANSFERRED' || status === 'SETTLED') {
      settledColonies++;
    } else if (eliminatedColonyIds.has(colId) || status === 'ELIMINATED' || status === 'RETIRED') {
      eliminatedInFounded++;
    }
  }
  return {
    livingColonies: Math.max(0, foundedSeats - eliminatedInFounded - settledColonies),
    eliminatedColonies: eliminatedInFounded + releasedEliminatedCount,
    settledColonies,
  };
}

function countReleasedEliminatedInSector(
  releasedIds: ReadonlySet<string>,
  foundedColonyIds: ReadonlySet<string>,
  repoColonies: readonly ColonyRecord[],
  sectorId: string,
  eliminatedColonyIds: ReadonlySet<string>,
): number {
  let count = 0;
  for (const colId of releasedIds) {
    if (foundedColonyIds.has(colId)) continue;
    const repoCol = repoColonies.find((c) => c.id === colId);
    if (repoCol && (repoCol.foundingSectorId ?? 'sec_0_0') !== sectorId) continue;
    if (
      eliminatedColonyIds.has(colId) ||
      repoCol?.status === 'ELIMINATED' ||
      repoCol?.status === 'RETIRED'
    ) {
      count++;
    }
  }
  return count;
}

function buildOceanSectorCounts(
  world: CanonicalWorldRecord,
): {
  readonly reservedSeats: number;
  readonly foundedSeats: number;
  readonly freeSeats: number;
  readonly livingColonies: number;
  readonly eliminatedColonies: number;
  readonly settledColonies: number;
  readonly availability: SectorReconciliationSnapshot['availability'];
} {
  const occ = deriveSectorOccupancy({
    kind: 'ocean',
    foundingCapacity: 0,
    validatedCapacity: 0,
    reservedSeats: 0,
    foundedSeats: 0,
    livingColonies: 0,
    presentColonies: 0,
    onlinePlayers: null,
    lifecycle: world.lifecycle,
    health: world.health,
    admission: world.admission,
  });
  return {
    reservedSeats: 0,
    foundedSeats: 0,
    freeSeats: 0,
    livingColonies: 0,
    eliminatedColonies: 0,
    settledColonies: 0,
    availability: occ.availability,
  };
}

export function computeAuthoritativeSectorCounts(params: {
  readonly world: CanonicalWorldRecord;
  readonly sector: PlanetSectorRecord;
  readonly reservations: readonly SectorReservationRecord[];
  readonly slots: readonly SectorLandingSlotRecord[];
  readonly repoColonies: readonly ColonyRecord[];
  readonly eliminatedColonyIds: ReadonlySet<string>;
  readonly settledColonyIds: ReadonlySet<string>;
}): {
  readonly reservedSeats: number;
  readonly foundedSeats: number;
  readonly freeSeats: number;
  readonly livingColonies: number;
  readonly eliminatedColonies: number;
  readonly settledColonies: number;
  readonly availability: SectorReconciliationSnapshot['availability'];
} {
  const { world, sector, reservations, slots, repoColonies, eliminatedColonyIds, settledColonyIds } =
    params;
  if (sector.kind === 'ocean') {
    return buildOceanSectorCounts(world);
  }

  const validatedCap = Math.min(sector.foundingCapacity, sector.validatedCapacity);
  const secRes = reservations.filter((r) => r.sectorId === sector.sectorId);
  const activeHolds = secRes.filter(
    (r) => r.state === 'HELD' || (r.state as string) === 'SPAWNING',
  );
  const committedRes = secRes.filter((r) => r.state === 'COMMITTED');
  const committedSlots = slots.filter(
    (s) => s.sectorId === sector.sectorId && s.state === 'COMMITTED',
  );
  const holdIds = new Set(activeHolds.map((r) => r.colonyId));
  const releasedIds = new Set(
    secRes.filter((r) => r.state === 'EXPIRED' || r.state === 'RELEASED').map((r) => r.colonyId),
  );
  const secColonies = repoColonies.filter(
    (c) =>
      (c.foundingSectorId ?? 'sec_0_0') === sector.sectorId &&
      c.status !== 'ABANDONED' &&
      !holdIds.has(c.id) &&
      !releasedIds.has(c.id),
  );

  const foundedColonyIds = new Set<string>([
    ...committedRes.map((r) => r.colonyId),
    ...secColonies.map((c) => c.id),
    ...committedSlots.map((s) => s.colonyId ?? s.landingSlotId),
  ]);
  const foundedSeats = Math.min(validatedCap, foundedColonyIds.size);
  const reservedSeats = Math.min(Math.max(0, validatedCap - foundedSeats), activeHolds.length);
  const freeSeats = computeFreeSectorSeats(
    sector.kind,
    sector.foundingCapacity,
    sector.validatedCapacity,
    reservedSeats,
    foundedSeats,
  );
  const colonyBreakdown = classifyFoundedColonies(
    foundedColonyIds,
    foundedSeats,
    secColonies,
    eliminatedColonyIds,
    settledColonyIds,
    countReleasedEliminatedInSector(
      releasedIds,
      foundedColonyIds,
      repoColonies,
      sector.sectorId,
      eliminatedColonyIds,
    ),
  );
  const occ = deriveSectorOccupancy({
    kind: sector.kind,
    foundingCapacity: sector.foundingCapacity,
    validatedCapacity: validatedCap,
    reservedSeats,
    foundedSeats,
    livingColonies: colonyBreakdown.livingColonies,
    presentColonies: colonyBreakdown.livingColonies,
    onlinePlayers: null,
    lifecycle: world.lifecycle,
    health: world.health,
    admission: world.admission,
  });

  return {
    reservedSeats,
    foundedSeats,
    freeSeats,
    ...colonyBreakdown,
    availability: occ.availability,
  };
}

export async function reconcileWorldSectorsAndBuildSnapshot(params: {
  readonly persistence: LobbyPersistenceService;
  readonly homeRepo?: HomeRepository;
  readonly world: CanonicalWorldRecord;
  readonly expiredInWorldCount: number;
  readonly eliminatedColonyIds: ReadonlySet<string>;
  readonly settledColonyIds: ReadonlySet<string>;
  readonly now: Date;
}): Promise<{
  readonly snapshot: WorldReconciliationSnapshot;
  readonly repairs: readonly SectorCounterDriftRepairRecord[];
}> {
  const {
    persistence,
    homeRepo,
    world,
    expiredInWorldCount,
    eliminatedColonyIds,
    settledColonyIds,
    now,
  } = params;
  const [sectors, reservations, slots, repoColonies, pinnedAtlas] = await Promise.all([
    persistence.listSectors(world.id),
    persistence.listReservations(world.id),
    persistence.listLandingSlots(world.id),
    homeRepo ? homeRepo.listColoniesByPlanetId(world.id) : Promise.resolve([]),
    persistence.getAtlasVersion(world.id, world.atlasVersion || 1),
  ]);

  const repairs: SectorCounterDriftRepairRecord[] = [];
  const sectorSnapshots: SectorReconciliationSnapshot[] = [];

  for (const sector of sectors) {
    const auth = computeAuthoritativeSectorCounts({
      world,
      sector,
      reservations,
      slots,
      repoColonies,
      eliminatedColonyIds,
      settledColonyIds,
    });
    const drifted =
      sector.reservedSeats !== auth.reservedSeats ||
      sector.foundedSeats !== auth.foundedSeats ||
      sector.freeSeats !== auth.freeSeats;

    if (drifted) {
      await persistence.updateSectorCounters({
        planetId: world.id,
        sectorId: sector.sectorId,
        reservedSeats: auth.reservedSeats,
        foundedSeats: auth.foundedSeats,
        now,
      });
      repairs.push({
        planetId: world.id,
        sectorId: sector.sectorId,
        previousReservedSeats: sector.reservedSeats,
        previousFoundedSeats: sector.foundedSeats,
        previousFreeSeats: sector.freeSeats,
        repairedReservedSeats: auth.reservedSeats,
        repairedFoundedSeats: auth.foundedSeats,
        repairedFreeSeats: auth.freeSeats,
        repairedAt: now.toISOString(),
      });
    }

    sectorSnapshots.push({
      planetId: world.id,
      sectorId: sector.sectorId,
      continentId: sector.continentId,
      kind: sector.kind,
      foundingCapacity: sector.kind === 'ocean' ? 0 : sector.foundingCapacity,
      validatedCapacity:
        sector.kind === 'ocean' ? 0 : Math.min(sector.foundingCapacity, sector.validatedCapacity),
      reservedSeats: auth.reservedSeats,
      foundedSeats: auth.foundedSeats,
      freeSeats: auth.freeSeats,
      livingColonies: auth.livingColonies,
      eliminatedColonies: auth.eliminatedColonies,
      settledColonies: auth.settledColonies,
      availability: auth.availability,
      repaired: drifted,
    });
  }

  const snapshot = composeWorldReconciliationSnapshot({
    world,
    pinnedAtlas,
    sectorSnapshots,
    expiredInWorldCount,
    repairsCount: repairs.length,
    now,
  });
  return { snapshot, repairs };
}

function composeWorldReconciliationSnapshot(params: {
  readonly world: CanonicalWorldRecord;
  readonly pinnedAtlas: PinnedAtlasVersionRecord | null;
  readonly sectorSnapshots: readonly SectorReconciliationSnapshot[];
  readonly expiredInWorldCount: number;
  readonly repairsCount: number;
  readonly now: Date;
}): WorldReconciliationSnapshot {
  const { world, pinnedAtlas, sectorSnapshots, expiredInWorldCount, repairsCount, now } = params;
  const landSectors = sectorSnapshots.filter((s) => s.kind === 'land');
  const nominalCapacity = landSectors.reduce((s, sec) => s + sec.foundingCapacity, 0);
  const validatedCapacity = landSectors.reduce((s, sec) => s + sec.validatedCapacity, 0);
  const reservedSeats = landSectors.reduce((s, sec) => s + sec.reservedSeats, 0);
  const foundedSeats = landSectors.reduce((s, sec) => s + sec.foundedSeats, 0);
  const freeSeats = Math.max(0, validatedCapacity - reservedSeats - foundedSeats);
  const livingColonies = landSectors.reduce((s, sec) => s + sec.livingColonies, 0);
  const eliminatedColonies = landSectors.reduce((s, sec) => s + sec.eliminatedColonies, 0);
  const settledColonies = landSectors.reduce((s, sec) => s + sec.settledColonies, 0);

  return {
    id: world.id,
    planetId: world.id,
    type: world.canonicalType as PlanetType,
    planetType: world.canonicalType as PlanetType,
    name: world.name,
    look: world.look,
    seed: world.seed,
    lifecycle: world.lifecycle,
    health: world.health,
    admission: world.admission,
    availability: deriveWorldAvailability({
      lifecycle: world.lifecycle,
      health: world.health,
      admission: world.admission,
      freeSeats,
    }),
    atlasVersion: world.atlasVersion,
    atlasHash: world.atlasHash,
    configHash: world.configHash,
    manifestPinned: pinnedAtlas !== null,
    manifest: pinnedAtlas?.manifest ?? null,
    elapsedAgeMs: Math.max(0, now.getTime() - world.createdAt.getTime()),
    ageSealed: false,
    expired: false,
    ended: false,
    archivedBySweep: false,
    replaced: false,
    wiped: false,
    nominalCapacity,
    validatedCapacity,
    reservedSeats,
    foundedSeats,
    freeSeats,
    livingColonies,
    eliminatedColonies,
    settledColonies,
    expiredReservationsInSweep: expiredInWorldCount,
    repairedSectorsInSweep: repairsCount,
    sectors: sectorSnapshots,
    world,
  };
}

export async function maybeRetryFaultedWorldsHelper(
  provisioning: CanonicalWorldProvisioningService,
  worlds: readonly CanonicalWorldRecord[],
  opts: ReconciliationSweepOptions,
): Promise<readonly CanonicalWorldProvisionOutcome[]> {
  if (!opts.autoRetryFaultedWorlds) return [];
  const retried: CanonicalWorldProvisionOutcome[] = [];
  for (const world of worlds) {
    if (
      world.lifecycle !== 'ARCHIVED' &&
      (world.health === 'FAULTED' ||
        world.health === 'RETRYING' ||
        world.lifecycle === 'PROVISIONING')
    ) {
      retried.push(
        await provisioning.retryFaultedWorld(world.canonicalType, {
          actor: opts.actor ?? 'system:reconciliation',
          reason: 'reconciliation sweep health retry',
        }),
      );
    }
  }
  return retried;
}

export async function buildWorldSnapshotsHelper(params: {
  readonly persistence: LobbyPersistenceService;
  readonly homeRepo: HomeRepository;
  readonly worlds: readonly CanonicalWorldRecord[];
  readonly expiredReservations: readonly { readonly planetId: string }[];
  readonly eliminatedColonyIds: ReadonlySet<string>;
  readonly settledColonyIds: ReadonlySet<string>;
  readonly repairedSectorsHistory: SectorCounterDriftRepairRecord[];
  readonly now: Date;
}): Promise<{
  readonly worldSnapshots: readonly WorldReconciliationSnapshot[];
  readonly byPlanet: Readonly<Record<string, WorldReconciliationSnapshot>>;
  readonly repairedSectors: readonly SectorCounterDriftRepairRecord[];
}> {
  const worldSnapshots: WorldReconciliationSnapshot[] = [];
  const byPlanet: Record<string, WorldReconciliationSnapshot> = {};
  const repairedSectors: SectorCounterDriftRepairRecord[] = [];

  for (const world of params.worlds) {
    const expiredInWorldCount = params.expiredReservations.filter(
      (r) => r.planetId === world.id,
    ).length;
    const { snapshot, repairs } = await reconcileWorldSectorsAndBuildSnapshot({
      persistence: params.persistence,
      homeRepo: params.homeRepo,
      world,
      expiredInWorldCount,
      eliminatedColonyIds: params.eliminatedColonyIds,
      settledColonyIds: params.settledColonyIds,
      now: params.now,
    });
    worldSnapshots.push(snapshot);
    byPlanet[snapshot.type] = snapshot;
    byPlanet[snapshot.planetId] = snapshot;
    repairedSectors.push(...repairs);
    params.repairedSectorsHistory.push(...repairs);
  }

  return { worldSnapshots, byPlanet, repairedSectors };
}

export function buildPlanetEventOutcomeResult(params: {
  readonly world: CanonicalWorldRecord;
  readonly event: PlanetLifecycleEventKind;
  readonly options: HandlePlanetEventOptions;
  readonly snapshot: WorldReconciliationSnapshot;
  readonly now: Date;
}): PlanetEventOutcomeResult {
  const { world, event, options, snapshot, now } = params;
  const outcomeKind =
    event === 'extinct' || event === 'all_eliminated'
      ? 'extinct'
      : event === 'settled' || event === 'all_settled'
        ? 'all_settled'
        : event === 'victory' || event === 'planet.victory'
          ? 'victory'
          : 'age_evaluated';

  const outcome: RecordedPlanetOutcome = {
    id: `out_${newId('mt').slice(3)}`,
    planetId: world.id,
    planetType: world.canonicalType as PlanetType,
    event,
    outcomeKind,
    winnerColonyId: options.winnerColonyId ?? null,
    foundedSeats: snapshot.foundedSeats,
    livingColonies: snapshot.livingColonies,
    recordedAt: now.toISOString(),
    ...(options.details ? { details: options.details } : {}),
  };

  return {
    planetId: world.id,
    planetType: world.canonicalType as PlanetType,
    event,
    outcomeRecorded: true,
    outcome,
    worldEnded: false,
    ageSealed: false,
    archived: false,
    replaced: false,
    wiped: false,
    seatsEvicted: 0,
    lifecycle: snapshot.lifecycle,
    health: snapshot.health,
    admission: snapshot.admission,
    availability: snapshot.availability,
    foundedSeats: snapshot.foundedSeats,
    reservedSeats: snapshot.reservedSeats,
    freeSeats: snapshot.freeSeats,
    livingColonies: snapshot.livingColonies,
    eliminatedColonies: snapshot.eliminatedColonies,
    settledColonies: snapshot.settledColonies,
    world: snapshot.world,
  };
}
