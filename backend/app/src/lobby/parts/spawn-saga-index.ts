import type { SectorAntiCheatService } from '../../core/anticheat';
import type { ColonySlotAllowanceService } from '../../core/home/colony-slot-allowance.service';
import type { ColonyRecord, HomeRepository } from '../../core/home/home.repository';
import type { LobbyPersistenceService } from '../lobby-persistence.service';
import type { MatchTicketRecord } from '../lobby-persistence.types';
import type { ManagedSectorReservationRecord } from '../reservation.types';
import { evaluateSpawnMultiColonyGuard } from './reservation-service-parts';

export async function findSpawnMultiColonyRejection(params: {
  readonly persistence: LobbyPersistenceService;
  readonly homeRepo: HomeRepository;
  readonly antiCheat?: SectorAntiCheatService;
  readonly slotAllowance?: ColonySlotAllowanceService;
  readonly reservation: ManagedSectorReservationRecord;
  readonly ticket: MatchTicketRecord | null;
}): Promise<string | null> {
  const { persistence, homeRepo, antiCheat, slotAllowance, reservation, ticket } = params;
  const activeTicket = ticket ?? (await persistence.getTicketById(reservation.ticketId));
  const check = await evaluateSpawnMultiColonyGuard({
    persistence,
    homeRepo,
    antiCheat,
    slotAllowance,
    playerId: reservation.playerId,
    planetId: reservation.planetId,
    sectorId: reservation.sectorId,
    colonyId: reservation.colonyId,
    isTransfer: activeTicket?.mode === 'TRANSFER',
  });
  return check.ok ? null : check.message;
}

export async function resolvePlanetUniqueColonyIndex(params: {
  readonly homeRepo: HomeRepository;
  readonly planetId: string;
  readonly colonyId: string;
  readonly preferredSlotIndex: number;
  readonly provisionalColonies?: Iterable<ColonyRecord>;
}): Promise<number> {
  const { homeRepo, planetId, colonyId, preferredSlotIndex, provisionalColonies } = params;
  const existingCols = (await homeRepo.listColoniesByPlanetId(planetId)).filter(
    (c) => c.id !== colonyId && c.status !== 'ABANDONED' && c.status !== 'RETIRED',
  );
  const usedIdx = new Set(existingCols.map((c) => c.colonyIndex));
  if (provisionalColonies) {
    for (const prov of provisionalColonies) {
      if (
        prov.planetId === planetId &&
        prov.id !== colonyId &&
        prov.status !== 'ABANDONED' &&
        prov.status !== 'RETIRED'
      ) {
        usedIdx.add(prov.colonyIndex);
      }
    }
  }
  let resolvedColonyIndex = preferredSlotIndex;
  if (usedIdx.has(resolvedColonyIndex)) {
    resolvedColonyIndex = 0;
    while (usedIdx.has(resolvedColonyIndex)) resolvedColonyIndex++;
  }
  return resolvedColonyIndex;
}

export async function upsertActiveColonyInHomeRepo(
  homeRepo: HomeRepository,
  reservation: ManagedSectorReservationRecord,
  options?: { readonly handle?: string; readonly displayName?: string; readonly preferredColonyIndex?: number },
): Promise<ColonyRecord> {
  const existingById = await homeRepo.findColonyById(reservation.colonyId);
  if (existingById) {
    if (
      existingById.status === 'ACTIVE' &&
      existingById.foundingSectorId === reservation.sectorId &&
      existingById.landingSlotId === reservation.landingSlotId
    ) {
      return existingById;
    }
    await homeRepo.deleteColony(reservation.colonyId);
  }
  const preferredIndex = options?.preferredColonyIndex ?? reservation.slotIndex;
  const onPlanet = await homeRepo.listColoniesByPlanetId(reservation.planetId);
  for (const col of onPlanet) {
    if (col.colonyIndex === preferredIndex && (col.status === 'ABANDONED' || col.status === 'RETIRED')) {
      await homeRepo.deleteColony(col.id);
    }
  }
  const refreshed = await homeRepo.listColoniesByPlanetId(reservation.planetId);
  const usedIndices = new Set(refreshed.map((c) => c.colonyIndex));
  let colonyIndex = preferredIndex;
  if (usedIndices.has(colonyIndex)) {
    colonyIndex = 0;
    while (usedIndices.has(colonyIndex)) {
      const stale = refreshed.find(
        (c) => c.colonyIndex === colonyIndex && (c.status === 'ABANDONED' || c.status === 'RETIRED'),
      );
      if (stale) {
        await homeRepo.deleteColony(stale.id);
        usedIndices.delete(colonyIndex);
        break;
      }
      colonyIndex++;
    }
  }
  const handle = options?.handle?.trim() || `Colonist-${reservation.playerId.slice(-4)}`;
  const name = options?.displayName?.trim() || `${handle.slice(0, 22)}'s Colony`;
  const { colony } = await homeRepo.createColony({
    id: reservation.colonyId,
    playerId: reservation.playerId,
    planetId: reservation.planetId,
    colonyIndex,
    name,
    color: colonyIndex,
    status: 'ACTIVE',
    foundingSectorId: reservation.sectorId,
    landingSlotId: reservation.landingSlotId,
    spawnQ: reservation.q,
    spawnR: reservation.r,
  });
  return colony;
}
