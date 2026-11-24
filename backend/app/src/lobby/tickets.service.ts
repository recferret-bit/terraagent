import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  CANONICAL_PLANETS,
  newId,
  type EnqueueTicketRequestV1,
  type MatchTicketV1,
  type NormalizedTicketIntentV1,
  type PlanetType,
} from '@terra/contracts';
import { SectorAntiCheatService } from '../core/anticheat';
import { ColonySlotAllowanceService } from '../core/home/colony-slot-allowance.service';
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
  assertMultiColonyTicketAdmissionHelper,
  resolveActivePlayerHomesHelper,
  type SeededColonyState,
} from './parts/tickets-multi-colony';
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

/**
 * Matchmaking ticket admission, ownership, live-colony + staking slot guard, and idempotent cancellation service.
 */
@Injectable()
export class MatchTicketsService {
  private readonly playerLock = new KeyedMutex();
  private readonly lifecycle: WorldLifecycleService;
  private readonly homeRepo: HomeRepository;
  private readonly seededColoniesByPlayer = new Map<string, SeededColonyState[]>();
  private readonly eliminatedColonyIds = new Set<string>();

  constructor(
    @Inject(LobbyPersistenceService) private readonly persistence: LobbyPersistenceService,
    @Optional() @Inject(WorldLifecycleService) lifecycle?: WorldLifecycleService,
    @Optional() @Inject(HomeRepository) homeRepo?: HomeRepository,
    @Optional() @Inject(HomeService) homeService?: HomeService,
    @Optional() @Inject(SectorAntiCheatService) private readonly antiCheat?: SectorAntiCheatService,
    @Optional() @Inject(ColonySlotAllowanceService) private slotAllowance?: ColonySlotAllowanceService,
  ) {
    this.lifecycle = lifecycle ?? new WorldLifecycleService(this.persistence);
    this.homeRepo = homeRepo ?? new HomeRepository();
    homeService?.setLobbyServices(this.persistence, this.lifecycle);
    this.antiCheat?.setLobbyPersistence(this.persistence);
    if (this.slotAllowance) this.antiCheat?.setSlotAllowanceService(this.slotAllowance);
  }

  setSlotAllowanceService(slotAllowance?: ColonySlotAllowanceService): void {
    this.slotAllowance = slotAllowance;
    this.antiCheat?.setSlotAllowanceService(slotAllowance);
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
    const existingList = (this.seededColoniesByPlayer.get(input.playerId) ?? []).filter(
      (c) => c.id !== colonyId,
    );
    existingList.push(state);
    this.seededColoniesByPlayer.set(input.playerId, existingList);

    this.antiCheat?.index.upsertColonyBase({
      playerId: state.playerId,
      colonyId: state.id,
      planetId: state.planetId,
      colonyIndex: state.colonyIndex,
      name: state.name,
      foundingSectorId: state.foundingSectorId,
      spawnQ: state.spawnQ,
      spawnR: state.spawnR,
      status: state.status,
      authoritativeStatus: true,
    });
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
    this.antiCheat?.recordColonyStatus(colonyId, 'ELIMINATED');
    if (playerId) {
      for (const seeded of this.seededColoniesByPlayer.get(playerId) ?? []) {
        if (seeded.id === colonyId) seeded.status = 'ELIMINATED';
      }
      return;
    }
    for (const list of this.seededColoniesByPlayer.values()) {
      for (const seeded of list) {
        if (seeded.id === colonyId) seeded.status = 'ELIMINATED';
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
      const activeHomes = await this.resolveActivePlayerHomes(call.playerId);
      if (intent.mode === 'TRANSFER' && activeHomes.length > 0) {
        await assertMultiColonyTicketAdmissionHelper({
          playerId: call.playerId,
          intent,
          activeHomes,
          sectors: [],
          slotAllowance: this.slotAllowance,
        });
      }

      const sectors = await this.validatePlanetAndSectorAdmission(intent);

      if (intent.mode !== 'TRANSFER' && activeHomes.length > 0) {
        await assertMultiColonyTicketAdmissionHelper({
          playerId: call.playerId,
          intent,
          activeHomes,
          sectors,
          slotAllowance: this.slotAllowance,
        });
      }

      const existingOpen = await this.persistence.findActiveTicketByPlayer(call.playerId);
      if (existingOpen) {
        if (
          existingOpen.mode === intent.mode &&
          existingOpen.planetId === intent.planetId &&
          existingOpen.planetType === intent.planetType &&
          sameSectorIntent(existingOpen.sectorIntent, intent.sectorIntent)
        ) {
          return this.hydrateTicketV1(existingOpen, sectors, activeHomes);
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
        return this.hydrateTicketV1(ticket, sectors, activeHomes);
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

  async resolveActivePlayerHomes(playerId: string): Promise<ActiveHomeV1[]> {
    return resolveActivePlayerHomesHelper({
      playerId,
      seededList: this.seededColoniesByPlayer.get(playerId) ?? [],
      eliminatedColonyIds: this.eliminatedColonyIds,
      antiCheat: this.antiCheat,
      homeRepo: this.homeRepo,
      persistence: this.persistence,
    });
  }

  async resolveActivePlayerHome(playerId: string): Promise<ActiveHomeV1 | null> {
    const homes = await this.resolveActivePlayerHomes(playerId);
    return homes[0] ?? null;
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
    preloadedHomes?: readonly ActiveHomeV1[],
  ): Promise<MatchTicketV1> {
    const sectors = preloadedSectors ?? (await this.persistence.listSectors(record.planetId));
    const homes = preloadedHomes ?? (await this.resolveActivePlayerHomes(record.playerId));
    const excluded = new Set(
      homes.filter((h) => h.planet.id === record.planetId).map((h) => h.colony.foundingSectorId),
    );
    const alternativeSectors = computeAlternativeSectorsForIntent(
      sectors,
      record.sectorIntent,
      excluded.size > 0 ? excluded : undefined,
    );
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
