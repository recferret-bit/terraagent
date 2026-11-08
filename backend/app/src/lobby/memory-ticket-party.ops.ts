import { newId, PARTY_MAX_MEMBERS, type PartyV1 } from '@terra/contracts';
import {
  LobbyPersistenceConflictError,
  type CreatePartyInput,
  type EnqueueTicketInput,
  type EnqueueTicketResult,
  type JoinPartyInput,
  type LeavePartyInput,
  type MatchTicketRecord,
  type SectorReservationRecord,
  type SetPartyIntentInput,
  type UpdateTicketInput,
  type UpdateTicketStateInput,
} from './lobby-persistence.types';
import {
  ACTIVE_TICKET_STATES,
  extractTransferCarryFromInput,
  generatePartyCode,
  type KeyedMutex,
  normalizeSectorIntentInput,
  normalizeTicketIntentOrThrow,
  sameSectorIntent,
  withSectorIntentModeAlias,
} from './lobby-store.helpers';

export class MemoryTicketPartyOps {
  constructor(
    private readonly mutex: KeyedMutex,
    private readonly ticketsById: Map<string, MatchTicketRecord>,
    private readonly partiesById: Map<string, PartyV1>,
    private readonly partyIdByCode: Map<string, string>,
    private readonly findReservationByTicketId: (ticketId: string) => Promise<SectorReservationRecord | null>,
    private readonly releaseReservation: (reservationId: string) => Promise<unknown>,
  ) {}

  async enqueueTicket(input: EnqueueTicketInput): Promise<EnqueueTicketResult> {
    const intent = normalizeTicketIntentOrThrow(input.request, input.transferCarry);
    return this.mutex.run(`ticket:${input.playerId}`, async () => {
      if (input.idempotencyKey) {
        const byKey = [...this.ticketsById.values()].find(
          (t) => t.playerId === input.playerId && t.idempotencyKey === input.idempotencyKey,
        );
        if (byKey) return { ticket: byKey, created: false };
      }
      const open = [...this.ticketsById.values()].find(
        (t) => t.playerId === input.playerId && ACTIVE_TICKET_STATES.includes(t.state),
      );
      if (open) {
        if (
          open.mode === intent.mode &&
          open.planetId === intent.planetId &&
          open.planetType === intent.planetType &&
          sameSectorIntent(open.sectorIntent, intent.sectorIntent)
        ) {
          return { ticket: open, created: false };
        }
        throw new LobbyPersistenceConflictError(
          'ticket_open',
          `player "${input.playerId}" already has an open ticket "${open.id}" with a different intent`,
          { ticketId: open.id },
        );
      }
      const colonyId = input.colonyId ?? newId('co');
      if ([...this.ticketsById.values()].some((t) => t.colonyId === colonyId)) {
        throw new LobbyPersistenceConflictError('ticket_open', `colonyId "${colonyId}" is already bound to a ticket`);
      }
      const nowIso = (input.now ?? new Date()).toISOString();
      const transferCarry = extractTransferCarryFromInput(input.request, intent, input.transferCarry);
      const ticket: MatchTicketRecord = {
        id: input.id ?? newId('mt'),
        playerId: input.playerId,
        partyId: intent.partyId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        mode: intent.mode,
        planetId: intent.planetId,
        planetType: intent.planetType,
        sectorIntent: withSectorIntentModeAlias(intent.sectorIntent),
        state: 'QUEUED',
        priority: input.priority ?? (intent.mode === 'TRANSFER' ? 10 : 0),
        position: 0,
        etaS: null,
        colonyId,
        reservedPlanetId: null,
        reservedSectorId: null,
        reservedLandingSlotId: null,
        reservationEpoch: null,
        reservationExpiresAt: null,
        alternativeSectors: [],
        attempts: 0,
        failureCode: null,
        ...(transferCarry
          ? {
              sourcePlanetId: transferCarry.sourcePlanetId,
              sourceColonyId: transferCarry.sourceColonyId,
              ...(transferCarry.carryOver ? { carryOver: { ...transferCarry.carryOver } } : {}),
              transferCarry,
            }
          : {}),
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      this.ticketsById.set(ticket.id, ticket);
      return { ticket, created: true };
    });
  }

  async getTicketById(ticketId: string): Promise<MatchTicketRecord | null> {
    return this.ticketsById.get(ticketId) ?? null;
  }

  async findActiveTicketByPlayer(playerId: string): Promise<MatchTicketRecord | null> {
    return (
      [...this.ticketsById.values()].find(
        (t) => t.playerId === playerId && ACTIVE_TICKET_STATES.includes(t.state),
      ) ?? null
    );
  }

  async listTickets(filter?: {
    readonly planetId?: string;
    readonly state?: MatchTicketRecord['state'];
  }): Promise<MatchTicketRecord[]> {
    return [...this.ticketsById.values()]
      .filter(
        (t) =>
          (filter?.planetId === undefined || t.planetId === filter.planetId) &&
          (filter?.state === undefined || t.state === filter.state),
      )
      .sort(
        (a, b) =>
          b.priority - a.priority ||
          a.createdAt.localeCompare(b.createdAt) ||
          a.id.localeCompare(b.id),
      );
  }

  async updateTicketState(input: UpdateTicketStateInput): Promise<MatchTicketRecord> {
    return this.updateTicket({
      ticketId: input.ticketId,
      state: input.state,
      ...(input.failureCode !== undefined ? { failureCode: input.failureCode } : {}),
      ...(input.attempts !== undefined ? { attempts: input.attempts } : {}),
      ...(input.now !== undefined ? { now: input.now } : {}),
    });
  }

  async updateTicket(input: UpdateTicketInput): Promise<MatchTicketRecord> {
    const ticket = this.ticketsById.get(input.ticketId);
    if (!ticket) {
      throw new LobbyPersistenceConflictError('ticket_open', `ticket "${input.ticketId}" not found`);
    }
    const nextState = input.state ?? ticket.state;
    const nextSectorIntent =
      input.sectorIntent !== undefined
        ? normalizeSectorIntentInput(input.sectorIntent)
        : withSectorIntentModeAlias(ticket.sectorIntent);
    const nextTransferCarry =
      input.transferCarry !== undefined ? input.transferCarry : ticket.transferCarry;
    const updated: MatchTicketRecord = {
      ...ticket,
      state: nextState,
      planetId: input.planetId ?? ticket.planetId,
      planetType: input.planetType ?? ticket.planetType,
      sectorIntent: nextSectorIntent,
      priority: input.priority ?? ticket.priority,
      position:
        input.position !== undefined
          ? input.position
          : nextState === 'QUEUED'
            ? (ticket.position ?? 0)
            : null,
      etaS: input.etaS !== undefined ? input.etaS : nextState === 'QUEUED' ? ticket.etaS : null,
      alternativeSectors:
        input.alternativeSectors !== undefined
          ? [...input.alternativeSectors]
          : (ticket.alternativeSectors ?? []),
      reservedPlanetId:
        input.reservedPlanetId !== undefined ? input.reservedPlanetId : ticket.reservedPlanetId,
      reservedSectorId:
        input.reservedSectorId !== undefined ? input.reservedSectorId : ticket.reservedSectorId,
      reservedLandingSlotId:
        input.reservedLandingSlotId !== undefined
          ? input.reservedLandingSlotId
          : ticket.reservedLandingSlotId,
      reservationEpoch:
        input.reservationEpoch !== undefined ? input.reservationEpoch : ticket.reservationEpoch,
      reservationExpiresAt:
        input.reservationExpiresAt !== undefined
          ? input.reservationExpiresAt
          : ticket.reservationExpiresAt,
      failureCode: input.failureCode === undefined ? ticket.failureCode : input.failureCode,
      attempts: input.attempts ?? ticket.attempts,
      ...(nextTransferCarry !== undefined
        ? {
            transferCarry: nextTransferCarry,
            sourcePlanetId: nextTransferCarry?.sourcePlanetId ?? ticket.sourcePlanetId ?? null,
            sourceColonyId: nextTransferCarry?.sourceColonyId ?? ticket.sourceColonyId ?? null,
            carryOver: nextTransferCarry?.carryOver ?? ticket.carryOver ?? null,
          }
        : {}),
      updatedAt: (input.now ?? new Date()).toISOString(),
    };
    this.ticketsById.set(updated.id, updated);
    return updated;
  }

  async cancelTicket(ticketId: string, playerId: string, now: Date = new Date()): Promise<MatchTicketRecord> {
    return this.mutex.run(`ticket:${playerId}`, async () => {
      const ticket = this.ticketsById.get(ticketId);
      if (!ticket || ticket.playerId !== playerId) {
        throw new LobbyPersistenceConflictError('ticket_open', `ticket "${ticketId}" not found for player "${playerId}"`);
      }
      if (ticket.state === 'CANCELLED') return ticket;
      if (ticket.state !== 'QUEUED' && ticket.state !== 'RESERVED') {
        throw new LobbyPersistenceConflictError('ticket_open', `cannot cancel ticket in state ${ticket.state}`);
      }
      const res = await this.findReservationByTicketId(ticketId);
      if (res && res.state === 'HELD') {
        await this.releaseReservation(res.reservationId);
      }
      const updated: MatchTicketRecord = {
        ...ticket,
        state: 'CANCELLED',
        position: null,
        etaS: null,
        reservedPlanetId: null,
        reservedSectorId: null,
        reservedLandingSlotId: null,
        reservationEpoch: null,
        reservationExpiresAt: null,
        updatedAt: now.toISOString(),
      };
      this.ticketsById.set(updated.id, updated);
      return updated;
    });
  }

  async createParty(input: CreatePartyInput): Promise<PartyV1> {
    return this.mutex.run('party:create', async () => {
      const nowIso = (input.now ?? new Date()).toISOString();
      const id = input.id ?? newId('pt');
      let code = input.code ?? generatePartyCode();
      while (!input.code && this.partyIdByCode.has(code)) code = generatePartyCode();
      if (this.partiesById.has(id) || this.partyIdByCode.has(code)) {
        throw new LobbyPersistenceConflictError('party_not_open', `party id "${id}" or code "${code}" already exists`);
      }
      const party: PartyV1 = {
        id,
        code,
        leaderId: input.leaderId,
        planetId: input.planetId ?? null,
        sectorIntent: input.sectorIntent ?? null,
        state: 'OPEN',
        members: [
          {
            playerId: input.leaderId,
            handle: input.leaderHandle,
            joinedAt: nowIso,
            spawnStatus: 'PENDING',
          },
        ],
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      this.partiesById.set(id, party);
      this.partyIdByCode.set(code, id);
      return party;
    });
  }

  async getPartyById(partyId: string): Promise<PartyV1 | null> {
    return this.partiesById.get(partyId) ?? null;
  }

  async getPartyByCode(code: string): Promise<PartyV1 | null> {
    const id = this.partyIdByCode.get(code);
    return id ? (this.partiesById.get(id) ?? null) : null;
  }

  async joinParty(input: JoinPartyInput): Promise<PartyV1> {
    const partyId = this.partyIdByCode.get(input.partyIdOrCode) ?? input.partyIdOrCode;
    return this.mutex.run(`party:${partyId}`, async () => {
      const party = this.partiesById.get(partyId);
      if (!party) {
        throw new LobbyPersistenceConflictError('party_not_found', `party "${input.partyIdOrCode}" not found`);
      }
      if (party.members.some((m) => m.playerId === input.playerId)) return party;
      if (party.state !== 'OPEN') {
        throw new LobbyPersistenceConflictError('party_not_open', `party "${party.id}" is ${party.state}`);
      }
      if (party.members.length >= PARTY_MAX_MEMBERS) {
        throw new LobbyPersistenceConflictError(
          'party_full',
          `party "${party.id}" is full (${PARTY_MAX_MEMBERS}/${PARTY_MAX_MEMBERS} members)`,
          { partyId: party.id, maxMembers: PARTY_MAX_MEMBERS },
        );
      }
      const nowIso = (input.now ?? new Date()).toISOString();
      const updated: PartyV1 = {
        ...party,
        members: [
          ...party.members,
          { playerId: input.playerId, handle: input.handle, joinedAt: nowIso, spawnStatus: 'PENDING' },
        ],
        updatedAt: nowIso,
      };
      this.partiesById.set(party.id, updated);
      return updated;
    });
  }

  async leaveParty(input: LeavePartyInput): Promise<PartyV1> {
    return this.mutex.run(`party:${input.partyId}`, async () => {
      const party = this.partiesById.get(input.partyId);
      if (!party) {
        throw new LobbyPersistenceConflictError('party_not_found', `party "${input.partyId}" not found`);
      }
      const remaining = party.members.filter((m) => m.playerId !== input.playerId);
      if (remaining.length === party.members.length) return party;
      const nowIso = (input.now ?? new Date()).toISOString();
      if (remaining.length === 0) {
        const cancelled: PartyV1 = { ...party, state: 'CANCELLED', updatedAt: nowIso };
        this.partiesById.set(party.id, cancelled);
        return cancelled;
      }
      const nextLeaderId = party.leaderId === input.playerId ? remaining[0]!.playerId : party.leaderId;
      const updated: PartyV1 = { ...party, leaderId: nextLeaderId, members: remaining, updatedAt: nowIso };
      this.partiesById.set(party.id, updated);
      return updated;
    });
  }

  async setPartyIntent(input: SetPartyIntentInput): Promise<PartyV1> {
    return this.mutex.run(`party:${input.partyId}`, async () => {
      const party = this.partiesById.get(input.partyId);
      if (!party) {
        throw new LobbyPersistenceConflictError('party_not_found', `party "${input.partyId}" not found`);
      }
      if (party.leaderId !== input.actorPlayerId) {
        throw new LobbyPersistenceConflictError('party_not_open', 'only the party leader can update party intent');
      }
      const updated: PartyV1 = {
        ...party,
        planetId: input.planetId,
        sectorIntent: input.sectorIntent,
        state: input.state ?? party.state,
        updatedAt: (input.now ?? new Date()).toISOString(),
      };
      this.partiesById.set(party.id, updated);
      return updated;
    });
  }
}
