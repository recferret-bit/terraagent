import { Inject, Injectable, Optional } from '@nestjs/common';
import type { MatchTicketV1, SectorId } from '@terra/contracts';
import { WorldLifecycleService } from './lifecycle.service';
import {
  getSharedCapacityMetricsState,
  recordCapacityBlockedForProcessResult,
} from './capacity-guard.helpers';
import { LobbyPersistenceService } from './lobby-persistence.service';
import type {
  CanonicalWorldRecord,
  MatchTicketRecord,
  PlanetSectorRecord,
  SectorIntentInput,
  TransferCarryRecord,
} from './lobby-persistence.types';
import { KeyedMutex, normalizeSectorIntentInput } from './lobby-store.helpers';
import {
  buildPausedTickSummaryHelper,
  buildQueuedProcessResult,
  buildReservedProcessResult,
  computeAlternativeSectorIds,
  evaluateWorldMatchmakingEligibility,
  extractAcceptAlternativeArgs,
  isValidTransferCarry,
  loadAndSyncTicketRecord,
  refreshRemainingQueuePositionsHelper,
  resolveCanonicalPlanetId,
  resolveTicketTargetWorld,
  resolveTransferCarry,
  sortEligibleLandSectorsFillFirst,
  sortQueuedTicketsByPriority,
  updateQueuedTicketPositionAndEtaHelper,
} from './matchmaker.helpers';
import {
  MM_BATCH,
  MM_DEFAULT_AVG_ASSIGN_S,
  MM_EWMA_ALPHA,
  MM_TRANSFER_PRIORITY,
  type AcceptAlternativeSectorInput,
  type AcceptAlternativeSectorOptions,
  type MatchmakerTickSummary,
  type ProcessTicketOptions,
  type ProcessTicketResult,
  type RunMatchmakerTickOptions,
} from './matchmaker.types';
import { SectorReservationService } from './reservation.service';
import { toSectorReservationV1 } from './reservation.helpers';
import {
  MatchTicketBadRequestException,
  MatchTicketConflictException,
  MatchTicketForbiddenException,
  MatchTicketNotFoundException,
} from './tickets.types';

/**
 * Same-planet sector matchmaker & pending `TRANSFER` coordinator (W11-12: MATCHMAKING §0.2 MM-32..34, MM-40, MM-41, MM-45..48).
 */
@Injectable()
export class MatchmakerService {
  private readonly tickMutex = new KeyedMutex();
  private readonly lifecycle: WorldLifecycleService;
  private readonly reservations: SectorReservationService;
  private avgAssignmentS = MM_DEFAULT_AVG_ASSIGN_S;

  constructor(
    @Inject(LobbyPersistenceService) private readonly persistence: LobbyPersistenceService,
    @Optional()
    @Inject(SectorReservationService)
    secondArg?: SectorReservationService | WorldLifecycleService,
    @Optional()
    @Inject(WorldLifecycleService)
    thirdArg?: WorldLifecycleService | SectorReservationService,
  ) {
    this.lifecycle =
      (secondArg instanceof WorldLifecycleService ? secondArg : undefined) ??
      (thirdArg instanceof WorldLifecycleService ? thirdArg : undefined) ??
      new WorldLifecycleService(this.persistence);
    this.reservations =
      (secondArg instanceof SectorReservationService ? secondArg : undefined) ??
      (thirdArg instanceof SectorReservationService ? thirdArg : undefined) ??
      new SectorReservationService(this.persistence, this.lifecycle);
  }

  async getEligibleSectorsForPlanet(
    planetId: string,
    excludeSectorId?: SectorId,
  ): Promise<PlanetSectorRecord[]> {
    return sortEligibleLandSectorsFillFirst(
      await this.persistence.listSectors(planetId),
      excludeSectorId,
    );
  }

  async computeAlternativeSectors(
    planetId: string,
    chosenSectorId: SectorId,
  ): Promise<SectorId[]> {
    return computeAlternativeSectorIds(await this.persistence.listSectors(planetId), chosenSectorId);
  }

  async processTicket(
    ticketOrId: string | MatchTicketRecord | MatchTicketV1,
    opts: ProcessTicketOptions = {},
  ): Promise<ProcessTicketResult> {
    const ticket = await loadAndSyncTicketRecord(this.persistence, ticketOrId);
    const now = opts.now ?? new Date();

    if (this.lifecycle.isQueuePaused()) {
      const updated = await updateQueuedTicketPositionAndEtaHelper(
        this.persistence,
        ticket,
        ticket.alternativeSectors ?? [],
        resolveTransferCarry(ticket),
        true,
        this.avgAssignmentS,
        now,
      );
      return buildQueuedProcessResult(
        'queue_paused',
        updated,
        updated.alternativeSectors ?? [],
        resolveTransferCarry(updated),
        'queue_paused',
      );
    }

    const existingHit = await this.checkAlreadyReservedTicket(ticket);
    if (existingHit) return existingHit;
    if (ticket.state !== 'QUEUED') {
      return buildQueuedProcessResult(
        'skipped',
        ticket,
        ticket.alternativeSectors ?? [],
        resolveTransferCarry(ticket),
        'ticket_not_queued',
      );
    }
    if (ticket.mode === 'TRANSFER') return this.processTransferTicket(ticket, opts, now);

    const world = await resolveTicketTargetWorld(this.persistence, ticket);
    const eligibility = evaluateWorldMatchmakingEligibility(world);
    if (!world || !eligibility.eligible) {
      const updated = await updateQueuedTicketPositionAndEtaHelper(
        this.persistence,
        ticket,
        [],
        null,
        true,
        this.avgAssignmentS,
        now,
      );
      return buildQueuedProcessResult('queued_world_unavailable', updated, [], null, eligibility.reason);
    }

    return ticket.sectorIntent.kind === 'chosen'
      ? this.processChosenSectorTicket(ticket, world, opts, null, now)
      : this.processAutoSectorTicket(ticket, world, opts, null, now);
  }

  async acceptAlternativeSector(
    firstArg: string | AcceptAlternativeSectorInput,
    secondArg?: string | SectorIntentInput,
    thirdArg?: SectorIntentInput | SectorId | AcceptAlternativeSectorOptions,
    fourthArg?: AcceptAlternativeSectorOptions,
  ): Promise<ProcessTicketResult> {
    const { ticketId, playerId, newSectorIntent, options } = extractAcceptAlternativeArgs(
      firstArg,
      secondArg,
      thirdArg,
      fourthArg,
    );
    const ticket = await this.persistence.getTicketById(ticketId);
    if (!ticket) {
      throw new MatchTicketNotFoundException(`Ticket "${ticketId}" not found`, { ticketId });
    }
    if (playerId !== undefined && ticket.playerId !== playerId) {
      throw new MatchTicketForbiddenException(
        `Player "${playerId}" is not authorized to modify ticket "${ticket.id}"`,
        { ticketId: ticket.id, playerId },
      );
    }
    if (ticket.state !== 'QUEUED') {
      throw new MatchTicketConflictException(
        'conflict',
        `Cannot change sector intent on ticket "${ticket.id}" in state "${ticket.state}"`,
        { ticketId: ticket.id, state: ticket.state },
      );
    }

    const normalizedIntent = normalizeSectorIntentInput(newSectorIntent);
    if (normalizedIntent.kind === 'chosen') {
      const sector = await this.persistence.getSector(ticket.planetId, normalizedIntent.sectorId);
      if (!sector) {
        throw new MatchTicketBadRequestException(
          'invalid_sector',
          `Sector "${normalizedIntent.sectorId}" does not exist on planet "${ticket.planetId}"`,
          { planetId: ticket.planetId, sectorId: normalizedIntent.sectorId },
        );
      }
      if (sector.kind === 'ocean') {
        throw new MatchTicketBadRequestException(
          'sector_not_land',
          `Sector "${normalizedIntent.sectorId}" is an ocean sector and cannot admit founding colonies`,
          { planetId: ticket.planetId, sectorId: normalizedIntent.sectorId },
        );
      }
    }

    const now = options.now ?? new Date();
    const updated = await this.persistence.updateTicket({
      ticketId: ticket.id,
      sectorIntent: normalizedIntent,
      now,
    });

    if (options.processImmediately === false) {
      const alternatives =
        normalizedIntent.kind === 'chosen'
          ? await this.computeAlternativeSectors(updated.planetId, normalizedIntent.sectorId)
          : [];
      return buildQueuedProcessResult(
        'skipped',
        updated,
        alternatives,
        resolveTransferCarry(updated),
        'intent_updated',
      );
    }
    return this.processTicket(updated, options);
  }

  async processQueuedTickets(opts: RunMatchmakerTickOptions = {}): Promise<MatchmakerTickSummary> {
    return this.runMatchmakerTick(opts);
  }

  async runMatchmakerTick(opts: RunMatchmakerTickOptions = {}): Promise<MatchmakerTickSummary> {
    return this.tickMutex.run('matchmaker:tick', async () => {
      const now = opts.now ?? new Date();
      const batchSize = Math.max(1, opts.batchSize ?? MM_BATCH);

      if (this.lifecycle.isQueuePaused()) {
        return buildPausedTickSummaryHelper(
          this.persistence,
          batchSize,
          opts.planetId,
          this.avgAssignmentS,
          now,
        );
      }

      const expiredRecords = await this.reservations.sweepExpiredReservations({
        now,
        ...(opts.planetId ? { planetId: opts.planetId } : {}),
      });

      const allQueued = await this.persistence.listTickets({
        state: 'QUEUED',
        ...(opts.planetId ? { planetId: opts.planetId } : {}),
      });
      const claimed = sortQueuedTicketsByPriority(allQueued).slice(0, batchSize);

      const results: ProcessTicketResult[] = [];
      for (const ticket of claimed) {
        results.push(await this.processTicket(ticket, { ...opts, now }));
      }

      const remainingQueued = await refreshRemainingQueuePositionsHelper(
        this.persistence,
        opts.planetId,
        false,
        this.avgAssignmentS,
        now,
      );
      const reservedTickets = results.filter((r) => r.reserved).map((r) => r.ticket);
      const transferPendingTickets = remainingQueued.filter((t) => t.mode === 'TRANSFER');

      return {
        queuePaused: false,
        batchSize,
        processed: results.length,
        reserved: reservedTickets.length,
        queued: remainingQueued.length,
        transferPending: transferPendingTickets.length,
        expiredReservations: expiredRecords.length,
        reservedTickets,
        queuedTickets: remainingQueued,
        transferPendingTickets,
        expiredReservationRecords: expiredRecords,
        results,
      };
    });
  }

  private async checkAlreadyReservedTicket(
    ticket: MatchTicketRecord,
  ): Promise<ProcessTicketResult | null> {
    if (ticket.state !== 'RESERVED') return null;
    const existing = await this.reservations.getReservationByTicketId(ticket.id);
    if (!existing) return null;
    const slot = await this.persistence.getLandingSlot(existing.planetId, existing.landingSlotId);
    const sector = await this.persistence.getSector(existing.planetId, existing.sectorId);
    if (!slot || !sector) return null;
    return buildReservedProcessResult(
      {
        ok: true,
        idempotent: true,
        reservation: existing,
        reservationV1: toSectorReservationV1(existing),
        slot,
        sector,
        ticket,
      },
      ticket,
      resolveTransferCarry(ticket),
    );
  }

  private async processTransferTicket(
    ticket: MatchTicketRecord,
    opts: ProcessTicketOptions,
    now: Date,
  ): Promise<ProcessTicketResult> {
    const transferCarry = resolveTransferCarry(ticket);
    const effectivePriority = Math.max(MM_TRANSFER_PRIORITY, ticket.priority);
    const keepPending = async (reason?: string): Promise<ProcessTicketResult> => {
      const updated = await updateQueuedTicketPositionAndEtaHelper(
        this.persistence,
        ticket,
        [],
        transferCarry,
        true,
        this.avgAssignmentS,
        now,
        effectivePriority,
      );
      return buildQueuedProcessResult('transfer_pending', updated, [], transferCarry, reason);
    };

    if (!isValidTransferCarry(transferCarry)) {
      return keepPending('invalid_transfer_carry');
    }

    const world = await resolveTicketTargetWorld(this.persistence, ticket);
    const sourceCanonicalId = resolveCanonicalPlanetId(transferCarry.sourcePlanetId);
    if (
      !world ||
      world.id === transferCarry.sourcePlanetId ||
      (sourceCanonicalId !== null && world.id === sourceCanonicalId)
    ) {
      return keepPending('same_planet_transfer');
    }

    const eligibility = evaluateWorldMatchmakingEligibility(world);
    if (!eligibility.eligible) {
      return keepPending(eligibility.reason);
    }

    const workingTicket =
      ticket.priority !== effectivePriority
        ? await this.persistence.updateTicket({
            ticketId: ticket.id,
            priority: effectivePriority,
            transferCarry,
            now,
          })
        : ticket;

    return workingTicket.sectorIntent.kind === 'chosen'
      ? this.processChosenSectorTicket(workingTicket, world, opts, transferCarry, now)
      : this.processAutoSectorTicket(workingTicket, world, opts, transferCarry, now);
  }

  private async processChosenSectorTicket(
    ticket: MatchTicketRecord,
    world: CanonicalWorldRecord,
    opts: ProcessTicketOptions,
    transferCarry: TransferCarryRecord | null,
    now: Date,
  ): Promise<ProcessTicketResult> {
    const chosenSectorId =
      ticket.sectorIntent.kind === 'chosen' ? ticket.sectorIntent.sectorId : 'sec_0_0';
    const res = await this.reservations.reserveSlotForTicket(ticket, {
      sectorId: chosenSectorId,
      ttlMs: opts.ttlMs,
      ttlS: opts.ttlS,
      now,
      authorityValidator: opts.authorityValidator,
      simState: opts.simState,
      generatedAtlas: opts.generatedAtlas,
    });

    if (res.ok) {
      this.recordAssignmentWaitSeconds(ticket, now);
      const updated = await this.persistence.updateTicket({
        ticketId: ticket.id,
        state: 'RESERVED',
        position: null,
        etaS: null,
        alternativeSectors: [],
        ...(transferCarry ? { transferCarry } : {}),
        now,
      });
      return buildReservedProcessResult(res, updated, transferCarry ?? resolveTransferCarry(updated));
    }

    const alternatives = await this.computeAlternativeSectors(world.id, chosenSectorId);
    const updated = await updateQueuedTicketPositionAndEtaHelper(
      this.persistence,
      ticket,
      alternatives,
      transferCarry,
      alternatives.length === 0,
      this.avgAssignmentS,
      now,
    );
    const outcome =
      ticket.mode === 'TRANSFER' ? 'transfer_pending' : 'queued_chosen_sector_full';
    const out = buildQueuedProcessResult(outcome, updated, alternatives, transferCarry, res.code);
    recordCapacityBlockedForProcessResult(getSharedCapacityMetricsState(this.persistence), out);
    return out;
  }

  private async processAutoSectorTicket(
    ticket: MatchTicketRecord,
    world: CanonicalWorldRecord,
    opts: ProcessTicketOptions,
    transferCarry: TransferCarryRecord | null,
    now: Date,
  ): Promise<ProcessTicketResult> {
    const eligibleSectors = await this.getEligibleSectorsForPlanet(world.id);
    let lastFailureCode = 'sector_full';

    for (const candidate of eligibleSectors) {
      const res = await this.reservations.reserveSlotForTicket(ticket, {
        sectorId: candidate.sectorId,
        ttlMs: opts.ttlMs,
        ttlS: opts.ttlS,
        now,
        authorityValidator: opts.authorityValidator,
        simState: opts.simState,
        generatedAtlas: opts.generatedAtlas,
      });
      if (res.ok) {
        this.recordAssignmentWaitSeconds(ticket, now);
        const updated = await this.persistence.updateTicket({
          ticketId: ticket.id,
          state: 'RESERVED',
          position: null,
          etaS: null,
          alternativeSectors: [],
          ...(transferCarry ? { transferCarry } : {}),
          now,
        });
        return buildReservedProcessResult(
          res,
          updated,
          transferCarry ?? resolveTransferCarry(updated),
        );
      }
      lastFailureCode = res.code;
    }

    const updated = await updateQueuedTicketPositionAndEtaHelper(
      this.persistence,
      ticket,
      [],
      transferCarry,
      true,
      this.avgAssignmentS,
      now,
    );
    const outcome = ticket.mode === 'TRANSFER' ? 'transfer_pending' : 'queued_planet_full';
    const reason = ticket.mode === 'TRANSFER' ? 'destination_planet_full' : lastFailureCode;
    const out = buildQueuedProcessResult(outcome, updated, [], transferCarry, reason);
    recordCapacityBlockedForProcessResult(getSharedCapacityMetricsState(this.persistence), out);
    return out;
  }

  private recordAssignmentWaitSeconds(ticket: MatchTicketRecord, now: Date): void {
    const createdMs = new Date(ticket.createdAt).getTime();
    if (Number.isNaN(createdMs)) return;
    const waitS = Math.max(1, (now.getTime() - createdMs) / 1000);
    this.avgAssignmentS = MM_EWMA_ALPHA * waitS + (1 - MM_EWMA_ALPHA) * this.avgAssignmentS;
  }
}
