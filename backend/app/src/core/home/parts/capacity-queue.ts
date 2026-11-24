import type { HomeResponse, SectorId } from '@terra/contracts';
import { devPlanetIdFor, devPlanetTypeOf, type DevPlanetType } from '@terra/sim';
import type { WorldLifecycleService } from '../../../lobby/lifecycle.service';
import type { LobbyPersistenceService } from '../../../lobby/lobby-persistence.service';
import type { MatchTicketRecord } from '../../../lobby/lobby-persistence.types';
import { CoreException } from '../../errors';
import { buildQueuedHomeResponse } from '../home-resolve.helpers';
import { PlanetCapReached } from './planet-capacity';

/** A queued ticket not polled for this long does not hold its place (its player closed the tab). */
export const QUEUE_LIVE_MS = 60_000;
/** A queued ticket not polled for this long is EXPIRED (the client gives up after 10 minutes of polls anyway). */
export const QUEUE_EXPIRE_MS = 15 * 60_000;
/** A poll refreshes its ticket's `updatedAt` at most this often. */
export const QUEUE_TOUCH_MS = 15_000;

/**
 * Planet-cap tickets reuse the W11 lobby ticket queue (`core.match_ticket`): mode `AUTO` on the dev family's base id
 * (`pl_dev`, `pl_dev_ocean`, …). Canonical W11 tickets name a canonical planet, so the two never mix, and the W11
 * matchmaker (canonical worlds only) never reserves a sector for one.
 */
export function isCapacityTicket(t: Pick<MatchTicketRecord, 'mode' | 'planetId' | 'state'>): boolean {
  return t.mode === 'AUTO' && t.state === 'QUEUED' && devPlanetTypeOf(t.planetId) !== null;
}

/** The player's planet-cap ticket, if their active ticket is one. */
export async function findCapacityTicket(lobby: LobbyPersistenceService | undefined, playerId: string): Promise<MatchTicketRecord | undefined> {
  const ticket = await lobby?.findActiveTicketByPlayer(playerId);
  return ticket && isCapacityTicket(ticket) ? ticket : undefined;
}

/** Planet type a capacity ticket waits for. */
export const capacityTicketType = (t: Pick<MatchTicketRecord, 'planetId'>): DevPlanetType => devPlanetTypeOf(t.planetId) ?? 'desert';

export interface CapacityQueueDeps {
  readonly lobby: LobbyPersistenceService | undefined;
  readonly lifecycle: WorldLifecycleService | undefined;
  readonly now?: () => number;
}

/**
 * Runs `seat`; at the planet cap the player is queued instead (no planet is created). A newcomer also queues while
 * players are waiting for the same family, so a freed seat goes to the first in line (`admitted`: that player).
 */
export async function seatOrQueue(
  deps: CapacityQueueDeps,
  playerId: string,
  type: DevPlanetType,
  admitted: boolean,
  seat: () => Promise<HomeResponse>,
  intent?: { readonly sectorId?: string; readonly planetId?: string },
): Promise<HomeResponse> {
  const now = (deps.now ?? Date.now)();
  if (deps.lobby && !admitted && (await liveQueue(deps.lobby, devPlanetIdFor(type, 1), now)).length > 0) {
    return enqueue(deps, deps.lobby, playerId, type, now, intent);
  }
  try {
    return await seat();
  } catch (e) {
    if (!(e instanceof PlanetCapReached)) throw e;
    if (!deps.lobby) throw capUnavailable(e);
    return enqueue(deps, deps.lobby, playerId, e.type, now, intent);
  }
}

async function enqueue(
  deps: CapacityQueueDeps,
  lobby: LobbyPersistenceService,
  playerId: string,
  type: DevPlanetType,
  now: number,
  intent?: { readonly sectorId?: string; readonly planetId?: string },
): Promise<HomeResponse> {
  const sectorId = intent?.sectorId?.trim() || undefined;
  const { ticket } = await lobby.enqueueTicket({
    playerId,
    idempotencyKey: `planet-cap:${type}:${now}`,
    request: {
      mode: 'AUTO',
      planetId: devPlanetIdFor(type, 1),
      planetType: type,
      ...(sectorId ? { sectorId: sectorId as SectorId, sectorIntent: { kind: 'chosen' as const, sectorId: sectorId as SectorId } } : {}),
    },
    priority: 0,
  });
  return queuedAtCap(ticket, lobby, deps.lifecycle);
}

/**
 * A poll of a queued player (`GET /me/home` while QUEUED). The first live ticket in line tries to seat; on success its
 * ticket is ASSIGNED and the home is ACTIVE. Otherwise (not first, or still at the cap) it stays QUEUED.
 */
export async function admitFromQueue(
  deps: CapacityQueueDeps,
  ticket: MatchTicketRecord,
  seat: () => Promise<HomeResponse>,
): Promise<HomeResponse> {
  const lobby = deps.lobby;
  if (!lobby) throw new Error('admitFromQueue needs the lobby');
  const now = (deps.now ?? Date.now)();
  if (await isHeadOfQueue(lobby, ticket, now)) {
    try {
      const home = await seat();
      if (home.state === 'ACTIVE') await lobby.updateTicketState({ ticketId: ticket.id, state: 'ASSIGNED' });
      return home;
    } catch (e) {
      if (!(e instanceof PlanetCapReached)) throw e;
    }
  }
  if (now - Date.parse(ticket.updatedAt) >= QUEUE_TOUCH_MS) {
    await lobby.updateTicket({ ticketId: ticket.id, position: ticket.position ?? 0 }).catch(() => undefined);
  }
  return queuedAtCap(ticket, lobby, deps.lifecycle);
}

/**
 * The QUEUED home of a capacity ticket. A seat only frees when a planet unloads or a colony ends, so there is no
 * honest estimate: `etaS` is null (the lobby's per-position estimate is for canonical sector assignment).
 */
async function queuedAtCap(ticket: MatchTicketRecord, lobby: LobbyPersistenceService, lifecycle: WorldLifecycleService | undefined): Promise<HomeResponse> {
  const home = await buildQueuedHomeResponse(ticket, lobby, lifecycle);
  return home.state === 'QUEUED' ? { ...home, etaS: null } : home;
}

/** First in line among the tickets of the same family that were polled recently (FIFO by priority, then age). */
export async function isHeadOfQueue(lobby: LobbyPersistenceService, ticket: MatchTicketRecord, now: number): Promise<boolean> {
  const live = await liveQueue(lobby, ticket.planetId, now, ticket.id);
  return live[0]?.id === ticket.id;
}

/** Queued capacity tickets of a family that were polled recently; long-abandoned ones are EXPIRED on the way. */
async function liveQueue(lobby: LobbyPersistenceService, familyId: string, now: number, keepId?: string): Promise<MatchTicketRecord[]> {
  const queued = (await lobby.listTickets({ planetId: familyId, state: 'QUEUED' })).filter(isCapacityTicket);
  const age = (t: MatchTicketRecord) => now - Date.parse(t.updatedAt);
  for (const t of queued) {
    if (t.id !== keepId && age(t) > QUEUE_EXPIRE_MS) void lobby.updateTicketState({ ticketId: t.id, state: 'EXPIRED' }).catch(() => undefined);
  }
  return queued.filter((t) => t.id === keepId || age(t) <= QUEUE_LIVE_MS);
}

function capUnavailable(e: PlanetCapReached): CoreException {
  return new CoreException('PLANET_CAP_REACHED', {
    status: 503,
    message: e.message,
    details: { code: 'planet_cap_reached', cap: e.cap, loaded: e.loaded },
  });
}
