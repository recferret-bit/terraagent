import type { HomeResponse } from '@terra/contracts';
import type { WorldLifecycleService } from '../../../lobby/lifecycle.service';
import type { LobbyPersistenceService } from '../../../lobby/lobby-persistence.service';
import type { CanonicalWorldRecord } from '../../../lobby/lobby-persistence.types';
import { isDevPlayerId } from '../../../ws/session-verifier';
import { normalizeColonyStatus, type SectorAntiCheatService } from '../../anticheat';
import { CoreException } from '../../errors';
import type { ColonySlotAllowanceService } from '../colony-slot-allowance.service';
import {
  buildQueuedHomeResponse,
  enrichColonyWithReservation,
  findCommittedReservationColony,
  isPlanetEndedOrArchived,
  type ColonySeatListener,
  type HomeLandingHost,
  type HomeSeatNotifier,
} from '../home-resolve.helpers';
import type { ColonyRecord, HomeRepository, PlanetRecord } from '../home.repository';
import {
  assertNewColonyAllowed,
  matchActiveBundle,
  type ActiveColonyBundle,
} from './home-multi-colony';
import { askHostLandingSite, assertRequestedHomeLocation, notifyColonySeated } from './home-seating';

export interface HomeServiceLookupDeps {
  readonly repo: HomeRepository;
  readonly lobbyPersistence?: LobbyPersistenceService;
  readonly worldLifecycle?: WorldLifecycleService;
  readonly antiCheat?: SectorAntiCheatService;
  readonly slotAllowance?: ColonySlotAllowanceService;
  readonly nonProduction?: boolean;
  readonly applyOverrides: (col: ColonyRecord) => ColonyRecord;
  readonly applyPlanetOverrides: (pl: PlanetRecord) => PlanetRecord;
  readonly isRecapSeenFor: (playerId: string, col: ColonyRecord) => boolean;
  readonly buildHomeResponse: (col: ColonyRecord, pl: PlanetRecord, canonical: boolean) => Promise<HomeResponse>;
  readonly answerExisting: (col: ColonyRecord, pl: PlanetRecord, canonical: boolean) => Promise<HomeResponse>;
  readonly withRoster: (home: HomeResponse, playerId: string, bundles: readonly ActiveColonyBundle[]) => Promise<HomeResponse>;
  readonly listActiveBundles: (playerId: string, handle?: string) => Promise<ActiveColonyBundle[]>;
  readonly resolveHomeFallback: (player: { readonly id: string; readonly handle?: string }) => Promise<HomeResponse>;
  readonly materializeW12LiveColony?: (
    playerId: string,
    colonyId: string,
    requestedSectorId?: string,
  ) => Promise<ColonyRecord | null>;
}

export async function findLatestColonyWithPlanet(
  deps: Pick<HomeServiceLookupDeps, 'repo' | 'lobbyPersistence' | 'applyOverrides' | 'applyPlanetOverrides'>,
  playerId: string,
  handle?: string,
): Promise<{ colony: ColonyRecord; planet: PlanetRecord; world: CanonicalWorldRecord | null } | null> {
  const { repo, lobbyPersistence, applyOverrides, applyPlanetOverrides } = deps;
  const repoColony = await repo.findLatestColonyByPlayerId(playerId);
  const enriched = repoColony
    ? await enrichColonyWithReservation(applyOverrides(repoColony), lobbyPersistence)
    : null;
  if (!enriched || normalizeColonyStatus(enriched.status) !== 'ACTIVE') {
    const committed = await findCommittedReservationColony(lobbyPersistence, playerId, { handle });
    if (committed) {
      const col = applyOverrides(committed.colony);
      const planet = applyPlanetOverrides(committed.planet);
      const world = lobbyPersistence ? await lobbyPersistence.getCanonicalWorldById(planet.id) : null;
      if (!enriched || (normalizeColonyStatus(col.status) === 'ACTIVE' && !isPlanetEndedOrArchived(planet, world))) {
        return { colony: col, planet, world };
      }
    }
  }
  if (!enriched) return null;
  const rawPlanet =
    (await repo.findPlanetById(enriched.planetId)) ??
    (await repo.upsertDevPlanet(enriched.planetId));
  const planet = applyPlanetOverrides(rawPlanet);
  const world = lobbyPersistence ? await lobbyPersistence.getCanonicalWorldById(planet.id) : null;
  return { colony: enriched, planet, world };
}

export async function getExistingHomeHelper(
  deps: HomeServiceLookupDeps,
  playerId: string,
  planetId?: string,
): Promise<HomeResponse | null> {
  const activeBundles = await deps.listActiveBundles(playerId);
  for (const b of activeBundles) deps.antiCheat?.recordColonyBase(b.colony, b.planet);

  if (planetId) {
    const matched = activeBundles.find((b) => b.planet.id === planetId);
    if (matched) {
      return deps.withRoster(await deps.buildHomeResponse(matched.colony, matched.planet, false), playerId, activeBundles);
    }
    const repoCol = await deps.repo.findColonyByPlayerAndPlanet(playerId, planetId);
    if (repoCol) {
      const enriched = await enrichColonyWithReservation(deps.applyOverrides(repoCol), deps.lobbyPersistence);
      const rawPlanet = (await deps.repo.findPlanetById(planetId)) ?? (await deps.repo.upsertDevPlanet(planetId));
      const planet = deps.applyPlanetOverrides(rawPlanet);
      deps.antiCheat?.recordColonyBase(enriched, planet);
      return deps.withRoster(await deps.buildHomeResponse(enriched, planet, false), playerId, activeBundles);
    }
    const committed = await findCommittedReservationColony(deps.lobbyPersistence, playerId, { planetId });
    if (committed) {
      const col = deps.applyOverrides(committed.colony);
      const planet = deps.applyPlanetOverrides(committed.planet);
      deps.antiCheat?.recordColonyBase(col, planet);
      return deps.withRoster(await deps.buildHomeResponse(col, planet, false), playerId, activeBundles);
    }
    return null;
  }

  if (activeBundles.length > 0) {
    const first = activeBundles[0]!;
    return deps.withRoster(await deps.buildHomeResponse(first.colony, first.planet, false), playerId, activeBundles);
  }
  const activeTicket = await deps.lobbyPersistence?.findActiveTicketByPlayer(playerId);
  if (activeTicket && deps.lobbyPersistence) {
    return deps.withRoster(await buildQueuedHomeResponse(activeTicket, deps.lobbyPersistence, deps.worldLifecycle), playerId, activeBundles);
  }
  const found = await findLatestColonyWithPlanet(deps, playerId);
  if (found) {
    if (deps.isRecapSeenFor(playerId, found.colony)) {
      return deps.resolveHomeFallback({ id: playerId });
    }
    return deps.withRoster(await deps.buildHomeResponse(found.colony, found.planet, false), playerId, activeBundles);
  }
  return null;
}

export async function resumeColonyHelper(
  deps: HomeServiceLookupDeps,
  playerId: string,
  colonyId: string,
  requestedSectorId?: string,
  requestedPlanetId?: string,
): Promise<HomeResponse> {
  let colony = await deps.repo.findColonyById(colonyId);
  if (!colony && deps.nonProduction && colonyId === 'co_w12_live_1' && deps.materializeW12LiveColony) {
    colony = await deps.materializeW12LiveColony(playerId, colonyId, requestedSectorId);
  }
  if (
    colony &&
    colony.playerId !== playerId &&
    deps.nonProduction &&
    (colony.id === 'co_w12_live_1' || colony.playerId.startsWith('pr_dev_') || isDevPlayerId(colony.playerId))
  ) {
    deps.antiCheat?.recordColonyRemoved(colony.id);
    colony = (await deps.repo.reassignColonyPlayer(colony.id, playerId)) ?? colony;
  }

  let rawPlanet: PlanetRecord | null = null;
  if (!colony) {
    const committed = await findCommittedReservationColony(deps.lobbyPersistence, playerId, { colonyId });
    if (committed && committed.colony.playerId === playerId) {
      colony = deps.applyOverrides(committed.colony);
      rawPlanet = committed.planet;
    }
  } else {
    colony = await enrichColonyWithReservation(deps.applyOverrides(colony), deps.lobbyPersistence);
    if (colony.playerId === playerId) {
      rawPlanet =
        (await deps.repo.findPlanetById(colony.planetId)) ??
        (await deps.repo.upsertDevPlanet(
          colony.planetId,
          colony.planetId === 'pl_w12_forest'
            ? { name: 'Sylva Reach', type: 'temperate', seed: 'w12-profile-achievements', state: 'ACTIVE' }
            : {},
        ));
    }
  }
  const planet = rawPlanet ? deps.applyPlanetOverrides(rawPlanet) : null;
  const world = colony && deps.lobbyPersistence ? await deps.lobbyPersistence.getCanonicalWorldById(colony.planetId) : null;
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
  const activeBundles = await deps.listActiveBundles(playerId);
  for (const b of activeBundles) deps.antiCheat?.recordColonyBase(b.colony, b.planet);
  deps.antiCheat?.recordColonyBase(colony, planet);
  const verified = assertRequestedHomeLocation(
    await deps.answerExisting(colony, planet, false),
    deps.antiCheat,
    requestedSectorId,
    requestedPlanetId,
  );
  return deps.withRoster(verified, playerId, activeBundles);
}

export async function checkPreSeatAssignShortCircuit(
  deps: HomeServiceLookupDeps,
  player: { readonly id: string; readonly handle?: string },
  activeBundles: readonly ActiveColonyBundle[],
  requestedSectorId: string | undefined,
  requestedPlanetId: string | undefined,
  newColony: boolean,
): Promise<HomeResponse | null> {
  if (!newColony && activeBundles.length > 0) {
    const activeTicket = await deps.lobbyPersistence?.findActiveTicketByPlayer(player.id);
    if (activeTicket && deps.lobbyPersistence && (!requestedPlanetId || activeTicket.planetId === requestedPlanetId)) {
      return deps.withRoster(await buildQueuedHomeResponse(activeTicket, deps.lobbyPersistence, deps.worldLifecycle), player.id, activeBundles);
    }
    const target =
      matchActiveBundle(activeBundles, requestedPlanetId, requestedSectorId) ??
      (requestedPlanetId ? activeBundles.find((b) => b.planet.id === requestedPlanetId) : undefined) ??
      activeBundles[0]!;
    const verified = assertRequestedHomeLocation(
      await deps.answerExisting(target.colony, target.planet, false),
      deps.antiCheat,
      requestedSectorId,
      requestedPlanetId,
    );
    return deps.withRoster(verified, player.id, activeBundles);
  }

  const activeTicket = await deps.lobbyPersistence?.findActiveTicketByPlayer(player.id);
  if (activeTicket && deps.lobbyPersistence) {
    assertRequestedHomeLocation(
      { state: 'NEW', planets: [], newPlanetTypes: [] },
      deps.antiCheat,
      requestedSectorId,
      requestedPlanetId,
    );
    return deps.withRoster(await buildQueuedHomeResponse(activeTicket, deps.lobbyPersistence, deps.worldLifecycle), player.id, activeBundles);
  }

  if (!newColony) {
    const existing = await findLatestColonyWithPlanet(deps, player.id, player.handle);
    if (existing) {
      if (deps.isRecapSeenFor(player.id, existing.colony)) {
        return deps.resolveHomeFallback(player);
      }
      return deps.withRoster(await deps.answerExisting(existing.colony, existing.planet, false), player.id, activeBundles);
    }
  } else {
    await assertNewColonyAllowed({
      playerId: player.id,
      activeBundles,
      slotAllowance: deps.slotAllowance,
      requestedPlanetId,
      requestedSectorId,
    });
  }
  return null;
}

export async function checkLockedSeatAssignShortCircuit(
  deps: HomeServiceLookupDeps,
  player: { readonly id: string; readonly handle?: string },
  lockedBundles: readonly ActiveColonyBundle[],
  requestedSectorId: string | undefined,
  requestedPlanetId: string | undefined,
  newColony: boolean,
): Promise<HomeResponse | null> {
  const recheckTicket = await deps.lobbyPersistence?.findActiveTicketByPlayer(player.id);
  if (recheckTicket && deps.lobbyPersistence) {
    return deps.withRoster(await buildQueuedHomeResponse(recheckTicket, deps.lobbyPersistence, deps.worldLifecycle), player.id, lockedBundles);
  }
  if (!newColony) {
    if (lockedBundles.length > 0) {
      const target = matchActiveBundle(lockedBundles, requestedPlanetId, requestedSectorId) ?? lockedBundles[0]!;
      deps.antiCheat?.recordColonyBase(target.colony, target.planet);
      const verified = assertRequestedHomeLocation(
        await deps.answerExisting(target.colony, target.planet, false),
        deps.antiCheat,
        requestedSectorId,
        requestedPlanetId,
      );
      return deps.withRoster(verified, player.id, lockedBundles);
    }
    const recheck = await findLatestColonyWithPlanet(deps, player.id, player.handle);
    if (recheck) {
      if (recheck.colony.status !== 'ACTIVE' && deps.isRecapSeenFor(player.id, recheck.colony)) {
        return deps.resolveHomeFallback(player);
      }
      deps.antiCheat?.recordColonyBase(recheck.colony, recheck.planet);
      const verified = assertRequestedHomeLocation(
        await deps.answerExisting(recheck.colony, recheck.planet, false),
        deps.antiCheat,
        requestedSectorId,
        requestedPlanetId,
      );
      return deps.withRoster(verified, player.id, lockedBundles);
    }
  } else {
    await assertNewColonyAllowed({
      playerId: player.id,
      activeBundles: lockedBundles,
      slotAllowance: deps.slotAllowance,
      requestedPlanetId,
      requestedSectorId,
    });
  }
  return null;
}

export async function materializeW12LiveColonyHelper(opts: {
  readonly repo: HomeRepository;
  readonly landingHost?: HomeLandingHost;
  readonly notifier?: HomeSeatNotifier;
  readonly seatListeners: ReadonlySet<ColonySeatListener>;
  readonly antiCheat?: SectorAntiCheatService;
  readonly playerId: string;
  readonly colonyId: string;
  readonly requestedSectorId?: string;
}): Promise<ColonyRecord | null> {
  const { repo, landingHost, notifier, seatListeners, antiCheat, playerId, colonyId, requestedSectorId } = opts;
  const w12Planet = await repo.upsertDevPlanet('pl_w12_forest', {
    name: 'Sylva Reach',
    type: 'temperate',
    seed: 'w12-profile-achievements',
    state: 'ACTIVE',
  });
  const slot = await repo.findFreeSlotOnPlanet(w12Planet.id);
  const colonyIndex = slot?.colonyIndex ?? 0;
  let spawnQ = 0;
  let spawnR = 0;
  let landingSlotId: string | null = null;
  let foundingSectorId = requestedSectorId?.trim() || 'sec_0_0';
  if (landingHost) {
    const site = await askHostLandingSite(landingHost, w12Planet, colonyIndex, requestedSectorId);
    if (site.ok) {
      spawnQ = site.q;
      spawnR = site.r;
      landingSlotId = site.landingSlotId ?? null;
      if (!requestedSectorId?.trim() && site.sectorId) foundingSectorId = site.sectorId;
    }
  }
  try {
    const created = await repo.createColony({
      id: colonyId, playerId, planetId: w12Planet.id, colonyIndex, name: 'Aegis Basin',
      color: colonyIndex, status: 'ACTIVE', foundingSectorId, landingSlotId, spawnQ, spawnR,
    });
    antiCheat?.recordColonyBase(created.colony, created.planet, true);
    await notifyColonySeated(
      repo,
      notifier,
      seatListeners,
      {
        player: { id: playerId, handle: 'Aegis' },
        colony: created.colony,
        planet: created.planet,
        slot: {
          index: colonyIndex, q: spawnQ, r: spawnR,
          ...(foundingSectorId ? { sectorId: foundingSectorId } : {}),
          ...(landingSlotId ? { landingSlotId } : {}),
        },
      },
      antiCheat,
    );
    return created.colony;
  } catch (err) {
    const existing = await repo.findColonyById(colonyId);
    if (existing) return existing;
    throw err;
  }
}
