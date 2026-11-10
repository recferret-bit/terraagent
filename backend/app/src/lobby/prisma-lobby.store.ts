import {
  AtlasManifestV1Schema,
  type AtlasManifestV1,
  type LandingSlotId,
  type PartyV1,
  type PlanetType,
  type SectorId,
} from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
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
  KeyedMutex,
  normalizeCanonicalWorldInput,
  normalizeSectorSlotsInput,
  seedManifestSectorsWithUpsert,
} from './lobby-store.helpers';
import { validateCanonicalWorldStateUpdate } from './lifecycle-policy.helpers';
import {
  mapAtlasVersionRow,
  mapCanonicalWorldRow,
  mapLandingSlotRow,
  mapSectorRow,
} from './prisma-lobby-mappers';
import { PrismaReservationOps } from './prisma-reservation.ops';
import { PrismaTicketPartyOps } from './prisma-ticket-party.ops';

function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'P2002'
  );
}

export class PrismaLobbyStore implements LobbyPersistenceStore {
  private readonly mutex = new KeyedMutex();
  private readonly worldAttempts = new Map<string, { retryCount: number; placementAttempts: number }>();
  private readonly reservationOps: PrismaReservationOps;
  private readonly ticketPartyOps: PrismaTicketPartyOps;

  private mapWorld(row: Parameters<typeof mapCanonicalWorldRow>[0]): CanonicalWorldRecord {
    return mapCanonicalWorldRow(row, this.worldAttempts.get(row.id));
  }

  constructor(private readonly prisma: PrismaClient) {
    this.reservationOps = new PrismaReservationOps(this.prisma, this.mutex);
    this.ticketPartyOps = new PrismaTicketPartyOps(
      this.prisma,
      this.mutex,
      (ticketId) => this.reservationOps.getReservationByTicketId(ticketId),
      (reservationId) => this.reservationOps.releaseReservation(reservationId, 'RELEASED'),
    );
  }

  async provisionCanonicalWorld(input: ProvisionCanonicalWorldInput): Promise<ProvisionCanonicalWorldResult> {
    const spec = normalizeCanonicalWorldInput(input);
    return this.mutex.run(`world:${spec.canonicalType}`, async () => {
      const existing = await this.prisma.planet.findFirst({
        where: { OR: [{ canonicalType: spec.canonicalType }, { id: spec.id }] },
      });
      if (existing) {
        const mapped = this.mapWorld(existing);
        assertCanonicalWorldCompatible(mapped, spec);
        const pinned = input.manifest ? (await this.pinAtlasVersionInternal(input.manifest)).record : undefined;
        const refreshed = await this.prisma.planet.findUniqueOrThrow({ where: { id: existing.id } });
        return {
          world: this.mapWorld(refreshed),
          created: false,
          ...(pinned ? { pinnedAtlas: pinned } : {}),
        };
      }
      let created = true;
      try {
        await this.prisma.planet.create({
          data: {
            id: spec.id,
            name: spec.name,
            type: spec.type,
            canonicalType: spec.canonicalType,
            look: spec.look,
            seed: spec.seed,
            state: spec.lifecycle,
            lifecycle: spec.lifecycle,
            health: spec.health,
            admission: spec.admission,
            capacity: spec.capacity,
            seatsTaken: 0,
            atlasVersion: spec.atlasVersion,
            atlasHash: spec.atlasHash,
            configHash: spec.configHash,
          },
        });
      } catch (err) {
        if (!isUniqueConstraintError(err)) throw err;
        created = false;
        const raced = await this.prisma.planet.findFirst({
          where: { OR: [{ canonicalType: spec.canonicalType }, { id: spec.id }] },
        });
        if (!raced) throw err;
        assertCanonicalWorldCompatible(this.mapWorld(raced), spec);
      }
      const pinned = input.manifest ? (await this.pinAtlasVersionInternal(input.manifest)).record : undefined;
      const finalRow = await this.prisma.planet.findUniqueOrThrow({ where: { id: spec.id } });
      return {
        world: this.mapWorld(finalRow),
        created,
        ...(pinned ? { pinnedAtlas: pinned } : {}),
      };
    });
  }

  async getCanonicalWorldByType(type: PlanetType): Promise<CanonicalWorldRecord | null> {
    const row = await this.prisma.planet.findUnique({ where: { canonicalType: type } });
    return row ? this.mapWorld(row) : null;
  }

  async getCanonicalWorldById(planetId: string): Promise<CanonicalWorldRecord | null> {
    const row = await this.prisma.planet.findUnique({ where: { id: planetId } });
    return row && row.canonicalType ? this.mapWorld(row) : null;
  }

  async listCanonicalWorlds(): Promise<CanonicalWorldRecord[]> {
    const rows = await this.prisma.planet.findMany({ where: { canonicalType: { not: null } } });
    const order: readonly PlanetType[] = ['desert', 'ocean', 'temperate'];
    return rows
      .map((r) => this.mapWorld(r))
      .sort((a, b) => order.indexOf(a.canonicalType) - order.indexOf(b.canonicalType));
  }

  async updateCanonicalWorldState(input: UpdateCanonicalWorldStateInput): Promise<CanonicalWorldRecord> {
    return this.mutex.run(`planet:${input.planetId}`, async () => {
      const existingRow = await this.prisma.planet.findUnique({ where: { id: input.planetId } });
      if (!existingRow) {
        throw new LobbyPersistenceConflictError('planet_not_found', `planet "${input.planetId}" not found`);
      }
      const existing = this.mapWorld(existingRow);
      validateCanonicalWorldStateUpdate(existing, input);
      const baseNow = input.now ?? new Date();
      const nextUpdatedAt = new Date(Math.max(baseNow.getTime(), existing.updatedAt.getTime() + 1));
      const nextRetryCount = input.retryCount === undefined ? (existing.retryCount ?? 0) : input.retryCount;
      const nextPlacementAttempts =
        input.placementAttempts === undefined ? (existing.placementAttempts ?? 0) : input.placementAttempts;
      this.worldAttempts.set(input.planetId, {
        retryCount: nextRetryCount,
        placementAttempts: nextPlacementAttempts,
      });
      const candidate: CanonicalWorldRecord = {
        ...existing,
        lifecycle: input.lifecycle ?? existing.lifecycle,
        health: input.health ?? existing.health,
        admission: input.admission ?? existing.admission,
        faultCode: input.faultCode === undefined ? existing.faultCode : input.faultCode,
        retryCount: nextRetryCount,
        placementAttempts: nextPlacementAttempts,
        updatedAt: nextUpdatedAt,
      };
      input.onTransition?.(existing, candidate);
      const updated = await this.prisma.planet.update({
        where: { id: input.planetId },
        data: {
          ...(input.lifecycle ? { lifecycle: input.lifecycle, state: input.lifecycle } : {}),
          ...(input.health ? { health: input.health } : {}),
          ...(input.admission ? { admission: input.admission } : {}),
          ...(input.faultCode !== undefined ? { faultCode: input.faultCode } : {}),
          updatedAt: nextUpdatedAt,
        },
      });
      return this.mapWorld(updated);
    });
  }

  async pinAtlasVersion(manifest: AtlasManifestV1): Promise<PinAtlasVersionResult> {
    return this.mutex.run(`atlas:${manifest.planetId}`, () => this.pinAtlasVersionInternal(manifest));
  }

  private async pinAtlasVersionInternal(rawManifest: AtlasManifestV1): Promise<PinAtlasVersionResult> {
    const manifest = AtlasManifestV1Schema.parse(rawManifest);
    const existing = await this.prisma.planetAtlasVersion.findUnique({
      where: { planetId_atlasVersion: { planetId: manifest.planetId, atlasVersion: manifest.atlasVersion } },
    });
    if (existing) {
      const mapped = mapAtlasVersionRow(existing);
      assertAtlasVersionImmutable(mapped, manifest);
      await this.seedManifestSectorsInternal(manifest);
      return { record: mapped, created: false };
    }
    const createdRow = await this.prisma.planetAtlasVersion.create({
      data: {
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
        manifestJson: JSON.parse(JSON.stringify(manifest)) as object,
      },
    });
    await this.prisma.planet.updateMany({
      where: { id: manifest.planetId },
      data: {
        atlasVersion: manifest.atlasVersion,
        atlasHash: manifest.atlasHash,
        configHash: manifest.configHash,
        capacity: manifest.validatedCapacity,
      },
    });
    await this.seedManifestSectorsInternal(manifest);
    return { record: mapAtlasVersionRow(createdRow), created: true };
  }

  private async seedManifestSectorsInternal(manifest: AtlasManifestV1): Promise<void> {
    await seedManifestSectorsWithUpsert(manifest, (s) => this.upsertSectorWithSlotsInternal(s));
  }

  async getAtlasVersion(planetId: string, atlasVersion: number): Promise<PinnedAtlasVersionRecord | null> {
    const row = await this.prisma.planetAtlasVersion.findUnique({
      where: { planetId_atlasVersion: { planetId, atlasVersion } },
    });
    return row ? mapAtlasVersionRow(row) : null;
  }

  async listAtlasVersions(planetId: string): Promise<PinnedAtlasVersionRecord[]> {
    const rows = await this.prisma.planetAtlasVersion.findMany({
      where: { planetId },
      orderBy: { atlasVersion: 'asc' },
    });
    return rows.map(mapAtlasVersionRow);
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
    const secRow = await this.prisma.planetSector.upsert({
      where: { planetId_sectorId: { planetId: norm.planetId, sectorId: norm.sectorId } },
      create: {
        id: `psec_${norm.planetId}_${norm.sectorId}`,
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
        ...(input.reservedSeats !== undefined ? { reservedSeats: Math.max(0, input.reservedSeats) } : {}),
        ...(input.foundedSeats !== undefined ? { foundedSeats: Math.max(0, input.foundedSeats) } : {}),
        mainResource: norm.mainResource ?? null,
        ...(norm.scarceResources ? { scarceResources: [...norm.scarceResources] } : {}),
      },
      update: {
        continentId: norm.continentId,
        macroQ: norm.macroQ,
        macroR: norm.macroR,
        centerQ: norm.centerQ,
        centerR: norm.centerR,
        kind: norm.kind,
        radius: norm.radius,
        foundingCapacity: norm.foundingCapacity,
        validatedCapacity: norm.validatedCapacity,
        ...(input.reservedSeats !== undefined ? { reservedSeats: Math.max(0, input.reservedSeats) } : {}),
        ...(input.foundedSeats !== undefined ? { foundedSeats: Math.max(0, input.foundedSeats) } : {}),
        mainResource: norm.mainResource ?? null,
      },
    });
    const outSlots: SectorLandingSlotRecord[] = [];
    for (const s of norm.slots) {
      const slotRow = await this.prisma.sectorLandingSlot.upsert({
        where: { planetId_landingSlotId: { planetId: norm.planetId, landingSlotId: s.landingSlotId } },
        create: {
          id: `pslot_${norm.planetId}_${s.landingSlotId}`,
          planetId: norm.planetId,
          sectorId: norm.sectorId,
          landingSlotId: s.landingSlotId,
          slotIndex: s.slotIndex,
          q: s.q,
          r: s.r,
          state: 'FREE',
          epoch: 0,
        },
        update: { q: s.q, r: s.r },
      });
      outSlots.push(mapLandingSlotRow(slotRow));
    }
    return { sector: mapSectorRow(secRow), slots: outSlots };
  }

  async getSector(planetId: string, sectorId: SectorId): Promise<PlanetSectorRecord | null> {
    const row = await this.prisma.planetSector.findUnique({
      where: { planetId_sectorId: { planetId, sectorId } },
    });
    return row ? mapSectorRow(row) : null;
  }

  async listSectors(planetId: string): Promise<PlanetSectorRecord[]> {
    const rows = await this.prisma.planetSector.findMany({
      where: { planetId },
      orderBy: { sectorId: 'asc' },
    });
    return rows.map(mapSectorRow);
  }

  async getLandingSlot(planetId: string, landingSlotId: LandingSlotId): Promise<SectorLandingSlotRecord | null> {
    const row = await this.prisma.sectorLandingSlot.findUnique({
      where: { planetId_landingSlotId: { planetId, landingSlotId } },
    });
    return row ? mapLandingSlotRow(row) : null;
  }

  async listLandingSlots(planetId: string, sectorId?: SectorId): Promise<SectorLandingSlotRecord[]> {
    const rows = await this.prisma.sectorLandingSlot.findMany({
      where: { planetId, ...(sectorId === undefined ? {} : { sectorId }) },
      orderBy: [{ sectorId: 'asc' }, { slotIndex: 'asc' }],
    });
    return rows.map(mapLandingSlotRow);
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
    options?: { readonly allowCommitted?: boolean },
  ): Promise<{ readonly released: boolean; readonly reservation: SectorReservationRecord }> {
    return this.reservationOps.releaseReservation(reservationId, reason, expectedEpoch, options);
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
  cancelTicket(ticketId: string, playerId: string): Promise<MatchTicketRecord> {
    return this.ticketPartyOps.cancelTicket(ticketId, playerId);
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
