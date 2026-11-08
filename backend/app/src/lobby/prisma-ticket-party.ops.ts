import { newId, PARTY_MAX_MEMBERS, type PartyV1 } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
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
  type UpdateTicketStateInput,
} from './lobby-persistence.types';
import {
  ACTIVE_TICKET_STATES,
  generatePartyCode,
  type KeyedMutex,
  normalizeTicketIntentOrThrow,
  sameSectorIntent,
} from './lobby-store.helpers';
import { mapPartyRow, mapTicketRow } from './prisma-lobby-mappers';

export class PrismaTicketPartyOps {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly mutex: KeyedMutex,
    private readonly findReservationByTicketId: (ticketId: string) => Promise<SectorReservationRecord | null>,
    private readonly releaseReservation: (reservationId: string) => Promise<unknown>,
  ) {}

  async enqueueTicket(input: EnqueueTicketInput): Promise<EnqueueTicketResult> {
    const intent = normalizeTicketIntentOrThrow(input.request);
    return this.mutex.run(`ticket:${input.playerId}`, async () => {
      if (input.idempotencyKey) {
        const byKey = await this.prisma.matchTicket.findUnique({
          where: { playerId_idempotencyKey: { playerId: input.playerId, idempotencyKey: input.idempotencyKey } },
        });
        if (byKey) return { ticket: mapTicketRow(byKey), created: false };
      }
      const openRow = await this.prisma.matchTicket.findFirst({
        where: { playerId: input.playerId, state: { in: [...ACTIVE_TICKET_STATES] } },
      });
      if (openRow) {
        const open = mapTicketRow(openRow);
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
      const created = await this.prisma.matchTicket.create({
        data: {
          id: input.id ?? newId('mt'),
          playerId: input.playerId,
          partyId: intent.partyId ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
          mode: intent.mode,
          planetId: intent.planetId,
          planetType: intent.planetType,
          sectorIntentKind: intent.sectorIntent.kind,
          requestedSectorId: intent.sectorIntent.kind === 'chosen' ? intent.sectorIntent.sectorId : null,
          state: 'QUEUED',
          priority: input.priority ?? (intent.mode === 'TRANSFER' ? 10 : 0),
          colonyId: input.colonyId ?? newId('co'),
        },
      });
      return { ticket: mapTicketRow(created), created: true };
    });
  }

  async getTicketById(ticketId: string): Promise<MatchTicketRecord | null> {
    const row = await this.prisma.matchTicket.findUnique({ where: { id: ticketId } });
    return row ? mapTicketRow(row) : null;
  }

  async findActiveTicketByPlayer(playerId: string): Promise<MatchTicketRecord | null> {
    const row = await this.prisma.matchTicket.findFirst({
      where: { playerId, state: { in: [...ACTIVE_TICKET_STATES] } },
    });
    return row ? mapTicketRow(row) : null;
  }

  async updateTicketState(input: UpdateTicketStateInput): Promise<MatchTicketRecord> {
    const updated = await this.prisma.matchTicket.update({
      where: { id: input.ticketId },
      data: {
        state: input.state,
        ...(input.failureCode !== undefined ? { failureCode: input.failureCode } : {}),
        ...(input.attempts !== undefined ? { attempts: input.attempts } : {}),
      },
    });
    return mapTicketRow(updated);
  }

  async cancelTicket(ticketId: string, playerId: string): Promise<MatchTicketRecord> {
    const row = await this.prisma.matchTicket.findUnique({ where: { id: ticketId } });
    if (!row || row.playerId !== playerId) {
      throw new LobbyPersistenceConflictError('ticket_open', `ticket "${ticketId}" not found for player "${playerId}"`);
    }
    if (row.state === 'CANCELLED') return mapTicketRow(row);
    if (row.state !== 'QUEUED' && row.state !== 'RESERVED') {
      throw new LobbyPersistenceConflictError('ticket_open', `cannot cancel ticket in state ${row.state}`);
    }
    const res = await this.findReservationByTicketId(ticketId);
    if (res && res.state === 'HELD') {
      await this.releaseReservation(res.reservationId);
    }
    const updated = await this.prisma.matchTicket.update({
      where: { id: ticketId },
      data: {
        state: 'CANCELLED',
        reservedPlanetId: null,
        reservedSectorId: null,
        reservedLandingSlotId: null,
        reservationExpiresAt: null,
      },
    });
    return mapTicketRow(updated);
  }

  async createParty(input: CreatePartyInput): Promise<PartyV1> {
    return this.mutex.run('party:create', async () => {
      const id = input.id ?? newId('pt');
      const code = input.code ?? generatePartyCode();
      const row = await this.prisma.party.create({
        data: {
          id,
          code,
          leaderId: input.leaderId,
          planetId: input.planetId ?? null,
          sectorIntentKind: input.sectorIntent?.kind ?? null,
          requestedSectorId: input.sectorIntent?.kind === 'chosen' ? input.sectorIntent.sectorId : null,
          state: 'OPEN',
          members: {
            create: {
              playerId: input.leaderId,
              handle: input.leaderHandle,
              spawnStatus: 'PENDING',
            },
          },
        },
        include: { members: true },
      });
      return mapPartyRow(row);
    });
  }

  async getPartyById(partyId: string): Promise<PartyV1 | null> {
    const row = await this.prisma.party.findUnique({ where: { id: partyId }, include: { members: true } });
    return row ? mapPartyRow(row) : null;
  }

  async getPartyByCode(code: string): Promise<PartyV1 | null> {
    const row = await this.prisma.party.findUnique({ where: { code }, include: { members: true } });
    return row ? mapPartyRow(row) : null;
  }

  async joinParty(input: JoinPartyInput): Promise<PartyV1> {
    const found = await this.prisma.party.findFirst({
      where: { OR: [{ id: input.partyIdOrCode }, { code: input.partyIdOrCode }] },
      select: { id: true },
    });
    if (!found) {
      throw new LobbyPersistenceConflictError('party_not_found', `party "${input.partyIdOrCode}" not found`);
    }
    return this.mutex.run(`party:${found.id}`, async () => {
      const party = await this.prisma.party.findUniqueOrThrow({
        where: { id: found.id },
        include: { members: true },
      });
      if (party.members.some((m) => m.playerId === input.playerId)) return mapPartyRow(party);
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
      await this.prisma.partyMember.create({
        data: {
          partyId: party.id,
          playerId: input.playerId,
          handle: input.handle,
          spawnStatus: 'PENDING',
        },
      });
      const updated = await this.prisma.party.findUniqueOrThrow({
        where: { id: party.id },
        include: { members: true },
      });
      return mapPartyRow(updated);
    });
  }

  async leaveParty(input: LeavePartyInput): Promise<PartyV1> {
    return this.mutex.run(`party:${input.partyId}`, async () => {
      const party = await this.prisma.party.findUnique({
        where: { id: input.partyId },
        include: { members: true },
      });
      if (!party) {
        throw new LobbyPersistenceConflictError('party_not_found', `party "${input.partyId}" not found`);
      }
      if (!party.members.some((m) => m.playerId === input.playerId)) return mapPartyRow(party);
      const remaining = party.members
        .filter((m) => m.playerId !== input.playerId)
        .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime() || a.playerId.localeCompare(b.playerId));
      if (remaining.length === 0) {
        const cancelled = await this.prisma.party.update({
          where: { id: party.id },
          data: { state: 'CANCELLED' },
          include: { members: true },
        });
        return mapPartyRow(cancelled);
      }
      await this.prisma.partyMember.delete({
        where: { partyId_playerId: { partyId: party.id, playerId: input.playerId } },
      });
      const nextLeaderId = party.leaderId === input.playerId ? remaining[0]!.playerId : party.leaderId;
      const updated = await this.prisma.party.update({
        where: { id: party.id },
        data: { leaderId: nextLeaderId },
        include: { members: true },
      });
      return mapPartyRow(updated);
    });
  }

  async setPartyIntent(input: SetPartyIntentInput): Promise<PartyV1> {
    return this.mutex.run(`party:${input.partyId}`, async () => {
      const party = await this.prisma.party.findUnique({ where: { id: input.partyId } });
      if (!party) {
        throw new LobbyPersistenceConflictError('party_not_found', `party "${input.partyId}" not found`);
      }
      if (party.leaderId !== input.actorPlayerId) {
        throw new LobbyPersistenceConflictError('party_not_open', 'only the party leader can update party intent');
      }
      const updated = await this.prisma.party.update({
        where: { id: input.partyId },
        data: {
          planetId: input.planetId,
          sectorIntentKind: input.sectorIntent?.kind ?? null,
          requestedSectorId: input.sectorIntent?.kind === 'chosen' ? input.sectorIntent.sectorId : null,
          ...(input.state ? { state: input.state } : {}),
        },
        include: { members: true },
      });
      return mapPartyRow(updated);
    });
  }
}
