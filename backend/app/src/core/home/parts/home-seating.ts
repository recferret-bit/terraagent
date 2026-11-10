import type { ColonySummary, HomeResponse } from '@terra/contracts';
import type { DevPlanetType } from '@terra/sim';
import type { LobbyPersistenceService } from '../../../lobby/lobby-persistence.service';
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

/** Landing attempts per `getOrAssignHome` (each asks a planet's sim for a site, seats there or moves on). */
export const SEAT_ATTEMPTS = 8;
/** Planets tried per `getOrAssignHome`: one whose sim has no landing site left is marked and the next of its family tried. */
export const SEAT_PLANETS = 2;

const NO_SITE_CODES: readonly string[] = ['landing_site_taken', 'planet_full'];
export type SeatMiss = 'no_site' | 'index_landed' | 'retry';

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
): Promise<void> {
  try {
    if (notifier) await notifier.onColonySeated(assignment);
    for (const listener of seatListeners) await listener(assignment);
  } catch (e) {
    await repo.deleteColony(assignment.colony.id).catch(() => undefined);
    throw e;
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
): Promise<HomeResponse | SeatMiss> {
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
  ctx.recapSeenPlayerIds.delete(player.id);
  const { colony, planet } = await ctx.repo.createColony({
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
    await notifyColonySeated(ctx.repo, ctx.notifier, ctx.seatListeners, {
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
    return ctx.buildHomeResponse(colony, planet, false);
  } catch (e) {
    if (isSeatRejected(e, 'already_landed')) return 'index_landed';
    if (isSeatRejected(e, 'landing_site_taken')) return 'retry';
    if (isSeatRejected(e, 'planet_full')) return 'no_site';
    throw e;
  }
}

export async function seatNewColony(
  ctx: SeatContext,
  player: { id: string; handle: string },
  type: DevPlanetType,
): Promise<HomeResponse> {
  const tried: string[] = [];
  for (let attempt = 0; attempt < SEAT_ATTEMPTS; attempt++) {
    const { planet, colonyIndex } = await ctx.repo.findOrCreateOpenDevPlanet(type, ctx.exhausted, ctx.landedIndices);
    if (!tried.includes(planet.id)) {
      if (tried.length >= SEAT_PLANETS) break;
      tried.push(planet.id);
    }
    const out = await seatColonyOnPlanet(ctx, player, planet, colonyIndex);
    if (typeof out === 'object') return out;
    if (out === 'no_site') ctx.exhausted.add(planet.id);
    else if (out === 'index_landed') markPlanetIndexLanded(ctx.landedIndices, planet.id, colonyIndex);
  }
  throw noLandingSite(tried);
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

  if (isPlanetEndedOrArchived(planet, world)) {
    const planets = await listCanonicalPlanetSummaries(opts.lobbyPersistence, alwaysIncludeCanonicalPlanets);
    return buildTerminalHomeResponse('PLANET_ENDED', colony, colonySummary, planetSummary, planets, recapSeen);
  }

  if (colony.status === 'ELIMINATED' || colony.state === 'ELIMINATED') {
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
