import {
  AtlasManifestV1Schema,
  type AtlasManifestV1,
  type LandingSlotId,
  type PartyV1,
  type PlanetType,
  type SectorId,
} from '@terra/contracts';
import { assertAtlasVersionImmutable } from './atlas-manifest.helper';
import {
  LobbyPersistenceConflictError,
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
  type UpdateTicketInput,
  type UpdateTicketStateInput,
  type UpsertSectorWithSlotsInput,
} from './lobby-persistence.types';
import {
  assertCanonicalWorldCompatible,
  computeFreeSectorSeats,
  KeyedMutex,
  normalizeCanonicalWorldInput,
  normalizeSectorSlotsInput,
  seedManifestSectorsWithUpsert,
} from './lobby-store.helpers';
import { validateCanonicalWorldStateUpdate } from './lifecycle-policy.helpers';
import { MemoryReservationOps } from './memory-reservation.ops';
import { MemoryTicketPartyOps } from './memory-ticket-party.ops';

export class MemoryLobbyStore implements LobbyPersistenceStore {
  private readonly mutex = new KeyedMutex();
  private readonly worldsById = new Map<string, CanonicalWorldRecord>();
  private readonly worldIdByType = new Map<PlanetType, string>();
  private readonly atlasVersions = new Map<string, PinnedAtlasVersionRecord>();
  private readonly sectors = new Map<string, PlanetSectorRecord>();
  private readonly landingSlots = new Map<string, SectorLandingSlotRecord>();
  private readonly reservationsById = new Map<string, SectorReservationRecord>();
  private readonly ticketsById = new Map<string, MatchTicketRecord>();
  private readonly partiesById = new Map<string, PartyV1>();
  private readonly partyIdByCode = new Map<string, string>();
  private readonly reservationOps: MemoryReservationOps;
  private readonly ticketPartyOps: MemoryTicketPartyOps;

  constructor() {
    this.reservationOps = new MemoryReservationOps(
      this.mutex,
      this.worldsById,
      this.sectors,
      this.landingSlots,
      this.reservationsById,
      this.ticketsById,
    );
    this.ticketPartyOps = new MemoryTicketPartyOps(
      this.mutex,
      this.ticketsById,
      this.partiesById,
      this.partyIdByCode,
      (ticketId) => this.reservationOps.getReservationByTicketId(ticketId),
      (reservationId) => this.reservationOps.releaseReservation(reservationId, 'RELEASED'),
    );
  }

  async provisionCanonicalWorld(input: ProvisionCanonicalWorldInput): Promise<ProvisionCanonicalWorldResult> {
    const spec = normalizeCanonicalWorldInput(input);
    return this.mutex.run(`world:${spec.canonicalType}`, async () => {
      const existingId = this.worldIdByType.get(spec.canonicalType);
      const existingById = this.worldsById.get(spec.id);
      const existing = (existingId ? this.worldsById.get(existingId) : undefined) ?? existingById;
      if (existing) {
        assertCanonicalWorldCompatible(existing, spec);
        const pinned = input.manifest ? (await this.pinAtlasVersionInternal(input.manifest)).record : undefined;
        return {
          world: this.worldsById.get(existing.id)!,
          created: false,
          ...(pinned ? { pinnedAtlas: pinned } : {}),
        };
      }
      const now = new Date();
      const world: CanonicalWorldRecord = {
        ...spec,
        seatsTaken: 0,
        faultCode: null,
        retryCount: 0,
        placementAttempts: 0,
        createdAt: now,
        updatedAt: now,
      };
      this.worldsById.set(world.id, world);
      this.worldIdByType.set(world.canonicalType, world.id);
      const pinned = input.manifest ? (await this.pinAtlasVersionInternal(input.manifest)).record : undefined;
      return {
        world: this.worldsById.get(world.id)!,
        created: true,
        ...(pinned ? { pinnedAtlas: pinned } : {}),
      };
    });
  }

  async getCanonicalWorldByType(type: PlanetType): Promise<CanonicalWorldRecord | null> {
    const id = this.worldIdByType.get(type);
    return id ? (this.worldsById.get(id) ?? null) : null;
  }

  async getCanonicalWorldById(planetId: string): Promise<CanonicalWorldRecord | null> {
    return this.worldsById.get(planetId) ?? null;
  }

  async listCanonicalWorlds(): Promise<CanonicalWorldRecord[]> {
    const order: readonly PlanetType[] = ['desert', 'ocean', 'temperate'];
    return [...this.worldsById.values()].sort(
      (a, b) => order.indexOf(a.canonicalType) - order.indexOf(b.canonicalType),
    );
  }

  async updateCanonicalWorldState(input: UpdateCanonicalWorldStateInput): Promise<CanonicalWorldRecord> {
    return this.mutex.run(`planet:${input.planetId}`, async () => {
      const existing = this.worldsById.get(input.planetId);
      if (!existing) {
        throw new LobbyPersistenceConflictError('planet_not_found', `planet "${input.planetId}" not found`, {
          planetId: input.planetId,
        });
      }
      validateCanonicalWorldStateUpdate(existing, input);
      const baseNow = input.now ?? new Date();
      const nextUpdatedAt = new Date(Math.max(baseNow.getTime(), existing.updatedAt.getTime() + 1));
      const next: CanonicalWorldRecord = {
        ...existing,
        lifecycle: input.lifecycle ?? existing.lifecycle,
        health: input.health ?? existing.health,
        admission: input.admission ?? existing.admission,
        faultCode: input.faultCode === undefined ? existing.faultCode : input.faultCode,
        retryCount: input.retryCount === undefined ? (existing.retryCount ?? 0) : input.retryCount,
        placementAttempts:
          input.placementAttempts === undefined ? (existing.placementAttempts ?? 0) : input.placementAttempts,
        updatedAt: nextUpdatedAt,
      };
      input.onTransition?.(existing, next);
      this.worldsById.set(next.id, next);
      return next;
    });
  }

  async pinAtlasVersion(manifest: AtlasManifestV1): Promise<PinAtlasVersionResult> {
    return this.mutex.run(`atlas:${manifest.planetId}`, () => this.pinAtlasVersionInternal(manifest));
  }

  private async pinAtlasVersionInternal(rawManifest: AtlasManifestV1): Promise<PinAtlasVersionResult> {
    const manifest = AtlasManifestV1Schema.parse(rawManifest);
    const key = `${manifest.planetId}:${manifest.atlasVersion}`;
    const existing = this.atlasVersions.get(key);
    if (existing) {
      assertAtlasVersionImmutable(existing, manifest);
      await this.seedManifestSectorsInternal(manifest);
      return { record: existing, created: false };
    }
    const record: PinnedAtlasVersionRecord = {
      id: `av_${manifest.planetId}_v${manifest.atlasVersion}`,
      planetId: manifest.planetId,
      atlasVersion: manifest.atlasVersion,
      topologyVersion: manifest.topologyVersion,
      genVersion: manifest.genVersion,
      configVersion: manifest.configVersion,
      configHash: manifest.configHash,
      atlasHash: manifest.atlasHash,
      resourceProfileId: manifest.resourceProfileId,
      resourceProfileHash: manifest.resourceProfileHash,
      manifest: structuredClone(manifest),
      createdAt: new Date(),
    };
    this.atlasVersions.set(key, record);
    const world = this.worldsById.get(manifest.planetId);
    if (world) {
      this.worldsById.set(world.id, {
        ...world,
        atlasVersion: manifest.atlasVersion,
        atlasHash: manifest.atlasHash,
        configHash: manifest.configHash,
        capacity: manifest.validatedCapacity,
        updatedAt: new Date(),
      });
    }
    await this.seedManifestSectorsInternal(manifest);
    return { record, created: true };
  }

  private async seedManifestSectorsInternal(manifest: AtlasManifestV1): Promise<void> {
    await seedManifestSectorsWithUpsert(manifest, (s) => this.upsertSectorWithSlotsInternal(s));
  }

  async getAtlasVersion(planetId: string, atlasVersion: number): Promise<PinnedAtlasVersionRecord | null> {
    return this.atlasVersions.get(`${planetId}:${atlasVersion}`) ?? null;
  }

  async listAtlasVersions(planetId: string): Promise<PinnedAtlasVersionRecord[]> {
    return [...this.atlasVersions.values()]
      .filter((v) => v.planetId === planetId)
      .sort((a, b) => a.atlasVersion - b.atlasVersion);
  }

  async upsertSectorWithSlots(
    input: UpsertSectorWithSlotsInput,
  ): Promise<{ readonly sector: PlanetSectorRecord; readonly slots: SectorLandingSlotRecord[] }> {
    return this.mutex.run(`planet:${input.planetId}`, () => this.upsertSectorWithSlotsInternal(input));
  }

  private async upsertSectorWithSlotsInternal(
    input: UpsertSectorWithSlotsInput,
  ): Promise<{ readonly sector: PlanetSectorRecord; readonly slots: SectorLandingSlotRecord[] }> {
    const norm = normalizeSectorSlotsInput(input);
    const secKey = `${norm.planetId}:${norm.sectorId}`;
    const prevSec = this.sectors.get(secKey);
    const now = new Date();
    const reservedSeats =
      input.reservedSeats !== undefined ? Math.max(0, input.reservedSeats) : (prevSec?.reservedSeats ?? 0);
    const foundedSeats =
      input.foundedSeats !== undefined ? Math.max(0, input.foundedSeats) : (prevSec?.foundedSeats ?? 0);
    const sectorUnchanged =
      prevSec !== undefined &&
      prevSec.kind === norm.kind &&
      prevSec.foundingCapacity === norm.foundingCapacity &&
      prevSec.validatedCapacity === norm.validatedCapacity &&
      prevSec.reservedSeats === reservedSeats &&
      prevSec.foundedSeats === foundedSeats;
    const sector: PlanetSectorRecord = {
      id: prevSec?.id ?? `psec_${norm.planetId}_${norm.sectorId}`,
      planetId: norm.planetId,
      sectorId: norm.sectorId,
      continentId: norm.continentId,
      macroQ: norm.macroQ,
      macroR: norm.macroR,
      centerQ: norm.centerQ,
      centerR: norm.centerR,
      kind: norm.kind,
      radius: norm.radius,
      foundingCapacity: norm.foundingCapacity,
      validatedCapacity: norm.validatedCapacity,
      reservedSeats,
      foundedSeats,
      freeSeats: computeFreeSectorSeats(
        norm.kind,
        norm.foundingCapacity,
        norm.validatedCapacity,
        reservedSeats,
        foundedSeats,
      ),
      ...(norm.mainResource ? { mainResource: norm.mainResource } : {}),
      ...(norm.scarceResources ? { scarceResources: [...norm.scarceResources] } : {}),
      createdAt: prevSec?.createdAt ?? now,
      updatedAt: sectorUnchanged ? prevSec.updatedAt : now,
    };
    this.sectors.set(secKey, sector);

    const outSlots: SectorLandingSlotRecord[] = [];
    for (const s of norm.slots) {
      const slotKey = `${norm.planetId}:${s.landingSlotId}`;
      const prevSlot = this.landingSlots.get(slotKey);
      const nextQ = input.slots !== undefined ? s.q : (prevSlot?.q ?? s.q);
      const nextR = input.slots !== undefined ? s.r : (prevSlot?.r ?? s.r);
      const slotRec: SectorLandingSlotRecord = prevSlot
        ? {
            ...prevSlot,
            q: nextQ,
            r: nextR,
            updatedAt: prevSlot.q === nextQ && prevSlot.r === nextR ? prevSlot.updatedAt : now,
          }
        : {
            id: `pslot_${norm.planetId}_${s.landingSlotId}`,
            planetId: norm.planetId,
            sectorId: norm.sectorId,
            landingSlotId: s.landingSlotId,
            slotIndex: s.slotIndex,
            q: nextQ,
            r: nextR,
            state: 'FREE',
            reservationId: null,
            colonyId: null,
            epoch: 0,
            expiresAt: null,
            createdAt: now,
            updatedAt: now,
          };
      this.landingSlots.set(slotKey, slotRec);
      outSlots.push(slotRec);
    }
    return { sector, slots: outSlots };
  }

  async getSector(planetId: string, sectorId: SectorId): Promise<PlanetSectorRecord | null> {
    return this.sectors.get(`${planetId}:${sectorId}`) ?? null;
  }

  async listSectors(planetId: string): Promise<PlanetSectorRecord[]> {
    return [...this.sectors.values()]
      .filter((s) => s.planetId === planetId)
      .sort((a, b) => a.sectorId.localeCompare(b.sectorId));
  }

  async getLandingSlot(planetId: string, landingSlotId: LandingSlotId): Promise<SectorLandingSlotRecord | null> {
    return this.landingSlots.get(`${planetId}:${landingSlotId}`) ?? null;
  }

  async listLandingSlots(planetId: string, sectorId?: SectorId): Promise<SectorLandingSlotRecord[]> {
    return [...this.landingSlots.values()]
      .filter((s) => s.planetId === planetId && (sectorId === undefined || s.sectorId === sectorId))
      .sort((a, b) => a.sectorId.localeCompare(b.sectorId) || a.slotIndex - b.slotIndex);
  }

  reserveSectorSlot(input: ReserveSectorSlotInput): Promise<ReserveSectorSlotOutcome> {
    return this.reservationOps.reserveSectorSlot(input);
  }
  commitReservation(reservationId: string, expectedEpoch?: number): Promise<SectorReservationRecord> {
    return this.reservationOps.commitReservation(reservationId, expectedEpoch);
  }
  releaseReservation(
    reservationId: string,
    reason?: 'RELEASED' | 'EXPIRED',
    expectedEpoch?: number,
  ): Promise<{ readonly released: boolean; readonly reservation: SectorReservationRecord }> {
    return this.reservationOps.releaseReservation(reservationId, reason, expectedEpoch);
  }
  expireReservations(now?: Date): Promise<SectorReservationRecord[]> {
    return this.reservationOps.expireReservations(now);
  }
  getReservationById(reservationId: string): Promise<SectorReservationRecord | null> {
    return this.reservationOps.getReservationById(reservationId);
  }
  getReservationByTicketId(ticketId: string): Promise<SectorReservationRecord | null> {
    return this.reservationOps.getReservationByTicketId(ticketId);
  }
  listReservations(planetId: string, sectorId?: SectorId): Promise<SectorReservationRecord[]> {
    return this.reservationOps.listReservations(planetId, sectorId);
  }
  enqueueTicket(input: EnqueueTicketInput): Promise<EnqueueTicketResult> {
    return this.ticketPartyOps.enqueueTicket(input);
  }
  getTicketById(ticketId: string): Promise<MatchTicketRecord | null> {
    return this.ticketPartyOps.getTicketById(ticketId);
  }
  findActiveTicketByPlayer(playerId: string): Promise<MatchTicketRecord | null> {
    return this.ticketPartyOps.findActiveTicketByPlayer(playerId);
  }
  listTickets(filter?: {
    readonly planetId?: string;
    readonly state?: MatchTicketRecord['state'];
  }): Promise<MatchTicketRecord[]> {
    return this.ticketPartyOps.listTickets(filter);
  }
  updateTicketState(input: UpdateTicketStateInput): Promise<MatchTicketRecord> {
    return this.ticketPartyOps.updateTicketState(input);
  }
  updateTicket(input: UpdateTicketInput): Promise<MatchTicketRecord> {
    return this.ticketPartyOps.updateTicket(input);
  }
  cancelTicket(ticketId: string, playerId: string, now?: Date): Promise<MatchTicketRecord> {
    return this.ticketPartyOps.cancelTicket(ticketId, playerId, now);
  }
  createParty(input: CreatePartyInput): Promise<PartyV1> {
    return this.ticketPartyOps.createParty(input);
  }
  getPartyById(partyId: string): Promise<PartyV1 | null> {
    return this.ticketPartyOps.getPartyById(partyId);
  }
  getPartyByCode(code: string): Promise<PartyV1 | null> {
    return this.ticketPartyOps.getPartyByCode(code);
  }
  joinParty(input: JoinPartyInput): Promise<PartyV1> {
    return this.ticketPartyOps.joinParty(input);
  }
  leaveParty(input: LeavePartyInput): Promise<PartyV1> {
    return this.ticketPartyOps.leaveParty(input);
  }
  setPartyIntent(input: SetPartyIntentInput): Promise<PartyV1> {
    return this.ticketPartyOps.setPartyIntent(input);
  }
}
