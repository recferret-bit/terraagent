import type { LandingSlotId, SectorId, SimCommandV1 } from '@terra/contracts';
import type { ColonyRecord, HomeRepository } from '../core/home/home.repository';
import type { LobbyPersistenceService } from './lobby-persistence.service';
import type { MatchTicketRecord, SectorReservationRecord } from './lobby-persistence.types';
import type { ManagedSectorReservationRecord, ReservationSlotFencePolicy } from './reservation.types';
import {
  buildProvisionalColonyRecord,
  DefaultColonySpawnExecutor,
  upsertActiveColonyInHomeRepo,
} from './spawn-saga.helpers';
import {
  ORPHAN_RETIRE_REASON,
  type ExecuteSpawnSagaOptions,
  type FencedReservationRecord,
  type PendingLateSpawnRecord,
  type ReconciledOrphanColonyRecord,
  type ReconcileOrphanColonyInput,
  type RetireColonyCommand,
  type SpawnSagaMetricsSnapshot,
  type SpawnSagaOutcome,
} from './spawn-saga.types';

export type NormalizedReconcileTarget = Required<
  Omit<ReconcileOrphanColonyInput, 'appliedAtTick'>
> & {
  readonly appliedAtTick?: number;
};

/**
 * Per-instance state store for `SpawnSagaService` tracking provisional colonies,
 * idempotency cache, expiry fences, pending late spawns, and reconciliation metrics.
 */
export class SpawnSagaStateStore implements ReservationSlotFencePolicy {
  readonly defaultExecutor = new DefaultColonySpawnExecutor();
  readonly provisionalColoniesById = new Map<string, ColonyRecord>();
  readonly committedOutcomeByColonyId = new Map<string, SpawnSagaOutcome>();
  readonly fencedReservationsById = new Map<string, FencedReservationRecord>();
  readonly fencedReservationByColonyId = new Map<string, FencedReservationRecord>();
  readonly pendingLateSpawnByColonyId = new Map<string, PendingLateSpawnRecord>();
  readonly pendingLateSpawnBySlotKey = new Map<string, PendingLateSpawnRecord>();
  readonly deprioritizedSlotKeys = new Set<string>();
  readonly processedExpiryByReservationId = new Set<string>();
  readonly reconciledOrphanByKey = new Map<string, ReconciledOrphanColonyRecord>();
  readonly reconciledOrphanByColonyId = new Map<string, ReconciledOrphanColonyRecord>();
  readonly spawnCommandsSent: SimCommandV1[] = [];
  readonly retireCommandsSent: RetireColonyCommand[] = [];

  spawnsCommittedCount = 0;
  spawnsFailedCount = 0;
  reservationsExpiredCount = 0;
  duplicateAcksCount = 0;
  retryAttemptsCount = 0;

  isSlotBlockedByPendingSpawn(planetId: string, slotOrSectorId: string, maybeSlotId?: string): boolean {
    const slotId = maybeSlotId ?? slotOrSectorId;
    return this.pendingLateSpawnBySlotKey.has(`${planetId}:${slotId}`);
  }

  isSlotDeprioritized(planetId: string, slotOrSectorId: string, maybeSlotId?: string): boolean {
    const slotId = maybeSlotId ?? slotOrSectorId;
    return this.deprioritizedSlotKeys.has(`${planetId}:${slotId}`);
  }

  getMetricsSnapshot(): SpawnSagaMetricsSnapshot {
    return {
      orphanColoniesReconciled: this.reconciledOrphanByKey.size,
      reservationsExpired: this.reservationsExpiredCount,
      spawnsCommitted: this.spawnsCommittedCount,
      spawnsFailed: this.spawnsFailedCount,
      duplicateAcks: this.duplicateAcksCount,
      retryAttempts: this.retryAttemptsCount,
      pendingLateSpawns: this.pendingLateSpawnByColonyId.size,
    };
  }

  setPendingLateSpawn(
    reservation: ManagedSectorReservationRecord,
    attempt: number,
    now: Date,
  ): void {
    const pending: PendingLateSpawnRecord = {
      reservationId: reservation.reservationId,
      ticketId: reservation.ticketId,
      colonyId: reservation.colonyId,
      playerId: reservation.playerId,
      planetId: reservation.planetId,
      sectorId: reservation.sectorId,
      landingSlotId: reservation.landingSlotId,
      slotIndex: reservation.slotIndex,
      q: reservation.q,
      r: reservation.r,
      epoch: reservation.epoch,
      expiresAt: reservation.expiresAt,
      attempt,
      startedAt: now,
      inFlight: true,
    };
    this.pendingLateSpawnByColonyId.set(reservation.colonyId, pending);
    this.pendingLateSpawnBySlotKey.set(`${reservation.planetId}:${reservation.landingSlotId}`, pending);
  }

  clearPendingLateSpawn(reservation: {
    readonly colonyId: string;
    readonly planetId: string;
    readonly landingSlotId: LandingSlotId;
  }): void {
    this.pendingLateSpawnByColonyId.delete(reservation.colonyId);
    const slotKey = `${reservation.planetId}:${reservation.landingSlotId}`;
    if (this.pendingLateSpawnBySlotKey.get(slotKey)?.colonyId === reservation.colonyId) {
      this.pendingLateSpawnBySlotKey.delete(slotKey);
    }
  }

  recordFenceAndAbandonedColony(
    reservation: ManagedSectorReservationRecord,
    now: Date,
    reason: 'expired' | 'cancelled' | 'retries_exhausted',
    options: ExecuteSpawnSagaOptions,
  ): ColonyRecord {
    const fence: FencedReservationRecord = {
      reservationId: reservation.reservationId,
      ticketId: reservation.ticketId,
      colonyId: reservation.colonyId,
      playerId: reservation.playerId,
      planetId: reservation.planetId,
      sectorId: reservation.sectorId,
      landingSlotId: reservation.landingSlotId,
      slotIndex: reservation.slotIndex,
      q: reservation.q,
      r: reservation.r,
      epoch: reservation.epoch,
      expiresAt: reservation.expiresAt,
      reason,
      fencedAt: now,
    };
    this.fencedReservationsById.set(reservation.reservationId, fence);
    this.fencedReservationByColonyId.set(reservation.colonyId, fence);
    this.deprioritizedSlotKeys.add(`${reservation.planetId}:${reservation.landingSlotId}`);
    const abandonedColony = buildProvisionalColonyRecord(reservation, 'ABANDONED', options);
    this.provisionalColoniesById.set(reservation.colonyId, abandonedColony);
    return abandonedColony;
  }

  async isReservationFencedOrExpired(
    persistence: LobbyPersistenceService,
    reservation: ManagedSectorReservationRecord,
    now: Date,
  ): Promise<boolean> {
    if (this.fencedReservationsById.has(reservation.reservationId)) return true;
    if (Date.parse(reservation.expiresAt) <= now.getTime()) return true;
    const latest = await persistence.getReservationById(reservation.reservationId);
    if (!latest) return true;
    if (latest.epoch !== reservation.epoch) return true;
    if (latest.state === 'EXPIRED' || latest.state === 'RELEASED') return true;
    if (Date.parse(latest.expiresAt) <= now.getTime()) return true;
    return false;
  }

  async checkIdempotentState(
    persistence: LobbyPersistenceService,
    homeRepo: HomeRepository,
    reservation: ManagedSectorReservationRecord,
    initialTicket: MatchTicketRecord | null,
    options: ExecuteSpawnSagaOptions,
  ): Promise<SpawnSagaOutcome | null> {
    const existingCommitted = this.committedOutcomeByColonyId.get(reservation.colonyId);
    const isFenced = this.fencedReservationsById.has(reservation.reservationId);
    if (
      existingCommitted &&
      !isFenced &&
      existingCommitted.reservation.reservationId === reservation.reservationId
    ) {
      this.duplicateAcksCount++;
      return { ...existingCommitted, duplicateAck: true, idempotent: true };
    }

    const existingColony = await homeRepo.findColonyById(reservation.colonyId);
    if (
      !isFenced &&
      (reservation.state === 'COMMITTED' ||
        (existingColony &&
          existingColony.status === 'ACTIVE' &&
          existingColony.landingSlotId === reservation.landingSlotId))
    ) {
      this.duplicateAcksCount++;
      const colony =
        existingColony ?? (await upsertActiveColonyInHomeRepo(homeRepo, reservation, options));
      const ticket = (await persistence.getTicketById(reservation.ticketId)) ?? initialTicket;
      const outcome: SpawnSagaOutcome = {
        ok: true,
        status: 'committed',
        duplicateAck: true,
        idempotent: true,
        orphanReconciled: false,
        requeued: false,
        ticketFailed: false,
        attemptsUsed: 0,
        ticketAttempts: ticket?.attempts ?? 0,
        backoffDelaysMs: [],
        appliedAtTick: 1,
        colonyId: reservation.colonyId,
        planetId: reservation.planetId,
        sectorId: reservation.sectorId,
        landingSlotId: reservation.landingSlotId,
        colony,
        reservation: { ...reservation, state: 'COMMITTED' },
        ticket,
        spawnCommand: null,
        retireCommand: null,
        failureCode: null,
        error: null,
      };
      this.committedOutcomeByColonyId.set(reservation.colonyId, outcome);
      return outcome;
    }
    return null;
  }

  async normalizeReconcileInput(
    persistence: LobbyPersistenceService,
    homeRepo: HomeRepository,
    input: string | ReconcileOrphanColonyInput | SectorReservationRecord | ManagedSectorReservationRecord,
  ): Promise<NormalizedReconcileTarget> {
    const colonyId = typeof input === 'string' ? input : input.colonyId;
    const explicit = typeof input === 'string' ? undefined : input;
    const fenced =
      (explicit?.reservationId ? this.fencedReservationsById.get(explicit.reservationId) : undefined) ??
      this.fencedReservationByColonyId.get(colonyId);
    const pending = this.pendingLateSpawnByColonyId.get(colonyId);
    const byResId = explicit?.reservationId
      ? await persistence.getReservationById(explicit.reservationId)
      : null;
    const ref =
      (typeof input !== 'string' && 'state' in input ? input : null) ?? fenced ?? pending ?? byResId;
    const provisional =
      this.provisionalColoniesById.get(colonyId) ?? (await homeRepo.findColonyById(colonyId));

    return {
      colonyId,
      reservationId: explicit?.reservationId ?? ref?.reservationId ?? `res_${colonyId}`,
      ticketId: explicit?.ticketId ?? ref?.ticketId ?? '',
      playerId: explicit?.playerId ?? ref?.playerId ?? provisional?.playerId ?? 'player_unknown',
      planetId: explicit?.planetId ?? ref?.planetId ?? provisional?.planetId ?? 'planet_unknown',
      sectorId: (explicit?.sectorId ?? ref?.sectorId ?? provisional?.foundingSectorId ?? 'S00') as SectorId,
      landingSlotId: (explicit?.landingSlotId ??
        ref?.landingSlotId ??
        provisional?.landingSlotId ??
        'S00-slot-0') as LandingSlotId,
      slotIndex: explicit?.slotIndex ?? ref?.slotIndex ?? provisional?.colonyIndex ?? 0,
      q: explicit?.q ?? ref?.q ?? provisional?.spawnQ ?? 0,
      r: explicit?.r ?? ref?.r ?? provisional?.spawnR ?? 0,
      epoch: explicit?.epoch ?? ref?.epoch ?? 1,
      appliedAtTick: explicit && 'appliedAtTick' in explicit ? explicit.appliedAtTick : undefined,
      reason:
        explicit && 'reason' in explicit && explicit.reason ? explicit.reason : ORPHAN_RETIRE_REASON,
    };
  }
}
