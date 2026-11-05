import type { IncomingMessage } from 'node:http';
import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@terra/db';
import { AuthTokenService, extractBearerPlayer } from '../../core/auth/index.js';
import { databaseEnabled } from '../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { devBearerPlayer, devPlayerId } from '../../ws/session-verifier.js';

const BEARER_RE = /^Bearer\s+(\S+)$/i;
const AS_NAME_RE = /^[a-z0-9_-]{1,32}$/i;
const PLAYER_SLOT = 'player';

export interface MarketCaller {
  readonly playerId: string;
  /** The colony (and its mock chain account) the caller trades with on this planet; null when none is known yet. */
  readonly colony: { readonly colonyId: string; readonly accountId: string } | null;
}

/** Who calls `GET /v1/market/{planetId}`: bearer token (dev `dev:<name>` and `?as=<name>` outside production) and the caller's colony. */
@Injectable()
export class MarketCallers {
  constructor(
    @Inject(AuthTokenService) private readonly tokens: AuthTokenService,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  /** The authenticated player, or null for an anonymous request. A bad token is an error (401), not anonymous. */
  playerOf(req: IncomingMessage, asName?: string): string | null {
    const raw = req.headers?.authorization;
    const header = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    const dev = this.env.NODE_ENV !== 'production';
    if (header) {
      const token = BEARER_RE.exec(header)?.[1];
      const d = dev && token ? devBearerPlayer(token) : null;
      return d ? d.id : extractBearerPlayer(req, this.tokens).id;
    }
    return dev && asName && AS_NAME_RE.test(asName) ? devPlayerId(asName.toLowerCase()) : null;
  }

  /** Colony with this player's orders on the planet, else the first colony account the player owns. */
  async colonyOf(playerId: string, planetId: string): Promise<MarketCaller['colony']> {
    if (!databaseEnabled(this.env)) return null;
    const order = await this.prisma.marketOrder.findFirst({ where: { playerId, planetId }, orderBy: { id: 'desc' }, select: { colonyId: true, accountId: true } });
    if (order) return order;
    const acct = await this.prisma.nearColonyAccount.findFirst({ where: { playerId, slot: { not: PLAYER_SLOT } }, orderBy: { createdAt: 'asc' }, select: { colonyId: true, slot: true, accountId: true } });
    return acct ? { colonyId: acct.colonyId || acct.slot, accountId: acct.accountId } : null;
  }
}
