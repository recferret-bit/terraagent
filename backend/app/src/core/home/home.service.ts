import { Inject, Injectable, Optional } from '@nestjs/common';
import type { ColonySummary, HomeResponse, PlanetSummary } from '@terra/contracts';
import { DEV_PLANET_TYPE, type DevPlanetType } from '@terra/sim';
import { WorldLifecycleService } from '../../lobby/lifecycle.service';
import { LobbyPersistenceService } from '../../lobby/lobby-persistence.service';
import { SectorAntiCheatService } from '../anticheat';
import { CoreException } from '../errors';
import { APP_ENV, type AppEnv } from '../tokens';
import {
  buildBasicColonySummary,
  buildBasicPlanetSummary,
  buildQueuedHomeResponse,
  createSpawnColonyCommand,
  listCanonicalPlanetSummaries,
  type ColonySeatAssignment,
  type ColonySeatListener,
  type HomeLandingHost,
  type HomeLandingSite,
  type HomeSeatNotifier,
  type ResolveHomeOptions,
  type SeatSlot,
} from './home-resolve.helpers';
import { ColonySlotAllowanceService } from './colony-slot-allowance.service';
import type { AwayHeadline } from './away-headline';
import type { HardModeHomeClock } from './hard-mode-home';
import { type ColonyRecord, HomeRepository, type PlanetRecord } from './home.repository';
import {
  adoptLateLandingHelper,
  assertNewColonyAllowed,
  attachHomeColonyRoster,
  collectActiveColonyBundles,
  matchActiveBundle,
  type ActiveColonyBundle,
} from './parts/home-multi-colony';
import {
  assertNewHomeJoinSpace,
  assertRequestedHomeLocation,
  buildHomeResponseForColony,
  errText,
  SEAT_ATTEMPTS,
  SEAT_PLANETS,
  type SeatContext,
} from './parts/home-seating';
import {
  checkLockedSeatAssignShortCircuit,
  checkPreSeatAssignShortCircuit,
  findLatestColonyWithPlanet,
  getExistingHomeHelper,
  materializeW12LiveColonyHelper,
  resumeColonyHelper,
  type HomeServiceLookupDeps,
} from './parts/home-service-ops';
import { admitCapacityQueued, isCapacityTicket, seatFreshColony, type CapacitySeatDeps, type PlanetCapacityGate } from './parts/capacity-seat';

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

export function toColonySummary(colony: ColonyRecord): ColonySummary { return buildBasicColonySummary(colony); }
export function toPlanetSummary(planet: PlanetRecord): PlanetSummary { return buildBasicPlanetSummary(planet); }

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
  private capacity: PlanetCapacityGate | undefined;
  private seatChain: Promise<void> = Promise.resolve();

  constructor(
    @Inject(HomeRepository) private readonly repo: HomeRepository,
    @Optional() @Inject(HOME_SEAT_NOTIFIER) private readonly notifier?: HomeSeatNotifier,
    @Optional() @Inject(LobbyPersistenceService) private lobbyPersistence?: LobbyPersistenceService,
    @Optional() @Inject(WorldLifecycleService) private worldLifecycle?: WorldLifecycleService,
    @Optional() @Inject(SectorAntiCheatService) private readonly antiCheat?: SectorAntiCheatService,
    @Optional() @Inject(ColonySlotAllowanceService) private slotAllowance?: ColonySlotAllowanceService,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
  ) {
    this.antiCheat?.setLobbyPersistence(this.lobbyPersistence);
    if (this.slotAllowance) this.antiCheat?.setSlotAllowanceService(this.slotAllowance);
  }

  setSlotAllowanceService(slotAllowance?: ColonySlotAllowanceService): void {
    this.slotAllowance = slotAllowance;
    this.antiCheat?.setSlotAllowanceService(slotAllowance);
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

  /** Game module wires the planet cap (3.4). Unset: no cap. */
  setCapacityGate(gate: PlanetCapacityGate | undefined): void { this.capacity = gate; }

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

  getExistingHome(playerId: string, planetId?: string): Promise<HomeResponse | null> {
    return getExistingHomeHelper(this.lookupDeps(), playerId, planetId);
  }

  resumeColony(
    playerId: string,
    colonyId: string,
    requestedSectorId?: string,
    requestedPlanetId?: string,
  ): Promise<HomeResponse> {
    return resumeColonyHelper(this.lookupDeps(), playerId, colonyId, requestedSectorId, requestedPlanetId);
  }

  /**
   * W11-20 `resolveHome`: pure home state machine over live colonies, active queue ticket,
   * unseen elimination/planet-end recap, or `NEW` player with all three canonical worlds.
   */
  async resolveHome(
    player: string | { readonly id: string; readonly handle?: string },
    opts?: ResolveHomeOptions,
  ): Promise<HomeResponse> {
    const playerId = typeof player === 'string' ? player : player.id;
    const handle = typeof player === 'string' ? undefined : player.handle;
    if (opts?.colonyId) return this.resumeColony(playerId, opts.colonyId, opts.sectorId, opts.planetId);

    const activeBundles = await this.listActiveBundles(playerId, handle);
    for (const b of activeBundles) this.antiCheat?.recordColonyBase(b.colony, b.planet);

    if (opts?.newColony) {
      return this.resolveNewColonyHome({ id: playerId, handle }, activeBundles, opts);
    }

    if (activeBundles.length > 0) {
      const activeTicket = await this.lobbyPersistence?.findActiveTicketByPlayer(playerId);
      if (activeTicket && this.lobbyPersistence && (!opts?.planetId || activeTicket.planetId === opts.planetId)) {
        return this.withRoster(await buildQueuedHomeResponse(activeTicket, this.lobbyPersistence, this.worldLifecycle), playerId, activeBundles);
      }
      const target =
        matchActiveBundle(activeBundles, opts?.planetId, opts?.sectorId) ??
        (opts?.planetId ? activeBundles.find((b) => b.planet.id === opts.planetId) : undefined) ??
        activeBundles[0]!;
      const verified = assertRequestedHomeLocation(
        await this.answerExisting(target.colony, target.planet, true),
        this.antiCheat,
        opts?.sectorId,
        opts?.planetId,
      );
      return this.withRoster(verified, playerId, activeBundles);
    }

    assertRequestedHomeLocation({ state: 'NEW', planets: [], newPlanetTypes: [] }, this.antiCheat, opts?.sectorId, opts?.planetId);

    const activeTicket = await this.lobbyPersistence?.findActiveTicketByPlayer(playerId);
    if (activeTicket && this.lobbyPersistence) {
      return this.withRoster(await buildQueuedHomeResponse(activeTicket, this.lobbyPersistence, this.worldLifecycle), playerId, activeBundles);
    }

    const existing = await findLatestColonyWithPlanet(this.lookupDeps(), playerId, handle);
    if (existing && !this.isRecapSeenFor(playerId, existing.colony)) {
      return this.withRoster(await this.buildHomeResponseAsync(existing.colony, existing.planet, true), playerId, activeBundles);
    }

    if (opts?.autoSeatDev === true) {
      return this.getOrAssignHome({ id: playerId, handle }, opts.preferredType, opts.sectorId, opts.planetId);
    }

    const planets = await listCanonicalPlanetSummaries(this.lobbyPersistence, true);
    return this.withRoster(
      { state: 'NEW', planets, newPlanetTypes: [], queuePaused: this.worldLifecycle?.isQueuePaused() ?? false },
      playerId,
      activeBundles,
    );
  }

  async getOrAssignHome(
    player: { id: string; handle?: string },
    preferredType?: DevPlanetType,
    requestedSectorId?: string,
    requestedPlanetId?: string,
    newColony = false,
  ): Promise<HomeResponse> {
    const activeBundles = await this.listActiveBundles(player.id, player.handle);
    for (const b of activeBundles) this.antiCheat?.recordColonyBase(b.colony, b.planet);

    const admitted = await admitCapacityQueued(this.capacitySeat(), player, { sectorId: requestedSectorId, planetId: requestedPlanetId, newColony, hasColonies: activeBundles.length > 0 });
    if (admitted) return admitted;
    const preShort = await checkPreSeatAssignShortCircuit(
      this.lookupDeps(),
      player,
      activeBundles,
      requestedSectorId,
      requestedPlanetId,
      newColony,
    );
    if (preShort) return preShort;

    const resolvedType = preferredType ?? DEV_PLANET_TYPE;
    await assertNewHomeJoinSpace({
      antiCheat: this.antiCheat,
      playerId: player.id,
      preferredType: resolvedType,
      requestedSectorId,
      requestedPlanetId,
      newColony,
    });

    return this.withSeatLock(async () => {
      const lockedBundles = await this.listActiveBundles(player.id, player.handle);
      const lockedShort = await checkLockedSeatAssignShortCircuit(
        this.lookupDeps(),
        player,
        lockedBundles,
        requestedSectorId,
        requestedPlanetId,
        newColony,
      );
      if (lockedShort) return lockedShort;

      return seatFreshColony(this.capacitySeat(), player, resolvedType, { sectorId: requestedSectorId, planetId: requestedPlanetId, newColony, bundles: lockedBundles });
    });
  }

  /** Planet-cap seat path (3.4): queue at the cap, admit the first in line. */
  private capacitySeat(): CapacitySeatDeps {
    return {
      queue: { lobby: this.lobbyPersistence, lifecycle: this.worldLifecycle },
      antiCheat: this.antiCheat, slotAllowance: this.slotAllowance,
      listActiveBundles: (playerId, handle) => this.listActiveBundles(playerId, handle),
      seatContext: (occupied) => this.seatContext(occupied),
      withRoster: (home, playerId, bundles) => this.withRoster(home, playerId, bundles),
      withSeatLock: (fn) => this.withSeatLock(fn),
      answerExisting: (col, pl, canonical) => this.answerExisting(col, pl, canonical),
    };
  }

  adoptLateLanding(assignment: ColonySeatAssignment): Promise<boolean> {
    return this.withSeatLock(() =>
      adoptLateLandingHelper({
        assignment,
        repo: this.repo,
        landedIndices: this.landedIndices,
        listActiveBundles: (pid, h) => this.listActiveBundles(pid, h),
        slotAllowance: this.slotAllowance,
        antiCheat: this.antiCheat,
      }),
    );
  }

  private async resolveNewColonyHome(
    player: { readonly id: string; readonly handle?: string },
    activeBundles: readonly ActiveColonyBundle[],
    opts: ResolveHomeOptions,
  ): Promise<HomeResponse> {
    await assertNewColonyAllowed({
      playerId: player.id,
      activeBundles,
      slotAllowance: this.slotAllowance,
      requestedPlanetId: opts.planetId,
      requestedSectorId: opts.sectorId,
    });
    await assertNewHomeJoinSpace({
      antiCheat: this.antiCheat,
      playerId: player.id,
      preferredType: opts.preferredType ?? DEV_PLANET_TYPE,
      requestedSectorId: opts.sectorId,
      requestedPlanetId: opts.planetId,
      newColony: true,
    });
    const activeTicket = await this.lobbyPersistence?.findActiveTicketByPlayer(player.id);
    // a planet-cap ticket is admitted by `getOrAssignHome` (3.4), so an auto-seat poll goes on to it
    if (activeTicket && this.lobbyPersistence && !(opts.autoSeatDev === true && isCapacityTicket(activeTicket))) {
      return this.withRoster(await buildQueuedHomeResponse(activeTicket, this.lobbyPersistence, this.worldLifecycle), player.id, activeBundles);
    }
    if (opts.autoSeatDev === true) {
      return this.getOrAssignHome(player, opts.preferredType, opts.sectorId, opts.planetId, true);
    }
    const planets = await listCanonicalPlanetSummaries(this.lobbyPersistence, true);
    return this.withRoster(
      { state: 'NEW', planets, newPlanetTypes: [], queuePaused: this.worldLifecycle?.isQueuePaused() ?? false },
      player.id,
      activeBundles,
    );
  }

  private lookupDeps(): HomeServiceLookupDeps {
    return {
      repo: this.repo,
      lobbyPersistence: this.lobbyPersistence,
      worldLifecycle: this.worldLifecycle,
      antiCheat: this.antiCheat,
      slotAllowance: this.slotAllowance,
      nonProduction: this.isNonProduction(),
      applyOverrides: (col) => this.applyOverrides(col),
      applyPlanetOverrides: (pl) => this.applyPlanetOverrides(pl),
      isRecapSeenFor: (playerId, col) => this.isRecapSeenFor(playerId, col),
      buildHomeResponse: (col, pl, canonical) => this.buildHomeResponseAsync(col, pl, canonical),
      answerExisting: (col, pl, canonical) => this.answerExisting(col, pl, canonical),
      withRoster: (home, playerId, bundles) => this.withRoster(home, playerId, bundles),
      listActiveBundles: (playerId, handle) => this.listActiveBundles(playerId, handle),
      resolveHomeFallback: (player) => this.resolveHome(player),
      materializeW12LiveColony: (playerId, colonyId, requestedSectorId) =>
        this.materializeW12LiveColony(playerId, colonyId, requestedSectorId),
    };
  }

  private seatContext(occupiedSectorsByPlanet?: ReadonlyMap<string, ReadonlySet<string>>): SeatContext {
    return {
      repo: this.repo,
      exhausted: this.exhausted,
      landedIndices: this.landedIndices,
      recapSeenPlayerIds: this.recapSeenPlayerIds,
      landingHost: this.landingHost,
      notifier: this.notifier,
      seatListeners: this.seatListeners,
      antiCheat: this.antiCheat,
      occupiedSectorsByPlanet,
      capacity: this.capacity,
      buildHomeResponse: (col, pl, canonical) => this.buildHomeResponseAsync(col, pl, canonical),
    };
  }

  private listActiveBundles(playerId: string, handle?: string): Promise<ActiveColonyBundle[]> {
    return collectActiveColonyBundles({
      repo: this.repo,
      lobbyPersistence: this.lobbyPersistence,
      hardMode: this.hardMode,
      applyOverrides: (col) => this.applyOverrides(col),
      applyPlanetOverrides: (pl) => this.applyPlanetOverrides(pl),
      playerId,
      handle,
    });
  }

  private withRoster(home: HomeResponse, playerId: string, activeBundles: readonly ActiveColonyBundle[]): Promise<HomeResponse> {
    return attachHomeColonyRoster({
      home,
      playerId,
      activeBundles,
      slotAllowance: this.slotAllowance,
      lobbyPersistence: this.lobbyPersistence,
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

  private materializeW12LiveColony(playerId: string, colonyId: string, requestedSectorId?: string): Promise<ColonyRecord | null> {
    return materializeW12LiveColonyHelper({
      repo: this.repo,
      landingHost: this.landingHost,
      notifier: this.notifier,
      seatListeners: this.seatListeners,
      antiCheat: this.antiCheat,
      playerId,
      colonyId,
      requestedSectorId,
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
