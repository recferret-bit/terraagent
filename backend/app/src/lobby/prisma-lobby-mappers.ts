import {
  AtlasManifestV1Schema,
  type MatchModeV1,
  type PartyMemberV1,
  type PartyV1,
  type PlanetLook,
  type PlanetType,
  type ReservationStateV1,
  type ResourceKey,
  type SectorKind,
  type SectorPlacementIntentV1,
  type TicketStateV1,
  type WorldAdmissionState,
  type WorldHealthState,
  type WorldLifecycleState,
} from '@terra/contracts';
import type {
  CanonicalWorldRecord,
  MatchTicketRecord,
  PinnedAtlasVersionRecord,
  PlanetSectorRecord,
  SectorLandingSlotRecord,
  SectorLandingSlotState,
  SectorReservationRecord,
} from './lobby-persistence.types';
import { computeFreeSectorSeats } from './lobby-store.helpers';

export interface PrismaPlanetRow {
  id: string;
  name: string;
  type: string;
  canonicalType: string | null;
  look: string;
  seed: string;
  lifecycle: string;
  health: string;
  admission: string;
  capacity: number;
  seatsTaken: number;
  atlasVersion: number;
  atlasHash: string;
  configHash: string;
  faultCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function mapCanonicalWorldRow(row: PrismaPlanetRow): CanonicalWorldRecord {
  return {
    id: row.id,
    name: row.name,
    type: row.type as PlanetType,
    canonicalType: (row.canonicalType ?? row.type) as PlanetType,
    look: row.look as PlanetLook,
    seed: row.seed,
    lifecycle: row.lifecycle as WorldLifecycleState,
    health: row.health as WorldHealthState,
    admission: row.admission as WorldAdmissionState,
    capacity: row.capacity,
    seatsTaken: row.seatsTaken,
    atlasVersion: row.atlasVersion,
    atlasHash: row.atlasHash,
    configHash: row.configHash,
    faultCode: row.faultCode,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface PrismaAtlasVersionRow {
  id: string;
  planetId: string;
  atlasVersion: number;
  topologyVersion: number;
  genVersion: number;
  configVersion: number;
  configHash: string;
  atlasHash: string;
  resourceProfileId: string;
  resourceProfileHash: string;
  manifestJson: unknown;
  createdAt: Date;
}

export function mapAtlasVersionRow(row: PrismaAtlasVersionRow): PinnedAtlasVersionRecord {
  return {
    id: row.id,
    planetId: row.planetId,
    atlasVersion: row.atlasVersion,
    topologyVersion: row.topologyVersion,
    genVersion: row.genVersion,
    configVersion: row.configVersion,
    configHash: row.configHash,
    atlasHash: row.atlasHash,
    resourceProfileId: row.resourceProfileId,
    resourceProfileHash: row.resourceProfileHash,
    manifest: AtlasManifestV1Schema.parse(row.manifestJson),
    createdAt: row.createdAt,
  };
}

export interface PrismaSectorRow {
  id: string;
  planetId: string;
  sectorId: string;
  continentId: string | null;
  macroQ: number;
  macroR: number;
  centerQ: number;
  centerR: number;
  kind: string;
  radius: number;
  foundingCapacity: number;
  validatedCapacity: number;
  reservedSeats: number;
  foundedSeats: number;
  mainResource: string | null;
  scarceResources: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export function mapSectorRow(row: PrismaSectorRow): PlanetSectorRecord {
  const kind = row.kind as SectorKind;
  return {
    id: row.id,
    planetId: row.planetId,
    sectorId: row.sectorId,
    continentId: row.continentId,
    macroQ: row.macroQ,
    macroR: row.macroR,
    centerQ: row.centerQ,
    centerR: row.centerR,
    kind,
    radius: row.radius,
    foundingCapacity: row.foundingCapacity,
    validatedCapacity: row.validatedCapacity,
    reservedSeats: row.reservedSeats,
    foundedSeats: row.foundedSeats,
    freeSeats: computeFreeSectorSeats(
      kind,
      row.foundingCapacity,
      row.validatedCapacity,
      row.reservedSeats,
      row.foundedSeats,
    ),
    ...(row.mainResource ? { mainResource: row.mainResource as ResourceKey } : {}),
    ...(Array.isArray(row.scarceResources) ? { scarceResources: row.scarceResources as ResourceKey[] } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface PrismaLandingSlotRow {
  id: string;
  planetId: string;
  sectorId: string;
  landingSlotId: string;
  slotIndex: number;
  q: number;
  r: number;
  state: string;
  reservationId: string | null;
  colonyId: string | null;
  epoch: number;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function mapLandingSlotRow(row: PrismaLandingSlotRow): SectorLandingSlotRecord {
  return {
    id: row.id,
    planetId: row.planetId,
    sectorId: row.sectorId,
    landingSlotId: row.landingSlotId,
    slotIndex: row.slotIndex,
    q: row.q,
    r: row.r,
    state: row.state as SectorLandingSlotState,
    reservationId: row.reservationId,
    colonyId: row.colonyId,
    epoch: row.epoch,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface PrismaReservationRow {
  id: string;
  ticketId: string;
  colonyId: string;
  playerId: string;
  planetId: string;
  sectorId: string;
  landingSlotId: string;
  slotIndex: number;
  q: number;
  r: number;
  epoch: number;
  state: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export function mapReservationRow(row: PrismaReservationRow): SectorReservationRecord {
  return {
    id: row.id,
    reservationId: row.id,
    ticketId: row.ticketId,
    colonyId: row.colonyId,
    playerId: row.playerId,
    planetId: row.planetId,
    sectorId: row.sectorId,
    landingSlotId: row.landingSlotId,
    slotIndex: row.slotIndex,
    q: row.q,
    r: row.r,
    epoch: row.epoch,
    expiresAt: row.expiresAt.toISOString(),
    state: row.state as ReservationStateV1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface PrismaTicketRow {
  id: string;
  playerId: string;
  partyId: string | null;
  idempotencyKey: string | null;
  mode: string;
  planetId: string;
  planetType: string;
  sectorIntentKind: string;
  requestedSectorId: string | null;
  state: string;
  priority: number;
  colonyId: string;
  reservedPlanetId: string | null;
  reservedSectorId: string | null;
  reservedLandingSlotId: string | null;
  reservationEpoch: number | null;
  reservationExpiresAt: Date | null;
  attempts: number;
  failureCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function mapTicketRow(row: PrismaTicketRow): MatchTicketRecord {
  const sectorIntent: SectorPlacementIntentV1 =
    row.sectorIntentKind === 'chosen' && row.requestedSectorId
      ? { kind: 'chosen', sectorId: row.requestedSectorId }
      : { kind: 'auto' };
  return {
    id: row.id,
    playerId: row.playerId,
    partyId: row.partyId,
    idempotencyKey: row.idempotencyKey,
    mode: row.mode as MatchModeV1,
    planetId: row.planetId,
    planetType: row.planetType as PlanetType,
    sectorIntent,
    state: row.state as TicketStateV1,
    priority: row.priority,
    position: row.state === 'QUEUED' ? 0 : null,
    etaS: null,
    colonyId: row.colonyId,
    reservedPlanetId: row.reservedPlanetId,
    reservedSectorId: row.reservedSectorId,
    reservedLandingSlotId: row.reservedLandingSlotId,
    reservationEpoch: row.reservationEpoch,
    reservationExpiresAt: row.reservationExpiresAt ? row.reservationExpiresAt.toISOString() : null,
    attempts: row.attempts,
    failureCode: row.failureCode,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface PrismaPartyRow {
  id: string;
  code: string;
  leaderId: string;
  planetId: string | null;
  sectorIntentKind: string | null;
  requestedSectorId: string | null;
  state: string;
  createdAt: Date;
  updatedAt: Date;
  members: {
    partyId: string;
    playerId: string;
    handle: string;
    joinedAt: Date;
    colonyId: string | null;
    reservedSectorId: string | null;
    reservedLandingSlotId: string | null;
    spawnStatus: string;
  }[];
}

export function mapPartyRow(row: PrismaPartyRow): PartyV1 {
  const sectorIntent: SectorPlacementIntentV1 | null =
    row.sectorIntentKind === 'chosen' && row.requestedSectorId
      ? { kind: 'chosen', sectorId: row.requestedSectorId }
      : row.sectorIntentKind === 'auto'
        ? { kind: 'auto' }
        : null;
  const members: PartyMemberV1[] = [...row.members]
    .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime() || a.playerId.localeCompare(b.playerId))
    .map((m) => ({
      playerId: m.playerId,
      handle: m.handle,
      joinedAt: m.joinedAt.toISOString(),
      ...(m.colonyId ? { colonyId: m.colonyId } : {}),
      ...(m.reservedSectorId ? { reservedSectorId: m.reservedSectorId } : {}),
      ...(m.reservedLandingSlotId ? { reservedLandingSlotId: m.reservedLandingSlotId } : {}),
      spawnStatus: m.spawnStatus as NonNullable<PartyMemberV1['spawnStatus']>,
    }));
  return {
    id: row.id,
    code: row.code,
    leaderId: row.leaderId,
    planetId: row.planetId,
    sectorIntent,
    state: row.state as PartyV1['state'],
    members,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
