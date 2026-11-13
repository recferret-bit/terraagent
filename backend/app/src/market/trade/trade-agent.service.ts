import { Inject, Injectable, Optional } from '@nestjs/common';
import type { AgentQuoteQuery, AgentQuoteResponse, MarketTokenKey } from '@terra/contracts';
import { withTransaction, type PrismaClient } from '@terra/db';
import { agentParamsFromData, compileData, quoteColony, toPlaceOrderArgs, type AgentColonyInput, type AgentParams, type SideQuote } from '@terra/sim';
import { FlagsService } from '../../flags/flags.service.js';
import { PRISMA } from '../../db/db.module.js';
import { EconomyProfileService } from '../../economy/profile/profile.service.js';
import { colonyFunds } from '../api/colony-funds.js';
import { PriceBoardService } from '../board/price-board.service.js';
import { MarketPolicyProvider } from '../orders/market-policy.provider.js';
import { TradeAuth, type TradePrincipal } from './trade-auth.js';
import { TradeError } from './trade-error.js';
import { OrderFunds } from '../orders/order-funds.js';
import { TradeOrdersService } from './trade-orders.service.js';
import { TradeRequestRepository } from './trade-request.repository.js';
import { resolveDbStakerPerks } from '../../near/staking/staker-perks.js';

type Ratio = { readonly num: bigint; readonly den: bigint };
const ratioOf = (t: string | undefined): Ratio | null => {
  if (t === undefined) return null;
  const [n, d] = t.split('/');
  return { num: BigInt(n!), den: BigInt(d ?? '1') };
};

/**
 * `GET /v1/trade/agent/quote`: the quote library (`@terra/sim` `quoteColony`) fed with what the backend knows (organic reference
 * from the price board, the caller's free cargo and quote funds, remaining daily budget, policy fees and lots) plus the planning
 * inputs the caller passes. The answer is the library's: exact bid/ask and reason codes, and bodies that go straight to `POST /orders`.
 * Nothing is priced here.
 */
@Injectable()
export class TradeAgentService {
  private params: Promise<AgentParams> | null = null;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly orders: TradeOrdersService,
    private readonly board: PriceBoardService,
    private readonly funds: OrderFunds,
    private readonly policy: MarketPolicyProvider,
    private readonly requests: TradeRequestRepository,
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Optional() private readonly profiles?: EconomyProfileService,
  ) {}

  /** The pinned `market.agent` row of the active profile (cached; the profile hash does not change within a process run unless activated). */
  private agentParams(): Promise<AgentParams> {
    return (this.params ??= (async () => {
      const overrides = this.profiles ? (await this.profiles.compiledFor({})).overrides : undefined;
      return agentParamsFromData(compileData(new Set(this.flags.list), overrides));
    })().catch((e: unknown) => { this.params = null; throw e; }));
  }

  async quote(p: TradePrincipal, q: AgentQuoteQuery): Promise<AgentQuoteResponse> {
    this.orders.gate();
    TradeAuth.require(p, 'read');
    const planetId = this.orders.planetOf(p, q.planetId);
    const colony = await this.orders.colonyOrThrow(p, planetId);
    const pair = this.policy.current().pairs.find((x) => x.base === q.resource && x.quote === q.quote);
    if (!pair) throw new TradeError('invalid_request', `No pair ${q.resource}/${q.quote}.`, { resource: q.resource, quote: q.quote });
    const views = await colonyFunds(this.funds, colony);
    const row = (await this.board.board(planetId)).find((r) => r.pair === pair.pair);
    const last = await this.prisma.intentTrade.findFirst({ where: { planetId, pair: pair.pair, state: 'FINAL', organic: true }, orderBy: { settledAt: 'desc' }, select: { settledAt: true } });
    const ageS = last?.settledAt ? Math.max(0, Math.floor((Date.now() - last.settledAt.getTime()) / 1000)) : null;
    const budgetLeft = await this.budgetLeft(p, colony.colonyId);
    const res = views[q.resource];
    const inventory = res.cargo + res.verifier;
    const baseCfg = this.policy.current();
    const perks = await resolveDbStakerPerks(this.prisma, {
      colonyId: colony.colonyId,
      accountId: colony.accountId,
      standardPlatformFeeBp: baseCfg.platformFeeBp,
    });
    const input: AgentColonyInput = {
      resource: q.resource, quote: q.quote as MarketTokenKey,
      need: { planned: BigInt(q.planned), reserve: BigInt(q.reserve), available: BigInt(q.available), expectedOwn: BigInt(q.expectedOwn) },
      inventory, target: q.target === undefined ? inventory : BigInt(q.target), freeUnits: res.free, keepUnits: BigInt(q.keep),
      reference: { price: row?.vwap ? { num: BigInt(row.vwap.num), den: BigInt(row.vwap.den) } : null, ageS, eligibleVolume: row?.eligibleVolume ?? null, basis: 'organic' },
      walkAway: { localUnitCost: ratioOf(q.localUnitCost), localMinutesPerUnit: ratioOf(q.localMinutesPerUnit), minuteValue: ratioOf(q.minuteValue), needValue: ratioOf(q.needValue) },
      ownUnitCost: ratioOf(q.ownUnitCost), transportPerUnit: ratioOf(q.transportPerUnit), freeQuote: views[q.quote as MarketTokenKey].free, budgetLeft,
      platformFeeBp: perks.platformFeeBp, maxStallFeeBp: baseCfg.stallFeeMaxBp, lotUnits: pair.lotUnits, minNotionalAtomic: BigInt(pair.minNotionalAtomic),
    };
    const quotes = quoteColony(input, await this.agentParams());
    const side = (s: SideQuote | null) => (s ? { order: { planetId, ...toPlaceOrderArgs(s, q.resource, q.ttlS) } as never, maxSpend: s.maxSpend.toString() } : null);
    return {
      planetId, resource: q.resource, quote: q.quote, basis: quotes.basis, mid: quotes.mid ? { num: quotes.mid.num.toString(), den: quotes.mid.den.toString() } : null,
      bid: side(quotes.bid), ask: side(quotes.ask), bidReasons: [...quotes.bidReasons], askReasons: [...quotes.askReasons],
      inputs: { freeUnits: res.free.toString(), inventory: inventory.toString(), freeQuote: input.freeQuote.toString(), budgetLeft: budgetLeft === null ? null : budgetLeft.toString(), referenceAgeS: ageS, eligibleVolume: input.reference.eligibleVolume },
    };
  }

  /** Remaining daily budget of a key (quote atomic); null for a session (no allowance). */
  private async budgetLeft(p: TradePrincipal, colonyId: string): Promise<bigint | null> {
    if (!p.key) return null;
    const use = await withTransaction(this.prisma, (tx) => this.requests.usage(p.key!.keyId, colonyId, tx, Date.now()));
    const left = BigInt(p.key.allowance.dailyBudget) - use.committedToday;
    return left > 0n ? left : 0n;
  }
}
