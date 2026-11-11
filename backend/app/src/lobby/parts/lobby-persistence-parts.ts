import {
  LobbyPersistenceConflictError,
  type LobbyPersistenceStore,
  type PlanetSectorRecord,
  type ReserveSectorSlotInput,
  type SectorLandingSlotRecord,
  type SectorReservationRecord,
  type UpdateSectorCountersInput,
  type UpsertSectorWithSlotsInput,
} from '../lobby-persistence.types';
import { buildSectorCoreFields } from './lobby-store-parts';

export async function upsertSectorsBatchInStore(
  store: LobbyPersistenceStore,
  planetIdOrSectors: string | readonly UpsertSectorWithSlotsInput[],
  sectors?: readonly (Omit<UpsertSectorWithSlotsInput, 'planetId'> & { readonly planetId?: string })[],
): Promise<readonly { readonly sector: PlanetSectorRecord; readonly slots: SectorLandingSlotRecord[] }[]> {
  const items: UpsertSectorWithSlotsInput[] =
    typeof planetIdOrSectors === 'string'
      ? (sectors ?? []).map((s) => ({ ...s, planetId: s.planetId ?? planetIdOrSectors }))
      : [...planetIdOrSectors];
  const out: { readonly sector: PlanetSectorRecord; readonly slots: SectorLandingSlotRecord[] }[] = [];
  for (const item of items) {
    out.push(await store.upsertSectorWithSlots(item));
  }
  return out;
}

export async function updateSectorCountersInStore(
  store: LobbyPersistenceStore,
  input: UpdateSectorCountersInput,
): Promise<PlanetSectorRecord> {
  const existing = await store.getSector(input.planetId, input.sectorId);
  if (!existing) {
    throw new LobbyPersistenceConflictError(
      'sector_not_found',
      `sector "${input.sectorId}" on "${input.planetId}" not found`,
      { planetId: input.planetId, sectorId: input.sectorId },
    );
  }
  const existingSlots = await store.listLandingSlots(input.planetId, input.sectorId);
  const out = await store.upsertSectorWithSlots({
    planetId: existing.planetId,
    sectorId: existing.sectorId,
    ...buildSectorCoreFields(existing),
    reservedSeats: input.reservedSeats !== undefined ? input.reservedSeats : existing.reservedSeats,
    foundedSeats: input.foundedSeats !== undefined ? input.foundedSeats : existing.foundedSeats,
    mainResource: existing.mainResource,
    scarceResources: existing.scarceResources,
    slots: existingSlots.map((s) => ({
      slotId: s.landingSlotId,
      slotIndex: s.slotIndex,
      q: s.q,
      r: s.r,
    })),
  });
  return out.sector;
}

export async function reserveSectorSlotOrThrowInStore(
  store: LobbyPersistenceStore,
  input: ReserveSectorSlotInput,
): Promise<{
  readonly idempotent: boolean;
  readonly reservation: SectorReservationRecord;
  readonly slot: SectorLandingSlotRecord;
  readonly sector: PlanetSectorRecord;
}> {
  const out = await store.reserveSectorSlot(input);
  if (!out.ok) {
    const code = out.reason === 'slot_taken' ? 'slot_already_reserved' : 'sector_capacity_exceeded';
    throw new LobbyPersistenceConflictError(code, out.message, {
      planetId: input.planetId,
      sectorId: input.sectorId,
      landingSlotId: input.landingSlotId,
      reason: out.reason,
    });
  }
  return {
    idempotent: out.idempotent,
    reservation: out.reservation,
    slot: out.slot,
    sector: out.sector,
  };
}
