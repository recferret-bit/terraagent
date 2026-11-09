import { Inject, Injectable, Optional } from '@nestjs/common';
import { HomeRepository } from '../core/home/home.repository';
import { WorldLifecycleService } from './lifecycle.service';
import { LobbyPersistenceService } from './lobby-persistence.service';
import type { MatchTicketRecord } from './lobby-persistence.types';
import { KeyedMutex } from './lobby-store.helpers';
import { PlanetsService } from './planets.service';
import { CanonicalWorldProvisioningService } from './provisioning.service';
import {
  buildPlanetEventOutcomeResult,
  buildWorldSnapshotsHelper,
  maybeRetryFaultedWorldsHelper,
  reconcileWorldSectorsAndBuildSnapshot,
} from './reconciliation-sector.helpers';
import {
  discoverAndReconcileOrphanColonies,
  finalizeExpiredReservationsTickets,
  normalizeHandlePlanetEventArgs,
  resolveCanonicalWorldOrThrow,
  resolveDateInput,
  resolveSweepOptions,
  sweepOverdueQueuedTicketsHelper,
  transitionColonyStatusHelper,
} from './reconciliation.helpers';
import {
  type ColonyEliminationReconcileResult,
  type HandlePlanetEventInput,
  type HandlePlanetEventOptions,
  type PlanetEventOutcomeResult,
  type PlanetLifecycleEventKind,
  type ReconciliationSweepOptions,
  type ReconciliationSweepReport,
  type RecordedPlanetOutcome,
  type SectorCounterDriftRepairRecord,
  type WorldReconciliationSnapshot,
} from './reconciliation.types';
import { SectorReservationService } from './reservation.service';
import { SpawnSagaService } from './spawn-saga.service';
import type {
  ExecuteSpawnSagaOptions,
  ReconcileOrphanColonyInput,
  ReconcileOrphanColonyResult,
} from './spawn-saga.types';

export * from './reconciliation.types';
export * from './reconciliation.helpers';
export * from './reconciliation-sector.helpers';

/**
 * Persistent canonical world reconciliation & health sweep service
 * (W11-04: MATCHMAKING §0.2 MM-03..09, MM-37..38, MM-40, MM-42, MM-50, WE-33).
 */
@Injectable()
export class WorldReconciliationService {
  private readonly sweepMutex = new KeyedMutex();
  private readonly lifecycle: WorldLifecycleService;
  private readonly reservations: SectorReservationService;
  private readonly spawnSaga: SpawnSagaService;
  private readonly provisioning: CanonicalWorldProvisioningService;
  private readonly homeRepo: HomeRepository;
  private readonly planetsService?: PlanetsService;
  private readonly eliminatedColonyIds = new Set<string>();
  private readonly settledColonyIds = new Set<string>();
  private readonly sweepHistory: ReconciliationSweepReport[] = [];
  private readonly recordedOutcomes: RecordedPlanetOutcome[] = [];
  private readonly repairedSectorsHistory: SectorCounterDriftRepairRecord[] = [];

  constructor(
    @Inject(LobbyPersistenceService)
    private readonly persistence: LobbyPersistenceService,
    @Optional() @Inject(WorldLifecycleService) arg2?: unknown,
    @Optional() @Inject(SectorReservationService) arg3?: unknown,
    @Optional() @Inject(SpawnSagaService) arg4?: unknown,
    @Optional() @Inject(CanonicalWorldProvisioningService) arg5?: unknown,
    @Optional() @Inject(HomeRepository) arg6?: unknown,
    @Optional() @Inject(PlanetsService) arg7?: unknown,
  ) {
    const candidates = [arg2, arg3, arg4, arg5, arg6, arg7];
    this.lifecycle =
      candidates.find((c): c is WorldLifecycleService => c instanceof WorldLifecycleService) ??
      new WorldLifecycleService(this.persistence);
    this.reservations =
      candidates.find(
        (c): c is SectorReservationService => c instanceof SectorReservationService,
      ) ?? new SectorReservationService(this.persistence, this.lifecycle);
    this.homeRepo =
      candidates.find((c): c is HomeRepository => c instanceof HomeRepository) ??
      new HomeRepository();
    this.spawnSaga =
      candidates.find((c): c is SpawnSagaService => c instanceof SpawnSagaService) ??
      new SpawnSagaService(this.persistence, this.reservations, this.homeRepo, this.lifecycle);
    this.provisioning =
      candidates.find(
        (c): c is CanonicalWorldProvisioningService =>
          c instanceof CanonicalWorldProvisioningService,
      ) ??
      new CanonicalWorldProvisioningService(this.persistence, this.lifecycle, this.homeRepo);
    this.planetsService = candidates.find((c): c is PlanetsService => c instanceof PlanetsService);
  }

  getHomeRepository(): HomeRepository {
    return this.homeRepo;
  }
  getReservationService(): SectorReservationService {
    return this.reservations;
  }
  getSpawnSagaService(): SpawnSagaService {
    return this.spawnSaga;
  }
  getLifecycleService(): WorldLifecycleService {
    return this.lifecycle;
  }
  getProvisioningService(): CanonicalWorldProvisioningService {
    return this.provisioning;
  }
  getPlanetsService(): PlanetsService | undefined {
    return this.planetsService;
  }
  getSweepHistory(): readonly ReconciliationSweepReport[] {
    return [...this.sweepHistory];
  }
  getLastSweepReport(): ReconciliationSweepReport | null {
    return this.sweepHistory[this.sweepHistory.length - 1] ?? null;
  }

  getRecordedOutcomes(planetIdOrType?: string): readonly RecordedPlanetOutcome[] {
    if (!planetIdOrType) return [...this.recordedOutcomes];
    return this.recordedOutcomes.filter(
      (o) => o.planetId === planetIdOrType || o.planetType === planetIdOrType,
    );
  }

  getRepairedSectorsHistory(planetIdOrType?: string): readonly SectorCounterDriftRepairRecord[] {
    if (!planetIdOrType) return [...this.repairedSectorsHistory];
    return this.repairedSectorsHistory.filter((r) => r.planetId === planetIdOrType);
  }

  runReconciliationSweep(
    nowOrOpts?: Date | number | string | ReconciliationSweepOptions,
    maybeOpts?: ReconciliationSweepOptions,
  ): Promise<ReconciliationSweepReport> {
    return this.sweepMutex.run('reconciliation:sweep', () =>
      this.executeSweepLocked(nowOrOpts, maybeOpts),
    );
  }

  sweep(
    nowOrOpts?: Date | number | string | ReconciliationSweepOptions,
    maybeOpts?: ReconciliationSweepOptions,
  ): Promise<ReconciliationSweepReport> {
    return this.runReconciliationSweep(nowOrOpts, maybeOpts);
  }

  reconcile(
    nowOrOpts?: Date | number | string | ReconciliationSweepOptions,
    maybeOpts?: ReconciliationSweepOptions,
  ): Promise<ReconciliationSweepReport> {
    return this.runReconciliationSweep(nowOrOpts, maybeOpts);
  }

  reconcileAll(
    nowOrOpts?: Date | number | string | ReconciliationSweepOptions,
    maybeOpts?: ReconciliationSweepOptions,
  ): Promise<ReconciliationSweepReport> {
    return this.runReconciliationSweep(nowOrOpts, maybeOpts);
  }

  async reconcileWorld(
    planetIdOrType: string,
    nowOrOpts?: Date | number | string | ReconciliationSweepOptions,
    maybeOpts?: ReconciliationSweepOptions,
  ): Promise<WorldReconciliationSnapshot> {
    const world = await resolveCanonicalWorldOrThrow(this.persistence, planetIdOrType);
    const { now, opts } = resolveSweepOptions(nowOrOpts, maybeOpts);
    const report = await this.runReconciliationSweep(now, { ...opts, planetId: world.id });
    const snap = report.byPlanet[world.id];
    if (!snap) throw new Error(`WorldReconciliationService: snapshot missing for "${world.id}"`);
    return snap;
  }

  async sweepExpiredQueuedTickets(
    nowOrOpts?: Date | number | string | ReconciliationSweepOptions,
    maybeOpts?: ReconciliationSweepOptions,
  ): Promise<readonly MatchTicketRecord[]> {
    const { now, maxTicketWaitMs, opts } = resolveSweepOptions(nowOrOpts, maybeOpts);
    const preQueued = await this.persistence.listTickets({
      state: 'QUEUED',
      ...(opts.planetId ? { planetId: opts.planetId } : {}),
    });
    return sweepOverdueQueuedTicketsHelper({
      persistence: this.persistence,
      preQueuedTicketIds: new Set(preQueued.map((t) => t.id)),
      planetId: opts.planetId,
      queuePaused: this.lifecycle.isQueuePaused(),
      ignoreQueuePause: opts.ignoreQueuePause,
      maxTicketWaitMs,
      now,
    });
  }

  async reconcileSectorOccupancy(
    planetIdOrType?: string,
    now: Date = new Date(),
  ): Promise<readonly SectorCounterDriftRepairRecord[]> {
    const worlds = planetIdOrType
      ? [await resolveCanonicalWorldOrThrow(this.persistence, planetIdOrType)]
      : await this.persistence.listCanonicalWorlds();
    const repairs: SectorCounterDriftRepairRecord[] = [];
    for (const world of worlds) {
      const res = await reconcileWorldSectorsAndBuildSnapshot({
        persistence: this.persistence,
        homeRepo: this.homeRepo,
        world,
        expiredInWorldCount: 0,
        eliminatedColonyIds: this.eliminatedColonyIds,
        settledColonyIds: this.settledColonyIds,
        now,
      });
      repairs.push(...res.repairs);
      this.repairedSectorsHistory.push(...res.repairs);
    }
    return repairs;
  }

  reconcileOrphanColony(
    input: string | ReconcileOrphanColonyInput,
    options: ExecuteSpawnSagaOptions = {},
  ): Promise<ReconcileOrphanColonyResult> {
    return this.spawnSaga.reconcileOrphanColony(input, options);
  }

  eliminateColony(
    colonyId: string,
    options: { readonly planetId?: string; readonly now?: Date } = {},
  ): Promise<ColonyEliminationReconcileResult> {
    return transitionColonyStatusHelper({
      persistence: this.persistence,
      homeRepo: this.homeRepo,
      eliminatedColonyIds: this.eliminatedColonyIds,
      settledColonyIds: this.settledColonyIds,
      colonyId,
      targetStatus: 'ELIMINATED',
      planetId: options.planetId,
      now: options.now,
    });
  }

  eliminateAllColonies(
    planetIdOrType?: string | { readonly now?: Date },
    options: { readonly now?: Date } = {},
  ): Promise<readonly ColonyEliminationReconcileResult[]> {
    const targetId = typeof planetIdOrType === 'string' ? planetIdOrType : undefined;
    const opts = typeof planetIdOrType === 'object' ? planetIdOrType : options;
    return this.transitionAllColoniesStatus('ELIMINATED', targetId, opts);
  }

  settleColony(
    colonyId: string,
    options: { readonly planetId?: string; readonly now?: Date } = {},
  ): Promise<ColonyEliminationReconcileResult> {
    return transitionColonyStatusHelper({
      persistence: this.persistence,
      homeRepo: this.homeRepo,
      eliminatedColonyIds: this.eliminatedColonyIds,
      settledColonyIds: this.settledColonyIds,
      colonyId,
      targetStatus: 'TRANSFERRED',
      planetId: options.planetId,
      now: options.now,
    });
  }

  settleAllColonies(
    planetIdOrType?: string | { readonly now?: Date },
    options: { readonly now?: Date } = {},
  ): Promise<readonly ColonyEliminationReconcileResult[]> {
    const targetId = typeof planetIdOrType === 'string' ? planetIdOrType : undefined;
    const opts = typeof planetIdOrType === 'object' ? planetIdOrType : options;
    return this.transitionAllColoniesStatus('TRANSFERRED', targetId, opts);
  }

  async handlePlanetEvent(
    firstArg: PlanetLifecycleEventKind | string | HandlePlanetEventInput,
    secondArg?: string | PlanetLifecycleEventKind | HandlePlanetEventOptions,
    thirdArg?: HandlePlanetEventOptions,
  ): Promise<PlanetEventOutcomeResult> {
    const { planetIdOrType, event, options } = normalizeHandlePlanetEventArgs(
      firstArg,
      secondArg,
      thirdArg,
    );
    const world = await resolveCanonicalWorldOrThrow(this.persistence, planetIdOrType);
    const now = resolveDateInput(options.now);

    if (
      (event === 'extinct' || event === 'all_eliminated') &&
      options.preserveColonyStatus !== true
    ) {
      await this.eliminateAllColonies(world.id, { now });
    } else if (
      (event === 'settled' || event === 'all_settled') &&
      options.preserveColonyStatus !== true
    ) {
      if (options.colonyIds && options.colonyIds.length > 0) {
        for (const colId of options.colonyIds) {
          await this.settleColony(colId, { planetId: world.id, now });
        }
      } else {
        await this.settleAllColonies(world.id, { now });
      }
    }

    const { snapshot } = await reconcileWorldSectorsAndBuildSnapshot({
      persistence: this.persistence,
      homeRepo: this.homeRepo,
      world,
      expiredInWorldCount: 0,
      eliminatedColonyIds: this.eliminatedColonyIds,
      settledColonyIds: this.settledColonyIds,
      now,
    });

    const result = buildPlanetEventOutcomeResult({
      world,
      event,
      options,
      snapshot,
      now,
    });
    this.recordedOutcomes.push(result.outcome);
    return result;
  }

  evaluatePlanetEvent(
    firstArg: PlanetLifecycleEventKind | string | HandlePlanetEventInput,
    secondArg?: string | PlanetLifecycleEventKind | HandlePlanetEventOptions,
    thirdArg?: HandlePlanetEventOptions,
  ): Promise<PlanetEventOutcomeResult> {
    return this.handlePlanetEvent(firstArg, secondArg, thirdArg);
  }

  onPlanetEvent(
    firstArg: PlanetLifecycleEventKind | string | HandlePlanetEventInput,
    secondArg?: string | PlanetLifecycleEventKind | HandlePlanetEventOptions,
    thirdArg?: HandlePlanetEventOptions,
  ): Promise<PlanetEventOutcomeResult> {
    return this.handlePlanetEvent(firstArg, secondArg, thirdArg);
  }

  private async executeSweepLocked(
    nowOrOpts?: Date | number | string | ReconciliationSweepOptions,
    maybeOpts?: ReconciliationSweepOptions,
  ): Promise<ReconciliationSweepReport> {
    const { now, maxTicketWaitMs, maxTicketAttempts, opts } = resolveSweepOptions(
      nowOrOpts,
      maybeOpts,
    );
    const queuePaused = this.lifecycle.isQueuePaused();
    const targetWorlds = opts.planetId
      ? [await resolveCanonicalWorldOrThrow(this.persistence, opts.planetId)]
      : await this.persistence.listCanonicalWorlds();
    const preQueuedTickets = await this.persistence.listTickets({
      state: 'QUEUED',
      ...(opts.planetId ? { planetId: opts.planetId } : {}),
    });
    const expiredReservations = await this.reservations.sweepExpiredReservations({
      now,
      ...(opts.planetId ? { planetId: opts.planetId } : {}),
      ...(opts.ignoreQueuePause ? { ignoreQueuePause: opts.ignoreQueuePause } : {}),
    });
    const { requeuedTickets, failedSpawnTickets } = await finalizeExpiredReservationsTickets({
      persistence: this.persistence,
      homeRepo: this.homeRepo,
      expiredReservations,
      maxTicketAttempts,
      now,
    });
    const expiredTickets = await sweepOverdueQueuedTicketsHelper({
      persistence: this.persistence,
      preQueuedTicketIds: new Set(preQueuedTickets.map((t) => t.id)),
      planetId: opts.planetId,
      queuePaused,
      ignoreQueuePause: opts.ignoreQueuePause,
      maxTicketWaitMs,
      now,
    });
    const reconciledOrphans = await discoverAndReconcileOrphanColonies({
      persistence: this.persistence,
      homeRepo: this.homeRepo,
      spawnSaga: this.spawnSaga,
      worlds: targetWorlds,
      explicitOrphans: opts.orphanColonies,
      now,
    });
    const retriedWorlds = await maybeRetryFaultedWorldsHelper(
      this.provisioning,
      targetWorlds,
      opts,
    );
    const refreshedWorlds = opts.planetId
      ? [await resolveCanonicalWorldOrThrow(this.persistence, opts.planetId)]
      : await this.persistence.listCanonicalWorlds();
    await this.lifecycle.sweepLifecycleForElapsedTime(now);
    const { worldSnapshots, byPlanet, repairedSectors } = await buildWorldSnapshotsHelper({
      persistence: this.persistence,
      homeRepo: this.homeRepo,
      worlds: refreshedWorlds,
      expiredReservations,
      eliminatedColonyIds: this.eliminatedColonyIds,
      settledColonyIds: this.settledColonyIds,
      repairedSectorsHistory: this.repairedSectorsHistory,
      now,
    });
    const allPersistedWorlds = await this.persistence.listCanonicalWorlds();
    const report: ReconciliationSweepReport = {
      sweptAt: now.toISOString(),
      nowMs: now.getTime(),
      queuePaused,
      canonicalWorldsCount: allPersistedWorlds.length,
      warmPoolCount: 0,
      overflowWorldsCount: 0,
      ageSealedCount: 0,
      endedWorldsCount: 0,
      archivedBySweepCount: 0,
      replacedWorldsCount: 0,
      evictedFoundedSeatsCount: 0,
      expiredReservationsCount: expiredReservations.length,
      expiredReservations,
      requeuedTicketsCount: requeuedTickets.length,
      requeuedTickets,
      failedSpawnTicketsCount: failedSpawnTickets.length,
      failedSpawnTickets,
      expiredTicketsCount: expiredTickets.length,
      expiredTickets,
      reconciledOrphansCount: reconciledOrphans.length,
      reconciledOrphans,
      repairedSectorsCount: repairedSectors.length,
      repairedSectors,
      retriedWorldsCount: retriedWorlds.length,
      retriedWorlds,
      worlds: worldSnapshots,
      byPlanet: byPlanet as ReconciliationSweepReport['byPlanet'],
    };
    this.sweepHistory.push(report);
    return report;
  }

  private async transitionAllColoniesStatus(
    targetStatus: 'ELIMINATED' | 'TRANSFERRED',
    planetIdOrType?: string,
    options: { readonly now?: Date } = {},
  ): Promise<readonly ColonyEliminationReconcileResult[]> {
    const worlds = planetIdOrType
      ? [await resolveCanonicalWorldOrThrow(this.persistence, planetIdOrType)]
      : await this.persistence.listCanonicalWorlds();
    const results: ColonyEliminationReconcileResult[] = [];

    for (const world of worlds) {
      const [reservations, repoColonies] = await Promise.all([
        this.persistence.listReservations(world.id),
        this.homeRepo.listColoniesByPlanetId(world.id),
      ]);
      const colonyIds = new Set<string>([
        ...reservations.filter((r) => r.state === 'COMMITTED').map((r) => r.colonyId),
        ...repoColonies.filter((c) => c.status !== 'ABANDONED').map((c) => c.id),
      ]);
      for (const colId of colonyIds) {
        results.push(
          await transitionColonyStatusHelper({
            persistence: this.persistence,
            homeRepo: this.homeRepo,
            eliminatedColonyIds: this.eliminatedColonyIds,
            settledColonyIds: this.settledColonyIds,
            colonyId: colId,
            targetStatus,
            planetId: world.id,
            now: options.now,
          }),
        );
      }
    }
    return results;
  }
}

export { WorldReconciliationService as ReconciliationService };
