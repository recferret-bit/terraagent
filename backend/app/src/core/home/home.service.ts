import { Inject, Injectable, Optional } from '@nestjs/common';
import type { ColonySummary, HomeResponse, PlanetSummary } from '@terra/contracts';
import { DEV_PLANET_TYPE, type DevPlanetType } from '@terra/sim';
import { WorldLifecycleService } from '../../lobby/lifecycle.service';
import { devPlayerId } from '../../ws/session-verifier';
import { APP_ENV, type AppEnv } from '../tokens';
import { LobbyPersistenceService } from '../../lobby/lobby-persistence.service';
import type { CanonicalWorldRecord } from '../../lobby/lobby-persistence.types';
import { normalizeColonyStatus, SectorAntiCheatService } from '../anticheat';
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
  askHostLandingSite,
  assertNewHomeJoinSpace,
  notifyColonySeated,
  assertRequestedHomeLocation,
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
    @Optional() @Inject(SectorAntiCheatService) private readonly antiCheat?: SectorAntiCheatService,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
  ) {
    this.antiCheat?.setLobbyPersistence(this.lobbyPersistence);
  }

  setLobbyServices(
    lobbyPersistence?: LobbyPersistenceService,
    worldLifecycle?: WorldLifecycleService,
  ): void {
    if (lobbyPersistence) {
      this.lobbyPersistence = lobbyPersistence;
      this.antiCheat?.setLobbyPersistence(lobbyPersistence);
    }
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
    this.antiCheat?.recordColonyStatus(colonyId, status);
    if (status === 'ELIMINATED') this.recapSeenColonyIds.delete(colonyId);
    return this.repo.setColonyStatus(colonyId, status);
  }

  async setPlanetStatus(planetId: string, status: string): Promise<PlanetRecord | null> {
    this.antiCheat?.recordPlanetStatus(planetId, status);
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
        const enriched = await enrichColonyWithReservation(this.applyOverrides(repoCol), this.lobbyPersistence);
        const rawPlanet = (await this.repo.findPlanetById(planetId)) ?? (await this.repo.upsertDevPlanet(planetId));
        const planet = this.applyPlanetOverrides(rawPlanet);
        this.antiCheat?.recordColonyBase(enriched, planet);
        return this.buildHomeResponseAsync(enriched, planet, false);
      }
      const committed = await findCommittedReservationColony(this.lobbyPersistence, playerId, { planetId });
      if (committed) {
        const col = this.applyOverrides(committed.colony);
        const planet = this.applyPlanetOverrides(committed.planet);
        this.antiCheat?.recordColonyBase(col, planet);
        return this.buildHomeResponseAsync(col, planet, false);
      }
      return null;
    }

    const found = await this.existingColony(playerId);
    if (found && found.colony.status === 'ACTIVE' && !isPlanetEndedOrArchived(found.planet, found.world)) {
      this.antiCheat?.recordColonyBase(found.colony, found.planet);
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

  async resumeColony(
    playerId: string,
    colonyId: string,
    requestedSectorId?: string,
    requestedPlanetId?: string,
  ): Promise<HomeResponse> {
    let colony = await this.repo.findColonyById(colonyId);
    if (!colony && this.isNonProduction() && colonyId === 'co_w12_live_1') {
      colony = await this.materializeW12LiveColony(playerId, colonyId, requestedSectorId);
    }
    if (
      colony &&
      colony.playerId !== playerId &&
      this.isNonProduction() &&
      (colony.id === 'co_w12_live_1' || colony.playerId.startsWith('pr_dev_') || colony.playerId === devPlayerId('w12'))
    ) {
      this.antiCheat?.recordColonyRemoved(colony.id);
      colony = (await this.repo.reassignColonyPlayer(colony.id, playerId)) ?? colony;
    }
    let rawPlanet: PlanetRecord | null = null;
    if (!colony) {
      const committed = await findCommittedReservationColony(this.lobbyPersistence, playerId, { colonyId });
      if (committed && committed.colony.playerId === playerId) {
        colony = this.applyOverrides(committed.colony);
        rawPlanet = committed.planet;
      }
    } else {
      colony = await enrichColonyWithReservation(this.applyOverrides(colony), this.lobbyPersistence);
      if (colony.playerId === playerId) {
        rawPlanet =
          (await this.repo.findPlanetById(colony.planetId)) ??
          (await this.repo.upsertDevPlanet(
            colony.planetId,
            colony.planetId === 'pl_w12_forest'
              ? { name: 'Sylva Reach', type: 'temperate', seed: 'w12-profile-achievements', state: 'ACTIVE' }
              : {},
          ));
      }
    }
    const planet = rawPlanet ? this.applyPlanetOverrides(rawPlanet) : null;

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
    this.antiCheat?.recordColonyBase(colony, planet);
    return assertRequestedHomeLocation(
      await this.answerExisting(colony, planet, false),
      this.antiCheat,
      requestedSectorId,
      requestedPlanetId,
    );
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
    if (opts?.colonyId) return this.resumeColony(playerId, opts.colonyId, opts.sectorId, opts.planetId);

    const existing = await this.existingColony(playerId, handle);
    if (existing && existing.colony.status === 'ACTIVE' && !isPlanetEndedOrArchived(existing.planet, existing.world)) {
      this.antiCheat?.recordColonyBase(existing.colony, existing.planet);
      return assertRequestedHomeLocation(
        await this.answerExisting(existing.colony, existing.planet, true),
        this.antiCheat,
        opts?.sectorId,
        opts?.planetId,
      );
    }

    assertRequestedHomeLocation(
      { state: 'NEW', planets: [], newPlanetTypes: [] },
      this.antiCheat,
      opts?.sectorId,
      opts?.planetId,
    );

    const activeTicket = await this.lobbyPersistence?.findActiveTicketByPlayer(playerId);
    if (activeTicket && this.lobbyPersistence) {
      return buildQueuedHomeResponse(activeTicket, this.lobbyPersistence, this.worldLifecycle);
    }

    if (existing && !this.isRecapSeenFor(playerId, existing.colony)) {
      return this.buildHomeResponseAsync(existing.colony, existing.planet, true);
    }

    if (opts?.autoSeatDev === true) {
      return this.getOrAssignHome({ id: playerId, handle }, opts.preferredType, opts.sectorId, opts.planetId);
    }

    const planets = await listCanonicalPlanetSummaries(this.lobbyPersistence, true);
    return {
      state: 'NEW',
      planets,
      newPlanetTypes: [],
      queuePaused: this.worldLifecycle?.isQueuePaused() ?? false,
    };
  }

  async getOrAssignHome(
    player: { id: string; handle?: string },
    preferredType?: DevPlanetType,
    requestedSectorId?: string,
    requestedPlanetId?: string,
  ): Promise<HomeResponse> {
    const existing = await this.existingColony(player.id, player.handle);
    if (existing && existing.colony.status === 'ACTIVE' && !isPlanetEndedOrArchived(existing.planet, existing.world)) {
      this.antiCheat?.recordColonyBase(existing.colony, existing.planet);
      return assertRequestedHomeLocation(
        await this.answerExisting(existing.colony, existing.planet, false),
        this.antiCheat,
        requestedSectorId,
        requestedPlanetId,
      );
    }

    const activeTicket = await this.lobbyPersistence?.findActiveTicketByPlayer(player.id);
    if (activeTicket && this.lobbyPersistence) {
      assertRequestedHomeLocation(
        { state: 'NEW', planets: [], newPlanetTypes: [] },
        this.antiCheat,
        requestedSectorId,
        requestedPlanetId,
      );
      return buildQueuedHomeResponse(activeTicket, this.lobbyPersistence, this.worldLifecycle);
    }

    if (existing) {
      if (this.isRecapSeenFor(player.id, existing.colony)) {
        return this.resolveHome(player);
      }
      return this.answerExisting(existing.colony, existing.planet, false);
    }

    const resolvedType = preferredType ?? DEV_PLANET_TYPE;
    await assertNewHomeJoinSpace({
      antiCheat: this.antiCheat,
      playerId: player.id,
      preferredType: resolvedType,
      requestedSectorId,
      requestedPlanetId,
    });

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
        this.antiCheat?.recordColonyBase(recheck.colony, recheck.planet);
        return assertRequestedHomeLocation(
          await this.answerExisting(recheck.colony, recheck.planet, false),
          this.antiCheat,
          requestedSectorId,
          requestedPlanetId,
        );
      }
      await assertNewHomeJoinSpace({
        antiCheat: this.antiCheat,
        playerId: player.id,
        preferredType: resolvedType,
        requestedSectorId,
        requestedPlanetId,
      });
      return seatNewColony(
        this.seatContext(),
        { id: player.id, handle: player.handle?.trim() || `Colonist-${player.id.slice(-4)}` },
        resolvedType,
        requestedSectorId?.trim() || undefined,
        requestedPlanetId?.trim() || undefined,
      );
    });
  }

  adoptLateLanding(assignment: ColonySeatAssignment): Promise<boolean> {
    return this.withSeatLock(async () => {
      const { player, colony, planet } = assignment;
      if (await this.repo.findLatestColonyByPlayerId(player.id)) {
        markPlanetIndexLanded(this.landedIndices, colony.planetId, colony.colonyIndex);
        return false;
      }
      const created = await this.repo.createColony({ ...colony });
      this.antiCheat?.recordColonyBase(created.colony, planet, true);
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
      antiCheat: this.antiCheat,
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
    const liveBinding =
      this.antiCheat?.index.getColonyById(colony.id) ??
      this.antiCheat?.index.getColonyByPlanetIndex(colony.planetId, colony.colonyIndex);
    const liveTerminal =
      liveBinding?.terminalFromLive && liveBinding.status !== 'ACTIVE' ? liveBinding.status : undefined;
    const overriddenStatus = this.colonyStatusOverrides.get(colony.id) ?? liveTerminal;
    const recapSeen = this.isRecapSeenFor(colony.playerId, colony);
    const liveSector =
      liveBinding?.baseSectorId && liveBinding.baseSectorId !== 'sec_0_0' && (!colony.foundingSectorId || colony.foundingSectorId === 'sec_0_0')
        ? liveBinding.baseSectorId
        : undefined;
    return {
      ...colony,
      ...(overriddenStatus ? { status: overriddenStatus, state: overriddenStatus } : {}),
      ...(liveSector ? { foundingSectorId: liveSector } : {}),
      recapSeen,
    };
  }

  private applyPlanetOverrides(planet: PlanetRecord): PlanetRecord {
    const livePlanet = this.antiCheat?.index.getPlanet(planet.id);
    if (livePlanet && (livePlanet.status === 'ENDED' || livePlanet.status === 'ARCHIVED') && planet.status !== 'ENDED' && planet.status !== 'PLANET_ENDED') {
      return { ...planet, status: 'ENDED', state: 'ENDED' };
    }
    return planet;
  }

  private async existingColony(
    playerId: string,
    handle?: string,
  ): Promise<{ colony: ColonyRecord; planet: PlanetRecord; world: CanonicalWorldRecord | null } | null> {
    const repoColony = await this.repo.findLatestColonyByPlayerId(playerId);
    const enriched = repoColony
      ? await enrichColonyWithReservation(this.applyOverrides(repoColony), this.lobbyPersistence)
      : null;
    if (!enriched || normalizeColonyStatus(enriched.status) !== 'ACTIVE') {
      const committed = await findCommittedReservationColony(this.lobbyPersistence, playerId, { handle });
      if (committed) {
        const col = this.applyOverrides(committed.colony);
        const planet = this.applyPlanetOverrides(committed.planet);
        const world = this.lobbyPersistence ? await this.lobbyPersistence.getCanonicalWorldById(planet.id) : null;
        if (!enriched || (normalizeColonyStatus(col.status) === 'ACTIVE' && !isPlanetEndedOrArchived(planet, world))) {
          return { colony: col, planet, world };
        }
      }
    }
    if (!enriched) return null;
    const rawPlanet =
      (await this.repo.findPlanetById(enriched.planetId)) ??
      (await this.repo.upsertDevPlanet(enriched.planetId));
    const planet = this.applyPlanetOverrides(rawPlanet);
    const world = this.lobbyPersistence ? await this.lobbyPersistence.getCanonicalWorldById(planet.id) : null;
    return { colony: enriched, planet, world };
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

  private isNonProduction(): boolean {
    return (this.env?.NODE_ENV ?? process.env.NODE_ENV) !== 'production';
  }

  private async materializeW12LiveColony(
    playerId: string,
    colonyId: string,
    requestedSectorId?: string,
  ): Promise<ColonyRecord | null> {
    const w12Planet = await this.repo.upsertDevPlanet('pl_w12_forest', {
      name: 'Sylva Reach',
      type: 'temperate',
      seed: 'w12-profile-achievements',
      state: 'ACTIVE',
    });
    const slot = await this.repo.findFreeSlotOnPlanet(w12Planet.id);
    const colonyIndex = slot?.colonyIndex ?? 0;
    let spawnQ = 0;
    let spawnR = 0;
    let landingSlotId: string | null = null;
    let foundingSectorId = requestedSectorId?.trim() || 'sec_0_0';
    if (this.landingHost) {
      const site = await askHostLandingSite(this.landingHost, w12Planet, colonyIndex, requestedSectorId);
      if (site.ok) {
        spawnQ = site.q;
        spawnR = site.r;
        landingSlotId = site.landingSlotId ?? null;
        if (!requestedSectorId?.trim() && site.sectorId) foundingSectorId = site.sectorId;
      }
    }
    try {
      const created = await this.repo.createColony({
        id: colonyId,
        playerId,
        planetId: w12Planet.id,
        colonyIndex,
        name: 'Aegis Basin',
        color: colonyIndex,
        status: 'ACTIVE',
        foundingSectorId,
        landingSlotId,
        spawnQ,
        spawnR,
      });
      this.antiCheat?.recordColonyBase(created.colony, created.planet, true);
      await notifyColonySeated(
        this.repo,
        this.notifier,
        this.seatListeners,
        {
          player: { id: playerId, handle: 'Aegis' },
          colony: created.colony,
          planet: created.planet,
          slot: {
            index: colonyIndex,
            q: spawnQ,
            r: spawnR,
            ...(foundingSectorId ? { sectorId: foundingSectorId } : {}),
            ...(landingSlotId ? { landingSlotId } : {}),
          },
        },
        this.antiCheat,
      );
      return created.colony;
    } catch (err) {
      const existing = await this.repo.findColonyById(colonyId);
      if (existing) return existing;
      throw err;
    }
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
