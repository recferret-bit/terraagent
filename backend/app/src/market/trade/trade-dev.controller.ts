import { Body, Controller, HttpCode, Inject, Post, UseFilters, UseGuards } from '@nestjs/common';
import { MarketTokenKey, TradeAllowanceUpdate, TradeScope, parseDisplayAmount, type CreateTradeKeyResponse } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { z } from 'zod';
import { DevOnlyGuard } from '../../core/dev-only.guard.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { kekEnv } from '../../near/identity/colony-accounts.js';
import { loadKekRing } from '../../near/keystore/kek.js';
import { KeyStore } from '../../near/keystore/keys.js';
import { ensureCustodialAccount } from '../dev/market-accounts.bootstrap.js';
import { MarketFaucetService } from '../dev/market-faucet.service.js';
import { MarketColonies } from '../orders/market-colonies.js';
import { MarketPolicyProvider } from '../orders/market-policy.provider.js';
import { TradeError, TradeErrorFilter } from './trade-error.js';
import { TradeKeyRepository, keyView } from './trade-key.repository.js';
import { defaultAllowance, mergeAllowance, newKey } from './trade-keys.js';
import { parseBody } from './trade.controller.js';

export const DevBotRequest = z.strictObject({
  /** Bot name: becomes the owner id `bot:<name>`; the same name always yields the same owner. */
  name: z.string().regex(/^[a-z0-9_-]{1,24}$/),
  planetId: z.string().min(1).max(64),
  /** The sim colony the bot trades with (a scenario planet seats `col_<index>`); default 0. */
  colonyIndex: z.number().int().min(0).default(0),
  scopes: z.array(TradeScope).min(1).default(['read', 'trade', 'manage']),
  allowance: TradeAllowanceUpdate.optional(),
  /** Whole-token display amounts credited as fixture funding (`{"USDC":"500"}`). */
  fund: z.partialRecord(MarketTokenKey, z.string()).optional(),
});
export type DevBotRequest = z.infer<typeof DevBotRequest>;

/**
 * `POST /v1/dev/trade/bots` (dev only): creates a bot colony account WITHOUT a human OAuth login: the colony's mock chain account
 * with a sealed custodial signer, optional faucet funding (labelled `fixture` on the chain explorer) and an API key bound to it.
 * The sim colony must exist on the planet (e.g. a scenario seat); a bot cannot conjure one.
 */
@Controller('dev/trade')
@UseGuards(DevOnlyGuard)
@UseFilters(TradeErrorFilter)
export class TradeDevController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly colonies: MarketColonies,
    private readonly faucet: MarketFaucetService,
    private readonly keys: TradeKeyRepository,
    private readonly policy: MarketPolicyProvider,
  ) {}

  @Post('bots')
  @HttpCode(201)
  async bot(@Body() raw: unknown): Promise<CreateTradeKeyResponse & { readonly ownerId: string; readonly funded: Record<string, string> }> {
    this.faucet.assertDevMarket();
    const body = parseBody(DevBotRequest, raw);
    const ownerId = `bot:${body.name}`;
    const colony = await this.colonies.resolve(body.planetId, body.colonyIndex, null, ownerId);
    await ensureCustodialAccount(this.prisma, new KeyStore(loadKekRing(kekEnv(this.env))), colony.accountId, { playerId: ownerId, slot: colony.colonyId });
    const funded: Record<string, string> = {};
    for (const [token, text] of Object.entries(body.fund ?? {}) as Array<[MarketTokenKey, string]>) {
      let atomic: bigint;
      try { atomic = parseDisplayAmount(token, text); } catch (e) { throw new TradeError('invalid_request', (e as Error).message); }
      await this.faucet.fund(colony.accountId, token, atomic);
      funded[token] = atomic.toString();
    }
    const usdcPairs = this.policy.current().pairs.filter((x) => x.quote === 'USDC').map((x) => x.pair);
    const key = newKey();
    const rec = await this.keys.create({
      key, ownerId, label: `dev bot ${body.name}`, planetId: body.planetId, colonyId: colony.colonyId, colonyIndex: colony.colonyIndex, accountId: colony.accountId,
      scopes: body.scopes, allowance: mergeAllowance(defaultAllowance(usdcPairs), body.allowance),
    });
    return { ...keyView(rec), secret: key.secret, ownerId, funded };
  }
}
