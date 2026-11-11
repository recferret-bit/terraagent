import type { PrismaClient } from '@terra/db';
import type { IncomingMessage } from 'node:http';
import { AuthTokenService, extractBearerPlayer } from '../../core/auth/index.js';
import { CoreException } from '../../core/errors/core-exception.js';
import { devBearerPlayer } from '../../ws/session-verifier.js';
import { AccountId } from '../domain/types.js';

const BEARER_RE = /^Bearer\s+(\S+)$/i;

/**
 * Who proposes or votes. A bearer session resolves to that player's colony account on the planet.
 * `NODE_ENV=test` only: body `colonyAccountId` or header `x-colony-account-id` (body wins). Ignored otherwise.
 */
export async function resolveColonyAccount(opts: {
  readonly req: IncomingMessage;
  readonly body: unknown;
  readonly planetId: string;
  readonly nodeEnv: string | undefined;
  readonly prisma?: PrismaClient;
  readonly tokens?: AuthTokenService;
}): Promise<string> {
  const testId = opts.nodeEnv === 'test' ? testAccount(opts.req, opts.body) : null;
  const accountId = testId ?? (opts.prisma ? await sessionAccount(opts) : null);
  if (!accountId) {
    throw new CoreException('UNAUTHORIZED', { status: 401, message: 'No colony account for this session.' });
  }
  const parsed = AccountId.safeParse(accountId);
  if (!parsed.success) throw new CoreException('invalid_args', { status: 400, message: 'Colony account is invalid.' });
  return parsed.data;
}

function testAccount(req: IncomingMessage, body: unknown): string | null {
  return bodyAccount(body) ?? headerValue(req, 'x-colony-account-id');
}

function bodyAccount(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const value = (body as Record<string, unknown>).colonyAccountId;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function headerValue(req: IncomingMessage, name: string): string | null {
  const raw = req.headers?.[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 ? trimmed : null;
}

async function sessionAccount(opts: {
  readonly req: IncomingMessage;
  readonly planetId: string;
  readonly nodeEnv: string | undefined;
  readonly prisma?: PrismaClient;
  readonly tokens?: AuthTokenService;
}): Promise<string | null> {
  const playerId = playerOf(opts.req, opts.nodeEnv, opts.tokens);
  const prisma = opts.prisma;
  if (!playerId || !prisma) return null;
  const colony = await prisma.colony.findFirst({
    where: { playerId, planetId: opts.planetId },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (!colony) return null;
  const account = await prisma.nearColonyAccount.findFirst({
    where: { colonyId: colony.id },
    select: { accountId: true },
  });
  return account?.accountId ?? null;
}

function playerOf(req: IncomingMessage, nodeEnv: string | undefined, tokens: AuthTokenService | undefined): string | null {
  const raw = req.headers?.authorization;
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (typeof header !== 'string') return null;
  const token = BEARER_RE.exec(header.trim())?.[1];
  if (!token) return null;
  if (nodeEnv !== 'production') {
    const dev = devBearerPlayer(token);
    if (dev) return dev.id;
  }
  if (!tokens) return null;
  try {
    return extractBearerPlayer(req, tokens).id;
  } catch {
    return null;
  }
}
