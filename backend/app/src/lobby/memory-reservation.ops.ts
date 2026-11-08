import { newId, type LandingSlotId, type SectorId } from '@terra/contracts';
import {
  LobbyPersistenceConflictError,
  type CanonicalWorldRecord,
  type MatchTicketRecord,
  type PlanetSectorRecord,
  type ReserveSectorSlotInput,
  type ReserveSectorSlotOutcome,
  type SectorLandingSlotRecord,
  type SectorReservationRecord,
} from './lobby-persistence.types';
import {
  computeFreeSectorSeats,
  DEFAULT_RESERVATION_TTL_MS,
  type KeyedMutex,
} from './lobby-store.helpers';

export class MemoryReservationOps {
  constructor(
    private readonly mutex: KeyedMutex,
    private readonly worldsById: Map<string, CanonicalWorldRecord>,
    private readonly sectors: Map<string, PlanetSectorRecord>,
    private readonly landingSlots: Map<string, SectorLandingSlotRecord>,
    private readonly reservationsById: Map<string, SectorReservationRecord>,
    private readonly ticketsById: Map<string, MatchTicketRecord>,
  ) {}

  async reserveSectorSlot(input: ReserveSectorSlotInput): Promise<ReserveSectorSlotOutcome> {
    return this.mutex.run(`planet:${input.planetId}`, async () => {
      const existingRes = this.findExistingReservationForInput(input);
      if (existingRes) return existingRes;

      const world = this.worldsById.get(input.planetId);
      if (world && (world.admission !== 'OPEN' || world.lifecycle !== 'ACTIVE' || world.health !== 'OK')) {
        return {
          ok: false,
          reason: 'admission_closed',
          message: `planet ${input.planetId} is not open for admission`,
        };
      }

      const secKey = `${input.planetId}:${input.sectorId}`;
      const sector = this.sectors.get(secKey);
      if (!sector) {
        throw new LobbyPersistenceConflictError(
          'sector_not_found',
          `sector ${input.sectorId} on ${input.planetId} not found`,
          { planetId: input.planetId, sectorId: input.sectorId },
        );
      }
      if (sector.kind === 'ocean') {
        return { ok: false, reason: 'ocean_sector', message: `ocean sector ${input.sectorId} has zero founding seats` };
      }
      const effectiveCap = Math.min(sector.foundingCapacity, sector.validatedCapacity);
      if (sector.reservedSeats + sector.foundedSeats >= effectiveCap) {
        return {
          ok: false,
          reason: 'sector_full',
          message: `sector ${input.sectorId} is at capacity (${sector.reservedSeats + sector.foundedSeats}/${effectiveCap})`,
        };
      }

      const targetSlot = this.pickSlotForReservation(input.planetId, input.sectorId, input.landingSlotId);
      if (!targetSlot.ok) return targetSlot;

      return this.applySlotReservation(input, sector, targetSlot.slot);
    });
  }

  private findExistingReservationForInput(input: ReserveSectorSlotInput): ReserveSectorSlotOutcome | null {
    for (const r of [...this.reservationsById.values()]) {
      const isActive = r.state === 'HELD' || r.state === 'COMMITTED' || (r.state as string) === 'SPAWNING';
      if (r.ticketId === input.ticketId || r.colonyId === input.colonyId) {
        if (!isActive) {
          this.reservationsById.delete(r.reservationId);
          continue;
        }
        if (
          r.ticketId === input.ticketId &&
          r.colonyId === input.colonyId &&
          r.playerId === input.playerId &&
          r.planetId === input.planetId &&
          r.sectorId === input.sectorId &&
          (!input.landingSlotId || r.landingSlotId === input.landingSlotId)
        ) {
          const slot = this.landingSlots.get(`${r.planetId}:${r.landingSlotId}`)!;
          const sector = this.sectors.get(`${r.planetId}:${r.sectorId}`)!;
          return { ok: true, idempotent: true, reservation: r, slot, sector };
        }
        throw new LobbyPersistenceConflictError(
          'duplicate_active_reservation',
          `ticket "${input.ticketId}" or colony "${input.colonyId}" already has a reservation`,
          { ticketId: input.ticketId, colonyId: input.colonyId },
        );
      }
      if (isActive && r.playerId === input.playerId) {
        throw new LobbyPersistenceConflictError(
          'duplicate_active_reservation',
          `player "${input.playerId}" already holds an active reservation "${r.reservationId}"`,
          { playerId: input.playerId, reservationId: r.reservationId },
        );
      }
    }
    return null;
  }

  private pickSlotForReservation(
    planetId: string,
    sectorId: SectorId,
    requestedSlotId?: LandingSlotId,
  ): { readonly ok: true; readonly slot: SectorLandingSlotRecord } | ReserveSectorSlotOutcome {
    if (requestedSlotId) {
      const slot = this.landingSlots.get(`${planetId}:${requestedSlotId}`);
      if (!slot || slot.sectorId !== sectorId) {
        throw new LobbyPersistenceConflictError(
          'slot_not_found',
          `landing slot ${requestedSlotId} not found in ${sectorId}`,
          { planetId, sectorId, landingSlotId: requestedSlotId },
        );
      }
      if (slot.state !== 'FREE') {
        return {
          ok: false,
          reason: 'slot_taken',
          message: `landing slot ${requestedSlotId} is already ${slot.state}`,
        };
      }
      return { ok: true, slot };
    }
    const freeSlot = [...this.landingSlots.values()]
      .filter((s) => s.planetId === planetId && s.sectorId === sectorId && s.state === 'FREE')
      .sort((a, b) => a.slotIndex - b.slotIndex)[0];
    if (!freeSlot) {
      return { ok: false, reason: 'sector_full', message: `no free landing slots in ${sectorId}` };
    }
    return { ok: true, slot: freeSlot };
  }

  private applySlotReservation(
    input: ReserveSectorSlotInput,
    sector: PlanetSectorRecord,
    slot: SectorLandingSlotRecord,
  ): ReserveSectorSlotOutcome {
    const now = input.now ?? new Date();
    const expiresAt = new Date(now.getTime() + (input.ttlMs ?? DEFAULT_RESERVATION_TTL_MS));
    const reservationId = input.reservationId ?? `res_${newId('mt').slice(3)}`;
    const nextEpoch = slot.epoch + 1;

    const updatedSlot: SectorLandingSlotRecord = {
      ...slot,
      state: 'HELD',
      reservationId,
      colonyId: input.colonyId,
      epoch: nextEpoch,
      expiresAt,
      updatedAt: now,
    };
    this.landingSlots.set(`${input.planetId}:${slot.landingSlotId}`, updatedSlot);

    const reservedSeats = sector.reservedSeats + 1;
    const updatedSector: PlanetSectorRecord = {
      ...sector,
      reservedSeats,
      freeSeats: computeFreeSectorSeats(
        sector.kind,
        sector.foundingCapacity,
        sector.validatedCapacity,
        reservedSeats,
        sector.foundedSeats,
      ),
      updatedAt: now,
    };
    this.sectors.set(`${input.planetId}:${sector.sectorId}`, updatedSector);

    const reservation: SectorReservationRecord = {
      id: reservationId,
      reservationId,
      ticketId: input.ticketId,
      colonyId: input.colonyId,
      playerId: input.playerId,
      planetId: input.planetId,
      sectorId: input.sectorId,
      landingSlotId: slot.landingSlotId,
      slotIndex: slot.slotIndex,
      q: slot.q,
      r: slot.r,
      epoch: nextEpoch,
      expiresAt: expiresAt.toISOString(),
      state: 'HELD',
      createdAt: now,
      updatedAt: now,
    };
    this.reservationsById.set(reservationId, reservation);

    const ticket = this.ticketsById.get(input.ticketId);
    if (ticket) {
      this.ticketsById.set(ticket.id, {
        ...ticket,
        state: 'RESERVED',
        reservedPlanetId: input.planetId,
        reservedSectorId: input.sectorId,
        reservedLandingSlotId: slot.landingSlotId,
        reservationEpoch: nextEpoch,
        reservationExpiresAt: expiresAt.toISOString(),
        updatedAt: now.toISOString(),
      });
    }

    return { ok: true, idempotent: false, reservation, slot: updatedSlot, sector: updatedSector };
  }

  async commitReservation(reservationId: string, expectedEpoch?: number): Promise<SectorReservationRecord> {
    const res = this.reservationsById.get(reservationId);
    if (!res) {
      throw new LobbyPersistenceConflictError('reservation_fenced', `reservation "${reservationId}" not found`);
    }
    return this.mutex.run(`planet:${res.planetId}`, async () => {
      const current = this.reservationsById.get(reservationId)!;
      if (expectedEpoch !== undefined && current.epoch !== expectedEpoch) {
        throw new LobbyPersistenceConflictError(
          'reservation_fenced',
          `reservation "${reservationId}" epoch mismatch (${current.epoch} !== ${expectedEpoch})`,
        );
      }
      if (current.state === 'COMMITTED') return current;
      if (current.state !== 'HELD' && (current.state as string) !== 'SPAWNING') {
        throw new LobbyPersistenceConflictError(
          'reservation_fenced',
          `cannot commit reservation "${reservationId}" in state ${current.state}`,
        );
      }
      const now = new Date();
      const committed: SectorReservationRecord = { ...current, state: 'COMMITTED', updatedAt: now };
      this.reservationsById.set(reservationId, committed);

      const slotKey = `${current.planetId}:${current.landingSlotId}`;
      const slot = this.landingSlots.get(slotKey);
      if (slot) {
        this.landingSlots.set(slotKey, { ...slot, state: 'COMMITTED', expiresAt: null, updatedAt: now });
      }
      const secKey = `${current.planetId}:${current.sectorId}`;
      const sector = this.sectors.get(secKey);
      if (sector) {
        const reservedSeats = Math.max(0, sector.reservedSeats - 1);
        const foundedSeats = sector.foundedSeats + 1;
        this.sectors.set(secKey, {
          ...sector,
          reservedSeats,
          foundedSeats,
          freeSeats: computeFreeSectorSeats(
            sector.kind,
            sector.foundingCapacity,
            sector.validatedCapacity,
            reservedSeats,
            foundedSeats,
          ),
          updatedAt: now,
        });
      }
      const ticket = this.ticketsById.get(current.ticketId);
      if (ticket) {
        this.ticketsById.set(ticket.id, {
          ...ticket,
          state: 'ASSIGNED',
          position: null,
          etaS: null,
          updatedAt: now.toISOString(),
        });
      }
      return committed;
    });
  }

  async releaseReservation(
    reservationId: string,
    reason: 'RELEASED' | 'EXPIRED' = 'RELEASED',
    expectedEpoch?: number,
  ): Promise<{ readonly released: boolean; readonly reservation: SectorReservationRecord }> {
    const res = this.reservationsById.get(reservationId);
    if (!res) {
      throw new LobbyPersistenceConflictError('reservation_fenced', `reservation "${reservationId}" not found`);
    }
    return this.mutex.run(`planet:${res.planetId}`, async () => {
      const current = this.reservationsById.get(reservationId)!;
      if (expectedEpoch !== undefined && current.epoch !== expectedEpoch) {
        throw new LobbyPersistenceConflictError(
          'reservation_fenced',
          `reservation "${reservationId}" epoch mismatch (${current.epoch} !== ${expectedEpoch})`,
        );
      }
      if (current.state === 'RELEASED' || current.state === 'EXPIRED') {
        return { released: false, reservation: current };
      }
      if (current.state === 'COMMITTED') {
        throw new LobbyPersistenceConflictError(
          'reservation_fenced',
          `cannot release committed reservation "${reservationId}": founded seats remain held`,
        );
      }
      const now = new Date();
      const nextRes: SectorReservationRecord = { ...current, state: reason, updatedAt: now };
      this.reservationsById.set(reservationId, nextRes);

      const slotKey = `${current.planetId}:${current.landingSlotId}`;
      const slot = this.landingSlots.get(slotKey);
      if (slot && slot.reservationId === reservationId) {
        this.landingSlots.set(slotKey, {
          ...slot,
          state: 'FREE',
          reservationId: null,
          colonyId: null,
          expiresAt: null,
          updatedAt: now,
        });
      }
      const secKey = `${current.planetId}:${current.sectorId}`;
      const sector = this.sectors.get(secKey);
      if (sector) {
        const reservedSeats = Math.max(0, sector.reservedSeats - 1);
        this.sectors.set(secKey, {
          ...sector,
          reservedSeats,
          freeSeats: computeFreeSectorSeats(
            sector.kind,
            sector.foundingCapacity,
            sector.validatedCapacity,
            reservedSeats,
            sector.foundedSeats,
          ),
          updatedAt: now,
        });
      }
      const ticket = this.ticketsById.get(current.ticketId);
      if (ticket && (ticket.state === 'RESERVED' || ticket.state === 'SPAWNING')) {
        this.ticketsById.set(ticket.id, {
          ...ticket,
          state: 'QUEUED',
          reservedPlanetId: null,
          reservedSectorId: null,
          reservedLandingSlotId: null,
          reservationEpoch: null,
          reservationExpiresAt: null,
          attempts: reason === 'EXPIRED' ? ticket.attempts + 1 : ticket.attempts,
          updatedAt: now.toISOString(),
        });
      }
      return { released: true, reservation: nextRes };
    });
  }

  async expireReservations(now: Date = new Date()): Promise<SectorReservationRecord[]> {
    const expired: SectorReservationRecord[] = [];
    for (const r of [...this.reservationsById.values()]) {
      const isHold = r.state === 'HELD' || (r.state as string) === 'SPAWNING';
      if (isHold && new Date(r.expiresAt).getTime() <= now.getTime()) {
        const out = await this.releaseReservation(r.reservationId, 'EXPIRED');
        if (out.released) expired.push(out.reservation);
      }
    }
    return expired;
  }

  async getReservationById(reservationId: string): Promise<SectorReservationRecord | null> {
    return this.reservationsById.get(reservationId) ?? null;
  }

  async getReservationByTicketId(ticketId: string): Promise<SectorReservationRecord | null> {
    for (const r of this.reservationsById.values()) {
      if (r.ticketId === ticketId) return r;
    }
    return null;
  }

  async listReservations(planetId: string, sectorId?: SectorId): Promise<SectorReservationRecord[]> {
    return [...this.reservationsById.values()]
      .filter((r) => r.planetId === planetId && (sectorId === undefined || r.sectorId === sectorId))
      .sort((a, b) => a.slotIndex - b.slotIndex);
  }
}
