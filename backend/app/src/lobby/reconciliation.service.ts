import { Inject, Injectable, Optional } from '@nestjs/common';
import { EventBus } from '../bus/event-bus';
import { HomeRepository } from '../core/home/home.repository';
import { WorldLifecycleService } from './lifecycle.service';
import { LobbyPersistenceService } from './lobby-persistence.service';
import type { MatchTicketRecord } from './lobby-persistence.types';
import { KeyedMutex } from './lobby-store.helpers';
import { PlanetsService } from './planets.service';
import { CanonicalWorldProvisioningService } from './provisioning.service';
import {
  buildPlanetEventOutcomeResult,
  reconcileWorldSectorsAndBuildSnapshot,
} from './reconciliation-sector.helpers';
import {
  bindReconciliationBus,
  normalizeHandlePlanetEventArgs,
  resolveCanonicalWorldOrThrow,
  resolveDateInput,
  resolveSweepOptions,
  sweepOverdueQueuedTicketsHelper,
  transitionAllColoniesStatusHelper,
  transitionColonyStatusHelper,
  type ReconciliationEventBusLike,
} from './reconciliation.helpers';
import {
  applyPlanetEventColonyTransitions,
  executeReconciliationSweepPipeline,
} from './parts/reconciliation-service-parts';
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
  private readonly boundBuses = new WeakSet<object>();
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
    @Optional() @Inject(EventBus) arg8?: unknown,
  ) {
    const candidates = [arg2, arg3, arg4, arg5, arg6, arg7, arg8];
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
    const bus = candidates.find((c): c is EventBus => c instanceof EventBus);
    if (bus) this.bindEventBus(bus);
  }

  bindEventBus(bus: ReconciliationEventBusLike): () => void {
    return bindReconciliationBus(bus, this.boundBuses, (colonyId, opts) =>
      this.eliminateColony(colonyId, opts),
    );
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
    options: { readonly planetId?: string; readonly releaseSeat?: boolean; readonly now?: Date } = {},
  ): Promise<ColonyEliminationReconcileResult> {
    return transitionColonyStatusHelper({
      persistence: this.persistence,
      homeRepo: this.homeRepo,
      eliminatedColonyIds: this.eliminatedColonyIds,
      settledColonyIds: this.settledColonyIds,
      colonyId,
      targetStatus: 'ELIMINATED',
      planetId: options.planetId,
      releaseSeat: options.releaseSeat ?? true,
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

    await applyPlanetEventColonyTransitions({
      event,
      options,
      worldId: world.id,
      now,
      eliminateAllColonies: (wId, o) => this.eliminateAllColonies(wId, o),
      eliminateColony: (cId, o) => this.eliminateColony(cId, o),
      settleColony: (cId, o) => this.settleColony(cId, o),
      settleAllColonies: (wId, o) => this.settleAllColonies(wId, o),
    });

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
    const report = await executeReconciliationSweepPipeline({
      persistence: this.persistence,
      lifecycle: this.lifecycle,
      reservations: this.reservations,
      spawnSaga: this.spawnSaga,
      provisioning: this.provisioning,
      homeRepo: this.homeRepo,
      eliminatedColonyIds: this.eliminatedColonyIds,
      settledColonyIds: this.settledColonyIds,
      repairedSectorsHistory: this.repairedSectorsHistory,
      nowOrOpts,
      maybeOpts,
    });
    this.sweepHistory.push(report);
    return report;
  }

  private transitionAllColoniesStatus(
    targetStatus: 'ELIMINATED' | 'TRANSFERRED',
    planetIdOrType?: string,
    options: { readonly now?: Date } = {},
  ): Promise<readonly ColonyEliminationReconcileResult[]> {
    return transitionAllColoniesStatusHelper({
      persistence: this.persistence,
      homeRepo: this.homeRepo,
      eliminatedColonyIds: this.eliminatedColonyIds,
      settledColonyIds: this.settledColonyIds,
      targetStatus,
      planetIdOrType,
      now: options.now,
    });
  }
}

export { WorldReconciliationService as ReconciliationService };
