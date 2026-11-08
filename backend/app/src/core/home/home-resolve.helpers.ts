import {
  CANONICAL_PLANETS,
  canonicalPlanetById,
  deriveSectorOccupancy,
  deriveWorldAvailability,
  newId,
  planetLookForType,
  type ColonySummary,
  type HomeResponse,
  type PlanetSummary,
  type PlanetType,
  type SectorSummaryV1,
  type SimCommandV1,
} from '@terra/contracts';
import { DEV_PLANET_CAPACITY, DEV_PLANET_RADIUS, DEV_PLANET_TYPE, type DevPlanetType } from '@terra/sim';
import { buildDefaultCanonicalAtlasManifest } from '../../lobby/atlas-manifest.helper';
import type { WorldLifecycleService } from '../../lobby/lifecycle.service';
import type { LobbyPersistenceService } from '../../lobby/lobby-persistence.service';
import type {
  CanonicalWorldRecord,
  MatchTicketRecord,
  PlanetSectorRecord,
  SectorReservationRecord,
} from '../../lobby/lobby-persistence.types';
import {
  computeAlternativeSectorsForIntent,
  computeQueuePositionAndEta,
} from '../../lobby/tickets.helpers';
import type { ColonyRecord, PlanetRecord } from './home.store';

/** The landing site of a seat: where the planet's sim said the colony lands (`slot.index`: its spawn slot, if any). */
export interface SeatSlot {
  readonly index: number;
  readonly q: number;
  readonly r: number;
  readonly sectorId?: string;
  readonly landingSlotId?: string;
}

export interface ColonySeatAssignment {
  readonly player: { readonly id: string; readonly handle: string };
  readonly colony: ColonyRecord;
  readonly planet: PlanetRecord;
  readonly slot: SeatSlot;
}

export interface HomeSeatNotifier {
  onColonySeated(assignment: ColonySeatAssignment): void | Promise<void>;
}

export type ColonySeatListener = (assignment: ColonySeatAssignment) => void | Promise<void>;

/** Where the planet's sim would land a colony now (`nextLandingSite`), or the sim's reason why it cannot. */
export type HomeLandingSite =
  | {
      readonly ok: true;
      readonly q: number;
      readonly r: number;
      readonly slotIndex?: number;
      readonly sectorId?: string;
      readonly landingSlotId?: string;
    }
  | { readonly ok: false; readonly code: string };

/**
 * What seating needs from the game (set by the game module, `setLandingHost`): the sim decides landing sites (LED-14)
 * and a home's planet is loaded before it is answered ACTIVE (BE-14). Both throw when the planet cannot be loaded.
 */
export interface HomeLandingHost {
  landingSite(planet: PlanetRecord, colonyIndex: number): Promise<HomeLandingSite>;
  ensureHomeLoaded(planet: PlanetRecord, colonies: () => Promise<ColonyRecord[]>): Promise<void>;
}

export interface ResolveHomeOptions {
  readonly autoSeatDev?: boolean;
  readonly preferredType?: DevPlanetType;
  readonly colonyId?: string;
}

export function createSpawnColonyCommand(assignment: ColonySeatAssignment): SimCommandV1 {
  const { player, colony, slot } = assignment;
  const sectorId = slot.sectorId ?? colony.foundingSectorId;
  const landingSlotId = slot.landingSlotId ?? colony.landingSlotId ?? undefined;
  return {
    colonyIndex: colony.colonyIndex,
    source: 'system',
    commandId: newId('cm'),
    kind: 'system.spawnColony',
    args: {
      colonyId: colony.id,
      colonyIndex: colony.colonyIndex,
      playerId: player.id,
      handle: player.handle,
      name: colony.name,
      color: colony.color,
      slotIndex: slot.index,
      ...(sectorId ? { sectorId } : {}),
      ...(landingSlotId ? { landingSlotId } : {}),
      q: colony.spawnQ,
      r: colony.spawnR,
    },
  };
}

export function buildBasicColonySummary(colony: ColonyRecord): ColonySummary {
  return {
    id: colony.id,
    playerId: colony.playerId,
    planetId: colony.planetId,
    colonyIndex: colony.colonyIndex,
    name: colony.name,
    color: colony.color,
    state: colony.status,
    status: colony.status,
    foundingSectorId: colony.foundingSectorId ?? 'sec_0_0',
    ...(colony.landingSlotId ? { landingSlotId: colony.landingSlotId } : {}),
    spawnQ: colony.spawnQ,
    spawnR: colony.spawnR,
  };
}

export function buildBasicPlanetSummary(planet: PlanetRecord): PlanetSummary {
  return {
    id: planet.id,
    name: planet.name,
    type: planet.type,
    seed: planet.seed,
    radius: planet.radius,
    state: planet.status,
    status: planet.status,
    capacity: planet.capacity,
    seatsTaken: planet.seatsTaken,
    seats: {
      taken: planet.seatsTaken,
      capacity: planet.capacity,
    },
  };
}

function toSectorSummary(
  world: Pick<CanonicalWorldRecord, 'lifecycle' | 'health' | 'admission'>,
  sec: PlanetSectorRecord,
): SectorSummaryV1 {
  const validatedCapacity = sec.kind === 'ocean' ? 0 : Math.min(sec.foundingCapacity, sec.validatedCapacity);
  const foundingCapacity = sec.kind === 'ocean' ? 0 : sec.foundingCapacity;
  const reservedSeats = sec.kind === 'ocean' ? 0 : sec.reservedSeats;
  const foundedSeats = sec.kind === 'ocean' ? 0 : sec.foundedSeats;
  const occ = deriveSectorOccupancy({
    kind: sec.kind,
    foundingCapacity,
    validatedCapacity,
    reservedSeats,
    foundedSeats,
    livingColonies: null,
    presentColonies: null,
    onlinePlayers: null,
    lifecycle: world.lifecycle,
    health: world.health,
    admission: world.admission,
  });
  return {
    sectorId: sec.sectorId,
    continentId: sec.continentId,
    macroQ: sec.macroQ,
    macroR: sec.macroR,
    centerQ: sec.centerQ,
    centerR: sec.centerR,
    kind: sec.kind,
    foundingCapacity,
    validatedCapacity,
    reservedSeats,
    foundedSeats,
    freeSeats: occ.freeSeats,
    livingColonies: null,
    presentColonies: null,
    onlinePlayers: null,
    availability: occ.availability,
    ...(sec.mainResource ? { mainResource: sec.mainResource } : {}),
    ...(sec.scarceResources ? { scarceResources: [...sec.scarceResources] } : {}),
  };
}

export function buildCanonicalPlanetSummary(
  world: CanonicalWorldRecord | null,
  sectors: readonly PlanetSectorRecord[],
  fallbackPlanetId: string,
  fallbackType: PlanetType,
  planetRecord?: PlanetRecord | null,
): PlanetSummary {
  const canonicalDef = canonicalPlanetById(fallbackPlanetId) ?? CANONICAL_PLANETS[fallbackType];
  const type = world?.type ?? planetRecord?.type ?? canonicalDef.type;
  const isEndedRecord =
    planetRecord?.status === 'ENDED' ||
    planetRecord?.status === 'PLANET_ENDED' ||
    planetRecord?.state === 'ENDED' ||
    planetRecord?.state === 'PLANET_ENDED';
  const lifecycle = isEndedRecord ? 'ARCHIVED' : (world?.lifecycle ?? 'ACTIVE');
  const health = world?.health ?? 'OK';
  const admission = isEndedRecord ? 'ARCHIVED' : (world?.admission ?? 'OPEN');

  const effectiveSectors: SectorSummaryV1[] =
    sectors.length > 0
      ? sectors.map((s) => toSectorSummary({ lifecycle, health, admission }, s))
      : buildDefaultCanonicalAtlasManifest(type).sectors.map((mSec) => {
          const cap = mSec.kind === 'ocean' ? 0 : mSec.validatedSafeSites;
          return {
            sectorId: mSec.sectorId,
            continentId: mSec.continentId,
            macroQ: mSec.macroQ,
            macroR: mSec.macroR,
            centerQ: mSec.centerQ,
            centerR: mSec.centerR,
            kind: mSec.kind,
            foundingCapacity: mSec.kind === 'ocean' ? 0 : mSec.foundingCapacity,
            validatedCapacity: cap,
            reservedSeats: 0,
            foundedSeats: 0,
            freeSeats: cap,
            livingColonies: null,
            presentColonies: null,
            onlinePlayers: null,
            availability: deriveWorldAvailability({
              lifecycle,
              health,
              admission,
              freeSeats: cap,
              sectorKind: mSec.kind,
            }),
          };
        });

  const landSectors = effectiveSectors.filter((s) => s.kind === 'land');
  const oceanSectors = effectiveSectors.filter((s) => s.kind === 'ocean');
  const nominalCapacity = landSectors.reduce((sum, s) => sum + s.foundingCapacity, 0);
  const validatedCapacity = landSectors.reduce((sum, s) => sum + s.validatedCapacity, 0);
  const reservedSeats = landSectors.reduce((sum, s) => sum + s.reservedSeats, 0);
  const foundedSeats = landSectors.reduce((sum, s) => sum + s.foundedSeats, 0);
  const freeSeats = Math.max(0, validatedCapacity - reservedSeats - foundedSeats);
  const taken = reservedSeats + foundedSeats;
  const stateStr = planetRecord?.status ?? lifecycle;

  return {
    id: world?.id ?? fallbackPlanetId,
    name: world?.name ?? planetRecord?.name ?? canonicalDef.name,
    type,
    look: world?.look ?? planetLookForType(type),
    seed: world?.seed ?? planetRecord?.seed ?? canonicalDef.seed,
    radius: planetRecord?.radius ?? DEV_PLANET_RADIUS,
    state: stateStr,
    status: stateStr,
    lifecycle,
    health,
    admission,
    availability: deriveWorldAvailability({ lifecycle, health, admission, freeSeats }),
    atlasVersion: world?.atlasVersion || 1,
    atlasHash: world?.atlasHash || 'w11-canonical-atlas-v1',
    configHash: world?.configHash || 'w11-canonical-config-v1',
    totalSectors: effectiveSectors.length,
    landSectors: Math.max(1, landSectors.length),
    oceanSectors: oceanSectors.length,
    nominalCapacity,
    validatedCapacity,
    reservedSeats,
    foundedSeats,
    freeSeats,
    livingColonies: foundedSeats > 0 ? foundedSeats : null,
    presentColonies: foundedSeats > 0 ? foundedSeats : null,
    onlinePlayers: null,
    updatedAt: (world?.updatedAt ?? new Date()).toISOString(),
    sectors: effectiveSectors as unknown as Record<string, unknown>[],
    capacity: validatedCapacity,
    seatsTaken: taken,
    seats: { taken, capacity: validatedCapacity },
    ...(world?.faultCode ? { faultCode: world.faultCode } : {}),
  };
}

export async function buildEnrichedPlanetSummary(
  planet: PlanetRecord,
  lobbyPersistence?: LobbyPersistenceService,
): Promise<{ readonly summary: PlanetSummary; readonly world: CanonicalWorldRecord | null }> {
  const world = lobbyPersistence ? await lobbyPersistence.getCanonicalWorldById(planet.id) : null;
  const canonicalDef = canonicalPlanetById(planet.id);
  if (!world && !canonicalDef) {
    return { summary: buildBasicPlanetSummary(planet), world: null };
  }
  const sectors = lobbyPersistence ? await lobbyPersistence.listSectors(planet.id) : [];
  const summary = buildCanonicalPlanetSummary(
    world,
    sectors,
    planet.id,
    world?.type ?? canonicalDef?.type ?? planet.type,
    planet,
  );
  return { summary, world };
}

export async function listCanonicalPlanetSummaries(
  lobbyPersistence?: LobbyPersistenceService,
  alwaysReturnThree = false,
): Promise<PlanetSummary[]> {
  if (!lobbyPersistence && !alwaysReturnThree) return [];
  const worlds = lobbyPersistence ? await lobbyPersistence.listCanonicalWorlds() : [];
  if (worlds.length === 0 && !alwaysReturnThree) return [];

  const types: readonly PlanetType[] = ['desert', 'ocean', 'temperate'];
  const summaries: PlanetSummary[] = [];
  for (const type of types) {
    const def = CANONICAL_PLANETS[type];
    const world = lobbyPersistence
      ? ((await lobbyPersistence.getCanonicalWorldByType(type)) ??
        (await lobbyPersistence.getCanonicalWorldById(def.id)))
      : null;
    const planetId = world?.id ?? def.id;
    const sectors = lobbyPersistence ? await lobbyPersistence.listSectors(planetId) : [];
    summaries.push(buildCanonicalPlanetSummary(world, sectors, planetId, type));
  }
  return summaries;
}

export async function buildQueuedHomeResponse(
  ticket: MatchTicketRecord,
  lobbyPersistence: LobbyPersistenceService,
  worldLifecycle?: WorldLifecycleService,
): Promise<HomeResponse> {
  const sectors = await lobbyPersistence.listSectors(ticket.planetId);
  const alternativeSectors = computeAlternativeSectorsForIntent(sectors, ticket.sectorIntent);
  const queuedOnPlanet =
    ticket.state === 'QUEUED'
      ? await lobbyPersistence.listTickets({ planetId: ticket.planetId, state: 'QUEUED' })
      : [];
  const world = await lobbyPersistence.getCanonicalWorldById(ticket.planetId);
  const paused = (worldLifecycle?.isQueuePaused() ?? false) || world?.admission === 'PAUSED';
  const computed = computeQueuePositionAndEta(ticket, queuedOnPlanet, paused);

  return {
    state: 'QUEUED',
    ticketId: ticket.id,
    ticketState: ticket.state,
    planetId: ticket.planetId,
    planetType: ticket.planetType,
    sectorIntent: ticket.sectorIntent,
    reservedSectorId: ticket.reservedSectorId,
    alternativeSectors,
    position: computed.position ?? ticket.position ?? 0,
    etaS: computed.etaS ?? ticket.etaS ?? null,
  };
}

export async function enrichColonyWithReservation(
  colony: ColonyRecord,
  lobbyPersistence?: LobbyPersistenceService,
): Promise<ColonyRecord> {
  if (!lobbyPersistence) return colony;
  if (colony.landingSlotId && colony.foundingSectorId && colony.foundingSectorId !== 'sec_0_0') {
    return colony;
  }
  const reservations = await lobbyPersistence.listReservations(colony.planetId);
  const matched = reservations.find((r) => r.colonyId === colony.id);
  if (!matched) return colony;
  return {
    ...colony,
    foundingSectorId: matched.sectorId,
    landingSlotId: matched.landingSlotId,
  };
}

export async function findCommittedReservationColony(
  lobbyPersistence: LobbyPersistenceService | undefined,
  playerId: string,
  options?: { readonly colonyId?: string; readonly planetId?: string; readonly handle?: string },
): Promise<{ readonly colony: ColonyRecord; readonly planet: PlanetRecord; readonly reservation: SectorReservationRecord } | null> {
  if (!lobbyPersistence) return null;
  const worlds = await lobbyPersistence.listCanonicalWorlds();
  for (const world of worlds) {
    if (options?.planetId && world.id !== options.planetId) continue;
    const reservations = await lobbyPersistence.listReservations(world.id);
    const committed = reservations.find(
      (r) =>
        r.state === 'COMMITTED' &&
        (options?.colonyId ? r.colonyId === options.colonyId : r.playerId === playerId),
    );
    if (!committed) continue;
    const handle = options?.handle?.trim() || `Colonist-${committed.playerId.slice(-4)}`;
    const colony: ColonyRecord = {
      id: committed.colonyId,
      playerId: committed.playerId,
      planetId: committed.planetId,
      colonyIndex: committed.slotIndex,
      name: `${handle.slice(0, 22)}'s Colony`,
      color: committed.slotIndex,
      status: 'ACTIVE',
      state: 'ACTIVE',
      foundingSectorId: committed.sectorId,
      landingSlotId: committed.landingSlotId,
      recapSeen: false,
      spawnQ: committed.q,
      spawnR: committed.r,
      spawn: { q: committed.q, r: committed.r },
      createdAt: committed.createdAt,
    };
    const planet: PlanetRecord = {
      id: world.id,
      name: world.name,
      type: world.type,
      seed: world.seed,
      radius: DEV_PLANET_RADIUS,
      state: world.lifecycle === 'ARCHIVED' ? 'ENDED' : 'ACTIVE',
      status: world.lifecycle === 'ARCHIVED' ? 'ENDED' : 'ACTIVE',
      capacity: world.capacity || DEV_PLANET_CAPACITY,
      seatsTaken: world.seatsTaken,
      createdAt: world.createdAt,
    };
    return { colony, planet, reservation: committed };
  }
  return null;
}

export function isPlanetEndedOrArchived(
  planet: PlanetRecord,
  world?: CanonicalWorldRecord | null,
): boolean {
  return (
    planet.status === 'ENDED' ||
    planet.status === 'PLANET_ENDED' ||
    planet.state === 'ENDED' ||
    planet.state === 'PLANET_ENDED' ||
    world?.lifecycle === 'ARCHIVED' ||
    world?.admission === 'ARCHIVED'
  );
}

export function buildTerminalHomeResponse(
  kind: 'ELIMINATED' | 'PLANET_ENDED',
  colony: ColonyRecord,
  colonySummary: ColonySummary,
  planetSummary: PlanetSummary,
  planets: PlanetSummary[],
  recapSeen: boolean,
): HomeResponse {
  const foundingSectorId = colony.foundingSectorId ?? 'sec_0_0';
  const newPlanetTypes = planets.length > 0 ? [] : [DEV_PLANET_TYPE];
  if (kind === 'PLANET_ENDED') {
    return {
      state: 'PLANET_ENDED',
      colony: colonySummary,
      planet: planetSummary,
      results: {
        colonyId: colony.id,
        planetId: colony.planetId,
        foundingSectorId,
      },
      recapSeen,
      planets,
      newPlanetTypes,
    };
  }
  return {
    state: 'ELIMINATED',
    colony: colonySummary,
    planet: planetSummary,
    recap: {
      colonyId: colony.id,
      planetId: colony.planetId,
      foundingSectorId,
    },
    recapSeen,
    planets,
    newPlanetTypes,
  };
}
