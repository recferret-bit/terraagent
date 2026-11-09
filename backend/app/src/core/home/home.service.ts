import { Inject, Injectable, Optional } from '@nestjs/common';
import type { ColonySummary, HomeResponse, PlanetSummary } from '@terra/contracts';
import { DEV_PLANET_TYPE, type DevPlanetType } from '@terra/sim';
import { WorldLifecycleService } from '../../lobby/lifecycle.service';
import { LobbyPersistenceService } from '../../lobby/lobby-persistence.service';
import type { CanonicalWorldRecord } from '../../lobby/lobby-persistence.types';
import { CoreConflict, CoreException } from '../errors';
import {
  buildBasicColonySummary,
  buildBasicPlanetSummary,
  buildEnrichedPlanetSummary,
  buildQueuedHomeResponse,
  buildTerminalHomeResponse,
  createSpawnColonyCommand,
  enrichColonyWithReservation,
  findCommittedReservationColony,
  isPlanetEndedOrArchived,
  listCanonicalPlanetSummaries,
  type ColonySeatAssignment,
  type ColonySeatListener,
  type HomeLandingHost,
  type HomeLandingSite,
  type HomeSeatNotifier,
  type ResolveHomeOptions,
  type SeatSlot,
} from './home-resolve.helpers';
import { attachAwaySummary, type AwayHeadline } from './away-headline';
import { type ColonyRecord, HomeRepository, type PlanetRecord } from './home.repository';

export const HOME_SEAT_NOTIFIER = Symbol('HOME_SEAT_NOTIFIER');

export { createSpawnColonyCommand };
export type {
  ColonySeatAssignment,
  ColonySeatListener,
  HomeLandingHost,
  HomeLandingSite,
  HomeSeatNotifier,
  ResolveHomeOptions,
  SeatSlot,
};

export function toColonySummary(colony: ColonyRecord): ColonySummary {
  return buildBasicColonySummary(colony);
}

export function toPlanetSummary(planet: PlanetRecord): PlanetSummary {
  return buildBasicPlanetSummary(planet);
}

/** Landing attempts per `getOrAssignHome` (each asks a planet's sim for a site, seats there or moves on). */
export const SEAT_ATTEMPTS = 8;
/** Planets tried per `getOrAssignHome`: one whose sim has no landing site left is marked and the next of its family tried. */
export const SEAT_PLANETS = 2;

const NO_SITE_CODES: readonly string[] = ['landing_site_taken', 'planet_full'];
type SeatMiss = 'no_site' | 'index_landed' | 'retry';

function isSeatRejected(e: unknown, code: string): boolean {
  if (!(e instanceof CoreException) || e.errorCode !== 'COLONY_SEAT_REJECTED') return false;
  return (e.details as { code?: unknown } | undefined)?.code === code;
}

function noLandingSite(planetIds: readonly string[]): CoreConflict {
  return new CoreConflict('COLONY_SEAT_REJECTED', {
    message: `no landing site left on ${planetIds.join(', ')}: their sims have no free landing site`,
    details: { code: 'landing_site_taken', planetIds },
  });
}

function hostUnavailable(planetId: string, message: string, cause?: string): CoreConflict {
  return new CoreConflict('COLONY_SEAT_REJECTED', {
    message,
    details: { code: 'host_unavailable', planetId, ...(cause ? { cause } : {}) },
  });
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

@Injectable()
export class HomeService {
  private readonly exhausted = new Set<string>();
  private readonly landedIndices = new Map<string, Set<number>>();
  private readonly seatListeners = new Set<ColonySeatListener>();
  private readonly recapSeenColonyIds = new Set<string>();
  private readonly recapSeenPlayerIds = new Set<string>();
  private readonly colonyStatusOverrides = new Map<string, string>();
  private landingHost: HomeLandingHost | undefined;
  private awayHeadline: AwayHeadline | undefined;
  private seatChain: Promise<void> = Promise.resolve();

  constructor(
    @Inject(HomeRepository) private readonly repo: HomeRepository,
    @Optional() @Inject(HOME_SEAT_NOTIFIER) private readonly notifier?: HomeSeatNotifier,
    @Optional() @Inject(LobbyPersistenceService) private lobbyPersistence?: LobbyPersistenceService,
    @Optional() @Inject(WorldLifecycleService) private worldLifecycle?: WorldLifecycleService,
  ) {}

  setLobbyServices(
    lobbyPersistence?: LobbyPersistenceService,
    worldLifecycle?: WorldLifecycleService,
  ): void {
    if (lobbyPersistence) this.lobbyPersistence = lobbyPersistence;
    if (worldLifecycle) this.worldLifecycle = worldLifecycle;
  }

  onColonySeated(listener: ColonySeatListener): () => void {
    this.seatListeners.add(listener);
    return () => {
      this.seatListeners.delete(listener);
    };
  }

  setLandingHost(host: HomeLandingHost | undefined): void {
    this.landingHost = host;
  }

  /** Game module wires this after boot. Core does not import the digest service. */
  setAwayHeadline(source: AwayHeadline | undefined): void {
    this.awayHeadline = source;
  }

  async setColonyStatus(colonyId: string, status: string): Promise<ColonyRecord | null> {
    this.colonyStatusOverrides.set(colonyId, status);
    if (status === 'ELIMINATED') this.recapSeenColonyIds.delete(colonyId);
    return this.repo.setColonyStatus(colonyId, status);
  }

  async setPlanetStatus(planetId: string, status: string): Promise<PlanetRecord | null> {
    return this.repo.setPlanetStatus(planetId, status);
  }

  async markRecapSeen(playerId: string, colonyId?: string): Promise<ColonyRecord | null> {
    this.recapSeenPlayerIds.add(playerId);
    if (colonyId) this.recapSeenColonyIds.add(colonyId);
    const updated = await this.repo.markRecapSeen(playerId, colonyId);
    if (updated) this.recapSeenColonyIds.add(updated.id);
    return updated;
  }

  async getExistingHome(playerId: string, planetId?: string): Promise<HomeResponse | null> {
    if (planetId) {
      const repoCol = await this.repo.findColonyByPlayerAndPlanet(playerId, planetId);
      if (repoCol) {
        const enriched = await enrichColonyWithReservation(repoCol, this.lobbyPersistence);
        const planet = (await this.repo.findPlanetById(planetId)) ?? (await this.repo.upsertDevPlanet(planetId));
        return this.buildHomeResponseAsync(enriched, planet, false);
      }
      const committed = await findCommittedReservationColony(this.lobbyPersistence, playerId, { planetId });
      if (committed) {
        return this.buildHomeResponseAsync(this.applyOverrides(committed.colony), committed.planet, false);
      }
      return null;
    }

    const found = await this.existingColony(playerId);
    if (found && found.colony.status === 'ACTIVE' && !isPlanetEndedOrArchived(found.planet, found.world)) {
      return this.buildHomeResponseAsync(found.colony, found.planet, false);
    }
    const activeTicket = await this.lobbyPersistence?.findActiveTicketByPlayer(playerId);
    if (activeTicket && this.lobbyPersistence) {
      return buildQueuedHomeResponse(activeTicket, this.lobbyPersistence, this.worldLifecycle);
    }
    if (found) {
      if (this.isRecapSeenFor(playerId, found.colony)) {
        return this.resolveHome({ id: playerId });
      }
      return this.buildHomeResponseAsync(found.colony, found.planet, false);
    }
    return null;
  }

  async resumeColony(playerId: string, colonyId: string): Promise<HomeResponse> {
    let colony = await this.repo.findColonyById(colonyId);
    let planet = colony && colony.playerId === playerId ? await this.repo.findPlanetById(colony.planetId) : null;
    if (!colony) {
      const committed = await findCommittedReservationColony(this.lobbyPersistence, playerId, { colonyId });
      if (committed && committed.colony.playerId === playerId) {
        colony = this.applyOverrides(committed.colony);
        planet = committed.planet;
      }
    } else {
      colony = await enrichColonyWithReservation(this.applyOverrides(colony), this.lobbyPersistence);
    }

    const world = colony && this.lobbyPersistence ? await this.lobbyPersistence.getCanonicalWorldById(colony.planetId) : null;
    if (
      !colony ||
      !planet ||
      colony.playerId !== playerId ||
      colony.status !== 'ACTIVE' ||
      isPlanetEndedOrArchived(planet, world)
    ) {
      throw new CoreException('COLONY_UNAVAILABLE', {
        status: 404,
        message: 'This colony is unavailable. Return to your pilot page to choose an active colony.',
      });
    }
    return this.answerExisting(colony, planet, false);
  }

  /**
   * W11-20 `resolveHome`: pure home state machine over live colony, active queue ticket,
   * unseen elimination/planet-end recap, or `NEW` player with all three canonical worlds.
   */
  async resolveHome(
    player: string | { readonly id: string; readonly handle?: string },
    opts?: ResolveHomeOptions,
  ): Promise<HomeResponse> {
    const playerId = typeof player === 'string' ? player : player.id;
    const handle = typeof player === 'string' ? undefined : player.handle;
    if (opts?.colonyId) return this.resumeColony(playerId, opts.colonyId);

    const existing = await this.existingColony(playerId, handle);
    if (existing && existing.colony.status === 'ACTIVE' && !isPlanetEndedOrArchived(existing.planet, existing.world)) {
      return this.answerExisting(existing.colony, existing.planet, true);
    }

    const activeTicket = await this.lobbyPersistence?.findActiveTicketByPlayer(playerId);
    if (activeTicket && this.lobbyPersistence) {
      return buildQueuedHomeResponse(activeTicket, this.lobbyPersistence, this.worldLifecycle);
    }

    if (existing && !this.isRecapSeenFor(playerId, existing.colony)) {
      return this.buildHomeResponseAsync(existing.colony, existing.planet, true);
    }

    if (opts?.autoSeatDev === true) {
      return this.getOrAssignHome({ id: playerId, handle }, opts.preferredType);
    }

    const planets = await listCanonicalPlanetSummaries(this.lobbyPersistence, true);
    return {
      state: 'NEW',
      planets,
      newPlanetTypes: [],
      queuePaused: this.worldLifecycle?.isQueuePaused() ?? false,
    };
  }

  async getOrAssignHome(player: { id: string; handle?: string }, preferredType?: DevPlanetType): Promise<HomeResponse> {
    const existing = await this.existingColony(player.id, player.handle);
    if (existing && existing.colony.status === 'ACTIVE' && !isPlanetEndedOrArchived(existing.planet, existing.world)) {
      return this.answerExisting(existing.colony, existing.planet, false);
    }

    const activeTicket = await this.lobbyPersistence?.findActiveTicketByPlayer(player.id);
    if (activeTicket && this.lobbyPersistence) {
      return buildQueuedHomeResponse(activeTicket, this.lobbyPersistence, this.worldLifecycle);
    }

    if (existing) {
      if (this.isRecapSeenFor(player.id, existing.colony)) {
        return this.resolveHome(player);
      }
      return this.answerExisting(existing.colony, existing.planet, false);
    }

    return this.withSeatLock(async () => {
      const recheckTicket = await this.lobbyPersistence?.findActiveTicketByPlayer(player.id);
      if (recheckTicket && this.lobbyPersistence) {
        return buildQueuedHomeResponse(recheckTicket, this.lobbyPersistence, this.worldLifecycle);
      }
      const recheck = await this.existingColony(player.id, player.handle);
      if (recheck) {
        if (recheck.colony.status !== 'ACTIVE' && this.isRecapSeenFor(player.id, recheck.colony)) {
          return this.resolveHome(player);
        }
        return this.answerExisting(recheck.colony, recheck.planet, false);
      }
      return this.seatNew(
        { id: player.id, handle: player.handle?.trim() || `Colonist-${player.id.slice(-4)}` },
        preferredType ?? DEV_PLANET_TYPE,
      );
    });
  }

  private isRecapSeenFor(playerId: string, colony: ColonyRecord): boolean {
    return (
      Boolean(colony.recapSeen) ||
      this.recapSeenColonyIds.has(colony.id) ||
      this.recapSeenPlayerIds.has(playerId)
    );
  }

  private applyOverrides(colony: ColonyRecord): ColonyRecord {
    const overriddenStatus = this.colonyStatusOverrides.get(colony.id);
    const recapSeen = this.isRecapSeenFor(colony.playerId, colony);
    return {
      ...colony,
      ...(overriddenStatus ? { status: overriddenStatus, state: overriddenStatus } : {}),
      recapSeen,
    };
  }

  private async existingColony(
    playerId: string,
    handle?: string,
  ): Promise<{ colony: ColonyRecord; planet: PlanetRecord; world: CanonicalWorldRecord | null } | null> {
    const repoColony = await this.repo.findLatestColonyByPlayerId(playerId);
    if (repoColony) {
      const enriched = await enrichColonyWithReservation(this.applyOverrides(repoColony), this.lobbyPersistence);
      const planet =
        (await this.repo.findPlanetById(enriched.planetId)) ??
        (await this.repo.upsertDevPlanet(enriched.planetId));
      const world = this.lobbyPersistence ? await this.lobbyPersistence.getCanonicalWorldById(planet.id) : null;
      return { colony: enriched, planet, world };
    }
    const committed = await findCommittedReservationColony(this.lobbyPersistence, playerId, { handle });
    if (committed) {
      const world = this.lobbyPersistence ? await this.lobbyPersistence.getCanonicalWorldById(committed.planet.id) : null;
      return { colony: this.applyOverrides(committed.colony), planet: committed.planet, world };
    }
    return null;
  }

  private async answerExisting(
    colony: ColonyRecord,
    planet: PlanetRecord,
    alwaysIncludeCanonicalPlanets: boolean,
  ): Promise<HomeResponse> {
    const home = await this.buildHomeResponseAsync(colony, planet, alwaysIncludeCanonicalPlanets);
    if (home.state !== 'ACTIVE' || !this.landingHost) return home;
    try {
      await this.landingHost.ensureHomeLoaded(planet, () => this.repo.listColoniesByPlanetId(planet.id));
    } catch (e) {
      throw new CoreException('HOME_UNAVAILABLE', {
        status: 503,
        message: `home planet ${planet.id} cannot be loaded: ${errText(e)}`,
        details: { planetId: planet.id },
      });
    }
    return home;
  }

  private async seatNew(player: { id: string; handle: string }, type: DevPlanetType): Promise<HomeResponse> {
    const tried: string[] = [];
    for (let attempt = 0; attempt < SEAT_ATTEMPTS; attempt++) {
      const { planet, colonyIndex } = await this.repo.findOrCreateOpenDevPlanet(type, this.exhausted, this.landedIndices);
      if (!tried.includes(planet.id)) {
        if (tried.length >= SEAT_PLANETS) break;
        tried.push(planet.id);
      }
      const out = await this.seatOnPlanet(player, planet, colonyIndex);
      if (typeof out === 'object') return out;
      if (out === 'no_site') this.exhausted.add(planet.id);
      else if (out === 'index_landed') this.markLanded(planet.id, colonyIndex);
    }
    throw noLandingSite(tried);
  }

  private async seatOnPlanet(
    player: { id: string; handle: string },
    openPlanet: PlanetRecord,
    colonyIndex: number,
  ): Promise<HomeResponse | SeatMiss> {
    const site = await this.askLandingSite(openPlanet, colonyIndex);
    if (!site.ok) {
      if (site.code === 'already_landed') return 'index_landed';
      if (NO_SITE_CODES.includes(site.code)) return 'no_site';
      throw hostUnavailable(
        openPlanet.id,
        `planet ${openPlanet.id} has no landing site for colony ${colonyIndex}: ${site.code}`,
        site.code,
      );
    }
    this.recapSeenPlayerIds.delete(player.id);
    const { colony, planet } = await this.repo.createColony({
      playerId: player.id,
      planetId: openPlanet.id,
      colonyIndex,
      name: `${player.handle.slice(0, 22)}'s Colony`,
      color: colonyIndex,
      status: 'ACTIVE',
      foundingSectorId: site.sectorId ?? 'sec_0_0',
      landingSlotId: site.landingSlotId ?? null,
      spawnQ: site.q,
      spawnR: site.r,
    });
    try {
      await this.notifySeated({
        player,
        colony,
        planet,
        slot: {
          index: site.slotIndex ?? colonyIndex,
          q: site.q,
          r: site.r,
          ...(site.sectorId ? { sectorId: site.sectorId } : {}),
          ...(site.landingSlotId ? { landingSlotId: site.landingSlotId } : {}),
        },
      });
      return this.buildHomeResponseAsync(colony, planet, false);
    } catch (e) {
      if (isSeatRejected(e, 'already_landed')) return 'index_landed';
      if (isSeatRejected(e, 'landing_site_taken')) return 'retry';
      if (isSeatRejected(e, 'planet_full')) return 'no_site';
      throw e;
    }
  }

  private async askLandingSite(planet: PlanetRecord, colonyIndex: number): Promise<HomeLandingSite> {
    if (!this.landingHost) throw hostUnavailable(planet.id, `no game host to land a colony on ${planet.id}`);
    try {
      return await this.landingHost.landingSite(planet, colonyIndex);
    } catch (e) {
      throw hostUnavailable(planet.id, `planet ${planet.id} cannot be asked for a landing site: ${errText(e)}`);
    }
  }

  private markLanded(planetId: string, colonyIndex: number): void {
    let set = this.landedIndices.get(planetId);
    if (!set) this.landedIndices.set(planetId, (set = new Set()));
    set.add(colonyIndex);
  }

  adoptLateLanding(assignment: ColonySeatAssignment): Promise<boolean> {
    return this.withSeatLock(async () => {
      const { player, colony } = assignment;
      if (await this.repo.findLatestColonyByPlayerId(player.id)) {
        this.markLanded(colony.planetId, colony.colonyIndex);
        return false;
      }
      await this.repo.createColony({ ...colony });
      return true;
    });
  }

  private async notifySeated(assignment: ColonySeatAssignment): Promise<void> {
    try {
      if (this.notifier) await this.notifier.onColonySeated(assignment);
      for (const listener of this.seatListeners) await listener(assignment);
    } catch (e) {
      await this.repo.deleteColony(assignment.colony.id).catch(() => undefined);
      throw e;
    }
  }

  private async buildHomeResponseAsync(
    colony: ColonyRecord,
    planet: PlanetRecord,
    alwaysIncludeCanonicalPlanets: boolean,
  ): Promise<HomeResponse> {
    const colonySummary = toColonySummary(colony);
    const { summary: planetSummary, world } = await buildEnrichedPlanetSummary(planet, this.lobbyPersistence);
    const recapSeen = this.isRecapSeenFor(colony.playerId, colony);

    if (isPlanetEndedOrArchived(planet, world)) {
      const planets = await listCanonicalPlanetSummaries(this.lobbyPersistence, alwaysIncludeCanonicalPlanets);
      return buildTerminalHomeResponse('PLANET_ENDED', colony, colonySummary, planetSummary, planets, recapSeen);
    }

    if (colony.status === 'ELIMINATED' || colony.state === 'ELIMINATED') {
      const planets = await listCanonicalPlanetSummaries(this.lobbyPersistence, alwaysIncludeCanonicalPlanets);
      return buildTerminalHomeResponse('ELIMINATED', colony, colonySummary, planetSummary, planets, recapSeen);
    }

    return attachAwaySummary(
      { state: 'ACTIVE', colony: colonySummary, planet: planetSummary },
      this.awayHeadline,
    );
  }

  private withSeatLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.seatChain.then(fn, fn);
    this.seatChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}
