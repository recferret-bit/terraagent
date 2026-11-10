import { CANONICAL_PLANETS, type SectorId } from '@terra/contracts';
import type { HomeRepository } from '../core/home/home.repository';
import type { LobbyPersistenceService } from './lobby-persistence.service';
import {
  LobbyPersistenceConflictError,
  type CanonicalWorldRecord,
  type MatchTicketRecord,
  type SectorReservationRecord,
} from './lobby-persistence.types';
import { resolveCanonicalPlanetType } from './planets.helpers';
import {
  bindReconciliationBus,
  extractEliminatedColonyIds,
  locateColonyAndCommittedReservation,
  transitionAllColoniesStatusHelper,
  transitionColonyStatusHelper,
  type ReconciliationEventBusLike,
} from './parts/reconciliation-elimination';
import {
  computeAuthoritativeSectorCounts,
  reconcileWorldSectorsAndBuildSnapshot,
} from './reconciliation-sector.helpers';
import {
  MATCH_TICKET_MAX_WAIT_MS,
  TICKET_TIMEOUT_FAILURE_CODE,
  type HandlePlanetEventInput,
  type HandlePlanetEventOptions,
  type PlanetLifecycleEventKind,
  type ReconciliationSweepOptions,
} from './reconciliation.types';
import type { ManagedSectorReservationRecord } from './reservation.types';
import type { SpawnSagaService } from './spawn-saga.service';
import {
  DEFAULT_MAX_TICKET_ATTEMPTS,
  ORPHAN_RETIRE_REASON,
  SPAWN_FAILED_CODE,
  type ReconciledOrphanColonyRecord,
} from './spawn-saga.types';

export {
  bindReconciliationBus,
  computeAuthoritativeSectorCounts,
  extractEliminatedColonyIds,
  locateColonyAndCommittedReservation,
  reconcileWorldSectorsAndBuildSnapshot,
  transitionAllColoniesStatusHelper,
  transitionColonyStatusHelper,
  type ReconciliationEventBusLike,
};
export type { SectorId };

const PLANET_EVENT_KINDS = new Set<string>([
  'extinct',
  'all_eliminated',
  'colonyEliminated',
  'colony_eliminated',
  'settled',
  'all_settled',
  'victory',
  'planet.victory',
  'age_check',
  'tick_sweep',
  'lifetime',
  'window',
  'inactivity_check',
  'refill_check',
]);

export function resolveDateInput(raw?: Date | number | string): Date {
  if (raw instanceof Date) return raw;
  if (typeof raw === 'number') return new Date(raw);
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) return new Date(parsed);
  }
  return new Date();
}

export function resolveSweepOptions(
  nowOrOpts?: Date | number | string | ReconciliationSweepOptions,
  maybeOpts?: ReconciliationSweepOptions,
): {
  readonly now: Date;
  readonly maxTicketWaitMs: number;
  readonly maxTicketAttempts: number;
  readonly opts: ReconciliationSweepOptions;
} {
  const isDateLike =
    nowOrOpts instanceof Date || typeof nowOrOpts === 'number' || typeof nowOrOpts === 'string';
  const opts: ReconciliationSweepOptions = isDateLike
    ? { ...(maybeOpts ?? {}), now: nowOrOpts }
    : { ...(nowOrOpts ?? {}), ...(maybeOpts ?? {}) };
  const now = resolveDateInput(opts.now);
  const maxTicketWaitMs = Math.max(
    1,
    opts.maxTicketWaitMs ??
      (opts.maxTicketWaitS !== undefined ? opts.maxTicketWaitS * 1_000 : MATCH_TICKET_MAX_WAIT_MS),
  );
  const maxTicketAttempts = Math.max(1, opts.maxTicketAttempts ?? DEFAULT_MAX_TICKET_ATTEMPTS);
  return { now, maxTicketWaitMs, maxTicketAttempts, opts };
}

export async function resolveCanonicalWorldOrThrow(
  persistence: LobbyPersistenceService,
  planetIdOrType: string,
): Promise<CanonicalWorldRecord> {
  const resolvedType = resolveCanonicalPlanetType(planetIdOrType);
  if (resolvedType) {
    const byType =
      (await persistence.getCanonicalWorldByType(resolvedType)) ??
      (await persistence.getCanonicalWorldById(CANONICAL_PLANETS[resolvedType].id));
    if (byType) return byType;
  }
  const byId = await persistence.getCanonicalWorldById(planetIdOrType);
  if (byId) return byId;
  throw new LobbyPersistenceConflictError(
    'planet_not_found',
    `Canonical world "${planetIdOrType}" not found`,
    { planetId: planetIdOrType },
  );
}

export function normalizeHandlePlanetEventArgs(
  firstArg: PlanetLifecycleEventKind | string | HandlePlanetEventInput,
  secondArg?: string | PlanetLifecycleEventKind | HandlePlanetEventOptions,
  thirdArg?: HandlePlanetEventOptions,
): {
  readonly planetIdOrType: string;
  readonly event: PlanetLifecycleEventKind;
  readonly options: HandlePlanetEventOptions;
} {
  if (typeof firstArg === 'object' && firstArg !== null) {
    const planetIdOrType = String(
      firstArg.planetId ?? firstArg.type ?? firstArg.planetType ?? 'desert',
    );
    const event = (firstArg.event ?? firstArg.kind ?? 'age_check') as PlanetLifecycleEventKind;
    return { planetIdOrType, event, options: firstArg };
  }
  const firstStr = String(firstArg).trim();
  const secondStr = typeof secondArg === 'string' ? secondArg.trim() : '';
  const options: HandlePlanetEventOptions =
    typeof secondArg === 'object' && secondArg !== null ? secondArg : (thirdArg ?? {});

  if (PLANET_EVENT_KINDS.has(firstStr)) {
    return {
      event: firstStr as PlanetLifecycleEventKind,
      planetIdOrType: secondStr || 'desert',
      options,
    };
  }
  return {
    planetIdOrType: firstStr,
    event: (PLANET_EVENT_KINDS.has(secondStr) ? secondStr : 'age_check') as PlanetLifecycleEventKind,
    options,
  };
}

export async function finalizeExpiredReservationsTickets(params: {
  readonly persistence: LobbyPersistenceService;
  readonly homeRepo?: HomeRepository;
  readonly expiredReservations: readonly ManagedSectorReservationRecord[];
  readonly maxTicketAttempts: number;
  readonly now: Date;
}): Promise<{
  readonly requeuedTickets: readonly MatchTicketRecord[];
  readonly failedSpawnTickets: readonly MatchTicketRecord[];
}> {
  const { persistence, homeRepo, expiredReservations, maxTicketAttempts, now } = params;
  const requeuedTickets: MatchTicketRecord[] = [];
  const failedSpawnTickets: MatchTicketRecord[] = [];

  for (const res of expiredReservations) {
    if (homeRepo) {
      const existingCol = await homeRepo.findColonyById(res.colonyId);
      if (existingCol && existingCol.status === 'FOUNDING') {
        await homeRepo.deleteColony(res.colonyId);
      }
    }
    const ticket = await persistence.getTicketById(res.ticketId);
    if (!ticket) continue;

    if (ticket.state === 'QUEUED' && ticket.attempts >= maxTicketAttempts) {
      const failed = await persistence.updateTicket({
        ticketId: ticket.id,
        state: 'FAILED',
        failureCode: SPAWN_FAILED_CODE,
        position: null,
        etaS: null,
        reservedPlanetId: null,
        reservedSectorId: null,
        reservedLandingSlotId: null,
        reservationEpoch: null,
        reservationExpiresAt: null,
        now,
      });
      failedSpawnTickets.push(failed);
    } else if (ticket.state === 'QUEUED') {
      requeuedTickets.push(ticket);
    } else if (ticket.state === 'FAILED') {
      failedSpawnTickets.push(ticket);
    }
  }

  return { requeuedTickets, failedSpawnTickets };
}

export async function sweepOverdueQueuedTicketsHelper(params: {
  readonly persistence: LobbyPersistenceService;
  readonly preQueuedTicketIds: ReadonlySet<string>;
  readonly planetId?: string;
  readonly queuePaused: boolean;
  readonly ignoreQueuePause?: boolean;
  readonly maxTicketWaitMs: number;
  readonly now: Date;
}): Promise<readonly MatchTicketRecord[]> {
  const {
    persistence,
    preQueuedTicketIds,
    planetId,
    queuePaused,
    ignoreQueuePause,
    maxTicketWaitMs,
    now,
  } = params;
  if (queuePaused && !ignoreQueuePause) {
    return [];
  }
  const queuedTickets = await persistence.listTickets({
    state: 'QUEUED',
    ...(planetId ? { planetId } : {}),
  });
  const expiredTickets: MatchTicketRecord[] = [];

  for (const ticket of queuedTickets) {
    if (!preQueuedTicketIds.has(ticket.id)) continue;
    const createdMs = Date.parse(ticket.createdAt);
    if (Number.isNaN(createdMs)) continue;
    if (now.getTime() - createdMs > maxTicketWaitMs) {
      const updated = await persistence.updateTicket({
        ticketId: ticket.id,
        state: 'EXPIRED',
        failureCode: TICKET_TIMEOUT_FAILURE_CODE,
        position: null,
        etaS: null,
        alternativeSectors: [],
        now,
      });
      expiredTickets.push(updated);
    }
  }
  return expiredTickets;
}

export async function discoverAndReconcileOrphanColonies(params: {
  readonly persistence: LobbyPersistenceService;
  readonly homeRepo?: HomeRepository;
  readonly spawnSaga?: SpawnSagaService;
  readonly worlds: readonly CanonicalWorldRecord[];
  readonly explicitOrphans?: readonly (string | Parameters<SpawnSagaService['reconcileOrphanColony']>[0])[];
  readonly now: Date;
}): Promise<readonly ReconciledOrphanColonyRecord[]> {
  const { persistence, homeRepo, spawnSaga, worlds, explicitOrphans = [], now } = params;
  if (!spawnSaga) return [];
  const beforeKeys = new Set(spawnSaga.getReconciledOrphans().map((o) => o.colonyId));

  for (const item of explicitOrphans) {
    await spawnSaga.reconcileOrphanColony(item, { now });
  }

  if (homeRepo) {
    for (const world of worlds) {
      await reconcileWorldOrphansInHomeRepo(persistence, homeRepo, spawnSaga, world.id, now);
    }
  }

  return spawnSaga
    .getReconciledOrphans()
    .filter((o) => !beforeKeys.has(o.colonyId) || explicitOrphans.length > 0);
}

async function reconcileWorldOrphansInHomeRepo(
  persistence: LobbyPersistenceService,
  homeRepo: HomeRepository,
  spawnSaga: SpawnSagaService,
  planetId: string,
  now: Date,
): Promise<void> {
  const [reservations, colonies] = await Promise.all([
    persistence.listReservations(planetId),
    homeRepo.listColoniesByPlanetId(planetId),
  ]);
  const committedIds = new Set(
    reservations.filter((r) => r.state === 'COMMITTED').map((r) => r.colonyId),
  );
  const heldIds = new Set(
    reservations
      .filter((r) => r.state === 'HELD' || (r.state as string) === 'SPAWNING')
      .map((r) => r.colonyId),
  );

  for (const col of colonies) {
    if (col.status !== 'ACTIVE' && col.status !== 'FOUNDING') continue;
    if (committedIds.has(col.id) || heldIds.has(col.id)) continue;
    const abandonedRes = reservations.find(
      (r) => r.colonyId === col.id && (r.state === 'EXPIRED' || r.state === 'RELEASED'),
    );
    if (!abandonedRes) continue;
    await spawnSaga.reconcileOrphanColony(
      {
        colonyId: col.id,
        reservationId: abandonedRes.reservationId,
        ticketId: abandonedRes.ticketId,
        playerId: col.playerId,
        planetId,
        sectorId: abandonedRes.sectorId,
        landingSlotId: abandonedRes.landingSlotId,
        slotIndex: abandonedRes.slotIndex,
        q: abandonedRes.q,
        r: abandonedRes.r,
        epoch: abandonedRes.epoch,
        reason: ORPHAN_RETIRE_REASON,
      },
      { now },
    );
  }
}
