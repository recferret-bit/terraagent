import type { PrismaClient } from '@terra/db';
import type { IncomingMessage } from 'node:http';
import { AuthTokenService, extractBearerPlayer } from '../../core/auth/index.js';
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
): string | undefined {
  const raw = req?.headers?.authorization;
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

export async function assertColonyOwnership(params: {
  readonly req?: IncomingMessage;
  readonly tokens?: AuthTokenService;
  readonly env?: AppEnv;
  readonly prisma?: PrismaClient;
  readonly port: NearPortName;
  readonly colonyId?: string | null;
  readonly ownerPlayerIdHint?: string | null;
  readonly claimedPlayerId?: string | null;
}): Promise<string | undefined> {
  const callerPlayerId = resolveOptionalBearerPlayerId(params.req, params.tokens, params.env);
  const strict = isStrictNearAuth(params.port, params.env);

  if (params.claimedPlayerId && callerPlayerId && params.claimedPlayerId !== callerPlayerId) {
    throw new NearException('NEAR_NOT_OWNER', {
      status: 403,
      message: 'Body playerId does not match authenticated caller',
    });
  }

  let ownerPlayerId = params.ownerPlayerIdHint ?? undefined;
  const colId = params.colonyId?.trim();
  if (!ownerPlayerId && colId && params.prisma && databaseEnabled(params.env)) {
    const row = await params.prisma.nearColonyAccount.findFirst({
      where: { OR: [{ colonyId: colId }, { slot: colId }] },
      select: { playerId: true },
    });
    ownerPlayerId = row?.playerId;
  }

  if (strict) {
    if (!callerPlayerId) {
      throw new NearException('NEAR_NOT_OWNER', {
        status: 401,
        message: 'Authentication is required for this NEAR action',
      });
    }
    if (ownerPlayerId && ownerPlayerId !== 'dev_pilot' && ownerPlayerId !== callerPlayerId) {
      throw new NearException('NEAR_NOT_OWNER', {
        status: 403,
        message: 'Caller does not own this colony',
      });
    }
    return callerPlayerId;
  }

  if (callerPlayerId && ownerPlayerId && ownerPlayerId !== 'dev_pilot' && ownerPlayerId !== callerPlayerId) {
    throw new NearException('NEAR_NOT_OWNER', {
      status: 403,
      message: 'Caller does not own this colony',
    });
  }
  return callerPlayerId;
}
