import type { PrismaClient } from '@terra/db';
import type { IncomingMessage } from 'node:http';
import { isValidSectorIdFormat, type SectorAntiCheatService } from '../../core/anticheat/index.js';
import { AuthTokenService, extractBearerPlayer } from '../../core/auth/index.js';
import { CoreException } from '../../core/errors/core-exception.js';
import { databaseEnabled } from '../../core/persistence.js';
import type { AppEnv } from '../../core/tokens.js';
import { devBearerPlayer } from '../../ws/session-verifier.js';
import { NearException } from '../domain/errors.js';
import type { NearPortName } from '../domain/types.js';
import { nearAdapterFor } from '../infrastructure/adapter-selection.js';

const BEARER_RE = /^Bearer\s+(\S+)$/i;

export function resolveOptionalBearerPlayerId(
  req: IncomingMessage | undefined,
  tokens?: AuthTokenService,
  env?: AppEnv,
  authHeader?: string,
): string | undefined {
  const raw = authHeader ?? req?.headers?.authorization;
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (typeof header !== 'string' || !header.trim()) return undefined;
  const token = BEARER_RE.exec(header.trim())?.[1];
  const nodeEnv = env?.NODE_ENV ?? process.env.NODE_ENV;
  if (token && nodeEnv !== 'production') {
    const dev = devBearerPlayer(token);
    if (dev) return dev.id;
  }
  if (!tokens) return undefined;
  try {
    return extractBearerPlayer(req!, tokens)?.id;
  } catch {
    return undefined;
  }
}

export function isStrictNearAuth(port: NearPortName, env?: AppEnv): boolean {
  const envMap = (env ?? process.env) as Record<string, string | undefined>;
  const nodeEnv = env?.NODE_ENV ?? process.env.NODE_ENV;
  return nearAdapterFor(port, envMap) !== 'mock' || nodeEnv === 'production';
}

function assertColonyLocationTuple(opts: {
  readonly actualPlanetId?: string | null;
  readonly actualColonyIndex?: number | null;
  readonly actualSectorId?: string | null;
  readonly expectedPlanetId?: string | null;
  readonly expectedColonyIndex?: number | null;
  readonly expectedSectorId?: string | null;
  readonly antiCheat?: SectorAntiCheatService;
}): void {
  if (opts.expectedPlanetId && opts.actualPlanetId && opts.actualPlanetId !== opts.expectedPlanetId) {
    opts.antiCheat?.recordRejection('http', 'ownership', 'not_your_planet');
    throw new NearException('NEAR_NOT_OWNER', {
      status: 403,
      message: 'Colony does not belong to target planet',
    });
  }
  if (
    opts.expectedColonyIndex !== undefined &&
    opts.expectedColonyIndex !== null &&
    typeof opts.actualColonyIndex === 'number' &&
    opts.actualColonyIndex !== opts.expectedColonyIndex
  ) {
    opts.antiCheat?.recordRejection('http', 'ownership', 'not_own_colony');
    throw new NearException('NEAR_NOT_OWNER', {
      status: 403,
      message: 'colonyIndex does not match colony record',
    });
  }
  if (opts.expectedSectorId) {
    const trimmedExpected = opts.expectedSectorId.trim();
    if (trimmedExpected && !isValidSectorIdFormat(trimmedExpected)) {
      opts.antiCheat?.recordRejection('http', 'ownership', 'invalid_args');
      throw new CoreException('INVALID_SECTOR', {
        status: 400,
        message: `Invalid sector "${trimmedExpected}"`,
        details: { code: 'invalid_args' },
      });
    }
    if (opts.actualSectorId && opts.actualSectorId !== trimmedExpected) {
      opts.antiCheat?.recordRejection('http', 'ownership', 'not_your_sector');
      throw new NearException('NEAR_NOT_OWNER', {
        status: 403,
        message: 'Colony is not located in requested sector',
      });
    }
  }
}

async function resolveOwnerAndVerifyLocation(params: {
  readonly colId: string | undefined;
  readonly ownerPlayerIdHint?: string | null;
  readonly prisma?: PrismaClient;
  readonly env?: AppEnv;
  readonly expectedPlanetId?: string | null;
  readonly expectedColonyIndex?: number | null;
  readonly expectedSectorId?: string | null;
  readonly antiCheat?: SectorAntiCheatService;
}): Promise<string | undefined> {
  let ownerPlayerId = params.ownerPlayerIdHint ?? undefined;
  const colId = params.colId;
  const indexed = colId ? params.antiCheat?.index.getColonyById(colId) : undefined;
  if (indexed) {
    if (!ownerPlayerId && indexed.playerId) ownerPlayerId = indexed.playerId;
    assertColonyLocationTuple({
      actualPlanetId: indexed.planetId,
      actualColonyIndex: indexed.colonyIndex,
      actualSectorId: indexed.baseSectorId,
      expectedPlanetId: params.expectedPlanetId,
      expectedColonyIndex: params.expectedColonyIndex,
      expectedSectorId: params.expectedSectorId,
      antiCheat: params.antiCheat,
    });
  }

  const isMockPrisma = Boolean(params.prisma && !('$connect' in params.prisma));
  const useDb = Boolean(colId && params.prisma && (databaseEnabled(params.env) || isMockPrisma));
  if (!colId || !useDb || !params.prisma) return ownerPlayerId;

  if (!ownerPlayerId) {
    const row = await params.prisma.nearColonyAccount?.findFirst?.({
      where: { OR: [{ colonyId: colId }, { slot: colId }] },
      select: { playerId: true },
    });
    ownerPlayerId = row?.playerId ?? undefined;
  }
  if (typeof params.prisma.colony?.findUnique === 'function') {
    const colRow = (await params.prisma.colony.findUnique({
      where: { id: colId },
      select: { playerId: true, planetId: true, colonyIndex: true, foundingSectorId: true, status: true },
    })) as {
      playerId?: string;
      planetId?: string;
      colonyIndex?: number;
      foundingSectorId?: string | null;
      status?: string;
    } | null;
    if (colRow) {
      if (!ownerPlayerId && colRow.playerId) ownerPlayerId = colRow.playerId;
      assertColonyLocationTuple({
        actualPlanetId: colRow.planetId,
        actualColonyIndex: colRow.colonyIndex,
        actualSectorId: colRow.foundingSectorId,
        expectedPlanetId: params.expectedPlanetId,
        expectedColonyIndex: params.expectedColonyIndex,
        expectedSectorId: params.expectedSectorId,
        antiCheat: params.antiCheat,
      });
      if (!indexed && params.antiCheat && colRow.planetId && typeof colRow.colonyIndex === 'number') {
        params.antiCheat.index.upsertColonyBase({
          playerId: colRow.playerId ?? ownerPlayerId ?? '',
          colonyId: colId,
          planetId: colRow.planetId,
          colonyIndex: colRow.colonyIndex,
          foundingSectorId: colRow.foundingSectorId,
          status: colRow.status,
        });
      }
    }
  }
  return ownerPlayerId;
}

export async function assertColonyOwnership(params: {
  readonly req?: IncomingMessage;
  readonly tokens?: AuthTokenService;
  readonly env?: AppEnv;
  readonly prisma?: PrismaClient;
  readonly port: NearPortName;
  readonly colonyId?: string | null;
  readonly ownerPlayerIdHint?: string | null;
  readonly claimedPlayerId?: string | null;
  readonly expectedPlanetId?: string | null;
  readonly expectedColonyIndex?: number | null;
  readonly expectedSectorId?: string | null;
  readonly antiCheat?: SectorAntiCheatService;
}): Promise<string | undefined> {
  const callerPlayerId = resolveOptionalBearerPlayerId(params.req, params.tokens, params.env);
  const strict = isStrictNearAuth(params.port, params.env);

  if (strict && !callerPlayerId) {
    throw new NearException('NEAR_NOT_OWNER', {
      status: 401,
      message: 'Authentication is required for this NEAR action',
    });
  }

  if (params.claimedPlayerId && callerPlayerId && params.claimedPlayerId !== callerPlayerId) {
    params.antiCheat?.recordRejection('http', 'ownership', 'not_own_colony');
    throw new NearException('NEAR_NOT_OWNER', {
      status: 403,
      message: 'Body playerId does not match authenticated caller',
    });
  }

  const ownerPlayerId = await resolveOwnerAndVerifyLocation({
    colId: params.colonyId?.trim(),
    ownerPlayerIdHint: params.ownerPlayerIdHint,
    prisma: params.prisma,
    env: params.env,
    expectedPlanetId: params.expectedPlanetId,
    expectedColonyIndex: params.expectedColonyIndex,
    expectedSectorId: params.expectedSectorId,
    antiCheat: params.antiCheat,
  });

  const nodeEnv = params.env?.NODE_ENV ?? process.env.NODE_ENV;
  const isDevSharedOwner = ownerPlayerId === 'dev_pilot' && nodeEnv !== 'production';

  if (strict) {
    if (!callerPlayerId) {
      throw new NearException('NEAR_NOT_OWNER', {
        status: 401,
        message: 'Authentication is required for this NEAR action',
      });
    }
    if (ownerPlayerId && !isDevSharedOwner && ownerPlayerId !== callerPlayerId) {
      params.antiCheat?.recordRejection('http', 'ownership', 'not_own_colony');
      throw new NearException('NEAR_NOT_OWNER', {
        status: 403,
        message: 'Caller does not own this colony',
      });
    }
    return callerPlayerId;
  }

  if (callerPlayerId && ownerPlayerId && !isDevSharedOwner && ownerPlayerId !== callerPlayerId) {
    params.antiCheat?.recordRejection('http', 'ownership', 'not_own_colony');
    throw new NearException('NEAR_NOT_OWNER', {
      status: 403,
      message: 'Caller does not own this colony',
    });
  }
  return callerPlayerId;
}
