import type { SectorId } from '@terra/contracts';
import type { HomeRepository } from '../../core/home/home.repository';
import type { LobbyPersistenceService } from '../lobby-persistence.service';
import type {
  CanonicalWorldRecord,
  SectorReservationRecord,
} from '../lobby-persistence.types';
import { reconcileWorldSectorsAndBuildSnapshot } from '../reconciliation-sector.helpers';
import { resolveCanonicalWorldOrThrow } from '../reconciliation.helpers';
import type { ColonyEliminationReconcileResult } from '../reconciliation.types';

export interface ReconciliationEventBusLike {
  on?(
    channel: 'planet.event',
    handler: (ev: {
      readonly planetId: string;
      readonly kind: string;
      readonly colonyIds?: readonly string[];
      readonly data?: unknown;
    }) => unknown,
    meta?: { readonly module: string },
  ): () => void;
}

export function extractEliminatedColonyIds(input: {
  readonly colonyId?: unknown;
  readonly colonyIds?: readonly unknown[];
  readonly data?: unknown;
}): string[] {
  const data = (input.data && typeof input.data === 'object' ? input.data : {}) as {
    colonyId?: unknown;
    killerColonyId?: unknown;
  };
  const killer =
    typeof data.killerColonyId === 'string' && data.killerColonyId.length > 0
      ? data.killerColonyId
      : null;
  const out: string[] = [];
  const push = (id: unknown) => {
    if (typeof id === 'string' && id.length > 0 && id !== killer && !out.includes(id)) {
      out.push(id);
    }
  };
  push(input.colonyId);
  push(data.colonyId);
  for (const id of input.colonyIds ?? []) push(id);
  return out;
}

export async function locateColonyAndCommittedReservation(
  persistence: LobbyPersistenceService,
  homeRepo: HomeRepository,
  colonyId: string,
  hintPlanetId?: string,
): Promise<{
  readonly planetId: string;
  readonly sectorId: string;
  readonly landingSlotId: string | null;
  readonly reservation: SectorReservationRecord | null;
}> {
  const existingColony = await homeRepo.findColonyById(colonyId);
  let worlds: readonly CanonicalWorldRecord[];
  if (hintPlanetId) {
    try {
      worlds = [await resolveCanonicalWorldOrThrow(persistence, hintPlanetId)];
    } catch {
      worlds = await persistence.listCanonicalWorlds();
    }
  } else {
    worlds = await persistence.listCanonicalWorlds();
  }

  let fallbackMatch: { readonly worldId: string; readonly reservation: SectorReservationRecord } | null =
    null;
  for (const world of worlds) {
    const reservations = await persistence.listReservations(world.id);
    const activeMatch = reservations.find(
      (r) =>
        r.colonyId === colonyId &&
        (r.state === 'COMMITTED' || r.state === 'HELD' || (r.state as string) === 'SPAWNING'),
    );
    if (activeMatch) {
      return {
        planetId: world.id,
        sectorId: activeMatch.sectorId,
        landingSlotId: activeMatch.landingSlotId,
        reservation: activeMatch,
      };
    }
    const anyMatch = reservations.find((r) => r.colonyId === colonyId);
    if (anyMatch && !fallbackMatch) {
      fallbackMatch = { worldId: world.id, reservation: anyMatch };
    }
  }
  if (fallbackMatch) {
    return {
      planetId: fallbackMatch.worldId,
      sectorId: fallbackMatch.reservation.sectorId,
      landingSlotId: fallbackMatch.reservation.landingSlotId,
      reservation: fallbackMatch.reservation,
    };
  }
  if (existingColony) {
    return {
      planetId: existingColony.planetId,
      sectorId: existingColony.foundingSectorId ?? 'sec_0_0',
      landingSlotId: existingColony.landingSlotId ?? null,
      reservation: null,
    };
  }
  return {
    planetId: hintPlanetId ?? worlds[0]?.id ?? 'desert',
    sectorId: 'sec_0_0',
    landingSlotId: null,
    reservation: null,
  };
}

async function upsertTransitionedColony(
  homeRepo: HomeRepository,
  colonyId: string,
  targetStatus: 'ELIMINATED' | 'TRANSFERRED',
  located: {
    readonly planetId: string;
    readonly sectorId: string;
    readonly landingSlotId: string | null;
    readonly reservation: SectorReservationRecord | null;
  },
) {
  const existing = await homeRepo.findColonyById(colonyId);
  if (!existing && located.reservation) {
    const created = await homeRepo.createColony({
      id: colonyId,
      playerId: located.reservation.playerId,
      planetId: located.planetId,
      colonyIndex: located.reservation.slotIndex,
      name: `Colony-${located.reservation.playerId.slice(-4)}`,
      status: targetStatus,
      foundingSectorId: located.sectorId,
      landingSlotId: located.landingSlotId,
      spawnQ: located.reservation.q,
      spawnR: located.reservation.r,
    });
    return created.colony;
  }
  if (existing && existing.status !== targetStatus) {
    return homeRepo.setColonyStatus(colonyId, targetStatus);
  }
  return existing;
}

export async function transitionColonyStatusHelper(params: {
  readonly persistence: LobbyPersistenceService;
  readonly homeRepo: HomeRepository;
  readonly eliminatedColonyIds: Set<string>;
  readonly settledColonyIds: Set<string>;
  readonly colonyId: string;
  readonly targetStatus: 'ELIMINATED' | 'TRANSFERRED';
  readonly planetId?: string;
  readonly releaseSeat?: boolean;
  readonly now?: Date;
}): Promise<ColonyEliminationReconcileResult> {
  const {
    persistence,
    homeRepo,
    eliminatedColonyIds,
    settledColonyIds,
    colonyId,
    targetStatus,
    planetId,
  } = params;
  const now = params.now ?? new Date();
  if (targetStatus === 'ELIMINATED') {
    eliminatedColonyIds.add(colonyId);
    settledColonyIds.delete(colonyId);
  } else {
    settledColonyIds.add(colonyId);
    eliminatedColonyIds.delete(colonyId);
  }

  const located = await locateColonyAndCommittedReservation(
    persistence,
    homeRepo,
    colonyId,
    planetId,
  );
  const updatedColony = await upsertTransitionedColony(homeRepo, colonyId, targetStatus, located);
  const { reservationReleased, reservationState } = await maybeReleaseEliminatedSeat(
    persistence,
    located.reservation,
    targetStatus === 'ELIMINATED' && params.releaseSeat !== false,
  );

  const world = await resolveCanonicalWorldOrThrow(persistence, located.planetId).catch(
    async () => (await persistence.listCanonicalWorlds())[0] ?? null,
  );
  if (!world) {
    return {
      colonyId,
      planetId: located.planetId,
      sectorId: located.sectorId as SectorId,
      landingSlotId: located.landingSlotId,
      status: targetStatus,
      foundedSeatHeld: true,
      seatEvicted: false,
      reservationReleased,
      reservationState,
      sectorFoundedSeats: 0,
      sectorReservedSeats: 0,
      sectorFreeSeats: 0,
      sectorLivingColonies: 0,
      colony: updatedColony,
    };
  }
  const { snapshot } = await reconcileWorldSectorsAndBuildSnapshot({
    persistence,
    homeRepo,
    world,
    expiredInWorldCount: 0,
    eliminatedColonyIds,
    settledColonyIds,
    now,
  });
  const secSnap = snapshot.sectors.find((s) => s.sectorId === located.sectorId);

  return {
    colonyId,
    planetId: world.id,
    sectorId: located.sectorId as SectorId,
    landingSlotId: located.landingSlotId,
    status: targetStatus,
    foundedSeatHeld: true,
    seatEvicted: false,
    reservationReleased,
    reservationState,
    sectorFoundedSeats: secSnap?.foundedSeats ?? snapshot.foundedSeats,
    sectorReservedSeats: secSnap?.reservedSeats ?? snapshot.reservedSeats,
    sectorFreeSeats: secSnap?.freeSeats ?? snapshot.freeSeats,
    sectorLivingColonies: secSnap?.livingColonies ?? snapshot.livingColonies,
    colony: updatedColony,
  };
}

async function maybeReleaseEliminatedSeat(
  persistence: LobbyPersistenceService,
  reservation: SectorReservationRecord | null,
  shouldRelease: boolean,
): Promise<{ readonly reservationReleased: boolean; readonly reservationState: string | null }> {
  if (!reservation) return { reservationReleased: false, reservationState: null };
  if (!shouldRelease) return { reservationReleased: false, reservationState: reservation.state };
  if (reservation.state === 'RELEASED' || reservation.state === 'EXPIRED') {
    return { reservationReleased: false, reservationState: reservation.state };
  }
  const released = await persistence.releaseReservation(
    reservation.reservationId,
    'RELEASED',
    undefined,
    { allowCommitted: true },
  );
  return { reservationReleased: released.released, reservationState: released.reservation.state };
}

export async function transitionAllColoniesStatusHelper(params: {
  readonly persistence: LobbyPersistenceService;
  readonly homeRepo: HomeRepository;
  readonly eliminatedColonyIds: Set<string>;
  readonly settledColonyIds: Set<string>;
  readonly targetStatus: 'ELIMINATED' | 'TRANSFERRED';
  readonly planetIdOrType?: string;
  readonly now?: Date;
}): Promise<readonly ColonyEliminationReconcileResult[]> {
  const {
    persistence,
    homeRepo,
    eliminatedColonyIds,
    settledColonyIds,
    targetStatus,
    planetIdOrType,
    now,
  } = params;
  const worlds = planetIdOrType
    ? [await resolveCanonicalWorldOrThrow(persistence, planetIdOrType)]
    : await persistence.listCanonicalWorlds();
  const results: ColonyEliminationReconcileResult[] = [];

  for (const world of worlds) {
    const [reservations, repoColonies] = await Promise.all([
      persistence.listReservations(world.id),
      homeRepo.listColoniesByPlanetId(world.id),
    ]);
    const colonyIds = new Set<string>([
      ...reservations.filter((r) => r.state === 'COMMITTED').map((r) => r.colonyId),
      ...repoColonies.filter((c) => c.status !== 'ABANDONED').map((c) => c.id),
    ]);
    for (const colId of colonyIds) {
      results.push(
        await transitionColonyStatusHelper({
          persistence,
          homeRepo,
          eliminatedColonyIds,
          settledColonyIds,
          colonyId: colId,
          targetStatus,
          planetId: world.id,
          releaseSeat: false,
          now,
        }),
      );
    }
  }
  return results;
}

export function bindReconciliationBus(
  bus: ReconciliationEventBusLike | undefined,
  boundBuses: WeakSet<object>,
  eliminateColony: (
    colonyId: string,
    options?: { readonly planetId?: string; readonly now?: Date },
  ) => Promise<unknown>,
): () => void {
  if (!bus || typeof bus.on !== 'function') return () => undefined;
  if (boundBuses.has(bus)) return () => undefined;
  boundBuses.add(bus);
  const unsub = bus.on(
    'planet.event',
    (ev) => {
      if (ev.kind !== 'colonyEliminated' && ev.kind !== 'colony_eliminated') return;
      for (const colId of extractEliminatedColonyIds(ev)) {
        void eliminateColony(colId, { planetId: ev.planetId }).catch(() => undefined);
      }
    },
    { module: 'WorldReconciliation' },
  );
  return () => {
    boundBuses.delete(bus);
    unsub();
  };
}
