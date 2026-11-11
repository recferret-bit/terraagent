import { Inject, Injectable, Optional } from '@nestjs/common';
import type { SectorId } from '@terra/contracts';
import { WorldLifecycleService } from './lifecycle.service';
import { LobbyPersistenceService } from './lobby-persistence.service';
import {
  LobbyPersistenceConflictError,
  type CanonicalWorldRecord,
  type MatchTicketRecord,
  type PlanetSectorRecord,
  type SectorLandingSlotRecord,
  type SectorReservationRecord,
} from './lobby-persistence.types';
import { KeyedMutex } from './lobby-store.helpers';
import {
  checkIdempotentTicketReservation,
  tryCandidateSlotsWithAuthorityHelper,
} from './parts/reservation-service-parts';
import {
  evaluateSectorCapacityGuard,
  evaluateWorldAdmissionGuard,
  findCandidateFreeSlots,
  makeFailureResult,
  resolveTargetSectorForTicket,
  toManagedReservationRecord,
} from './reservation.helpers';
import {
  SIM_LANDING_AUTHORITY_VALIDATOR,
  type CommitReservationOptions,
  type ManagedReservationState,
  type ManagedSectorReservationRecord,
  type ReleaseReservationOptions,
  type ReleaseReservationResult,
  type ReservationSlotFencePolicy,
  type ReserveSectorSlotRequest,
  type ReserveSlotForTicketOptions,
  type SectorReservationResult,
  type SimLandingAuthorityValidator,
  type SweepExpiredReservationsOptions,
} from './reservation.types';

/**
 * Atomic sector-seat and safe landing-slot reservation service (W11-11: MM-01..06, MM-33, §5.2).
 *
 * Guarantees:
 * - Per-planet mutex serialization so N concurrent joins for an X=4 sector allocate at most 4 distinct slots
 *   and return `{ ok: false, code: 'sector_full' }` for the 5th while keeping its ticket `QUEUED`.
 * - World lifecycle/health/admission guard (`ACTIVE` + `OK` + `OPEN`) and land-only sector guard (`kind === 'land'`).
 * - Pre-hold sim authority revalidation (`SimLandingAuthorityValidator` + `@terra/sim` default checks) so rejected
 *   candidate slots never leak a database reservation hold.
 * - Idempotent `commitReservation`, `releaseReservation`, `expireReservation`, and TTL sweep (`MATCH_SEAT_TTL_S = 90`).
 */
@Injectable()
export class SectorReservationService {
  private readonly mutex = new KeyedMutex();
  private readonly spawningStateById = new Map<string, boolean>();
  private slotFencePolicy?: ReservationSlotFencePolicy;

  constructor(
    @Inject(LobbyPersistenceService)
    private readonly persistence: LobbyPersistenceService,
    @Optional()
    @Inject(WorldLifecycleService)
    private readonly lifecycle?: WorldLifecycleService,
    @Optional()
    @Inject(SIM_LANDING_AUTHORITY_VALIDATOR)
    private authorityValidator?: SimLandingAuthorityValidator,
  ) {}

  setAuthorityValidator(validator: SimLandingAuthorityValidator | undefined): void {
    this.authorityValidator = validator;
  }

  getAuthorityValidator(): SimLandingAuthorityValidator | undefined {
    return this.authorityValidator;
  }

  setSlotFencePolicy(policy: ReservationSlotFencePolicy | undefined): void {
    this.slotFencePolicy = policy;
  }

  getSlotFencePolicy(): ReservationSlotFencePolicy | undefined {
    return this.slotFencePolicy;
  }

  async reserveSlotForTicket(
    ticketOrId: string | MatchTicketRecord,
    optionsOrSectorId?: ReserveSlotForTicketOptions | SectorId,
  ): Promise<SectorReservationResult> {
    const opts: ReserveSlotForTicketOptions =
      typeof optionsOrSectorId === 'string'
        ? { sectorId: optionsOrSectorId }
        : (optionsOrSectorId ?? {});
    const ticketId = typeof ticketOrId === 'string' ? ticketOrId : ticketOrId.id;
    const initialTicket =
      typeof ticketOrId === 'string'
        ? await this.persistence.getTicketById(ticketId)
        : ticketOrId;

    if (!initialTicket) {
      return makeFailureResult('ticket_not_found', `Match ticket "${ticketId}" not found`);
    }

    const resolvedSectorId = await resolveTargetSectorForTicket(
      this.persistence,
      initialTicket,
      opts.sectorId,
    );
    if (!resolvedSectorId) {
      return makeFailureResult(
        'sector_full',
        `No land sector with available seats found on planet ${initialTicket.planetId}`,
        { ticket: initialTicket },
      );
    }

    return this.reserveSectorSlot({
      planetId: initialTicket.planetId,
      sectorId: resolvedSectorId,
      landingSlotId: opts.landingSlotId,
      ticketId: initialTicket.id,
      playerId: initialTicket.playerId,
      colonyId: initialTicket.colonyId,
      reservationId: opts.reservationId,
      ttlMs: opts.ttlMs,
      ttlS: opts.ttlS,
      now: opts.now,
      authorityValidator: opts.authorityValidator,
      simState: opts.simState,
      generatedAtlas: opts.generatedAtlas,
    });
  }

  async reserveSectorSlot(input: ReserveSectorSlotRequest): Promise<SectorReservationResult> {
    return this.mutex.run(`planet:${input.planetId}`, async () => {
      return this.executeReserveUnderLock(input);
    });
  }

  private async executeReserveUnderLock(
    input: ReserveSectorSlotRequest,
  ): Promise<SectorReservationResult> {
    const ticket = await this.persistence.getTicketById(input.ticketId);
    if (
      ticket &&
      ticket.state !== 'QUEUED' &&
      ticket.state !== 'RESERVED' &&
      ticket.state !== 'SPAWNING'
    ) {
      return makeFailureResult(
        'ticket_not_reservable',
        `Ticket "${input.ticketId}" cannot reserve a slot from state ${ticket.state}`,
        { ticket },
      );
    }

    const idempotentHit = await this.checkIdempotentReservation(input, ticket);
    if (idempotentHit) return idempotentHit;

    const world = await this.persistence.getCanonicalWorldById(input.planetId);
    if (!world) {
      return makeFailureResult(
        'planet_not_found',
        `Canonical world "${input.planetId}" not found`,
        { ticket },
      );
    }

    const worldGuard = evaluateWorldAdmissionGuard(
      world,
      this.lifecycle?.isQueuePaused() ?? false,
    );
    if (worldGuard) return { ...worldGuard, ticket };

    const sector = await this.persistence.getSector(input.planetId, input.sectorId);
    if (!sector) {
      return makeFailureResult(
        'sector_not_found',
        `Sector "${input.sectorId}" on "${input.planetId}" not found`,
        { ticket },
      );
    }

    const sectorGuard = evaluateSectorCapacityGuard(sector);
    if (sectorGuard) return { ...sectorGuard, ticket };

    const candidatesOutcome = await findCandidateFreeSlots(
      this.persistence,
      input.planetId,
      input.sectorId,
      input.landingSlotId,
      ticket,
      this.slotFencePolicy,
    );
    if (!candidatesOutcome.ok) return candidatesOutcome.failure;

    return this.tryCandidateSlotsWithAuthority(
      input,
      world,
      sector,
      candidatesOutcome.slots,
      ticket,
    );
  }

  private async checkIdempotentReservation(
    input: ReserveSectorSlotRequest,
    ticket: MatchTicketRecord | null,
  ): Promise<SectorReservationResult | null> {
    return checkIdempotentTicketReservation({
      persistence: this.persistence,
      input,
      ticket,
      spawningStateById: this.spawningStateById,
      decorateRecord: (r) => this.decorateRecord(r),
    });
  }

  private async tryCandidateSlotsWithAuthority(
    input: ReserveSectorSlotRequest,
    world: CanonicalWorldRecord,
    sector: PlanetSectorRecord,
    candidates: readonly SectorLandingSlotRecord[],
    ticket: MatchTicketRecord | null,
  ): Promise<SectorReservationResult> {
    return tryCandidateSlotsWithAuthorityHelper({
      persistence: this.persistence,
      input,
      world,
      sector,
      candidates,
      ticket,
      defaultValidator: this.authorityValidator,
      decorateRecord: (r) => this.decorateRecord(r),
    });
  }

  async markReservationSpawning(
    reservationId: string,
    expectedEpoch?: number,
  ): Promise<ManagedSectorReservationRecord> {
    const existing = await this.persistence.getReservationById(reservationId);
    if (!existing) {
      throw new LobbyPersistenceConflictError(
        'reservation_fenced',
        `Reservation "${reservationId}" not found`,
      );
    }
    return this.mutex.run(`planet:${existing.planetId}`, async () => {
      const current = await this.persistence.getReservationById(reservationId);
      if (!current) {
        throw new LobbyPersistenceConflictError(
          'reservation_fenced',
          `Reservation "${reservationId}" not found`,
        );
      }
      if (expectedEpoch !== undefined && current.epoch !== expectedEpoch) {
        throw new LobbyPersistenceConflictError(
          'reservation_fenced',
          `Reservation "${reservationId}" epoch mismatch (${current.epoch} !== ${expectedEpoch})`,
        );
      }
      if (current.state !== 'HELD') {
        throw new LobbyPersistenceConflictError(
          'reservation_fenced',
          `Cannot mark reservation "${reservationId}" SPAWNING from state ${current.state}`,
        );
      }
      this.spawningStateById.set(reservationId, true);
      const ticket = await this.persistence.getTicketById(current.ticketId);
      if (ticket && ticket.state === 'RESERVED') {
        await this.persistence.updateTicketState({
          ticketId: ticket.id,
          state: 'SPAWNING',
        });
      }
      return this.decorateRecord(current);
    });
  }

  private async runWithReservationMutex<T>(
    reservationId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const existing = await this.persistence.getReservationById(reservationId);
    if (!existing) {
      throw new LobbyPersistenceConflictError(
        'reservation_fenced',
        `Reservation "${reservationId}" not found`,
      );
    }
    return this.mutex.run(`planet:${existing.planetId}`, async () => {
      this.spawningStateById.delete(reservationId);
      return fn();
    });
  }

  async commitReservation(
    reservationId: string,
    options?: CommitReservationOptions | number,
  ): Promise<ManagedSectorReservationRecord> {
    const expectedEpoch = typeof options === 'number' ? options : options?.expectedEpoch;
    return this.runWithReservationMutex(reservationId, async () => {
      const committed = await this.persistence.commitReservation(reservationId, expectedEpoch);
      return this.decorateRecord(committed, 'COMMITTED');
    });
  }

  async releaseReservation(
    reservationId: string,
    reason: 'RELEASED' | 'EXPIRED' = 'RELEASED',
    options?: ReleaseReservationOptions | number,
  ): Promise<ReleaseReservationResult> {
    const expectedEpoch = typeof options === 'number' ? options : options?.expectedEpoch;
    const allowCommitted = typeof options === 'object' ? options?.allowCommitted : undefined;
    return this.runWithReservationMutex(reservationId, async () => {
      const out = await this.persistence.releaseReservation(
        reservationId,
        reason,
        expectedEpoch,
        allowCommitted ? { allowCommitted } : undefined,
      );
      const ticket = await this.persistence.getTicketById(out.reservation.ticketId);
      return {
        released: out.released,
        reservation: this.decorateRecord(out.reservation, out.reservation.state),
        ticket,
      };
    });
  }

  async expireReservation(
    reservationId: string,
    options?: ReleaseReservationOptions | number,
  ): Promise<ReleaseReservationResult> {
    return this.releaseReservation(reservationId, 'EXPIRED', options);
  }

  async sweepExpiredReservations(
    nowOrOptions?: Date | SweepExpiredReservationsOptions,
  ): Promise<ManagedSectorReservationRecord[]> {
    const opts: SweepExpiredReservationsOptions =
      nowOrOptions instanceof Date ? { now: nowOrOptions } : (nowOrOptions ?? {});
    if (!opts.ignoreQueuePause && (this.lifecycle?.isQueuePaused() ?? false)) {
      return [];
    }
    const now = opts.now ?? new Date();
    const worlds = opts.planetId
      ? [await this.persistence.getCanonicalWorldById(opts.planetId)].filter(
          (w): w is CanonicalWorldRecord => w !== null,
        )
      : await this.persistence.listCanonicalWorlds();

    const expired: ManagedSectorReservationRecord[] = [];
    for (const world of worlds) {
      if (!opts.ignoreQueuePause && world.admission !== 'OPEN') {
        continue;
      }
      const reservations = await this.persistence.listReservations(world.id);
      for (const res of reservations) {
        const isHold = res.state === 'HELD' || this.spawningStateById.has(res.reservationId);
        if (isHold && new Date(res.expiresAt).getTime() <= now.getTime()) {
          const out = await this.releaseReservation(res.reservationId, 'EXPIRED', { now });
          if (out.released) {
            expired.push(out.reservation);
          }
        }
      }
    }
    return expired;
  }

  async getReservationById(reservationId: string): Promise<ManagedSectorReservationRecord | null> {
    const res = await this.persistence.getReservationById(reservationId);
    return res ? this.decorateRecord(res) : null;
  }

  async getReservationByTicketId(ticketId: string): Promise<ManagedSectorReservationRecord | null> {
    const res = await this.persistence.getReservationByTicketId(ticketId);
    return res ? this.decorateRecord(res) : null;
  }

  async listReservations(
    planetId: string,
    sectorId?: SectorId,
  ): Promise<ManagedSectorReservationRecord[]> {
    const list = await this.persistence.listReservations(planetId, sectorId);
    return list.map((r) => this.decorateRecord(r));
  }

  private decorateRecord(
    record: SectorReservationRecord,
    overrideState?: ManagedReservationState,
  ): ManagedSectorReservationRecord {
    const state =
      overrideState ??
      (record.state === 'HELD' && this.spawningStateById.has(record.reservationId)
        ? 'SPAWNING'
        : record.state);
    return toManagedReservationRecord(record, state);
  }
}

export { SectorReservationService as ReservationService };
