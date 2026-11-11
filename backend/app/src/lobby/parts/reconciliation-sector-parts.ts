import {
  deriveSectorOccupancy,
  deriveWorldAvailability,
  type PlanetType,
} from '@terra/contracts';
import type { ColonyRecord } from '../../core/home/home.repository';
import type { LobbyPersistenceService } from '../lobby-persistence.service';
import type {
  CanonicalWorldRecord,
  PinnedAtlasVersionRecord,
  PlanetSectorRecord,
  SectorLandingSlotRecord,
  SectorReservationRecord,
} from '../lobby-persistence.types';
import type {
  SectorCounterDriftRepairRecord,
  SectorReconciliationSnapshot,
  WorldReconciliationSnapshot,
} from '../reconciliation.types';

export interface AuthoritativeSectorCounts {
  readonly reservedSeats: number;
  readonly foundedSeats: number;
  readonly freeSeats: number;
  readonly livingColonies: number;
  readonly eliminatedColonies: number;
  readonly settledColonies: number;
  readonly availability: SectorReconciliationSnapshot['availability'];
}

export function classifyFoundedColonies(
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

export function countReleasedEliminatedInSector(
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

export function buildOceanSectorCounts(world: CanonicalWorldRecord): AuthoritativeSectorCounts {
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

export function collectSectorColonyAndReservationSets(
  sector: PlanetSectorRecord,
  reservations: readonly SectorReservationRecord[],
  slots: readonly SectorLandingSlotRecord[],
  repoColonies: readonly ColonyRecord[],
) {
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
  return { activeHolds, releasedIds, secColonies, foundedColonyIds };
}

export async function repairAndBuildSectorSnapshot(params: {
  readonly persistence: LobbyPersistenceService;
  readonly world: CanonicalWorldRecord;
  readonly sector: PlanetSectorRecord;
  readonly auth: AuthoritativeSectorCounts;
  readonly now: Date;
}): Promise<{
  readonly sectorSnapshot: SectorReconciliationSnapshot;
  readonly repair: SectorCounterDriftRepairRecord | null;
}> {
  const { persistence, world, sector, auth, now } = params;
  const drifted =
    sector.reservedSeats !== auth.reservedSeats ||
    sector.foundedSeats !== auth.foundedSeats ||
    sector.freeSeats !== auth.freeSeats;
  let repair: SectorCounterDriftRepairRecord | null = null;
  if (drifted) {
    await persistence.updateSectorCounters({
      planetId: world.id,
      sectorId: sector.sectorId,
      reservedSeats: auth.reservedSeats,
      foundedSeats: auth.foundedSeats,
      now,
    });
    repair = {
      planetId: world.id,
      sectorId: sector.sectorId,
      previousReservedSeats: sector.reservedSeats,
      previousFoundedSeats: sector.foundedSeats,
      previousFreeSeats: sector.freeSeats,
      repairedReservedSeats: auth.reservedSeats,
      repairedFoundedSeats: auth.foundedSeats,
      repairedFreeSeats: auth.freeSeats,
      repairedAt: now.toISOString(),
    };
  }
  const sectorSnapshot: SectorReconciliationSnapshot = {
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
  };
  return { sectorSnapshot, repair };
}

export function composeWorldReconciliationSnapshot(params: {
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
