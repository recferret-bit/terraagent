import type { Logger } from 'pino';
import {
  ClientMessage,
  decodeWire,
  PlanetType,
  type AgentDecisionFeedItemV1,
  type AwayDigestV1,
  type HomeResponse,
  type SimInputFeedItemV1,
} from '@terra/contracts';
import type { RawData } from 'ws';
import { buildingCatalog, compileData } from '@terra/sim';
import type { AwayDigestService } from '../../game/digest';
import type { FullState, GamePlanets } from '../../game/game-planets.service';
import {
  inferAuthoritativeBaseSector,
  isValidSectorIdFormat,
  type SectorAntiCheatService,
} from '../../core/anticheat';
import { DEFAULT_HOME, type HomeProvider } from '../home-provider';
import type { VerifiedSession } from '../session-verifier';
import { welcomeFields } from '../welcome-digest';

export const TICK_MS = 200;
export const PROTO_VERSION = 1;

export const rawToFrame = (data: RawData, isBinary: boolean): string | Uint8Array => {
  const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);
  return isBinary ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) : buf.toString('utf8');
};

export function parseClientFrame(frame: string | Uint8Array, log: Logger): ClientMessage | undefined {
  try {
    const r = ClientMessage.safeParse(decodeWire(frame));
    if (r.success) return r.data;
    log.debug({ issues: r.error.issues.slice(0, 3) }, 'invalid ws frame');
  } catch {
    log.debug('undecodable ws frame');
  }
  return undefined;
}

export async function seatConnectionScenario(opts: {
  readonly seat?: (input: {
    playerId: string;
    handle: string;
    planetId: string;
    colonyIndices?: readonly number[];
  }) => Promise<void>;
  readonly playerId: string | undefined;
  readonly session: VerifiedSession | undefined;
  readonly planets: GamePlanets;
  readonly planetId: string;
  readonly log: Logger;
}): Promise<void> {
  const { seat, playerId, session, planets, planetId, log } = opts;
  if (!seat || !playerId || !session?.dev || !planets.isScenarioColonyPlanet(planetId)) return;
  try {
    await seat({
      playerId,
      handle: session.handle ?? 'pilot',
      planetId,
      colonyIndices: planets.scenarioColonyIndices?.(planetId) ?? [0],
    });
  } catch (e) {
    log.warn({ err: e, playerId, planetId }, 'scenario colony seat failed');
  }
}

export async function resolveConnectionHome(
  home: HomeProvider | undefined,
  log: Logger,
  playerId: string,
  planetId?: string,
): Promise<HomeResponse> {
  if (!home) return DEFAULT_HOME;
  try {
    return await home.getHome(playerId, planetId);
  } catch (e) {
    log.warn({ err: e, playerId }, 'home lookup failed: answered as NEW (a join is refused until it works)');
    return DEFAULT_HOME;
  }
}

export async function verifyConnectionJoin(opts: {
  readonly homeProvider: HomeProvider | undefined;
  readonly antiCheat: SectorAntiCheatService | undefined;
  readonly log: Logger;
  readonly playerId: string | undefined;
  readonly planetId: string;
  readonly requestedSectorId?: string;
  readonly requestedColonyId?: string;
  readonly dev: boolean;
  readonly isScenarioPlanet: boolean;
  readonly mode?: 'play' | 'spectator';
}): Promise<
  | {
      readonly ok: true;
      readonly colonyId: string | null;
      readonly colonyIndex?: number;
      readonly sectorId?: string;
      readonly bindingHash?: string;
    }
  | {
      readonly ok: false;
      readonly reason: string;
    }
> {
  const { homeProvider, antiCheat, log, playerId, planetId, requestedSectorId, requestedColonyId, dev, isScenarioPlanet, mode } = opts;
  const trimmedSector = requestedSectorId?.trim() || undefined;
  if (trimmedSector && !isValidSectorIdFormat(trimmedSector)) {
    antiCheat?.recordRejection('ws', 'join', 'invalid_sector');
    return { ok: false, reason: 'invalid_sector' };
  }
  if (mode === 'spectator') {
    return { ok: true, colonyId: null, sectorId: trimmedSector };
  }

  const fastActive = playerId ? antiCheat?.index.getActiveBaseByPlayer(playerId) : undefined;
  const fastLatest = playerId ? antiCheat?.index.getLatestBindingByPlayer(playerId) : undefined;
  const hasLiveTerminalOnTarget = Boolean(
    fastLatest?.planetId === planetId && fastLatest.terminalFromLive && fastLatest.status !== 'ACTIVE',
  );

  let effectiveHome: HomeResponse | undefined;
  if (playerId && (!antiCheat || (!fastActive && !hasLiveTerminalOnTarget))) {
    const onTarget = await resolveConnectionHome(homeProvider, log, playerId, planetId);
    effectiveHome =
      onTarget.state === 'ACTIVE'
        ? onTarget
        : await resolveConnectionHome(homeProvider, log, playerId);
  }

  const activeColony =
    effectiveHome?.state === 'ACTIVE' && effectiveHome.colony.planetId === planetId
      ? effectiveHome.colony
      : null;

  if (antiCheat && playerId) {
    const verdict = await antiCheat.verifyJoin({
      transport: 'ws',
      playerId,
      targetPlanetId: planetId,
      requestedSectorId: trimmedSector,
      requestedColonyId,
      dev,
      isScenarioPlanet,
      ...(effectiveHome ? { resolvedHome: effectiveHome } : {}),
      allowNewJoin: false,
    });
    if (!verdict.ok) return { ok: false, reason: verdict.reason };
    const resolvedColonyId = activeColony ? activeColony.id : verdict.colonyId;
    return {
      ok: true,
      colonyId: resolvedColonyId,
      colonyIndex: activeColony ? activeColony.colonyIndex : verdict.colonyIndex,
      sectorId: resolvedColonyId ? verdict.sectorId : trimmedSector,
      bindingHash: resolvedColonyId ? verdict.bindingHash : undefined,
    };
  }

  return verifyConnectionJoinWithoutAntiCheat({
    effectiveHome: effectiveHome ?? DEFAULT_HOME,
    activeColony,
    planetId,
    trimmedSector,
    requestedColonyId,
    dev,
    isScenarioPlanet,
  });
}

function verifyConnectionJoinWithoutAntiCheat(opts: {
  readonly effectiveHome: HomeResponse;
  readonly activeColony: Extract<HomeResponse, { state: 'ACTIVE' }>['colony'] | null;
  readonly planetId: string;
  readonly trimmedSector: string | undefined;
  readonly requestedColonyId: string | undefined;
  readonly dev: boolean;
  readonly isScenarioPlanet: boolean;
}):
  | { readonly ok: true; readonly colonyId: string | null; readonly colonyIndex?: number; readonly sectorId?: string }
  | { readonly ok: false; readonly reason: string } {
  const { effectiveHome, activeColony, planetId, trimmedSector, requestedColonyId, dev, isScenarioPlanet } = opts;
  const hasActiveElsewhere =
    effectiveHome.state === 'ACTIVE' &&
    effectiveHome.colony.planetId !== planetId &&
    !(isScenarioPlanet && dev);
  if (hasActiveElsewhere) return { ok: false, reason: 'not_your_planet' };

  if (!activeColony && !dev) return { ok: false, reason: 'not_your_planet' };
  if (activeColony) {
    if (requestedColonyId && requestedColonyId !== activeColony.id) {
      return { ok: false, reason: 'not_your_colony' };
    }
    const baseSec = inferAuthoritativeBaseSector({
      foundingSectorId: activeColony.foundingSectorId,
      spawnQ: activeColony.spawnQ,
      spawnR: activeColony.spawnR,
    });
    if (trimmedSector && trimmedSector !== baseSec) {
      return { ok: false, reason: 'not_your_sector' };
    }
    return {
      ok: true,
      colonyId: activeColony.id,
      colonyIndex: activeColony.colonyIndex,
      sectorId: baseSec,
    };
  }
  return { ok: true, colonyId: null, sectorId: trimmedSector };
}

export function verifyPostSnapshotConnectionJoin(opts: {
  readonly antiCheat: SectorAntiCheatService | undefined;
  readonly planetId: string;
  readonly colonyId: string | null;
  readonly colonyIndex: number | undefined;
  readonly requestedSectorId?: string;
  readonly currentSectorId?: string;
  readonly currentBindingHash?: string;
  readonly dev: boolean;
  readonly isScenarioPlanet: boolean;
  readonly mode?: 'play' | 'spectator';
}):
  | { readonly ok: true; readonly sectorId?: string; readonly bindingHash?: string }
  | { readonly ok: false; readonly reason: string } {
  const { antiCheat, planetId, colonyId, colonyIndex, requestedSectorId, dev, isScenarioPlanet, mode } = opts;
  if (!antiCheat) return { ok: true, sectorId: opts.currentSectorId, bindingHash: opts.currentBindingHash };

  const planetSpatial = antiCheat.index.getPlanet(planetId);
  if (planetSpatial && (planetSpatial.status === 'ENDED' || planetSpatial.status === 'ARCHIVED')) {
    antiCheat.recordRejection('ws', 'join', 'planet_unavailable');
    return { ok: false, reason: 'planet_unavailable' };
  }

  const trimmedSector = requestedSectorId?.trim() || undefined;
  if (colonyId) {
    const indexed =
      antiCheat.index.getColonyById(colonyId) ??
      (colonyIndex !== undefined ? antiCheat.index.getColonyByPlanetIndex(planetId, colonyIndex) : undefined);
    if (indexed && !(isScenarioPlanet && dev)) {
      if (indexed.status !== 'ACTIVE') {
        antiCheat.recordRejection('ws', 'join', 'colony_inactive');
        return { ok: false, reason: 'colony_inactive' };
      }
      if (trimmedSector && trimmedSector !== indexed.baseSectorId) {
        antiCheat.recordRejection('ws', 'join', 'not_your_sector');
        return { ok: false, reason: 'not_your_sector' };
      }
    }
    return {
      ok: true,
      sectorId: indexed?.baseSectorId ?? opts.currentSectorId,
      bindingHash: indexed?.bindingHash ?? opts.currentBindingHash,
    };
  }

  if (trimmedSector && mode !== 'spectator') {
    const liveSec = antiCheat.index.getSectorSpace(planetId, trimmedSector);
    if (liveSec) {
      if (liveSec.kind === 'ocean') {
        antiCheat.recordRejection('ws', 'join', 'sector_not_land');
        return { ok: false, reason: 'sector_not_land' };
      }
      if (liveSec.freeSeats <= 0) {
        antiCheat.recordRejection('ws', 'join', 'sector_full');
        return { ok: false, reason: 'sector_full' };
      }
      return { ok: true, sectorId: trimmedSector, bindingHash: opts.currentBindingHash };
    }
    const sectors = antiCheat.index.listPlanetSectors(planetId);
    const isMulti = Boolean(planetSpatial?.hasMultiSectorGrid) || sectors.length > 1;
    if (sectors.length > 0 || (planetSpatial && planetSpatial.knownSectorIds.size > 0)) {
      antiCheat.recordRejection('ws', 'join', 'invalid_sector');
      return { ok: false, reason: 'invalid_sector' };
    }
    if (!isMulti && trimmedSector !== 'sec_0_0') {
      antiCheat.recordRejection('ws', 'join', 'invalid_sector');
      return { ok: false, reason: 'invalid_sector' };
    }
    if (planetSpatial && planetSpatial.capacity > 0 && antiCheat.index.countActiveColoniesOnPlanet(planetId) >= planetSpatial.capacity) {
      antiCheat.recordRejection('ws', 'join', 'sector_full');
      return { ok: false, reason: 'sector_full' };
    }
  }
  return { ok: true, sectorId: opts.currentSectorId, bindingHash: opts.currentBindingHash };
}

/** Closes the open digest and takes it. A failure still lets the join welcome go out. */
export async function readConnectionReturnDigest(
  colonyId: string | null,
  digests: Pick<AwayDigestService, 'deliverWelcome'> | undefined,
  log: Logger,
  raw: Uint8Array,
): Promise<AwayDigestV1 | null> {
  if (!colonyId || !digests) return null;
  try {
    return await digests.deliverWelcome(colonyId, new Date(), raw);
  } catch (e) {
    log.warn({ err: e, colonyId }, 'away digest unread');
    return null;
  }
}

export function buildWelcomeMessage(opts: {
  readonly reason: 'join' | 'resync';
  readonly colonyId: string | null;
  readonly planetId: string;
  readonly snap: FullState;
  readonly deltaHz: number;
  readonly flags: readonly string[];
  readonly away: AwayDigestV1 | null;
  readonly mode?: 'play' | 'spectator';
  readonly recentInputs?: readonly SimInputFeedItemV1[];
  readonly recentDecisions?: readonly AgentDecisionFeedItemV1[];
}): object {
  const { reason, colonyId, planetId, snap, deltaHz, flags, away, mode, recentInputs, recentDecisions } = opts;
  const type = PlanetType.safeParse(snap.planetType);
  return {
    v: 1,
    t: 'welcome',
    tick: snap.tick,
    d: {
      reason,
      colonyId,
      planet: { id: planetId, type: type.success ? type.data : 'temperate', name: planetId },
      state: snap.bytes,
      simVersion: snap.simVersion,
      dataHash: snap.dataHash,
      tick: snap.tick,
      ...(snap.overrides && Object.keys(snap.overrides).length ? { overrides: snap.overrides } : {}),
      serverTimeMs: Date.now(),
      tickMs: TICK_MS,
      deltaHz,
      flags,
      buildings: buildingCatalog(compileData(new Set(flags), snap.overrides)),
      ...(snap.warp > 1 ? { warp: snap.warp } : {}),
      ...(mode ? { mode } : {}),
      ...(recentInputs?.length ? { recentInputs } : {}),
      ...(recentDecisions?.length ? { recentDecisions } : {}),
      ...welcomeFields(reason, away),
    },
  };
}
