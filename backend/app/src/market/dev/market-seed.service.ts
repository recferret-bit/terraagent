import { Inject, Injectable, Optional } from '@nestjs/common';
import { isResourceToken, marketOrderRef, parsePairId, type MarketTokenKey, type OrderSide } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { defaultParamRegistry } from '@terra/sim';
import { z } from 'zod';
import type { PlanetEventOf } from '../../bus/channels.js';
import { CoreException } from '../../core/errors/index.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { kekEnv } from '../../near/identity/colony-accounts.js';
import { loadKekRing } from '../../near/keystore/kek.js';
import { KeyStore } from '../../near/keystore/keys.js';
import { MarketOrderRepository } from '../book/market-order.repository.js';
import { OrderRelease } from '../orders/cancel-order.service.js';
import { resolveMarketAccountId } from '../orders/colony-account.js';
import { MarketPolicyProvider } from '../orders/market-policy.provider.js';
import { requirementOf } from '../orders/order-funds.js';
import { PlaceOrderService } from '../orders/place-order.service.js';
import { ensureCustodialAccount } from './market-accounts.bootstrap.js';
import { MarketFaucetService } from './market-faucet.service.js';

export const SeedArgs = z.strictObject({ planetId: z.string().min(1), pair: z.string().min(1) });
export const ClearArgs = z.strictObject({ planetId: z.string().min(1) });

/** The fixture bot colony of a planet: labelled, never in the sim, never organic (D-44). */
export const botColonyId = (planetId: string): string => `bot.${planetId}`;
const BOT_COLONY_INDEX = 99;

export interface SeedResult {
  readonly planetId: string;
  readonly pair: string;
  readonly botColonyId: string;
  readonly accountId: string;
  readonly actorKind: 'fixture';
  readonly bids: number;
  readonly asks: number;
  readonly orderIds: string[];
}

interface SeedRow {
  readonly levels: number;
  readonly stepBp: bigint;
  readonly sizeUnits: bigint;
  readonly ttlS: number;
  readonly mid: Record<'USDC' | 'NEAR' | 'resource', bigint>;
}

/** The `market.dev.seed.*` data row (D-35); bootstrap defaults. */
function seedRow(): SeedRow {
  const get = (f: string): unknown => defaultParamRegistry().get(`market.dev.seed.${f}`)?.default;
  return {
    levels: Number(get('levels')), stepBp: BigInt(get('stepBp') as number), sizeUnits: BigInt(get('sizeUnits') as number), ttlS: Number(get('ttlS')),
    mid: { USDC: BigInt(get('midUsdcAtomic') as string), NEAR: BigInt(get('midNearAtomic') as string), resource: BigInt(get('midResourceAtomic') as string) },
  };
}

/**
 * Dev `market.seed` / `market.clear` (W13-30). The bot is a fixture colony `bot.<planetId>` with a mock chain account
 * funded straight in the verifier ledger (fixture funding notes, like the faucet). Its orders go through the real
 * `PlaceOrderService` (policy pinning, reservations, books), labelled `actorKind: 'fixture'`, and are NOT mirrored to the
 * sim: the bot has no sim colony, so no `market.reserve` / `market.release` is sent for it.
 */
@Injectable()
export class MarketSeedService {
  private seq = 0;

  constructor(
    private readonly place: PlaceOrderService,
    private readonly release: OrderRelease,
    private readonly faucet: MarketFaucetService,
    private readonly policy: MarketPolicyProvider,
    private readonly repo: MarketOrderRepository,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
  ) {}

  async seed(raw: unknown): Promise<SeedResult> {
    this.faucet.assertDevMarket();
    const { planetId, pair } = SeedArgs.parse(raw);
    const parsed = parsePairId(pair);
    if (!parsed) throw new CoreException('VALIDATION_ERROR', { status: 400, message: `bad pair "${pair}" (expected <base>/<quote>, e.g. bio.water/metals.t1)` });
    const row = seedRow();
    const cfg = this.policy.current();
    if (!cfg.pairs.some((p) => p.pair === pair)) throw new CoreException('VALIDATION_ERROR', { status: 400, message: `pair "${pair}" is not tradable` });

    await this.clearBook(planetId, pair);
    const colonyId = botColonyId(planetId);
    const accountId = await resolveMarketAccountId(this.prisma, colonyId, null, planetId, BOT_COLONY_INDEX);
    // The bot's fills settle through the verifier like any trade: its account must be able to sign (dev only; same key path as the fee accounts).
    await ensureCustodialAccount(this.prisma, new KeyStore(loadKekRing(this.env ? kekEnv(this.env) : { NODE_ENV: 'test' })), accountId);
    const ladder = this.ladder(row, parsed.quote);
    await this.fundBot(accountId, parsed.base, parsed.quote, row, ladder, cfg.platformFeeBp, cfg.stallFeeMaxBp);

    const orderIds: string[] = [];
    let bids = 0;
    let asks = 0;
    const stamp = Date.now();
    for (const o of ladder) {
      const ref = marketOrderRef(colonyId, ++this.seq + stamp);
      const event = {
        planetId, tick: 0, kind: 'marketOrderRequested', severity: 'info', colonyIds: [colonyId],
        data: {
          ref, orderSeq: this.seq, colonyId, colonyIndex: BOT_COLONY_INDEX, side: o.side, resource: parsed.base, amount: Number(row.sizeUnits),
          price: { token: parsed.quote, amount: o.total.toString() }, ttlS: row.ttlS, stallFeeBp: cfg.stallFeeDefaultBp, hubEntityId: 0, stallName: 'Fixture Bot',
        },
      } as unknown as PlanetEventOf<'marketOrderRequested'>;
      const res = await this.place.handle(event, { actorKind: 'fixture', answerSim: false });
      if (!res || res.rejected) throw new CoreException('VALIDATION_ERROR', { status: 400, message: `seed order rejected: ${res?.rejected?.detail ?? 'database off'}` });
      orderIds.push(res.order.orderId);
      if (o.side === 'buy') bids += 1; else asks += 1;
    }
    return { planetId, pair, botColonyId: colonyId, accountId, actorKind: 'fixture', bids, asks, orderIds };
  }

  /** Cancels every open fixture-bot order on the planet (all pairs). */
  async clear(raw: unknown): Promise<{ planetId: string; cancelled: number }> {
    this.faucet.assertDevMarket();
    const { planetId } = ClearArgs.parse(raw);
    return { planetId, cancelled: await this.clearBook(planetId) };
  }

  private async clearBook(planetId: string, pair?: string): Promise<number> {
    const open = await this.prisma.marketOrder.findMany({
      where: { planetId, actorKind: 'fixture', state: { in: ['OPEN', 'PARTIAL'] }, ...(pair ? { pair } : {}) }, select: { orderId: true },
    });
    let n = 0;
    for (const o of open) if ((await this.release.release(o.orderId, 'cancelled')).kind === 'released') n += 1;
    return n;
  }

  /** Bids below and asks above mid, `stepBp` apart; `total` is the quote for the whole order. */
  private ladder(row: SeedRow, quote: MarketTokenKey): { side: OrderSide; total: bigint }[] {
    const mid = row.mid[quote === 'USDC' || quote === 'NEAR' ? quote : 'resource'];
    const out: { side: OrderSide; total: bigint }[] = [];
    for (let k = 1; k <= row.levels; k++) {
      const down = 10_000n - BigInt(k) * row.stepBp;
      const up = 10_000n + BigInt(k) * row.stepBp;
      const total = (bp: bigint): bigint => {
        const t = (row.sizeUnits * mid * bp) / 10_000n;
        return t > 0n ? t : 1n;
      };
      out.push({ side: 'buy', total: total(down > 0n ? down : 1n) }, { side: 'sell', total: total(up) });
    }
    return out;
  }

  private async fundBot(
    accountId: string, base: MarketTokenKey, quote: MarketTokenKey, row: SeedRow, ladder: { side: OrderSide; total: bigint }[],
    platformFeeBp: number, maxStallFeeBp: number,
  ): Promise<void> {
    const need = new Map<MarketTokenKey, bigint>();
    for (const o of ladder) {
      const r = requirementOf({ side: o.side, base: base as never, quote: quote as never, amount: row.sizeUnits, priceAmount: o.total, platformFeeBp, maxStallFeeBp });
      need.set(r.token, (need.get(r.token) ?? 0n) + r.principal + r.fees);
    }
    for (const [token, amount] of need) {
      if (isResourceToken(token) || token === 'USDC' || token === 'NEAR') await this.faucet.fund(accountId, token, amount);
    }
  }
}
