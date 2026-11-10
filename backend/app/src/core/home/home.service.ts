import { Inject, Injectable, Optional } from '@nestjs/common';
import type { ColonySummary, HomeResponse, PlanetSummary } from '@terra/contracts';
import { DEV_PLANET_TYPE, type DevPlanetType } from '@terra/sim';
import { WorldLifecycleService } from '../../lobby/lifecycle.service';
import { LobbyPersistenceService } from '../../lobby/lobby-persistence.service';
import type { CanonicalWorldRecord } from '../../lobby/lobby-persistence.types';
import { CoreException } from '../errors';
import {
  buildBasicColonySummary,
  buildBasicPlanetSummary,
  buildQueuedHomeResponse,
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
import type { AwayHeadline } from './away-headline';
import type { HardModeHomeClock } from './hard-mode-home';
import { type ColonyRecord, HomeRepository, type PlanetRecord } from './home.repository';
import {
  buildHomeResponseForColony,
  errText,
  markPlanetIndexLanded,
  SEAT_ATTEMPTS,
  SEAT_PLANETS,
  seatNewColony,
  type SeatContext,
} from './parts/home-seating';

export const HOME_SEAT_NOTIFIER = Symbol('HOME_SEAT_NOTIFIER');

export { createSpawnColonyCommand, SEAT_ATTEMPTS, SEAT_PLANETS };
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
  private hardMode: HardModeHomeClock | undefined;
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

  /** Game module wires the dev hard-mode clock after boot. Core does not import it. */
  setHardModeClock(clock: HardModeHomeClock | undefined): void {
    this.hardMode = clock;
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
      return seatNewColony(
        this.seatContext(),
        { id: player.id, handle: player.handle?.trim() || `Colonist-${player.id.slice(-4)}` },
        preferredType ?? DEV_PLANET_TYPE,
      );
    });
  }

  adoptLateLanding(assignment: ColonySeatAssignment): Promise<boolean> {
    return this.withSeatLock(async () => {
      const { player, colony } = assignment;
      if (await this.repo.findLatestColonyByPlayerId(player.id)) {
        markPlanetIndexLanded(this.landedIndices, colony.planetId, colony.colonyIndex);
        return false;
      }
      await this.repo.createColony({ ...colony });
      return true;
    });
  }

  private seatContext(): SeatContext {
    return {
      repo: this.repo,
      exhausted: this.exhausted,
      landedIndices: this.landedIndices,
      recapSeenPlayerIds: this.recapSeenPlayerIds,
      landingHost: this.landingHost,
      notifier: this.notifier,
      seatListeners: this.seatListeners,
      buildHomeResponse: (col, pl, canonical) => this.buildHomeResponseAsync(col, pl, canonical),
    };
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

  private buildHomeResponseAsync(
    colony: ColonyRecord,
    planet: PlanetRecord,
    alwaysIncludeCanonicalPlanets: boolean,
  ): Promise<HomeResponse> {
    return buildHomeResponseForColony({
      colony,
      colonySummary: toColonySummary(colony),
      planet,
      alwaysIncludeCanonicalPlanets,
      recapSeen: this.isRecapSeenFor(colony.playerId, colony),
      lobbyPersistence: this.lobbyPersistence,
      hardMode: this.hardMode,
      awayHeadline: this.awayHeadline,
    });
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
