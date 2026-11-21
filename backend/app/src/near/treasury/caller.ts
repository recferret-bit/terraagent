import type { PrismaClient } from '@terra/db';
import type { IncomingMessage } from 'node:http';
import { isValidSectorIdFormat, type SectorAntiCheatService } from '../../core/anticheat/index.js';
import { AuthTokenService, extractBearerPlayer } from '../../core/auth/index.js';
import { CoreException } from '../../core/errors/core-exception.js';
import { devBearerPlayer } from '../../ws/session-verifier.js';
import { AccountId } from '../domain/types.js';

const BEARER_RE = /^Bearer\s+(\S+)$/i;

function assertLiveColonyActiveOnPlanet(
  antiCheat: SectorAntiCheatService | undefined,
  colonyId: string,
  planetId: string,
  requestedSectorId: string | null,
): void {
  if (!antiCheat) return;
  if (requestedSectorId && !isValidSectorIdFormat(requestedSectorId)) {
    antiCheat.recordRejection('http', 'ownership', 'invalid_args');
    throw new CoreException('INVALID_SECTOR', { status: 400, message: `Invalid sector "${requestedSectorId}".` });
  }
  const indexed = antiCheat.index.getColonyById(colonyId);
  if (!indexed) return;
  if (indexed.planetId !== planetId) {
    antiCheat.recordRejection('http', 'ownership', 'not_own_colony');
    throw new CoreException('WRONG_PLANET', { status: 403, message: 'Colony belongs to another planet.' });
  }
  if (indexed.status !== 'ACTIVE') {
    antiCheat.recordRejection('http', 'economy', 'colony_inactive');
    throw new CoreException('COLONY_INACTIVE', { status: 409, message: 'Colony is no longer active.' });
  }
  if (requestedSectorId && requestedSectorId !== indexed.baseSectorId) {
    antiCheat.recordRejection('http', 'ownership', 'cross_sector_disabled');
    throw new CoreException('NOT_YOUR_SECTOR', { status: 403, message: 'Colony is not located in requested sector.' });
  }
}

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
  readonly antiCheat?: SectorAntiCheatService;
}): Promise<string> {
  const requestedSector = bodySector(opts.body) ?? headerValue(opts.req, 'x-sector-id');
  const testId = opts.nodeEnv === 'test' ? testAccount(opts.req, opts.body) : null;
  if (testId && opts.antiCheat && opts.prisma) {
    const row = await opts.prisma.nearColonyAccount?.findFirst?.({
      where: { accountId: testId },
      select: { colonyId: true },
    });
    if (row?.colonyId) assertLiveColonyActiveOnPlanet(opts.antiCheat, row.colonyId, opts.planetId, requestedSector);
  }
  const accountId = testId ?? (opts.prisma ? await sessionAccount(opts, requestedSector) : null);
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

function bodySector(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const value = (body as Record<string, unknown>).sectorId;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function headerValue(req: IncomingMessage, name: string): string | null {
  const raw = req.headers?.[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 ? trimmed : null;
}

async function sessionAccount(
  opts: {
    readonly req: IncomingMessage;
    readonly planetId: string;
    readonly nodeEnv: string | undefined;
    readonly prisma?: PrismaClient;
    readonly tokens?: AuthTokenService;
    readonly antiCheat?: SectorAntiCheatService;
  },
  requestedSector: string | null,
): Promise<string | null> {
  const playerId = playerOf(opts.req, opts.nodeEnv, opts.tokens);
  const prisma = opts.prisma;
  if (!playerId || !prisma) return null;
  if (opts.antiCheat) {
    const activeBase = opts.antiCheat.index.getActiveBaseByPlayer(playerId);
    if (
      activeBase &&
      activeBase.planetId !== opts.planetId &&
      !opts.antiCheat.index.hasActiveColonyForPlayerOnPlanet(playerId, opts.planetId)
    ) {
      opts.antiCheat.recordRejection('http', 'ownership', 'not_own_colony');
      throw new CoreException('WRONG_PLANET', { status: 403, message: `Active colony is on ${activeBase.planetId}.` });
    }
    const latest = opts.antiCheat.index.getLatestBindingByPlayer(playerId);
    if (latest && latest.planetId === opts.planetId && latest.terminalFromLive && latest.status !== 'ACTIVE') {
      opts.antiCheat.recordRejection('http', 'economy', 'colony_inactive');
      throw new CoreException('COLONY_INACTIVE', { status: 409, message: 'Colony is no longer active.' });
    }
  }
  if (typeof prisma.colony?.findFirst !== 'function') return null;
  const colony = await prisma.colony.findFirst({
    where: { playerId, planetId: opts.planetId, status: 'ACTIVE' },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (!colony) return null;
  assertLiveColonyActiveOnPlanet(opts.antiCheat, colony.id, opts.planetId, requestedSector);
  const account = await prisma.nearColonyAccount?.findFirst?.({
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
