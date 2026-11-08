import { newId, type LandingSlotId, type SectorId } from '@terra/contracts';
import type { PrismaClient, TransactionClient } from '@terra/db';
import {
  LobbyPersistenceConflictError,
  type ReserveSectorSlotInput,
  type ReserveSectorSlotOutcome,
  type SectorLandingSlotRecord,
  type SectorReservationRecord,
} from './lobby-persistence.types';
import { DEFAULT_RESERVATION_TTL_MS, type KeyedMutex } from './lobby-store.helpers';
import { mapLandingSlotRow, mapReservationRow, mapSectorRow } from './prisma-lobby-mappers';

export class PrismaReservationOps {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly mutex: KeyedMutex,
  ) {}

  async reserveSectorSlot(input: ReserveSectorSlotInput): Promise<ReserveSectorSlotOutcome> {
    return this.mutex.run(`planet:${input.planetId}`, () =>
      this.prisma.$transaction(async (tx) => {
        const existingRes = await this.findExistingReservationTx(tx, input);
        if (existingRes) return existingRes;

        const planet = await tx.planet.findUnique({ where: { id: input.planetId } });
        if (planet && (planet.admission !== 'OPEN' || planet.lifecycle !== 'ACTIVE' || planet.health !== 'OK')) {
          return {
            ok: false,
            reason: 'admission_closed',
            message: `planet ${input.planetId} is not open for admission`,
          };
        }

        const sectorRow = await tx.planetSector.findUnique({
          where: { planetId_sectorId: { planetId: input.planetId, sectorId: input.sectorId } },
        });
        if (!sectorRow) {
          throw new LobbyPersistenceConflictError(
            'sector_not_found',
            `sector ${input.sectorId} on ${input.planetId} not found`,
          );
        }
        if (sectorRow.kind === 'ocean') {
          return { ok: false, reason: 'ocean_sector', message: `ocean sector ${input.sectorId} has zero founding seats` };
        }
        const effectiveCap = Math.min(sectorRow.foundingCapacity, sectorRow.validatedCapacity);
        if (sectorRow.reservedSeats + sectorRow.foundedSeats >= effectiveCap) {
          return {
            ok: false,
            reason: 'sector_full',
            message: `sector ${input.sectorId} is at capacity (${sectorRow.reservedSeats + sectorRow.foundedSeats}/${effectiveCap})`,
          };
        }

        const slotPick = await this.pickSlotTx(tx, input.planetId, input.sectorId, input.landingSlotId);
        if (!slotPick.ok) return slotPick;

        return this.applySlotReservationTx(tx, input, slotPick.slot);
      }),
    );
  }

  private async findExistingReservationTx(
    tx: TransactionClient,
    input: ReserveSectorSlotInput,
  ): Promise<ReserveSectorSlotOutcome | null> {
    const conflicts = await tx.sectorReservation.findMany({
      where: {
        OR: [
          { ticketId: input.ticketId },
          { colonyId: input.colonyId },
          { playerId: input.playerId, state: { in: ['HELD', 'COMMITTED'] } },
        ],
      },
    });
    for (const r of conflicts) {
      const isActive = r.state === 'HELD' || r.state === 'COMMITTED';
      if (r.ticketId === input.ticketId || r.colonyId === input.colonyId) {
        if (
          isActive &&
          r.ticketId === input.ticketId &&
          r.colonyId === input.colonyId &&
          r.playerId === input.playerId &&
          r.planetId === input.planetId &&
          r.sectorId === input.sectorId &&
          (!input.landingSlotId || r.landingSlotId === input.landingSlotId)
        ) {
          const slot = await tx.sectorLandingSlot.findUniqueOrThrow({
            where: { planetId_landingSlotId: { planetId: r.planetId, landingSlotId: r.landingSlotId } },
          });
          const sector = await tx.planetSector.findUniqueOrThrow({
            where: { planetId_sectorId: { planetId: r.planetId, sectorId: r.sectorId } },
          });
          return {
            ok: true,
            idempotent: true,
            reservation: mapReservationRow(r),
            slot: mapLandingSlotRow(slot),
            sector: mapSectorRow(sector),
          };
        }
        throw new LobbyPersistenceConflictError(
          'duplicate_active_reservation',
          `ticket "${input.ticketId}" or colony "${input.colonyId}" already has a reservation`,
        );
      }
      if (isActive && r.playerId === input.playerId) {
        throw new LobbyPersistenceConflictError(
          'duplicate_active_reservation',
          `player "${input.playerId}" already holds an active reservation "${r.id}"`,
        );
      }
    }
    return null;
  }

  private async pickSlotTx(
    tx: TransactionClient,
    planetId: string,
    sectorId: SectorId,
    requestedSlotId?: LandingSlotId,
  ): Promise<{ readonly ok: true; readonly slot: SectorLandingSlotRecord } | ReserveSectorSlotOutcome> {
    if (requestedSlotId) {
      const row = await tx.sectorLandingSlot.findUnique({
        where: { planetId_landingSlotId: { planetId, landingSlotId: requestedSlotId } },
      });
      if (!row || row.sectorId !== sectorId) {
        throw new LobbyPersistenceConflictError(
          'slot_not_found',
          `landing slot ${requestedSlotId} not found in ${sectorId}`,
        );
      }
      if (row.state !== 'FREE') {
        return { ok: false, reason: 'slot_taken', message: `landing slot ${requestedSlotId} is already ${row.state}` };
      }
      return { ok: true, slot: mapLandingSlotRow(row) };
    }
    const freeRow = await tx.sectorLandingSlot.findFirst({
      where: { planetId, sectorId, state: 'FREE' },
      orderBy: { slotIndex: 'asc' },
    });
    if (!freeRow) {
      return { ok: false, reason: 'sector_full', message: `no free landing slots in ${sectorId}` };
    }
    return { ok: true, slot: mapLandingSlotRow(freeRow) };
  }

  private async applySlotReservationTx(
    tx: TransactionClient,
    input: ReserveSectorSlotInput,
    slot: SectorLandingSlotRecord,
  ): Promise<ReserveSectorSlotOutcome> {
    const now = input.now ?? new Date();
    const expiresAt = new Date(now.getTime() + (input.ttlMs ?? DEFAULT_RESERVATION_TTL_MS));
    const reservationId = input.reservationId ?? `res_${newId('mt').slice(3)}`;
    const nextEpoch = slot.epoch + 1;

    const updatedSlot = await tx.sectorLandingSlot.update({
      where: { id: slot.id },
      data: {
        state: 'HELD',
        reservationId,
        colonyId: input.colonyId,
        epoch: nextEpoch,
        expiresAt,
      },
    });
    const updatedSector = await tx.planetSector.update({
      where: { planetId_sectorId: { planetId: input.planetId, sectorId: input.sectorId } },
      data: { reservedSeats: { increment: 1 } },
    });
    const createdRes = await tx.sectorReservation.create({
      data: {
        id: reservationId,
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
        state: 'HELD',
        expiresAt,
      },
    });
    await tx.matchTicket.updateMany({
      where: { id: input.ticketId },
      data: {
        state: 'RESERVED',
        reservedPlanetId: input.planetId,
        reservedSectorId: input.sectorId,
        reservedLandingSlotId: slot.landingSlotId,
        reservationEpoch: nextEpoch,
        reservationExpiresAt: expiresAt,
      },
    });
    return {
      ok: true,
      idempotent: false,
      reservation: mapReservationRow(createdRes),
      slot: mapLandingSlotRow(updatedSlot),
      sector: mapSectorRow(updatedSector),
    };
  }

  async commitReservation(reservationId: string, expectedEpoch?: number): Promise<SectorReservationRecord> {
    const res = await this.prisma.sectorReservation.findUnique({ where: { id: reservationId } });
    if (!res) {
      throw new LobbyPersistenceConflictError('reservation_fenced', `reservation "${reservationId}" not found`);
    }
    return this.mutex.run(`planet:${res.planetId}`, () =>
      this.prisma.$transaction(async (tx) => {
        const current = await tx.sectorReservation.findUniqueOrThrow({ where: { id: reservationId } });
        if (expectedEpoch !== undefined && current.epoch !== expectedEpoch) {
          throw new LobbyPersistenceConflictError(
            'reservation_fenced',
            `reservation "${reservationId}" epoch mismatch (${current.epoch} !== ${expectedEpoch})`,
          );
        }
        if (current.state === 'COMMITTED') return mapReservationRow(current);
        if (current.state !== 'HELD') {
          throw new LobbyPersistenceConflictError(
            'reservation_fenced',
            `cannot commit reservation "${reservationId}" in state ${current.state}`,
          );
        }
        const committed = await tx.sectorReservation.update({
          where: { id: reservationId },
          data: { state: 'COMMITTED' },
        });
        await tx.sectorLandingSlot.updateMany({
          where: { planetId: current.planetId, landingSlotId: current.landingSlotId },
          data: { state: 'COMMITTED', expiresAt: null },
        });
        await tx.planetSector.updateMany({
          where: { planetId: current.planetId, sectorId: current.sectorId },
          data: { reservedSeats: { decrement: 1 }, foundedSeats: { increment: 1 } },
        });
        await tx.matchTicket.updateMany({
          where: { id: current.ticketId },
          data: { state: 'ASSIGNED' },
        });
        return mapReservationRow(committed);
      }),
    );
  }

  async releaseReservation(
    reservationId: string,
    reason: 'RELEASED' | 'EXPIRED' = 'RELEASED',
    expectedEpoch?: number,
  ): Promise<{ readonly released: boolean; readonly reservation: SectorReservationRecord }> {
    const res = await this.prisma.sectorReservation.findUnique({ where: { id: reservationId } });
    if (!res) {
      throw new LobbyPersistenceConflictError('reservation_fenced', `reservation "${reservationId}" not found`);
    }
    return this.mutex.run(`planet:${res.planetId}`, () =>
      this.prisma.$transaction(async (tx) => {
        const current = await tx.sectorReservation.findUniqueOrThrow({ where: { id: reservationId } });
        if (expectedEpoch !== undefined && current.epoch !== expectedEpoch) {
          throw new LobbyPersistenceConflictError(
            'reservation_fenced',
            `reservation "${reservationId}" epoch mismatch (${current.epoch} !== ${expectedEpoch})`,
          );
        }
        if (current.state === 'RELEASED' || current.state === 'EXPIRED') {
          return { released: false, reservation: mapReservationRow(current) };
        }
        if (current.state === 'COMMITTED') {
          throw new LobbyPersistenceConflictError(
            'reservation_fenced',
            `cannot release committed reservation "${reservationId}": founded seats remain held`,
          );
        }
        const updated = await tx.sectorReservation.update({
          where: { id: reservationId },
          data: { state: reason },
        });
        await tx.sectorLandingSlot.updateMany({
          where: { planetId: current.planetId, landingSlotId: current.landingSlotId, reservationId },
          data: { state: 'FREE', reservationId: null, colonyId: null, expiresAt: null },
        });
        await tx.planetSector.updateMany({
          where: { planetId: current.planetId, sectorId: current.sectorId },
          data: { reservedSeats: { decrement: 1 } },
        });
        return { released: true, reservation: mapReservationRow(updated) };
      }),
    );
  }

  async expireReservations(now: Date = new Date()): Promise<SectorReservationRecord[]> {
    const candidates = await this.prisma.sectorReservation.findMany({
      where: { state: 'HELD', expiresAt: { lte: now } },
    });
    const expired: SectorReservationRecord[] = [];
    for (const c of candidates) {
      const out = await this.releaseReservation(c.id, 'EXPIRED');
      if (out.released) expired.push(out.reservation);
    }
    return expired;
  }

  async getReservationById(reservationId: string): Promise<SectorReservationRecord | null> {
    const row = await this.prisma.sectorReservation.findUnique({ where: { id: reservationId } });
    return row ? mapReservationRow(row) : null;
  }

  async getReservationByTicketId(ticketId: string): Promise<SectorReservationRecord | null> {
    const row = await this.prisma.sectorReservation.findUnique({ where: { ticketId } });
    return row ? mapReservationRow(row) : null;
  }

  async listReservations(planetId: string, sectorId?: SectorId): Promise<SectorReservationRecord[]> {
    const rows = await this.prisma.sectorReservation.findMany({
      where: { planetId, ...(sectorId === undefined ? {} : { sectorId }) },
      orderBy: { slotIndex: 'asc' },
    });
    return rows.map(mapReservationRow);
  }
}
