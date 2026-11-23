import { W11_DEFAULT_SECTOR_RADIUS, type ColonySummary, type HomeResponse, type PlanetType } from '@terra/contracts';
import type { DevPlanetType } from '@terra/sim';
import type { LobbyPersistenceService } from '../../../lobby/lobby-persistence.service';
import {
  inferAuthoritativeBaseSector,
  isValidSectorIdFormat,
  normalizeColonyStatus,
  resolveTileSectorFast,
  type SectorAntiCheatService,
} from '../../anticheat';
import { CoreConflict, CoreException } from '../../errors';
import { attachAwaySummary, type AwayHeadline } from '../away-headline';
import { eliminatedHomeFromClock, type HardModeHomeClock } from '../hard-mode-home';
import {
  buildEnrichedPlanetSummary,
  buildTerminalHomeResponse,
  isPlanetEndedOrArchived,
  listCanonicalPlanetSummaries,
  type ColonySeatAssignment,
  type ColonySeatListener,
  type HomeLandingHost,
  type HomeLandingSite,
  type HomeSeatNotifier,
} from '../home-resolve.helpers';
import type { ColonyRecord, HomeRepository, PlanetRecord } from '../home.repository';
import { explicitPlanetWake, pickSeatPlanet, wakePlanet, type PlanetCapacityGate } from './planet-capacity';

/** Landing attempts per `getOrAssignHome` (each asks a planet's sim for a site, seats there or moves on). */
export const SEAT_ATTEMPTS = 8;
/** Planets tried per `getOrAssignHome`: one whose sim has no landing site left is marked and the next of its family tried. */
export const SEAT_PLANETS = 2;

const NO_SITE_CODES: readonly string[] = ['landing_site_taken', 'planet_full'];
export type SeatMiss = 'no_site' | 'sector_full' | 'index_landed' | 'retry';

export const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function isSeatRejected(e: unknown, code: string): boolean {
  if (!(e instanceof CoreException) || e.errorCode !== 'COLONY_SEAT_REJECTED') return false;
  return (e.details as { code?: unknown } | undefined)?.code === code;
}

export function noLandingSite(planetIds: readonly string[]): CoreConflict {
  return new CoreConflict('COLONY_SEAT_REJECTED', {
    message: `no landing site left on ${planetIds.join(', ')}: their sims have no free landing site`,
    details: { code: 'landing_site_taken', planetIds },
  });
}

export function sectorFullConflict(sectorId: string, planetIds: readonly string[]): CoreException {
  return new CoreException('SECTOR_FULL', {
    status: 409,
    message: `Sector ${sectorId} has no free space`,
    details: { code: 'sector_full', sectorId, planetIds },
  });
}

export function hostUnavailable(planetId: string, message: string, cause?: string): CoreConflict {
  return new CoreConflict('COLONY_SEAT_REJECTED', {
    message,
    details: { code: 'host_unavailable', planetId, ...(cause ? { cause } : {}) },
  });
}

export function markPlanetIndexLanded(
  landedIndices: Map<string, Set<number>>,
  planetId: string,
  colonyIndex: number,
): void {
  let set = landedIndices.get(planetId);
  if (!set) landedIndices.set(planetId, (set = new Set()));
  set.add(colonyIndex);
}

export async function askHostLandingSite(
  landingHost: HomeLandingHost | undefined,
  planet: PlanetRecord,
  colonyIndex: number,
): Promise<HomeLandingSite> {
  if (!landingHost) throw hostUnavailable(planet.id, `no game host to land a colony on ${planet.id}`);
  try {
    return await landingHost.landingSite(planet, colonyIndex);
  } catch (e) {
    throw hostUnavailable(planet.id, `planet ${planet.id} cannot be asked for a landing site: ${errText(e)}`);
  }
}

export async function notifyColonySeated(
  repo: HomeRepository,
  notifier: HomeSeatNotifier | undefined,
  seatListeners: ReadonlySet<ColonySeatListener>,
  assignment: ColonySeatAssignment,
  antiCheat?: SectorAntiCheatService,
): Promise<void> {
  try {
    if (notifier) await notifier.onColonySeated(assignment);
    for (const listener of seatListeners) await listener(assignment);
  } catch (e) {
    antiCheat?.recordColonyRemoved(assignment.colony.id);
    await repo.deleteColony(assignment.colony.id).catch(() => undefined);
    throw e;
  }
}

export function assertRequestedHomeLocation(
  home: HomeResponse,
  antiCheat: SectorAntiCheatService | undefined,
  requestedSectorId?: string,
  requestedPlanetId?: string,
): HomeResponse {
  const trimmedSector = requestedSectorId?.trim();
  const trimmedPlanet = requestedPlanetId?.trim();
  if (trimmedSector && !isValidSectorIdFormat(trimmedSector)) {
    antiCheat?.recordRejection('http', 'join', 'invalid_sector');
    throw new CoreException('INVALID_SECTOR', {
      status: 400,
      message: `Invalid sector "${trimmedSector}"`,
      details: { code: 'invalid_sector', requestedSectorId: trimmedSector },
    });
  }
  if (home.state !== 'ACTIVE') return home;

  const planetSpatial = antiCheat?.index.getPlanet(home.planet.id);
  const indexedColony = antiCheat?.index.getColonyById(home.colony.id);
  const activeSector =
    indexedColony?.baseSectorId ??
    inferAuthoritativeBaseSector({
      foundingSectorId: home.colony.foundingSectorId,
      spawnQ: home.colony.spawnQ,
      spawnR: home.colony.spawnR,
      sectorRadius: planetSpatial?.sectorRadius,
      hasMultiSectorGrid: planetSpatial?.hasMultiSectorGrid,
    });

  if (home.colony.playerId) {
    antiCheat?.index.upsertColonyBase({
      playerId: home.colony.playerId,
      colonyId: home.colony.id,
      planetId: home.planet.id,
      colonyIndex: home.colony.colonyIndex ?? 0,
      foundingSectorId: activeSector,
      spawnQ: home.colony.spawnQ,
      spawnR: home.colony.spawnR,
      status: 'ACTIVE',
    });
  }

  if (trimmedPlanet && trimmedPlanet !== home.planet.id) {
    antiCheat?.recordRejection('http', 'join', 'not_your_planet');
    throw new CoreException('COLONY_PLANET_LOCKED', {
      status: 409,
      message: `Active colony is located on planet ${home.planet.id}`,
      details: {
        code: 'not_your_planet',
        colonyId: home.colony.id,
        planetId: home.planet.id,
        requestedPlanetId: trimmedPlanet,
      },
    });
  }
  if (trimmedSector && activeSector !== trimmedSector) {
    antiCheat?.recordRejection('http', 'join', 'not_your_sector');
    throw new CoreException('COLONY_SECTOR_LOCKED', {
      status: 409,
      message: `Active colony is locked to sector ${activeSector}`,
      details: {
        code: 'not_your_sector',
        colonyId: home.colony.id,
        planetId: home.planet.id,
        foundingSectorId: activeSector,
        requestedSectorId: trimmedSector,
      },
    });
  }
  return home;
}

export async function assertNewHomeJoinSpace(opts: {
  readonly antiCheat: SectorAntiCheatService | undefined;
  readonly playerId: string;
  readonly preferredType: PlanetType;
  readonly requestedSectorId?: string;
  readonly requestedPlanetId?: string;
}): Promise<void> {
  const trimmedSector = opts.requestedSectorId?.trim();
  if (trimmedSector && !isValidSectorIdFormat(trimmedSector)) {
    opts.antiCheat?.recordRejection('http', 'join', 'invalid_sector');
    throw new CoreException('INVALID_SECTOR', {
      status: 400,
      message: `Invalid sector "${trimmedSector}"`,
      details: { code: 'invalid_sector', requestedSectorId: trimmedSector },
    });
  }
  if (!opts.antiCheat) return;
  const verdict = await opts.antiCheat.verifyJoin({
    transport: 'http',
    playerId: opts.playerId,
    targetPlanetId: opts.requestedPlanetId?.trim() || undefined,
    targetPlanetType: opts.preferredType,
    requestedSectorId: trimmedSector,
    allowNewJoin: true,
  });
  if (!verdict.ok) {
    throw new CoreException(verdict.errorCode, {
      status: verdict.httpStatus,
      message: verdict.detail,
      details: {
        code: verdict.reason,
        ...(trimmedSector ? { requestedSectorId: trimmedSector } : {}),
        ...(opts.requestedPlanetId ? { planetId: opts.requestedPlanetId } : {}),
      },
    });
  }
}

export interface SeatContext {
  readonly repo: HomeRepository;
  readonly exhausted: Set<string>;
  readonly landedIndices: Map<string, Set<number>>;
  readonly recapSeenPlayerIds: Set<string>;
  readonly landingHost: HomeLandingHost | undefined;
  readonly notifier: HomeSeatNotifier | undefined;
  readonly seatListeners: ReadonlySet<ColonySeatListener>;
  readonly antiCheat?: SectorAntiCheatService;
  /** Planet cap (3.4); absent = no cap (every open planet is seated as before). */
  readonly capacity?: PlanetCapacityGate;
  readonly buildHomeResponse: (
    colony: ColonyRecord,
    planet: PlanetRecord,
    alwaysIncludeCanonicalPlanets: boolean,
  ) => Promise<HomeResponse>;
}

export async function seatColonyOnPlanet(
  ctx: SeatContext,
  player: { id: string; handle: string },
  openPlanet: PlanetRecord,
  colonyIndex: number,
  requestedSectorId?: string,
): Promise<HomeResponse | SeatMiss> {
  if (ctx.antiCheat) {
    await ctx.antiCheat.hydratePlanetSectors(openPlanet.id);
    if (requestedSectorId) {
      const sec = ctx.antiCheat.index.getSectorSpace(openPlanet.id, requestedSectorId);
      if (sec?.kind === 'ocean') {
        ctx.antiCheat.recordRejection('http', 'join', 'sector_not_land');
        throw new CoreException('INVALID_SECTOR', {
          status: 400,
          message: `Sector ${requestedSectorId} is an ocean sector`,
          details: { code: 'sector_not_land', planetId: openPlanet.id, sectorId: requestedSectorId },
        });
      }
      if (sec && sec.freeSeats <= 0) {
        ctx.antiCheat.recordRejection('http', 'join', 'sector_full');
        return 'sector_full';
      }
    }
  }

  const site = await askHostLandingSite(ctx.landingHost, openPlanet, colonyIndex);
  if (!site.ok) {
    if (site.code === 'already_landed') return 'index_landed';
    if (NO_SITE_CODES.includes(site.code)) return 'no_site';
    throw hostUnavailable(
      openPlanet.id,
      `planet ${openPlanet.id} has no landing site for colony ${colonyIndex}: ${site.code}`,
      site.code,
    );
  }

  const planetSpatial = ctx.antiCheat?.index.getPlanet(openPlanet.id);
  const sectorRadius = planetSpatial?.sectorRadius ?? W11_DEFAULT_SECTOR_RADIUS;
  const knownSecCount = ctx.antiCheat?.index.listPlanetSectors(openPlanet.id).length ?? 0;
  const isMultiSector =
    Boolean(planetSpatial?.hasMultiSectorGrid) ||
    knownSecCount > 1 ||
    Boolean(site.sectorId && site.sectorId !== 'sec_0_0');
  if (!isMultiSector && requestedSectorId && requestedSectorId !== 'sec_0_0') {
    ctx.antiCheat?.recordRejection('http', 'join', 'invalid_sector');
    throw new CoreException('INVALID_SECTOR', {
      status: 400,
      message: `Sector ${requestedSectorId} does not exist on ${openPlanet.id}`,
      details: { code: 'invalid_sector', planetId: openPlanet.id, requestedSectorId },
    });
  }

  const effectiveSector =
    site.sectorId ?? (isMultiSector ? resolveTileSectorFast(site.q, site.r, sectorRadius) : 'sec_0_0');
  if (requestedSectorId && effectiveSector !== requestedSectorId) {
    return 'sector_full';
  }
  const siteSec = ctx.antiCheat?.index.getSectorSpace(openPlanet.id, effectiveSector);
  if (siteSec && (siteSec.kind === 'ocean' || siteSec.freeSeats <= 0)) {
    ctx.antiCheat?.recordRejection('http', 'join', 'sector_full');
    return 'sector_full';
  }

  ctx.recapSeenPlayerIds.delete(player.id);
  const { colony, planet } = await ctx.repo.createColony({
    playerId: player.id,
    planetId: openPlanet.id,
    colonyIndex,
    name: `${player.handle.slice(0, 22)}'s Colony`,
    color: colonyIndex,
    status: 'ACTIVE',
    foundingSectorId: effectiveSector,
    landingSlotId: site.landingSlotId ?? null,
    spawnQ: site.q,
    spawnR: site.r,
  });
  ctx.antiCheat?.recordColonyBase(colony, planet, true);
  try {
    await notifyColonySeated(ctx.repo, ctx.notifier, ctx.seatListeners, {
      player,
      colony,
      planet,
      slot: {
        index: site.slotIndex ?? colonyIndex,
        q: site.q,
        r: site.r,
        ...((site.sectorId ?? requestedSectorId) ? { sectorId: effectiveSector } : {}),
        ...(site.landingSlotId ? { landingSlotId: site.landingSlotId } : {}),
      },
    }, ctx.antiCheat);
    return ctx.buildHomeResponse(colony, planet, false);
  } catch (e) {
    if (isSeatRejected(e, 'already_landed')) return 'index_landed';
    if (isSeatRejected(e, 'landing_site_taken')) return 'retry';
    if (isSeatRejected(e, 'planet_full')) return 'no_site';
    throw e;
  }
}

/** Max populated historical shards scanned before giving up when `TA_SEED_RIVAL_AI` fills shards below capacity. */
export const MAX_PLANET_SCANS = 64;

async function seatOnExplicitPlanet(
  ctx: SeatContext,
  player: { id: string; handle: string },
  planetId: string,
  type: DevPlanetType,
  requestedSectorId?: string,
): Promise<HomeResponse> {
  const existingPlanet = await ctx.repo.findPlanetById(planetId);
  if (!existingPlanet) {
    throw new CoreException('NOT_YOUR_PLANET', {
      status: 404,
      message: `Planet ${planetId} not found`,
      details: { code: 'planet_not_found', planetId },
    });
  }
  if (await explicitPlanetWake(ctx.capacity, existingPlanet, type)) await wakeOrUnavailable(ctx, existingPlanet);
  for (let attempt = 0; attempt < SEAT_ATTEMPTS; attempt++) {
    const free = await ctx.repo.findFreeSlotOnPlanet(planetId, ctx.landedIndices.get(planetId));
    if (!free) throw sectorFullConflict(requestedSectorId ?? 'sec_0_0', [planetId]);
    const out = await seatColonyOnPlanet(ctx, player, free.planet, free.colonyIndex, requestedSectorId);
    if (typeof out === 'object') return out;
    if (out === 'sector_full' || out === 'no_site') {
      throw sectorFullConflict(requestedSectorId ?? 'sec_0_0', [planetId]);
    }
    if (out === 'index_landed') markPlanetIndexLanded(ctx.landedIndices, planetId, free.colonyIndex);
  }
  throw sectorFullConflict(requestedSectorId ?? 'sec_0_0', [planetId]);
}

export async function seatNewColony(
  ctx: SeatContext,
  player: { id: string; handle: string },
  type: DevPlanetType,
  requestedSectorId?: string,
  requestedPlanetId?: string,
): Promise<HomeResponse> {
  if (requestedPlanetId) {
    return seatOnExplicitPlanet(ctx, player, requestedPlanetId, type, requestedSectorId);
  }
  const emptyTried: string[] = [];
  const allTried: string[] = [];
  let emptyAttempts = 0;
  const unwoken = new Set<string>();
  for (let scan = 0; scan < MAX_PLANET_SCANS && emptyAttempts < SEAT_ATTEMPTS; scan++) {
    const skip = unwoken.size ? new Set([...ctx.exhausted, ...unwoken]) : ctx.exhausted;
    const { planet, colonyIndex, wake } = await pickSeatPlanet(ctx.repo, ctx.capacity, type, skip, ctx.landedIndices);
    if (wake && !(await wakePlanet(ctx.landingHost, ctx.repo, planet).then(() => true, () => false))) {
      unwoken.add(planet.id); // held, or its restore outran the seat budget: this request tries the next planet
      continue;
    }
    const isEmpty = (planet.seatsTaken ?? 0) === 0;
    if (!allTried.includes(planet.id)) allTried.push(planet.id);
    if (isEmpty && !emptyTried.includes(planet.id)) {
      if (emptyTried.length >= SEAT_PLANETS) break;
      emptyTried.push(planet.id);
    }
    const out = await seatColonyOnPlanet(ctx, player, planet, colonyIndex, requestedSectorId);
    if (typeof out === 'object') return out;
    if (out === 'sector_full') {
      throw sectorFullConflict(requestedSectorId ?? 'sec_0_0', allTried);
    }
    if (isEmpty || out !== 'no_site') emptyAttempts++;
    if (out === 'no_site') ctx.exhausted.add(planet.id);
    else if (out === 'index_landed') markPlanetIndexLanded(ctx.landedIndices, planet.id, colonyIndex);
  }
  const triedList = emptyTried.length > 0 ? emptyTried : allTried;
  throw noLandingSite(triedList);
}

/** Restores an idle-unloaded planet before a landing site is asked of it (a planet with snapshots is never generated). */
async function wakeOrUnavailable(ctx: SeatContext, planet: PlanetRecord): Promise<void> {
  try {
    await wakePlanet(ctx.landingHost, ctx.repo, planet);
  } catch (e) {
    throw hostUnavailable(planet.id, `planet ${planet.id} cannot be restored for a new colony: ${errText(e)}`);
  }
}

export async function buildHomeResponseForColony(opts: {
  readonly colony: ColonyRecord;
  readonly colonySummary: ColonySummary;
  readonly planet: PlanetRecord;
  readonly alwaysIncludeCanonicalPlanets: boolean;
  readonly recapSeen: boolean;
  readonly lobbyPersistence: LobbyPersistenceService | undefined;
  readonly hardMode: HardModeHomeClock | undefined;
  readonly awayHeadline: AwayHeadline | undefined;
}): Promise<HomeResponse> {
  const { colony, colonySummary, planet, alwaysIncludeCanonicalPlanets, recapSeen } = opts;
  const { summary: planetSummary, world } = await buildEnrichedPlanetSummary(planet, opts.lobbyPersistence);

  const normalizedColonyStatus = normalizeColonyStatus(colony.status ?? colony.state ?? 'ACTIVE');
  if (isPlanetEndedOrArchived(planet, world) || normalizedColonyStatus === 'ENDED') {
    const planets = await listCanonicalPlanetSummaries(opts.lobbyPersistence, alwaysIncludeCanonicalPlanets);
    return buildTerminalHomeResponse('PLANET_ENDED', colony, colonySummary, planetSummary, planets, recapSeen);
  }

  if (normalizedColonyStatus === 'ELIMINATED') {
    const planets = await listCanonicalPlanetSummaries(opts.lobbyPersistence, alwaysIncludeCanonicalPlanets);
    return buildTerminalHomeResponse('ELIMINATED', colony, colonySummary, planetSummary, planets, recapSeen);
  }

  const mark = opts.hardMode?.get(planet.id, colony.id);
  if (mark) return eliminatedHomeFromClock(colonySummary, planetSummary, mark, recapSeen);

  return attachAwaySummary(
    { state: 'ACTIVE', colony: colonySummary, planet: planetSummary },
    opts.awayHeadline,
  );
}
