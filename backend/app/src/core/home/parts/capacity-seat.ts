import type { HomeResponse } from '@terra/contracts';
import type { DevPlanetType } from '@terra/sim';
import type { SectorAntiCheatService } from '../../anticheat';
import type { ColonySlotAllowanceService } from '../colony-slot-allowance.service';
import type { ColonyRecord, PlanetRecord } from '../home.repository';
import { admitFromQueue, capacityTicketType, findCapacityTicket, seatOrQueue, type CapacityQueueDeps } from './capacity-queue';
import { assertNewColonyAllowed, buildOccupiedSectorsMap, type ActiveColonyBundle } from './home-multi-colony';
import { assertNewHomeJoinSpace, assertRequestedHomeLocation, seatNewColony, type SeatContext } from './home-seating';

export { isCapacityTicket } from './capacity-queue';
export type { PlanetCapacityGate } from './planet-capacity';

type Player = { readonly id: string; readonly handle?: string };

/** What `HomeService` lends the planet-cap seat path (3.4). */
export interface CapacitySeatDeps {
  readonly queue: CapacityQueueDeps;
  readonly antiCheat?: SectorAntiCheatService;
  readonly slotAllowance?: ColonySlotAllowanceService;
  readonly listActiveBundles: (playerId: string, handle?: string) => Promise<ActiveColonyBundle[]>;
  readonly seatContext: (occupiedSectorsByPlanet: ReadonlyMap<string, ReadonlySet<string>>) => SeatContext;
  readonly withRoster: (home: HomeResponse, playerId: string, bundles: readonly ActiveColonyBundle[]) => Promise<HomeResponse>;
  readonly withSeatLock: <T>(fn: () => Promise<T>) => Promise<T>;
  readonly answerExisting: (colony: ColonyRecord, planet: PlanetRecord, canonical: boolean) => Promise<HomeResponse>;
}

export interface FreshSeatOptions {
  readonly sectorId?: string;
  readonly planetId?: string;
  readonly newColony: boolean;
  /** First in the planet-cap queue: skips the "others are waiting" check. */
  readonly admitted?: boolean;
  /** The player's active colonies read under the seat lock (read again when absent). */
  readonly bundles?: readonly ActiveColonyBundle[];
}

/** Seats a NEW colony (caller holds the seat lock); at the planet cap, or behind a queue, the player is queued. */
export async function seatFreshColony(deps: CapacitySeatDeps, player: Player, type: DevPlanetType, opts: FreshSeatOptions): Promise<HomeResponse> {
  const { sectorId, planetId, newColony } = opts;
  const bundles = opts.bundles ?? (await deps.listActiveBundles(player.id, player.handle));
  await assertNewHomeJoinSpace({ antiCheat: deps.antiCheat, playerId: player.id, preferredType: type, requestedSectorId: sectorId, requestedPlanetId: planetId, newColony });
  const who = { id: player.id, handle: player.handle?.trim() || `Colonist-${player.id.slice(-4)}` };
  const ctx = deps.seatContext(buildOccupiedSectorsMap(bundles));
  const seated = await seatOrQueue(deps.queue, player.id, type, opts.admitted ?? false, () =>
    seatNewColony(ctx, who, type, sectorId?.trim() || undefined, planetId?.trim() || undefined),
    { sectorId, planetId },
  );
  return deps.withRoster(seated, player.id, await deps.listActiveBundles(player.id, player.handle));
}

/**
 * A player holding a planet-cap ticket, with no colony or asking for a new one, is admitted when first in line.
 * `null`: no such ticket, the normal home flow goes on.
 */
export async function admitCapacityQueued(
  deps: CapacitySeatDeps,
  player: Player,
  req: { readonly sectorId?: string; readonly planetId?: string; readonly newColony: boolean; readonly hasColonies: boolean },
): Promise<HomeResponse | null> {
  if (!req.newColony && req.hasColonies) return null;
  const ticket = await findCapacityTicket(deps.queue.lobby, player.id);
  if (!ticket) return null;
  const effectiveSectorId = req.sectorId?.trim() || (ticket.sectorIntent.kind === 'chosen' ? ticket.sectorIntent.sectorId : undefined);
  assertRequestedHomeLocation({ state: 'NEW', planets: [], newPlanetTypes: [] }, deps.antiCheat, effectiveSectorId, req.planetId);
  return admitFromQueue(deps.queue, ticket, () =>
    deps.withSeatLock(async () => {
      const bundles = await deps.listActiveBundles(player.id, player.handle);
      if (!req.newColony && bundles[0]) return deps.answerExisting(bundles[0].colony, bundles[0].planet, false);
      if (req.newColony) {
        try {
          await assertNewColonyAllowed({
            playerId: player.id,
            activeBundles: bundles,
            slotAllowance: deps.slotAllowance,
            requestedPlanetId: req.planetId,
            requestedSectorId: effectiveSectorId,
          });
        } catch (err) {
          await deps.queue.lobby?.updateTicketState({ ticketId: ticket.id, state: 'CANCELLED', failureCode: 'slot_allowance_revoked' }).catch(() => undefined);
          throw err;
        }
      }
      return seatFreshColony(deps, player, capacityTicketType(ticket), {
        sectorId: effectiveSectorId,
        planetId: req.planetId,
        newColony: req.newColony,
        admitted: true,
        bundles,
      });
    }),
  );
}
