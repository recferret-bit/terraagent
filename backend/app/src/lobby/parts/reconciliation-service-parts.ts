import type { HomeRepository } from '../../core/home/home.repository';
import type { WorldLifecycleService } from '../lifecycle.service';
import type { LobbyPersistenceService } from '../lobby-persistence.service';
import type { CanonicalWorldRecord } from '../lobby-persistence.types';
import type { CanonicalWorldProvisioningService } from '../provisioning.service';
import {
  buildWorldSnapshotsHelper,
  maybeRetryFaultedWorldsHelper,
} from '../reconciliation-sector.helpers';
import {
  discoverAndReconcileOrphanColonies,
  extractEliminatedColonyIds,
  finalizeExpiredReservationsTickets,
  resolveCanonicalWorldOrThrow,
  resolveSweepOptions,
  sweepOverdueQueuedTicketsHelper,
} from '../reconciliation.helpers';
import type {
  HandlePlanetEventOptions,
  PlanetLifecycleEventKind,
  ReconciliationSweepOptions,
  ReconciliationSweepReport,
  SectorCounterDriftRepairRecord,
} from '../reconciliation.types';
import type { SectorReservationService } from '../reservation.service';
import type { SpawnSagaService } from '../spawn-saga.service';

export async function applyPlanetEventColonyTransitions(params: {
  readonly event: PlanetLifecycleEventKind;
  readonly options: HandlePlanetEventOptions;
  readonly worldId: string;
  readonly now: Date;
  readonly eliminateAllColonies: (worldId: string, opts: { readonly now: Date }) => Promise<unknown>;
  readonly eliminateColony: (
    colonyId: string,
    opts: { readonly planetId: string; readonly now: Date },
  ) => Promise<unknown>;
  readonly settleColony: (
    colonyId: string,
    opts: { readonly planetId: string; readonly now: Date },
  ) => Promise<unknown>;
  readonly settleAllColonies: (worldId: string, opts: { readonly now: Date }) => Promise<unknown>;
}): Promise<void> {
  const { event, options, worldId, now } = params;
  if (options.preserveColonyStatus === true) return;

  if (event === 'extinct' || event === 'all_eliminated') {
    await params.eliminateAllColonies(worldId, { now });
    return;
  }
  if (event === 'colonyEliminated' || event === 'colony_eliminated') {
    for (const colId of extractEliminatedColonyIds(options)) {
      await params.eliminateColony(colId, { planetId: worldId, now });
    }
    return;
  }
  if (event === 'settled' || event === 'all_settled') {
    if (options.colonyIds && options.colonyIds.length > 0) {
      for (const colId of options.colonyIds) {
        await params.settleColony(colId, { planetId: worldId, now });
      }
      return;
    }
    await params.settleAllColonies(worldId, { now });
  }
}

async function runTicketReservationOrphanSweepStep(params: {
  readonly persistence: LobbyPersistenceService;
  readonly reservations: SectorReservationService;
  readonly spawnSaga: SpawnSagaService;
  readonly homeRepo: HomeRepository;
  readonly targetWorlds: readonly CanonicalWorldRecord[];
  readonly queuePaused: boolean;
  readonly maxTicketWaitMs: number;
  readonly maxTicketAttempts: number;
  readonly opts: ReconciliationSweepOptions;
  readonly now: Date;
}) {
  const {
    persistence,
    reservations,
    spawnSaga,
    homeRepo,
    targetWorlds,
    queuePaused,
    maxTicketWaitMs,
    maxTicketAttempts,
    opts,
    now,
  } = params;
  const preQueuedTickets = await persistence.listTickets({
    state: 'QUEUED',
    ...(opts.planetId ? { planetId: opts.planetId } : {}),
  });
  const expiredReservations = await reservations.sweepExpiredReservations({
    now,
    ...(opts.planetId ? { planetId: opts.planetId } : {}),
    ...(opts.ignoreQueuePause ? { ignoreQueuePause: opts.ignoreQueuePause } : {}),
  });
  const { requeuedTickets, failedSpawnTickets } = await finalizeExpiredReservationsTickets({
    persistence,
    homeRepo,
    expiredReservations,
    maxTicketAttempts,
    now,
  });
  const expiredTickets = await sweepOverdueQueuedTicketsHelper({
    persistence,
    preQueuedTicketIds: new Set(preQueuedTickets.map((t) => t.id)),
    planetId: opts.planetId,
    queuePaused,
    ignoreQueuePause: opts.ignoreQueuePause,
    maxTicketWaitMs,
    now,
  });
  const reconciledOrphans = await discoverAndReconcileOrphanColonies({
    persistence,
    homeRepo,
    spawnSaga,
    worlds: targetWorlds,
    explicitOrphans: opts.orphanColonies,
    now,
  });
  return { expiredReservations, requeuedTickets, failedSpawnTickets, expiredTickets, reconciledOrphans };
}

export async function executeReconciliationSweepPipeline(params: {
  readonly persistence: LobbyPersistenceService;
  readonly lifecycle: WorldLifecycleService;
  readonly reservations: SectorReservationService;
  readonly spawnSaga: SpawnSagaService;
  readonly provisioning: CanonicalWorldProvisioningService;
  readonly homeRepo: HomeRepository;
  readonly eliminatedColonyIds: ReadonlySet<string>;
  readonly settledColonyIds: ReadonlySet<string>;
  readonly repairedSectorsHistory: SectorCounterDriftRepairRecord[];
  readonly nowOrOpts?: Date | number | string | ReconciliationSweepOptions;
  readonly maybeOpts?: ReconciliationSweepOptions;
}): Promise<ReconciliationSweepReport> {
  const { now, maxTicketWaitMs, maxTicketAttempts, opts } = resolveSweepOptions(
    params.nowOrOpts,
    params.maybeOpts,
  );
  const queuePaused = params.lifecycle.isQueuePaused();
  const targetWorlds = opts.planetId
    ? [await resolveCanonicalWorldOrThrow(params.persistence, opts.planetId)]
    : await params.persistence.listCanonicalWorlds();
  const stepOut = await runTicketReservationOrphanSweepStep({
    persistence: params.persistence,
    reservations: params.reservations,
    spawnSaga: params.spawnSaga,
    homeRepo: params.homeRepo,
    targetWorlds,
    queuePaused,
    maxTicketWaitMs,
    maxTicketAttempts,
    opts,
    now,
  });
  const retriedWorlds = await maybeRetryFaultedWorldsHelper(params.provisioning, targetWorlds, opts);
  const refreshedWorlds = opts.planetId
    ? [await resolveCanonicalWorldOrThrow(params.persistence, opts.planetId)]
    : await params.persistence.listCanonicalWorlds();
  await params.lifecycle.sweepLifecycleForElapsedTime(now);
  const { worldSnapshots, byPlanet, repairedSectors } = await buildWorldSnapshotsHelper({
    persistence: params.persistence,
    homeRepo: params.homeRepo,
    worlds: refreshedWorlds,
    expiredReservations: stepOut.expiredReservations,
    eliminatedColonyIds: params.eliminatedColonyIds,
    settledColonyIds: params.settledColonyIds,
    repairedSectorsHistory: params.repairedSectorsHistory,
    now,
  });
  const allPersistedWorlds = await params.persistence.listCanonicalWorlds();
  return {
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
    expiredReservationsCount: stepOut.expiredReservations.length,
    expiredReservations: stepOut.expiredReservations,
    requeuedTicketsCount: stepOut.requeuedTickets.length,
    requeuedTickets: stepOut.requeuedTickets,
    failedSpawnTicketsCount: stepOut.failedSpawnTickets.length,
    failedSpawnTickets: stepOut.failedSpawnTickets,
    expiredTicketsCount: stepOut.expiredTickets.length,
    expiredTickets: stepOut.expiredTickets,
    reconciledOrphansCount: stepOut.reconciledOrphans.length,
    reconciledOrphans: stepOut.reconciledOrphans,
    repairedSectorsCount: repairedSectors.length,
    repairedSectors,
    retriedWorldsCount: retriedWorlds.length,
    retriedWorlds,
    worlds: worldSnapshots,
    byPlanet: byPlanet as ReconciliationSweepReport['byPlanet'],
  };
}
