import type { Logger } from 'pino';
import {
  ClientMessage,
  decodeWire,
  PlanetType,
  type AwayDigestV1,
  type HomeResponse,
} from '@terra/contracts';
import type { RawData } from 'ws';
import type { AwayDigestService } from '../../game/digest';
import type { FullState, GamePlanets } from '../../game/game-planets.service';
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
}): object {
  const { reason, colonyId, planetId, snap, deltaHz, flags, away } = opts;
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
      ...(snap.warp > 1 ? { warp: snap.warp } : {}),
      ...welcomeFields(reason, away),
    },
  };
}
