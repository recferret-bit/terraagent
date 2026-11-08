import { ConflictException } from '@nestjs/common';
import type {
  AtlasManifestV1,
  EnqueueTicketRequestV1,
  LandingSlotId,
  MatchModeV1,
  MatchTicketV1,
  NormalizedTicketIntentV1,
  PartyMemberV1,
  PartyV1,
  PlanetLook,
  PlanetType,
  ReservationStateV1,
  ResourceKey,
  SectorId,
  SectorKind,
  SectorPlacementIntentV1,
  SectorReservationV1,
  TicketStateV1,
  WorldAdmissionState,
  WorldHealthState,
  WorldLifecycleState,
} from '@terra/contracts';

export type LobbyConflictCode =
  | 'canonical_type_conflict'
  | 'atlas_version_immutable'
  | 'slot_already_reserved'
  | 'sector_capacity_exceeded'
  | 'duplicate_active_reservation'
  | 'reservation_fenced'
  | 'ticket_open'
  | 'unsupported_mode'
  | 'same_planet_transfer'
  | 'invalid_ticket_intent'
  | 'party_full'
  | 'party_not_open'
  | 'party_not_found'
  | 'planet_not_found'
  | 'sector_not_found'
  | 'slot_not_found'
  | 'concurrency_conflict'
  | 'invalid_lifecycle_transition'
  | 'audit_metadata_required';

export class LobbyPersistenceConflictError extends ConflictException {
  readonly code: LobbyConflictCode;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(code: LobbyConflictCode, message: string, details?: Readonly<Record<string, unknown>>) {
    super({ errorCode: code, message, ...(details ? { details } : {}) });
    this.name = 'LobbyPersistenceConflictError';
    this.code = code;
    this.details = details;
  }
}

export interface CanonicalWorldRecord {
  readonly id: string;
  readonly name: string;
  readonly type: PlanetType;
  readonly canonicalType: PlanetType;
  readonly look: PlanetLook;
  readonly seed: string;
  readonly lifecycle: WorldLifecycleState;
  readonly health: WorldHealthState;
  readonly admission: WorldAdmissionState;
  readonly capacity: number;
  readonly seatsTaken: number;
  readonly atlasVersion: number;
  readonly atlasHash: string;
  readonly configHash: string;
  readonly faultCode: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PinnedAtlasVersionRecord {
  readonly id: string;
  readonly planetId: string;
  readonly atlasVersion: number;
  readonly topologyVersion: number;
  readonly genVersion: number;
  readonly configVersion: number;
  readonly configHash: string;
  readonly atlasHash: string;
  readonly resourceProfileId: string;
  readonly resourceProfileHash: string;
  readonly manifest: AtlasManifestV1;
  readonly createdAt: Date;
}

export interface PlanetSectorRecord {
  readonly id: string;
  readonly planetId: string;
  readonly sectorId: SectorId;
  readonly continentId: string | null;
  readonly macroQ: number;
  readonly macroR: number;
  readonly centerQ: number;
  readonly centerR: number;
  readonly kind: SectorKind;
  readonly radius: number;
  readonly foundingCapacity: number;
  readonly validatedCapacity: number;
  readonly reservedSeats: number;
  readonly foundedSeats: number;
  readonly freeSeats: number;
  readonly mainResource?: ResourceKey;
  readonly scarceResources?: readonly ResourceKey[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type SectorLandingSlotState = 'FREE' | 'HELD' | 'COMMITTED';

export interface SectorLandingSlotRecord {
  readonly id: string;
  readonly planetId: string;
  readonly sectorId: SectorId;
  readonly landingSlotId: LandingSlotId;
  readonly slotIndex: number;
  readonly q: number;
  readonly r: number;
  readonly state: SectorLandingSlotState;
  readonly reservationId: string | null;
  readonly colonyId: string | null;
  readonly epoch: number;
  readonly expiresAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface SectorReservationRecord extends SectorReservationV1 {
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface MatchTicketRecord extends MatchTicketV1 {
  readonly idempotencyKey: string | null;
}

export type PartyState = PartyV1['state'];
export type PartyMemberSpawnStatus = NonNullable<PartyMemberV1['spawnStatus']>;

export interface ProvisionCanonicalWorldInput {
  readonly type: PlanetType;
  readonly id?: string;
  readonly name?: string;
  readonly look?: PlanetLook;
  readonly seed?: string;
  readonly lifecycle?: WorldLifecycleState;
  readonly health?: WorldHealthState;
  readonly admission?: WorldAdmissionState;
  readonly capacity?: number;
  readonly manifest?: AtlasManifestV1;
}

export interface ProvisionCanonicalWorldResult {
  readonly world: CanonicalWorldRecord;
  readonly created: boolean;
  readonly pinnedAtlas?: PinnedAtlasVersionRecord;
}

export interface UpdateCanonicalWorldStateInput {
  readonly planetId: string;
  readonly lifecycle?: WorldLifecycleState;
  readonly health?: WorldHealthState;
  readonly admission?: WorldAdmissionState;
  readonly faultCode?: string | null;
  readonly expectedUpdatedAt?: Date | string | number;
  readonly now?: Date;
  readonly onTransition?: (previous: CanonicalWorldRecord, next: CanonicalWorldRecord) => void;
}

export interface PinAtlasVersionResult {
  readonly record: PinnedAtlasVersionRecord;
  readonly created: boolean;
}

export interface UpsertSectorWithSlotsInput {
  readonly planetId: string;
  readonly sectorId: SectorId;
  readonly continentId?: string | null;
  readonly macroQ?: number;
  readonly macroR?: number;
  readonly centerQ?: number;
  readonly centerR?: number;
  readonly kind?: SectorKind;
  readonly radius?: number;
  readonly foundingCapacity: number;
  readonly validatedCapacity: number;
  readonly mainResource?: ResourceKey;
  readonly scarceResources?: readonly ResourceKey[];
  readonly slots?: readonly {
    readonly slotId?: LandingSlotId;
    readonly slotIndex: number;
    readonly q: number;
    readonly r: number;
  }[];
}

export interface ReserveSectorSlotInput {
  readonly planetId: string;
  readonly sectorId: SectorId;
  readonly landingSlotId?: LandingSlotId;
  readonly playerId: string;
  readonly ticketId: string;
  readonly colonyId: string;
  readonly reservationId?: string;
  readonly ttlMs?: number;
  readonly now?: Date;
}

export type ReserveSectorSlotOutcome =
  | {
      readonly ok: true;
      readonly idempotent: boolean;
      readonly reservation: SectorReservationRecord;
      readonly slot: SectorLandingSlotRecord;
      readonly sector: PlanetSectorRecord;
    }
  | {
      readonly ok: false;
      readonly reason: 'sector_full' | 'slot_taken' | 'ocean_sector' | 'admission_closed';
      readonly message: string;
    };

export interface EnqueueTicketInput {
  readonly id?: string;
  readonly playerId: string;
  readonly idempotencyKey?: string;
  readonly request: EnqueueTicketRequestV1 | NormalizedTicketIntentV1;
  readonly colonyId?: string;
  readonly priority?: number;
  readonly now?: Date;
}

export interface EnqueueTicketResult {
  readonly ticket: MatchTicketRecord;
  readonly created: boolean;
}

export interface UpdateTicketStateInput {
  readonly ticketId: string;
  readonly state: TicketStateV1;
  readonly failureCode?: string | null;
  readonly attempts?: number;
  readonly now?: Date;
}

export interface CreatePartyInput {
  readonly id?: string;
  readonly code?: string;
  readonly leaderId: string;
  readonly leaderHandle: string;
  readonly planetId?: string | null;
  readonly sectorIntent?: SectorPlacementIntentV1 | null;
  readonly now?: Date;
}

export interface JoinPartyInput {
  readonly partyIdOrCode: string;
  readonly playerId: string;
  readonly handle: string;
  readonly now?: Date;
}

export interface LeavePartyInput {
  readonly partyId: string;
  readonly playerId: string;
  readonly now?: Date;
}

export interface SetPartyIntentInput {
  readonly partyId: string;
  readonly actorPlayerId: string;
  readonly planetId: string | null;
  readonly sectorIntent: SectorPlacementIntentV1 | null;
  readonly state?: PartyState;
  readonly now?: Date;
}

export interface LobbyPersistenceStore {
  provisionCanonicalWorld(input: ProvisionCanonicalWorldInput): Promise<ProvisionCanonicalWorldResult>;
  getCanonicalWorldByType(type: PlanetType): Promise<CanonicalWorldRecord | null>;
  getCanonicalWorldById(planetId: string): Promise<CanonicalWorldRecord | null>;
  listCanonicalWorlds(): Promise<CanonicalWorldRecord[]>;
  updateCanonicalWorldState(input: UpdateCanonicalWorldStateInput): Promise<CanonicalWorldRecord>;

  pinAtlasVersion(manifest: AtlasManifestV1): Promise<PinAtlasVersionResult>;
  getAtlasVersion(planetId: string, atlasVersion: number): Promise<PinnedAtlasVersionRecord | null>;
  listAtlasVersions(planetId: string): Promise<PinnedAtlasVersionRecord[]>;

  upsertSectorWithSlots(input: UpsertSectorWithSlotsInput): Promise<{
    readonly sector: PlanetSectorRecord;
    readonly slots: SectorLandingSlotRecord[];
  }>;
  getSector(planetId: string, sectorId: SectorId): Promise<PlanetSectorRecord | null>;
  listSectors(planetId: string): Promise<PlanetSectorRecord[]>;
  getLandingSlot(planetId: string, landingSlotId: LandingSlotId): Promise<SectorLandingSlotRecord | null>;
  listLandingSlots(planetId: string, sectorId?: SectorId): Promise<SectorLandingSlotRecord[]>;

  reserveSectorSlot(input: ReserveSectorSlotInput): Promise<ReserveSectorSlotOutcome>;
  commitReservation(reservationId: string, expectedEpoch?: number): Promise<SectorReservationRecord>;
  releaseReservation(
    reservationId: string,
    reason?: 'RELEASED' | 'EXPIRED',
    expectedEpoch?: number,
  ): Promise<{ readonly released: boolean; readonly reservation: SectorReservationRecord }>;
  expireReservations(now?: Date): Promise<SectorReservationRecord[]>;
  getReservationById(reservationId: string): Promise<SectorReservationRecord | null>;
  getReservationByTicketId(ticketId: string): Promise<SectorReservationRecord | null>;
  listReservations(planetId: string, sectorId?: SectorId): Promise<SectorReservationRecord[]>;

  enqueueTicket(input: EnqueueTicketInput): Promise<EnqueueTicketResult>;
  getTicketById(ticketId: string): Promise<MatchTicketRecord | null>;
  findActiveTicketByPlayer(playerId: string): Promise<MatchTicketRecord | null>;
  listTickets(filter?: { readonly planetId?: string; readonly state?: TicketStateV1 }): Promise<MatchTicketRecord[]>;
  updateTicketState(input: UpdateTicketStateInput): Promise<MatchTicketRecord>;
  cancelTicket(ticketId: string, playerId: string, now?: Date): Promise<MatchTicketRecord>;

  createParty(input: CreatePartyInput): Promise<PartyV1>;
  getPartyById(partyId: string): Promise<PartyV1 | null>;
  getPartyByCode(code: string): Promise<PartyV1 | null>;
  joinParty(input: JoinPartyInput): Promise<PartyV1>;
  leaveParty(input: LeavePartyInput): Promise<PartyV1>;
  setPartyIntent(input: SetPartyIntentInput): Promise<PartyV1>;
}

export type {
  AtlasManifestV1,
  LandingSlotId,
  MatchModeV1,
  MatchTicketV1,
  PartyMemberV1,
  PartyV1,
  PlanetLook,
  PlanetType,
  ReservationStateV1,
  SectorId,
  SectorKind,
  SectorPlacementIntentV1,
  TicketStateV1,
  WorldAdmissionState,
  WorldHealthState,
  WorldLifecycleState,
};
