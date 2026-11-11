import type { AtlasManifestV1 } from '@terra/contracts';
import type {
  LobbyPersistenceStore,
  PlanetSectorRecord,
  SectorLandingSlotRecord,
  UpsertSectorWithSlotsInput,
} from '../lobby-persistence.types';
import {
  computeFreeSectorSeats,
  normalizeSectorSlotsInput,
} from '../lobby-store.helpers';

export type ReservationOpsLike = Pick<
  LobbyPersistenceStore,
  | 'reserveSectorSlot'
  | 'commitReservation'
  | 'releaseReservation'
  | 'expireReservations'
  | 'getReservationById'
  | 'getReservationByTicketId'
  | 'listReservations'
>;

export type TicketPartyOpsLike = Pick<
  LobbyPersistenceStore,
  | 'enqueueTicket'
  | 'getTicketById'
  | 'findActiveTicketByPlayer'
  | 'listTickets'
  | 'updateTicketState'
  | 'updateTicket'
  | 'cancelTicket'
  | 'createParty'
  | 'getPartyById'
  | 'getPartyByCode'
  | 'joinParty'
  | 'leaveParty'
  | 'setPartyIntent'
>;

export function buildAtlasVersionBaseFields(manifest: AtlasManifestV1) {
  return {
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
  };
}

export function buildSectorCoreFields(
  norm: Pick<
    PlanetSectorRecord,
    | 'continentId'
    | 'macroQ'
    | 'macroR'
    | 'centerQ'
    | 'centerR'
    | 'kind'
    | 'radius'
    | 'foundingCapacity'
    | 'validatedCapacity'
  >,
) {
  return {
    continentId: norm.continentId,
    macroQ: norm.macroQ,
    macroR: norm.macroR,
    centerQ: norm.centerQ,
    centerR: norm.centerR,
    kind: norm.kind,
    radius: norm.radius,
    foundingCapacity: norm.foundingCapacity,
    validatedCapacity: norm.validatedCapacity,
  };
}

export function buildPrismaSectorUpsertData(
  norm: ReturnType<typeof normalizeSectorSlotsInput>,
  input: UpsertSectorWithSlotsInput,
) {
  const core = buildSectorCoreFields(norm);
  const counterPatch = {
    ...(input.reservedSeats !== undefined ? { reservedSeats: Math.max(0, input.reservedSeats) } : {}),
    ...(input.foundedSeats !== undefined ? { foundedSeats: Math.max(0, input.foundedSeats) } : {}),
    mainResource: norm.mainResource ?? null,
  };
  return {
    create: {
      id: `psec_${norm.planetId}_${norm.sectorId}`,
      planetId: norm.planetId,
      sectorId: norm.sectorId,
      ...core,
      ...counterPatch,
      ...(norm.scarceResources ? { scarceResources: [...norm.scarceResources] } : {}),
    },
    update: {
      ...core,
      ...counterPatch,
    },
  };
}

export function upsertMemorySectorAndSlots(
  sectors: Map<string, PlanetSectorRecord>,
  landingSlots: Map<string, SectorLandingSlotRecord>,
  input: UpsertSectorWithSlotsInput,
): { readonly sector: PlanetSectorRecord; readonly slots: SectorLandingSlotRecord[] } {
  const norm = normalizeSectorSlotsInput(input);
  const secKey = `${norm.planetId}:${norm.sectorId}`;
  const prevSec = sectors.get(secKey);
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
    ...buildSectorCoreFields(norm),
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
  sectors.set(secKey, sector);
  const slots = upsertMemorySlotsForSector(landingSlots, norm, input.slots !== undefined, now);
  return { sector, slots };
}

function upsertMemorySlotsForSector(
  landingSlots: Map<string, SectorLandingSlotRecord>,
  norm: ReturnType<typeof normalizeSectorSlotsInput>,
  overwriteCoords: boolean,
  now: Date,
): SectorLandingSlotRecord[] {
  const outSlots: SectorLandingSlotRecord[] = [];
  for (const s of norm.slots) {
    const slotKey = `${norm.planetId}:${s.landingSlotId}`;
    const prevSlot = landingSlots.get(slotKey);
    const nextQ = overwriteCoords ? s.q : (prevSlot?.q ?? s.q);
    const nextR = overwriteCoords ? s.r : (prevSlot?.r ?? s.r);
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
    landingSlots.set(slotKey, slotRec);
    outSlots.push(slotRec);
  }
  return outSlots;
}

export abstract class LobbyStoreDelegatorBase {
  protected abstract readonly reservationOps: ReservationOpsLike;
  protected abstract readonly ticketPartyOps: TicketPartyOpsLike;

  reserveSectorSlot(...args: Parameters<LobbyPersistenceStore['reserveSectorSlot']>) {
    return this.reservationOps.reserveSectorSlot(...args);
  }
  commitReservation(...args: Parameters<LobbyPersistenceStore['commitReservation']>) {
    return this.reservationOps.commitReservation(...args);
  }
  releaseReservation(...args: Parameters<LobbyPersistenceStore['releaseReservation']>) {
    return this.reservationOps.releaseReservation(...args);
  }
  expireReservations(...args: Parameters<LobbyPersistenceStore['expireReservations']>) {
    return this.reservationOps.expireReservations(...args);
  }
  getReservationById(...args: Parameters<LobbyPersistenceStore['getReservationById']>) {
    return this.reservationOps.getReservationById(...args);
  }
  getReservationByTicketId(...args: Parameters<LobbyPersistenceStore['getReservationByTicketId']>) {
    return this.reservationOps.getReservationByTicketId(...args);
  }
  listReservations(...args: Parameters<LobbyPersistenceStore['listReservations']>) {
    return this.reservationOps.listReservations(...args);
  }
  enqueueTicket(...args: Parameters<LobbyPersistenceStore['enqueueTicket']>) {
    return this.ticketPartyOps.enqueueTicket(...args);
  }
  getTicketById(...args: Parameters<LobbyPersistenceStore['getTicketById']>) {
    return this.ticketPartyOps.getTicketById(...args);
  }
  findActiveTicketByPlayer(...args: Parameters<LobbyPersistenceStore['findActiveTicketByPlayer']>) {
    return this.ticketPartyOps.findActiveTicketByPlayer(...args);
  }
  listTickets(...args: Parameters<LobbyPersistenceStore['listTickets']>) {
    return this.ticketPartyOps.listTickets(...args);
  }
  updateTicketState(...args: Parameters<LobbyPersistenceStore['updateTicketState']>) {
    return this.ticketPartyOps.updateTicketState(...args);
  }
  updateTicket(...args: Parameters<LobbyPersistenceStore['updateTicket']>) {
    return this.ticketPartyOps.updateTicket(...args);
  }
  cancelTicket(...args: Parameters<LobbyPersistenceStore['cancelTicket']>) {
    return this.ticketPartyOps.cancelTicket(...args);
  }
  createParty(...args: Parameters<LobbyPersistenceStore['createParty']>) {
    return this.ticketPartyOps.createParty(...args);
  }
  getPartyById(...args: Parameters<LobbyPersistenceStore['getPartyById']>) {
    return this.ticketPartyOps.getPartyById(...args);
  }
  getPartyByCode(...args: Parameters<LobbyPersistenceStore['getPartyByCode']>) {
    return this.ticketPartyOps.getPartyByCode(...args);
  }
  joinParty(...args: Parameters<LobbyPersistenceStore['joinParty']>) {
    return this.ticketPartyOps.joinParty(...args);
  }
  leaveParty(...args: Parameters<LobbyPersistenceStore['leaveParty']>) {
    return this.ticketPartyOps.leaveParty(...args);
  }
  setPartyIntent(...args: Parameters<LobbyPersistenceStore['setPartyIntent']>) {
    return this.ticketPartyOps.setPartyIntent(...args);
  }
}
