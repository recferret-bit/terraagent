import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { MarketPlaceOrderArgs } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { CommandPrechecks, type CommandPrecheck } from '../../core/command-prechecks.js';
import { databaseEnabled } from '../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { MarketOrderRepository } from '../book/market-order.repository.js';
import { MarketColonies } from './market-colonies.js';
import { OrderFunds, requirementOf } from './order-funds.js';
import { MarketPolicyProvider } from './market-policy.provider.js';

/**
 * Synchronous server precheck of `market.placeOrder` (W13-09): open-order limit and effective spend (free funds against the
 * order's full lock, buyer fees included). Read-only; the event handler re-checks under lock.
 */
@Injectable()
export class PlaceOrderPrecheck implements OnModuleInit, OnModuleDestroy {
  private off: (() => void) | null = null;

  constructor(
    private readonly prechecks: CommandPrechecks,
    private readonly funds: OrderFunds,
    private readonly repo: MarketOrderRepository,
    private readonly policy: MarketPolicyProvider,
    private readonly colonies: MarketColonies,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  onModuleInit(): void {
    this.off ??= this.prechecks.register('market.placeOrder', this.check);
  }

  onModuleDestroy(): void {
    this.off?.();
    this.off = null;
  }

  readonly check: CommandPrecheck = async (input) => {
    if (!input.colony || !databaseEnabled(this.env)) return null;
    const a = input.args as Partial<MarketPlaceOrderArgs>;
    if (!wellFormed(a)) return null; // malformed args never throw here: the sim rejects them with invalid_args
    const cfg = this.policy.current();
    const { colonyId, accountId } = await this.colonies.resolve(input.planetId, input.colony.colonyIndex, input.colony.id, input.playerId);
    if ((await this.repo.listOpenByColony(input.planetId, colonyId)).length >= cfg.openOrderLimit) return { code: 'order_limit', detail: `At most ${cfg.openOrderLimit} open orders.` };
    const need = requirementOf({
      side: a.side, base: a.resource, quote: a.price.token, amount: BigInt(a.amount), priceAmount: BigInt(a.price.amount),
      platformFeeBp: cfg.platformFeeBp, maxStallFeeBp: a.maxStallFeeBp ?? cfg.stallFeeMaxBp,
    });
    const view = await this.funds.view(accountId, need.token);
    const total = need.principal + need.fees;
    if (view.free < total) return { code: 'insufficient_cargo', detail: `Need ${total} ${need.token} (incl. fees), ${view.free} free.` };
    return null;
  };
}

const ATOMIC_RE = /^(0|[1-9]\d{0,77})$/;

/** True when `a` has the shape the BigInt conversions in `check` need; anything else is left to the sim's strict args check. */
export function wellFormed(a: Partial<MarketPlaceOrderArgs>): a is MarketPlaceOrderArgs {
  if (!a.price || typeof a.price !== 'object' || typeof a.price.amount !== 'string' || !ATOMIC_RE.test(a.price.amount)) return false;
  if (typeof a.amount !== 'number' || !Number.isSafeInteger(a.amount) || a.amount <= 0) return false;
  if (typeof a.resource !== 'string' || typeof a.side !== 'string' || typeof a.price.token !== 'string') return false;
  const bp = a.maxStallFeeBp;
  return bp === undefined || (typeof bp === 'number' && Number.isInteger(bp) && bp >= 0 && bp <= 10_000);
}
