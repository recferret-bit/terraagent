import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  CANONICAL_PLANETS,
  newId,
  type EnqueueTicketRequestV1,
  type LandingSlotId,
  type MatchTicketV1,
  type NormalizedTicketIntentV1,
  type PlanetType,
  type SectorId,
} from '@terra/contracts';
import { HomeRepository } from '../core/home/home.repository';
import { HomeService } from '../core/home/home.service';
import { WorldLifecycleService } from './lifecycle.service';
import { LobbyPersistenceService } from './lobby-persistence.service';
import {
  LobbyPersistenceConflictError,
  type MatchTicketRecord,
  type PlanetSectorRecord,
} from './lobby-persistence.types';
import { KeyedMutex, sameSectorIntent } from './lobby-store.helpers';
import {
  buildActiveHomeSummary,
  computeAlternativeSectorsForIntent,
  computeQueuePositionAndEta,
  extractEnqueueCallArgs,
  formatMatchTicketV1,
  normalizePlayerId,
  parseAndValidateTicketIntent,
} from './tickets.helpers';
import {
  MatchTicketBadRequestException,
  MatchTicketConflictException,
  MatchTicketForbiddenException,
  MatchTicketNotFoundException,
  type ActiveHomeV1,
  type EnqueueMatchTicketOptions,
  type EnqueueMatchTicketServiceInput,
  type SeedActiveColonyInput,
} from './tickets.types';

interface SeededColonyState {
  readonly id: string;
  readonly playerId: string;
  readonly planetId: string;
  readonly planetType: PlanetType;
  readonly colonyIndex: number;
  readonly name: string;
  readonly color: number;
  readonly foundingSectorId: string;
  readonly landingSlotId?: string;
  readonly spawnQ: number;
  readonly spawnR: number;
  status: 'ACTIVE' | 'ELIMINATED' | 'ENDED';
}

/**
 * Matchmaking ticket admission, ownership, live-colony guard, and idempotent cancellation service (W11-10).
 * - Enforces per-player ticket serialization (`withPlayerTicketLock`) so concurrent identical POSTs return 1 ticket.
 * - Rejects `NEW_PLANET` (`400 unsupported_mode`), same-planet `TRANSFER` (`400 same_planet_transfer`),
 *   and ocean-sector founding (`400 sector_not_land`).
 * - Rejects players who already have an `ACTIVE` colony with `409 already_has_colony` + `home` summary.
 * - Preserves explicit `chosen` vs `auto` sector intent and attaches `alternativeSectors` when chosen land sector is full.
 * - Enforces ticket ownership (`403 forbidden`) and idempotent cancellation releasing any held reservation.
 */
@Injectable()
export class MatchTicketsService {
  private readonly playerLock = new KeyedMutex();
  private readonly lifecycle: WorldLifecycleService;
  private readonly homeRepo: HomeRepository;
  private readonly seededColoniesByPlayer = new Map<string, SeededColonyState>();
  private readonly eliminatedColonyIds = new Set<string>();

  constructor(
    @Inject(LobbyPersistenceService) private readonly persistence: LobbyPersistenceService,
    @Optional() @Inject(WorldLifecycleService) lifecycle?: WorldLifecycleService,
    @Optional() @Inject(HomeRepository) homeRepo?: HomeRepository,
    @Optional() @Inject(HomeService) homeService?: HomeService,
  ) {
    this.lifecycle = lifecycle ?? new WorldLifecycleService(this.persistence);
    this.homeRepo = homeRepo ?? new HomeRepository();
    homeService?.setLobbyServices(this.persistence, this.lifecycle);
  }

  /**
   * Serializes per-player ticket operations so 20 concurrent identical `POST /v1/match/tickets`
   * calls for the same player return the exact same single active `MatchTicketV1`.
   */
  withPlayerTicketLock<T>(playerId: string, fn: () => Promise<T>): Promise<T> {
    return this.playerLock.run(`ticket:${playerId}`, () =>
      this.persistence.withPlayerTicketLock(playerId, fn),
    );
  }

  /**
   * Seeds or updates a player's colony state for live-colony admission checks.
   */
  async seedActiveColony(input: SeedActiveColonyInput): Promise<ActiveHomeV1> {
    const planetType: PlanetType =
      input.planetType ??
      (input.planetId === CANONICAL_PLANETS.ocean.id
        ? 'ocean'
        : input.planetId === CANONICAL_PLANETS.temperate.id
          ? 'temperate'
          : 'desert');
    const planetId = input.planetId ?? CANONICAL_PLANETS[planetType].id;
    const colonyId = input.id ?? newId('co');
    const status = input.status ?? 'ACTIVE';
    const state: SeededColonyState = {
      id: colonyId,
      playerId: input.playerId,
      planetId,
      planetType,
      colonyIndex: input.colonyIndex ?? 0,
      name: input.name ?? `Colony-${input.playerId.slice(-4)}`,
      color: input.color ?? 0,
      foundingSectorId: input.foundingSectorId ?? 'sec_0_0',
      ...(input.landingSlotId ? { landingSlotId: input.landingSlotId } : {}),
      spawnQ: input.spawnQ ?? 0,
      spawnR: input.spawnR ?? 0,
      status,
    };
    this.seededColoniesByPlayer.set(input.playerId, state);
    if (status !== 'ACTIVE') {
      this.eliminatedColonyIds.add(colonyId);
    } else {
      this.eliminatedColonyIds.delete(colonyId);
    }
    const world = await this.persistence.getCanonicalWorldById(planetId);
    const sectors = await this.persistence.listSectors(planetId);
    return buildActiveHomeSummary(state, world, sectors, planetType);
  }

  markColonyEliminated(colonyId: string, playerId?: string): void {
    this.eliminatedColonyIds.add(colonyId);
    if (playerId) {
      const seeded = this.seededColoniesByPlayer.get(playerId);
      if (seeded && seeded.id === colonyId) {
        seeded.status = 'ELIMINATED';
      }
    }
  }

  async enqueueTicket(
    firstArg: string | { readonly id: string; readonly handle?: string } | EnqueueMatchTicketServiceInput,
    secondArg?: EnqueueTicketRequestV1 | NormalizedTicketIntentV1 | Record<string, unknown>,
    thirdArg?: EnqueueMatchTicketOptions | string,
  ): Promise<MatchTicketV1> {
    const call = extractEnqueueCallArgs(firstArg, secondArg, thirdArg);
    if (!call.playerId) {
      throw new MatchTicketBadRequestException('validation_error', 'Authenticated playerId is required');
    }
    const { intent, bodyIdempotencyKey } = parseAndValidateTicketIntent(call.rawRequest);
    const effectiveIdempotencyKey = call.idempotencyKey?.trim() || bodyIdempotencyKey;

    return this.withPlayerTicketLock(call.playerId, async () => {
      if (intent.mode !== 'TRANSFER') {
        const activeHome = await this.resolveActivePlayerHome(call.playerId);
        if (activeHome) {
          throw new MatchTicketConflictException(
            'already_has_colony',
            'Player already has an active colony',
            { home: activeHome },
            activeHome,
          );
        }
      }

      const sectors = await this.validatePlanetAndSectorAdmission(intent);

      const existingOpen = await this.persistence.findActiveTicketByPlayer(call.playerId);
      if (existingOpen) {
        if (
          existingOpen.mode === intent.mode &&
          existingOpen.planetId === intent.planetId &&
          existingOpen.planetType === intent.planetType &&
          sameSectorIntent(existingOpen.sectorIntent, intent.sectorIntent)
        ) {
          return this.hydrateTicketV1(existingOpen, sectors);
        }
        throw new MatchTicketConflictException(
          'already_queued',
          `Player "${call.playerId}" already has an active ticket "${existingOpen.id}" with a different intent`,
          { ticketId: existingOpen.id, code: 'ticket_open' },
        );
      }

      try {
        const { ticket } = await this.persistence.enqueueTicket({
          playerId: call.playerId,
          idempotencyKey: effectiveIdempotencyKey,
          request: intent,
          priority: call.priority,
          now: call.now,
        });
        return this.hydrateTicketV1(ticket, sectors);
      } catch (err) {
        if (err instanceof LobbyPersistenceConflictError && err.code === 'ticket_open') {
          throw new MatchTicketConflictException('already_queued', err.message, err.details);
        }
        throw err;
      }
    });
  }

  async getTicket(
    ticketId: string,
    playerOrId: string | { readonly id: string },
  ): Promise<MatchTicketV1> {
    const playerId = normalizePlayerId(playerOrId);
    const record =
      ticketId === 'current'
        ? await this.persistence.findActiveTicketByPlayer(playerId)
        : await this.persistence.getTicketById(ticketId);
    if (!record) {
      throw new MatchTicketNotFoundException(`Ticket "${ticketId}" not found`, { ticketId });
    }
    if (record.playerId !== playerId) {
      throw new MatchTicketForbiddenException(
        `Player "${playerId}" is not authorized to view ticket "${record.id}"`,
        { ticketId: record.id, playerId },
      );
    }
    return this.hydrateTicketV1(record);
  }

  async cancelTicket(
    ticketId: string,
    playerOrId: string | { readonly id: string },
    now?: Date,
  ): Promise<MatchTicketV1> {
    const playerId = normalizePlayerId(playerOrId);
    return this.withPlayerTicketLock(playerId, async () => {
      const record =
        ticketId === 'current'
          ? await this.persistence.findActiveTicketByPlayer(playerId)
          : await this.persistence.getTicketById(ticketId);
      if (!record) {
        throw new MatchTicketNotFoundException(`Ticket "${ticketId}" not found`, { ticketId });
      }
      if (record.playerId !== playerId) {
        throw new MatchTicketForbiddenException(
          `Player "${playerId}" is not authorized to cancel ticket "${record.id}"`,
          { ticketId: record.id, playerId },
        );
      }
      if (record.state === 'CANCELLED') {
        return this.hydrateTicketV1(record);
      }
      if (record.state !== 'QUEUED' && record.state !== 'RESERVED') {
        throw new MatchTicketConflictException(
          'conflict',
          `Cannot cancel ticket "${record.id}" in state "${record.state}"`,
          { ticketId: record.id, state: record.state },
        );
      }
      const cancelled = await this.persistence.cancelTicket(record.id, playerId, now);
      return this.hydrateTicketV1(cancelled);
    });
  }

  async resolveActivePlayerHome(playerId: string): Promise<ActiveHomeV1 | null> {
    const seeded = this.seededColoniesByPlayer.get(playerId);
    if (seeded && seeded.status === 'ACTIVE' && !this.eliminatedColonyIds.has(seeded.id)) {
      const world = await this.persistence.getCanonicalWorldById(seeded.planetId);
      if (!world || world.lifecycle !== 'ARCHIVED') {
        const sectors = await this.persistence.listSectors(seeded.planetId);
        return buildActiveHomeSummary(seeded, world, sectors, seeded.planetType);
      }
    }

    const repoColony = await this.homeRepo.findLatestColonyByPlayerId(playerId);
    if (
      repoColony &&
      (repoColony.status === 'ACTIVE' || repoColony.status === 'ALIVE' || repoColony.status === 'FOUNDING') &&
      !this.eliminatedColonyIds.has(repoColony.id)
    ) {
      const repoPlanet = await this.homeRepo.findPlanetById(repoColony.planetId);
      if (!repoPlanet || (repoPlanet.status !== 'ENDED' && repoPlanet.status !== 'PLANET_ENDED')) {
        const world = await this.persistence.getCanonicalWorldById(repoColony.planetId);
        if (!world || world.lifecycle !== 'ARCHIVED') {
          const sectors = await this.persistence.listSectors(repoColony.planetId);
          const fallbackType = (repoPlanet?.type as PlanetType | undefined) ?? world?.type ?? 'desert';
          return buildActiveHomeSummary(
            {
              id: repoColony.id,
              playerId: repoColony.playerId,
              planetId: repoColony.planetId,
              colonyIndex: repoColony.colonyIndex,
              name: repoColony.name,
              color: repoColony.color,
              foundingSectorId: (repoColony.foundingSectorId ?? 'sec_0_0') as SectorId,
              ...(repoColony.landingSlotId ? { landingSlotId: repoColony.landingSlotId as LandingSlotId } : {}),
              spawnQ: repoColony.spawnQ,
              spawnR: repoColony.spawnR,
            },
            world,
            sectors,
            fallbackType,
          );
        }
      }
    }

    const worlds = await this.persistence.listCanonicalWorlds();
    for (const world of worlds) {
      if (world.lifecycle === 'ARCHIVED') continue;
      const reservations = await this.persistence.listReservations(world.id);
      const committed = reservations.find(
        (r) =>
          r.playerId === playerId &&
          r.state === 'COMMITTED' &&
          !this.eliminatedColonyIds.has(r.colonyId) &&
          (!repoColony || repoColony.id !== r.colonyId || repoColony.status === 'ACTIVE'),
      );
      if (committed) {
        const sectors = await this.persistence.listSectors(world.id);
        return buildActiveHomeSummary(
          {
            id: committed.colonyId,
            playerId: committed.playerId,
            planetId: committed.planetId,
            colonyIndex: committed.slotIndex,
            name: `Colony-${playerId.slice(-4)}`,
            color: committed.slotIndex,
            foundingSectorId: committed.sectorId,
            landingSlotId: committed.landingSlotId,
            spawnQ: committed.q,
            spawnR: committed.r,
          },
          world,
          sectors,
          world.type,
        );
      }
    }

    return null;
  }

  private async validatePlanetAndSectorAdmission(
    intent: NormalizedTicketIntentV1,
  ): Promise<readonly PlanetSectorRecord[]> {
    if (this.lifecycle.isQueuePaused()) {
      throw new MatchTicketConflictException(
        'queue_paused',
        'Global matchmaking queue is currently paused',
        { queuePaused: true },
      );
    }

    const world = await this.persistence.getCanonicalWorldById(intent.planetId);
    if (world) {
      if (world.admission === 'PAUSED') {
        throw new MatchTicketConflictException(
          'queue_paused',
          `Planet "${world.id}" admission is currently paused`,
          { planetId: world.id, admission: 'PAUSED' },
        );
      }
      if (world.lifecycle === 'ARCHIVED' || world.admission === 'ARCHIVED') {
        throw new MatchTicketConflictException(
          'planet_archived',
          `Planet "${world.id}" is archived and no longer admits colonies`,
          { planetId: world.id },
        );
      }
      if (world.lifecycle !== 'ACTIVE' || world.health !== 'OK') {
        throw new MatchTicketConflictException(
          'planet_faulted',
          `Planet "${world.id}" is currently unavailable (${world.health})`,
          { planetId: world.id, health: world.health, lifecycle: world.lifecycle },
        );
      }
    }

    const sectors = await this.persistence.listSectors(intent.planetId);
    if (intent.sectorIntent.kind === 'chosen') {
      const targetSectorId = intent.sectorIntent.sectorId;
      const chosenSec =
        sectors.find((s) => s.sectorId === targetSectorId) ??
        (await this.persistence.getSector(intent.planetId, targetSectorId));
      if (chosenSec && chosenSec.kind === 'ocean') {
        throw new MatchTicketBadRequestException(
          'sector_not_land',
          `Sector "${chosenSec.sectorId}" is an ocean sector and cannot admit founding colonies`,
          { planetId: intent.planetId, sectorId: chosenSec.sectorId },
        );
      }
      if (!chosenSec && sectors.length > 0) {
        throw new MatchTicketBadRequestException(
          'invalid_sector',
          `Sector "${targetSectorId}" does not exist on planet "${intent.planetId}"`,
          { planetId: intent.planetId, sectorId: targetSectorId },
        );
      }
    }

    return sectors;
  }

  private async hydrateTicketV1(
    record: MatchTicketRecord,
    preloadedSectors?: readonly PlanetSectorRecord[],
  ): Promise<MatchTicketV1> {
    const sectors = preloadedSectors ?? (await this.persistence.listSectors(record.planetId));
    const alternativeSectors = computeAlternativeSectorsForIntent(sectors, record.sectorIntent);
    const queuedOnPlanet =
      record.state === 'QUEUED'
        ? await this.persistence.listTickets({ planetId: record.planetId, state: 'QUEUED' })
        : [];
    const world = await this.persistence.getCanonicalWorldById(record.planetId);
    const paused = this.lifecycle.isQueuePaused() || world?.admission === 'PAUSED';
    const { position, etaS } = computeQueuePositionAndEta(record, queuedOnPlanet, paused);

    return formatMatchTicketV1(record, {
      position,
      etaS,
      alternativeSectors,
    });
  }
}
