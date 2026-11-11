import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
  AtlasManifestV1,
  LandingSlotId,
  PartyV1,
  PlanetType,
  SectorId,
} from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { databaseEnabled } from '../core/persistence';
import { APP_ENV, type AppEnv } from '../core/tokens';
import { PRISMA } from '../db/db.module';
import {
  buildDefaultCanonicalAtlasManifest,
  type BuildCanonicalAtlasManifestOptions,
} from './atlas-manifest.helper';
import {
  type CanonicalWorldRecord,
  type CreatePartyInput,
  type EnqueueTicketInput,
  type EnqueueTicketResult,
  type JoinPartyInput,
  type LeavePartyInput,
  type LobbyPersistenceStore,
  type MatchTicketRecord,
  type PinAtlasVersionResult,
  type PinnedAtlasVersionRecord,
  type PlanetSectorRecord,
  type ProvisionCanonicalWorldInput,
  type ProvisionCanonicalWorldResult,
  type ReserveSectorSlotInput,
  type ReserveSectorSlotOutcome,
  type SectorLandingSlotRecord,
  type SectorReservationRecord,
  type SetPartyIntentInput,
  type UpdateCanonicalWorldStateInput,
  type UpdateSectorCountersInput,
  type UpdateTicketInput,
  type UpdateTicketStateInput,
  type UpsertSectorWithSlotsInput,
} from './lobby-persistence.types';
import { KeyedMutex } from './lobby-store.helpers';
import { MemoryLobbyStore } from './memory-lobby.store';
import {
  reserveSectorSlotOrThrowInStore,
  updateSectorCountersInStore,
  upsertSectorsBatchInStore,
} from './parts/lobby-persistence-parts';
import { PrismaLobbyStore } from './prisma-lobby.store';

export const LOBBY_STORE = Symbol('LOBBY_STORE');

/**
 * Persistence repository for W11 persistent worlds, immutable atlas versions,
 * sector landing slots & reservations, matchmaking tickets, and 5-member parties (W11-02).
 */
@Injectable()
export class LobbyPersistenceService implements LobbyPersistenceStore {
  private readonly store: LobbyPersistenceStore;
  private readonly playerTicketLock = new KeyedMutex();

  constructor(
    @Optional() @Inject(PRISMA) prisma?: PrismaClient,
    @Optional() @Inject(APP_ENV) env?: AppEnv,
    @Optional() @Inject(LOBBY_STORE) customStore?: LobbyPersistenceStore,
  ) {
    if (customStore) {
      this.store = customStore;
    } else if (prisma && (!env || databaseEnabled(env))) {
      this.store = new PrismaLobbyStore(prisma);
    } else {
      this.store = new MemoryLobbyStore();
    }
  }

  provisionCanonicalWorld(input: ProvisionCanonicalWorldInput): Promise<ProvisionCanonicalWorldResult> {
    return this.store.provisionCanonicalWorld(input);
  }

  upsertCanonicalWorld(input: ProvisionCanonicalWorldInput): Promise<ProvisionCanonicalWorldResult> {
    return this.store.provisionCanonicalWorld(input);
  }

  /**
   * Provisions all three canonical worlds (`desert`, `ocean`, `temperate`) with pinned W11 manifests.
   * Idempotent under concurrent calls.
   */
  async provisionAllCanonicalWorlds(
    options: BuildCanonicalAtlasManifestOptions = {},
  ): Promise<readonly ProvisionCanonicalWorldResult[]> {
    const types: readonly PlanetType[] = ['desert', 'ocean', 'temperate'];
    return Promise.all(
      types.map((type) =>
        this.store.provisionCanonicalWorld({
          type,
          manifest: buildDefaultCanonicalAtlasManifest(type, options),
        }),
      ),
    );
  }

  getCanonicalWorldByType(type: PlanetType): Promise<CanonicalWorldRecord | null> {
    return this.store.getCanonicalWorldByType(type);
  }

  getCanonicalWorldById(planetId: string): Promise<CanonicalWorldRecord | null> {
    return this.store.getCanonicalWorldById(planetId);
  }

  listCanonicalWorlds(): Promise<CanonicalWorldRecord[]> {
    return this.store.listCanonicalWorlds();
  }

  updateCanonicalWorldState(input: UpdateCanonicalWorldStateInput): Promise<CanonicalWorldRecord> {
    return this.store.updateCanonicalWorldState(input);
  }

  pinAtlasVersion(manifest: AtlasManifestV1): Promise<PinAtlasVersionResult> {
    return this.store.pinAtlasVersion(manifest);
  }

  saveAtlasManifest(manifest: AtlasManifestV1): Promise<PinAtlasVersionResult> {
    return this.store.pinAtlasVersion(manifest);
  }

  getAtlasVersion(planetId: string, atlasVersion: number): Promise<PinnedAtlasVersionRecord | null> {
    return this.store.getAtlasVersion(planetId, atlasVersion);
  }

  listAtlasVersions(planetId: string): Promise<PinnedAtlasVersionRecord[]> {
    return this.store.listAtlasVersions(planetId);
  }

  upsertSectorWithSlots(
    input: UpsertSectorWithSlotsInput,
  ): Promise<{ readonly sector: PlanetSectorRecord; readonly slots: SectorLandingSlotRecord[] }> {
    return this.store.upsertSectorWithSlots(input);
  }

  async upsertSectors(
    planetIdOrSectors: string | readonly UpsertSectorWithSlotsInput[],
    sectors?: readonly (Omit<UpsertSectorWithSlotsInput, 'planetId'> & { readonly planetId?: string })[],
  ): Promise<readonly { readonly sector: PlanetSectorRecord; readonly slots: SectorLandingSlotRecord[] }[]> {
    return upsertSectorsBatchInStore(this.store, planetIdOrSectors, sectors);
  }

  getSector(planetId: string, sectorId: SectorId): Promise<PlanetSectorRecord | null> {
    return this.store.getSector(planetId, sectorId);
  }

  async updateSectorCounters(input: UpdateSectorCountersInput): Promise<PlanetSectorRecord> {
    return updateSectorCountersInStore(this.store, input);
  }

  listSectors(planetId: string): Promise<PlanetSectorRecord[]> {
    return this.store.listSectors(planetId);
  }

  getLandingSlot(planetId: string, landingSlotId: LandingSlotId): Promise<SectorLandingSlotRecord | null> {
    return this.store.getLandingSlot(planetId, landingSlotId);
  }

  listLandingSlots(planetId: string, sectorId?: SectorId): Promise<SectorLandingSlotRecord[]> {
    return this.store.listLandingSlots(planetId, sectorId);
  }

  reserveSectorSlot(input: ReserveSectorSlotInput): Promise<ReserveSectorSlotOutcome> {
    return this.store.reserveSectorSlot(input);
  }

  async reserveSectorSlotOrThrow(input: ReserveSectorSlotInput): Promise<{
    readonly idempotent: boolean;
    readonly reservation: SectorReservationRecord;
    readonly slot: SectorLandingSlotRecord;
    readonly sector: PlanetSectorRecord;
  }> {
    return reserveSectorSlotOrThrowInStore(this.store, input);
  }

  commitReservation(reservationId: string, expectedEpoch?: number): Promise<SectorReservationRecord> {
    return this.store.commitReservation(reservationId, expectedEpoch);
  }

  releaseReservation(
    reservationId: string,
    reason?: 'RELEASED' | 'EXPIRED',
    expectedEpoch?: number,
    options?: { readonly allowCommitted?: boolean },
  ): Promise<{ readonly released: boolean; readonly reservation: SectorReservationRecord }> {
    return this.store.releaseReservation(reservationId, reason, expectedEpoch, options);
  }

  expireReservations(now?: Date): Promise<SectorReservationRecord[]> {
    return this.store.expireReservations(now);
  }

  getReservationById(reservationId: string): Promise<SectorReservationRecord | null> {
    return this.store.getReservationById(reservationId);
  }

  getReservationByTicketId(ticketId: string): Promise<SectorReservationRecord | null> {
    return this.store.getReservationByTicketId(ticketId);
  }

  listReservations(planetId: string, sectorId?: SectorId): Promise<SectorReservationRecord[]> {
    return this.store.listReservations(planetId, sectorId);
  }

  enqueueTicket(input: EnqueueTicketInput): Promise<EnqueueTicketResult> {
    return this.withPlayerTicketLock(input.playerId, () => this.store.enqueueTicket(input));
  }

  /**
   * Serializes per-player ticket operations so concurrent identical POSTs for the same player
   * never create duplicate active tickets.
   */
  withPlayerTicketLock<T>(playerId: string, fn: () => Promise<T>): Promise<T> {
    return this.playerTicketLock.run(`ticket:${playerId}`, fn);
  }

  getTicketById(ticketId: string): Promise<MatchTicketRecord | null> {
    return this.store.getTicketById(ticketId);
  }

  findActiveTicketByPlayer(playerId: string): Promise<MatchTicketRecord | null> {
    return this.store.findActiveTicketByPlayer(playerId);
  }

  listTickets(filter?: {
    readonly planetId?: string;
    readonly state?: MatchTicketRecord['state'];
  }): Promise<MatchTicketRecord[]> {
    return this.store.listTickets(filter);
  }

  updateTicketState(input: UpdateTicketStateInput): Promise<MatchTicketRecord> {
    return this.store.updateTicketState(input);
  }

  updateTicket(
    inputOrTicketId: UpdateTicketInput | string,
    patch?: Omit<UpdateTicketInput, 'ticketId'>,
  ): Promise<MatchTicketRecord> {
    const input: UpdateTicketInput =
      typeof inputOrTicketId === 'string'
        ? { ticketId: inputOrTicketId, ...(patch ?? {}) }
        : inputOrTicketId;
    return this.store.updateTicket(input);
  }

  cancelTicket(ticketId: string, playerId: string, now?: Date): Promise<MatchTicketRecord> {
    return this.store.cancelTicket(ticketId, playerId, now);
  }

  createParty(input: CreatePartyInput): Promise<PartyV1> {
    return this.store.createParty(input);
  }

  getPartyById(partyId: string): Promise<PartyV1 | null> {
    return this.store.getPartyById(partyId);
  }

  getPartyByCode(code: string): Promise<PartyV1 | null> {
    return this.store.getPartyByCode(code);
  }

  joinParty(input: JoinPartyInput): Promise<PartyV1> {
    return this.store.joinParty(input);
  }

  leaveParty(input: LeavePartyInput): Promise<PartyV1> {
    return this.store.leaveParty(input);
  }

  setPartyIntent(input: SetPartyIntentInput): Promise<PartyV1> {
    return this.store.setPartyIntent(input);
  }
}
