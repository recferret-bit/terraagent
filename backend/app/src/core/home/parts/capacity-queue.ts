import type { HomeResponse } from '@terra/contracts';
import { devPlanetIdFor, devPlanetTypeOf, type DevPlanetType } from '@terra/sim';
import type { WorldLifecycleService } from '../../../lobby/lifecycle.service';
import type { LobbyPersistenceService } from '../../../lobby/lobby-persistence.service';
import type { MatchTicketRecord } from '../../../lobby/lobby-persistence.types';
import { CoreException } from '../../errors';
import { buildQueuedHomeResponse } from '../home-resolve.helpers';
import { PlanetCapReached } from './planet-capacity';

/** A queued ticket not polled for this long does not hold its place (its player closed the tab). */
export const QUEUE_LIVE_MS = 60_000;
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

/** Planet type a capacity ticket waits for. */
export const capacityTicketType = (t: Pick<MatchTicketRecord, 'planetId'>): DevPlanetType => devPlanetTypeOf(t.planetId) ?? 'desert';

export interface CapacityQueueDeps {
  readonly lobby: LobbyPersistenceService | undefined;
  readonly lifecycle: WorldLifecycleService | undefined;
  readonly now?: () => number;
}

/** Runs `seat`; at the planet cap the player is queued instead (no planet is created). */
export async function seatOrQueue(deps: CapacityQueueDeps, playerId: string, seat: () => Promise<HomeResponse>): Promise<HomeResponse> {
  try {
    return await seat();
  } catch (e) {
    if (!(e instanceof PlanetCapReached)) throw e;
    if (!deps.lobby) throw capUnavailable(e);
    const { ticket } = await deps.lobby.enqueueTicket({
      playerId,
      idempotencyKey: `planet-cap:${e.type}:${(deps.now ?? Date.now)()}`,
      request: { mode: 'AUTO', planetId: devPlanetIdFor(e.type, 1), planetType: e.type },
      priority: 0,
    });
    return buildQueuedHomeResponse(ticket, deps.lobby, deps.lifecycle);
  }
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
  return buildQueuedHomeResponse(ticket, lobby, deps.lifecycle);
}

/** First in line among the tickets of the same family that were polled recently (FIFO by priority, then age). */
export async function isHeadOfQueue(lobby: LobbyPersistenceService, ticket: MatchTicketRecord, now: number): Promise<boolean> {
  const queued = await lobby.listTickets({ planetId: ticket.planetId, state: 'QUEUED' });
  const live = queued.filter((t) => t.id === ticket.id || now - Date.parse(t.updatedAt) <= QUEUE_LIVE_MS);
  return live[0]?.id === ticket.id;
}

function capUnavailable(e: PlanetCapReached): CoreException {
  return new CoreException('PLANET_CAP_REACHED', {
    status: 503,
    message: e.message,
    details: { code: 'planet_cap_reached', cap: e.cap, loaded: e.loaded },
  });
}
