import { Inject, Injectable, Optional } from '@nestjs/common';
import type { SimCommandV1 } from '@terra/contracts';
import { HomeRepository, type ColonyRecord } from '../core/home/home.repository';
import { GamePlanets } from '../game/game-planets.service';
import { WorldLifecycleService } from './lifecycle.service';
import { LobbyPersistenceService } from './lobby-persistence.service';
import type { MatchTicketRecord, SectorReservationRecord } from './lobby-persistence.types';
import { KeyedMutex } from './lobby-store.helpers';
import { SectorReservationService } from './reservation.service';
import type {
  ManagedSectorReservationRecord,
  ReservationSlotFencePolicy,
} from './reservation.types';
import {
  buildAlreadyReconciledResult,
  executeOrphanReconciliationHelper,
  expireAndFenceReservationHelper,
  finalizeSuccessfulSpawnAttemptHelper,
  resolveSagaClock,
} from './spawn-saga-reconcile.helpers';
import { SpawnSagaStateStore } from './spawn-saga-state';
import {
  buildProvisionalColonyRecord,
  buildSpawnExecutionRequest,
  DefaultColonySpawnExecutor,
  invokeSpawnExecutorWithTimeout,
  resolveReservationAndTicket,
} from './spawn-saga.helpers';
import {
  COLONY_SPAWN_EXECUTOR,
  DEFAULT_MAX_SPAWN_RETRIES_PER_RESERVATION,
  DEFAULT_MAX_TICKET_ATTEMPTS,
  DEFAULT_SPAWN_RETRY_BACKOFF_MS,
  ORPHAN_RETIRE_REASON,
  type ColonySpawnExecutor,
  type ExecuteSpawnSagaOptions,
  type FencedReservationRecord,
  type PendingLateSpawnRecord,
  type ReconciledOrphanColonyRecord,
  type ReconcileOrphanColonyInput,
  type ReconcileOrphanColonyResult,
  type RetireColonyCommand,
  type SpawnBackoffSleepFn,
  type SpawnSagaInput,
  type SpawnSagaMetricsSnapshot,
  type SpawnSagaOutcome,
} from './spawn-saga.types';

/**
 * Idempotent colony spawn saga, bounded retry coordinator, expiry fence, and orphan reconciler
 * (W11-13: MATCHMAKING §0.2 MM-35..38, §5.2 E6..E8).
 */
@Injectable()
export class SpawnSagaService implements ReservationSlotFencePolicy {
  private readonly sagaMutex = new KeyedMutex();
  private readonly reservations: SectorReservationService;
  private readonly homeRepo: HomeRepository;
  private readonly lifecycle: WorldLifecycleService;
  private readonly state = new SpawnSagaStateStore();
  private spawnExecutor?: ColonySpawnExecutor;
  private defaultSleepFn: SpawnBackoffSleepFn = async () => {};

  constructor(
    @Inject(LobbyPersistenceService)
    private readonly persistence: LobbyPersistenceService,
    @Optional()
    @Inject(SectorReservationService)
    arg2?: SectorReservationService | HomeRepository | WorldLifecycleService | ColonySpawnExecutor,
    @Optional()
    @Inject(HomeRepository)
    arg3?: HomeRepository | SectorReservationService | WorldLifecycleService | ColonySpawnExecutor,
    @Optional()
    @Inject(WorldLifecycleService)
    arg4?: WorldLifecycleService | HomeRepository | SectorReservationService | ColonySpawnExecutor,
    @Optional()
    @Inject(COLONY_SPAWN_EXECUTOR)
    arg5?: ColonySpawnExecutor,
    @Optional()
    @Inject(GamePlanets)
    private readonly gamePlanets?: GamePlanets,
  ) {
    const candidates = [arg2, arg3, arg4, arg5];
    this.lifecycle =
      candidates.find((c): c is WorldLifecycleService => c instanceof WorldLifecycleService) ??
      new WorldLifecycleService(this.persistence);
    this.reservations =
      candidates.find((c): c is SectorReservationService => c instanceof SectorReservationService) ??
      new SectorReservationService(this.persistence, this.lifecycle);
    this.homeRepo =
      candidates.find((c): c is HomeRepository => c instanceof HomeRepository) ??
      new HomeRepository();
    this.spawnExecutor = candidates.find(
      (c): c is ColonySpawnExecutor =>
        c !== undefined &&
        !(c instanceof SectorReservationService) &&
        !(c instanceof HomeRepository) &&
        !(c instanceof WorldLifecycleService),
    );
    this.reservations.setSlotFencePolicy(this);
  }

  setSpawnExecutor(executor: ColonySpawnExecutor | undefined): void {
    this.spawnExecutor = executor;
  }
  getSpawnExecutor(): ColonySpawnExecutor | undefined {
    return this.spawnExecutor;
  }
  setDefaultSleepFn(sleepFn: SpawnBackoffSleepFn): void {
    this.defaultSleepFn = sleepFn;
  }
  getDefaultSpawnExecutor(): DefaultColonySpawnExecutor {
    return this.state.defaultExecutor;
  }
  getHomeRepository(): HomeRepository {
    return this.homeRepo;
  }
  getReservationService(): SectorReservationService {
    return this.reservations;
  }
  get orphanColoniesReconciled(): number {
    return this.state.reconciledOrphanByKey.size;
  }
  getOrphanColoniesReconciledCount(): number {
    return this.state.reconciledOrphanByKey.size;
  }
  getReconciledOrphans(): ReconciledOrphanColonyRecord[] {
    return [...this.state.reconciledOrphanByKey.values()];
  }
  getSpawnCommandsSent(): SimCommandV1[] {
    return [...this.state.spawnCommandsSent];
  }
  getRetireCommandsSent(): RetireColonyCommand[] {
    return [...this.state.retireCommandsSent];
  }
  getPendingLateSpawn(colonyId: string): PendingLateSpawnRecord | null {
    return this.state.pendingLateSpawnByColonyId.get(colonyId) ?? null;
  }
  getFencedReservation(colonyIdOrReservationId: string): FencedReservationRecord | null {
    return (
      this.state.fencedReservationsById.get(colonyIdOrReservationId) ??
      this.state.fencedReservationByColonyId.get(colonyIdOrReservationId) ??
      null
    );
  }
  async getColonyRecord(colonyId: string): Promise<ColonyRecord | null> {
    return (await this.homeRepo.findColonyById(colonyId)) ?? this.state.provisionalColoniesById.get(colonyId) ?? null;
  }
  getMetricsSnapshot(): SpawnSagaMetricsSnapshot {
    return this.state.getMetricsSnapshot();
  }
  isSlotBlockedByPendingSpawn(planetId: string, slotOrSectorId: string, maybeSlotId?: string): boolean {
    return this.state.isSlotBlockedByPendingSpawn(planetId, slotOrSectorId, maybeSlotId);
  }
  isSlotDeprioritized(planetId: string, slotOrSectorId: string, maybeSlotId?: string): boolean {
    return this.state.isSlotDeprioritized(planetId, slotOrSectorId, maybeSlotId);
  }
  async runSpawnSaga(input: SpawnSagaInput, options: ExecuteSpawnSagaOptions = {}): Promise<SpawnSagaOutcome> {
    return this.executeSpawnForReservation(input, options);
  }
  async executeSpawnForTicket(
    ticketOrId: string | MatchTicketRecord,
    options: ExecuteSpawnSagaOptions = {},
  ): Promise<SpawnSagaOutcome> {
    return this.executeSpawnForReservation(ticketOrId, options);
  }

  async executeSpawnForReservation(
    input: SpawnSagaInput,
    options: ExecuteSpawnSagaOptions = {},
  ): Promise<SpawnSagaOutcome> {
    const resolved = await resolveReservationAndTicket(this.persistence, input);
    if (!resolved.reservation) {
      if (typeof input === 'string' && this.state.committedOutcomeByColonyId.has(input)) {
        this.state.duplicateAcksCount++;
        return {
          ...this.state.committedOutcomeByColonyId.get(input)!,
          duplicateAck: true,
          idempotent: true,
        };
      }
      throw new Error('SpawnSagaService: reservation not found for input');
    }
    const reservation = resolved.reservation;
    return this.sagaMutex.run(`colony:${reservation.colonyId}`, () =>
      this.executeLockedSaga(reservation, resolved.ticket, options),
    );
  }

  private async executeLockedSaga(
    reservation: ManagedSectorReservationRecord,
    initialTicket: MatchTicketRecord | null,
    options: ExecuteSpawnSagaOptions,
  ): Promise<SpawnSagaOutcome> {
    const getNow = resolveSagaClock(options.now);
    const idempotentHit = await this.state.checkIdempotentState(
      this.persistence,
      this.homeRepo,
      reservation,
      initialTicket,
      options,
    );
    if (idempotentHit) return idempotentHit;

    const maxTicketAttempts = Math.max(1, options.maxTicketAttempts ?? DEFAULT_MAX_TICKET_ATTEMPTS);
    if (await this.state.isReservationFencedOrExpired(this.persistence, reservation, getNow())) {
      return this.expireAndFence({
        reservation,
        ticket: initialTicket,
        now: getNow(),
        reason: 'expired',
        attemptsUsed: 0,
        backoffDelaysMs: [],
        spawnCommand: null,
        error: 'Reservation expired before spawn could start',
        maxTicketAttempts,
        options,
      });
    }

    this.state.provisionalColoniesById.set(
      reservation.colonyId,
      buildProvisionalColonyRecord(reservation, 'FOUNDING', options),
    );
    let spawning: ManagedSectorReservationRecord | null;
    try {
      spawning = await this.reservations.markReservationSpawning(
        reservation.reservationId,
        reservation.epoch,
      );
    } catch {
      spawning = null;
    }
    if (!spawning) {
      return this.expireAndFence({
        reservation,
        ticket: initialTicket,
        now: getNow(),
        reason: 'expired',
        attemptsUsed: 0,
        backoffDelaysMs: [],
        spawnCommand: null,
        error: 'Reservation could not transition to SPAWNING (expired or epoch mismatch)',
        maxTicketAttempts,
        options,
      });
    }

    return this.runBoundedSpawnLoop(spawning, initialTicket, getNow, maxTicketAttempts, options);
  }

  private async runBoundedSpawnLoop(
    reservation: ManagedSectorReservationRecord,
    initialTicket: MatchTicketRecord | null,
    getNow: () => Date,
    maxTicketAttempts: number,
    options: ExecuteSpawnSagaOptions,
  ): Promise<SpawnSagaOutcome> {
    const maxRetries = Math.max(
      1,
      options.maxSpawnRetriesPerReservation ?? options.maxRetries ?? DEFAULT_MAX_SPAWN_RETRIES_PER_RESERVATION,
    );
    const backoffSchedule = options.backoffMs ?? DEFAULT_SPAWN_RETRY_BACKOFF_MS;
    const sleepFn = options.sleepFn ?? this.defaultSleepFn;
    const activeExecutor = options.executor ?? options.spawnExecutor ?? this.spawnExecutor;
    const backoffDelaysMs: number[] = [];
    let attemptsUsed = 0;
    let lastCommand: SimCommandV1 | null = null;
    let lastError: string | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (await this.state.isReservationFencedOrExpired(this.persistence, reservation, getNow())) break;
      attemptsUsed = attempt;
      const ticket = (await this.persistence.getTicketById(reservation.ticketId)) ?? initialTicket;
      if (!ticket) throw new Error(`Ticket ${reservation.ticketId} not found for reservation ${reservation.reservationId}`);

      const request = await buildSpawnExecutionRequest({
        persistence: this.persistence,
        homeRepo: this.homeRepo,
        reservation,
        ticket,
        attempt,
        maxRetries,
        options,
      });
      lastCommand = request.command;
      this.state.spawnCommandsSent.push(request.command);
      this.state.setPendingLateSpawn(reservation, attempt, getNow());

      const attemptResult = await invokeSpawnExecutorWithTimeout({
        request,
        activeExecutor,
        gamePlanets: this.gamePlanets,
        defaultExecutor: this.state.defaultExecutor,
        spawnTimeoutMs: options.spawnTimeoutMs,
      });

      if (attemptResult.ok) {
        return finalizeSuccessfulSpawnAttemptHelper({
          persistence: this.persistence,
          reservations: this.reservations,
          homeRepo: this.homeRepo,
          state: this.state,
          reservation,
          ticket,
          getNow,
          attemptsUsed,
          backoffDelaysMs,
          appliedAtTick: attemptResult.appliedAtTick ?? 1,
          spawnCommand: lastCommand,
          maxTicketAttempts,
          options,
          reconcileOrphan: (inp, opts) => this.reconcileOrphanColony(inp, opts),
        });
      }

      lastError = attemptResult.error;
      if (attemptResult.inFlightPromise) {
        this.attachBackgroundLateSpawnMonitor(attemptResult.inFlightPromise, reservation, options);
      } else {
        this.state.clearPendingLateSpawn(reservation);
      }

      if (
        attempt < maxRetries &&
        !(await this.state.isReservationFencedOrExpired(this.persistence, reservation, getNow()))
      ) {
        const delayMs = backoffSchedule[attempt - 1] ?? backoffSchedule[backoffSchedule.length - 1] ?? 1_000;
        backoffDelaysMs.push(delayMs);
        this.state.retryAttemptsCount++;
        await sleepFn(delayMs, attempt);
      }
    }

    return this.expireAndFence({
      reservation,
      ticket: initialTicket,
      now: getNow(),
      reason: attemptsUsed >= maxRetries ? 'retries_exhausted' : 'expired',
      attemptsUsed,
      backoffDelaysMs,
      spawnCommand: lastCommand,
      error: lastError ?? 'spawnColony retries exhausted',
      maxTicketAttempts,
      options,
    });
  }

  private expireAndFence(params: {
    readonly reservation: ManagedSectorReservationRecord;
    readonly ticket: MatchTicketRecord | null;
    readonly now: Date;
    readonly reason: 'expired' | 'cancelled' | 'retries_exhausted';
    readonly attemptsUsed: number;
    readonly backoffDelaysMs: readonly number[];
    readonly spawnCommand: SimCommandV1 | null;
    readonly error: string;
    readonly maxTicketAttempts: number;
    readonly options: ExecuteSpawnSagaOptions;
  }): Promise<SpawnSagaOutcome> {
    return expireAndFenceReservationHelper({
      persistence: this.persistence,
      reservations: this.reservations,
      homeRepo: this.homeRepo,
      state: this.state,
      ...params,
    });
  }

  async handleLateSpawnAck(
    input: string | ReconcileOrphanColonyInput | SectorReservationRecord | ManagedSectorReservationRecord,
    options: ExecuteSpawnSagaOptions = {},
  ): Promise<ReconcileOrphanColonyResult> {
    const normalized = await this.state.normalizeReconcileInput(this.persistence, this.homeRepo, input);
    const existingCommitted = this.state.committedOutcomeByColonyId.get(normalized.colonyId);
    const isFenced =
      this.state.fencedReservationsById.has(normalized.reservationId) ||
      this.state.fencedReservationByColonyId.has(normalized.colonyId);

    if (existingCommitted && !isFenced) {
      this.state.duplicateAcksCount++;
      return {
        reconciled: false,
        alreadyReconciled: false,
        duplicateAck: true,
        status: 'committed',
        colonyId: normalized.colonyId,
        planetId: existingCommitted.planetId,
        sectorId: existingCommitted.sectorId,
        landingSlotId: existingCommitted.landingSlotId,
        reason: 'already_committed',
        colony: existingCommitted.colony,
        ticket: existingCommitted.ticket,
        reservation: existingCommitted.reservation,
        retireCommand: null,
        orphanColoniesReconciled: this.state.reconciledOrphanByKey.size,
      };
    }
    return this.reconcileOrphanColony(normalized, options);
  }

  async onColonyFounded(
    input: string | ReconcileOrphanColonyInput | SectorReservationRecord | ManagedSectorReservationRecord,
    options: ExecuteSpawnSagaOptions = {},
  ): Promise<ReconcileOrphanColonyResult> {
    return this.handleLateSpawnAck(input, options);
  }

  async reconcileOrphanColony(
    input: string | ReconcileOrphanColonyInput | SectorReservationRecord | ManagedSectorReservationRecord,
    options: ExecuteSpawnSagaOptions = {},
  ): Promise<ReconcileOrphanColonyResult> {
    const colonyId = typeof input === 'string' ? input : input.colonyId;
    return this.sagaMutex.run(`reconcile:${colonyId}`, async () => {
      const normalized = await this.state.normalizeReconcileInput(
        this.persistence,
        this.homeRepo,
        input,
      );
      const reconcileKey = `${normalized.colonyId}:${normalized.reservationId}:${normalized.epoch}`;
      const existing =
        this.state.reconciledOrphanByKey.get(reconcileKey) ??
        this.state.reconciledOrphanByColonyId.get(normalized.colonyId);

      if (existing) {
        this.state.duplicateAcksCount++;
        return buildAlreadyReconciledResult({
          existing,
          colony: this.state.provisionalColoniesById.get(existing.colonyId) ?? null,
          ticket: existing.ticketId ? await this.persistence.getTicketById(existing.ticketId) : null,
          orphanColoniesReconciled: this.state.reconciledOrphanByKey.size,
        });
      }

      return executeOrphanReconciliationHelper({
        persistence: this.persistence,
        reservations: this.reservations,
        homeRepo: this.homeRepo,
        state: this.state,
        gamePlanets: this.gamePlanets,
        defaultSpawnExecutor: this.spawnExecutor,
        target: normalized,
        reconcileKey,
        options,
      });
    });
  }

  private attachBackgroundLateSpawnMonitor(
    inFlightPromise: Promise<{ readonly ok: boolean; readonly appliedAtTick?: number }>,
    reservation: ManagedSectorReservationRecord,
    options: ExecuteSpawnSagaOptions,
  ): void {
    void inFlightPromise
      .then(async (res) => {
        if (!res.ok) {
          this.state.clearPendingLateSpawn(reservation);
          return;
        }
        const expired = await this.state.isReservationFencedOrExpired(
          this.persistence,
          reservation,
          resolveSagaClock(options.now)(),
        );
        if (expired) {
          await this.reconcileOrphanColony(
            {
              colonyId: reservation.colonyId,
              reservationId: reservation.reservationId,
              ticketId: reservation.ticketId,
              playerId: reservation.playerId,
              planetId: reservation.planetId,
              sectorId: reservation.sectorId,
              landingSlotId: reservation.landingSlotId,
              slotIndex: reservation.slotIndex,
              q: reservation.q,
              r: reservation.r,
              epoch: reservation.epoch,
              appliedAtTick: res.appliedAtTick ?? 1,
              reason: ORPHAN_RETIRE_REASON,
            },
            options,
          );
        }
      })
      .catch(() => {
        this.state.clearPendingLateSpawn(reservation);
      });
  }
}
