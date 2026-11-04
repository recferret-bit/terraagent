import { Inject, Injectable } from '@nestjs/common';
import { isResourceToken, type MarketTokenKey } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { Counter } from 'prom-client';
import { MetricsRegistry } from '../../core/metrics.registry.js';
import { scrapeGauge } from '../../core/scrape-gauge.js';
import { PRISMA } from '../../db/db.module.js';
import type { TradePlan } from '../settlement/trade-plan.js';

const OPEN_STATES = ['OPEN', 'PARTIAL'];
const num = (d: { toString(): string } | null | undefined): number => (d ? Number(d.toString()) : 0);

/** Who rested the maker order of a trade: `player`, `npc` or `fixture` (dev seed bots). Plans from before W13-29 have no kind. */
export const makerKindOf = (plan: Pick<TradePlan, 'makerKind' | 'organic'>): string => plan.makerKind ?? (plan.organic ? 'player' : 'fixture');

/**
 * W13-29 market metrics (NEAR §14) on the shared registry. Counters move once per transition (FINAL trade, FAILED trade);
 * gauges are read from Postgres at scrape time, so a restart never resets them. Money counters/gauges are in the token's
 * **atomic units** (USDC micro, NEAR yocto, whole resource units) as doubles: exact below 2^53, rounded above it (the
 * ledger in Postgres stays exact; these are for dashboards).
 */
@Injectable()
export class MarketMetrics {
  private readonly trades: Counter<'planet' | 'maker_kind'>;
  private readonly fees: Counter<'planet' | 'token' | 'kind'>;
  private readonly failed: Counter<'reason'>;

  constructor(metrics: MetricsRegistry, @Inject(PRISMA) private readonly prisma: PrismaClient) {
    const registers = [metrics.registry];
    this.trades = new Counter({ name: 'market_trades_total', help: 'FINAL market trades, by planet and maker kind (player/npc/fixture)', labelNames: ['planet', 'maker_kind'], registers });
    this.fees = new Counter({ name: 'market_fees_total', help: 'Realized fees of FINAL trades in the quote token atomic units; kind platform (net of treasury), stall or treasury (subsidy share)', labelNames: ['planet', 'token', 'kind'], registers });
    this.failed = new Counter({ name: 'intent_batch_failed_total', help: 'Trade batches that definitely failed and were rolled back, by error code', labelNames: ['reason'], registers });
    const reg = metrics.registry;
    scrapeGauge(reg, { name: 'market_orders_open', help: 'Resting (OPEN/PARTIAL) orders per planet', labelNames: ['planet'] }, async (set) => {
      for (const r of await this.prisma.marketOrder.groupBy({ by: ['planetId'], where: { state: { in: OPEN_STATES } }, _count: { _all: true } })) set({ planet: r.planetId }, r._count._all);
    });
    scrapeGauge(reg, { name: 'market_reserved_principal', help: 'Reserved principal of resting orders per planet and token, atomic units', labelNames: ['planet', 'token'] }, async (set) => {
      for (const [k, v] of await this.reserved('reservedPrincipal')) set(k, v);
    });
    scrapeGauge(reg, { name: 'market_reserved_fees', help: 'Reserved fees (platform + max stall) of resting orders per planet and token, atomic units', labelNames: ['planet', 'token'] }, async (set) => {
      for (const [k, v] of await this.reserved('reservedFees')) set(k, v);
    });
  }

  /** One FINAL trade (called once, by the call that made the transition). */
  tradeFinal(plan: TradePlan): void {
    const planet = plan.planetId;
    this.trades.inc({ planet, maker_kind: makerKindOf(plan) });
    const treasury = BigInt(plan.treasuryFee ?? '0');
    const platform = BigInt(plan.platformFee) - treasury;
    for (const [kind, v] of [['platform', platform], ['stall', BigInt(plan.stallFee)], ['treasury', treasury]] as const) {
      if (v > 0n) this.fees.inc({ planet, token: plan.quote, kind }, Number(v));
    }
  }

  batchFailed(reason: string): void {
    this.failed.inc({ reason });
  }

  private async reserved(field: 'reservedPrincipal' | 'reservedFees'): Promise<Array<[{ planet: string; token: string }, number]>> {
    const rows = await this.prisma.marketOrder.groupBy({ by: ['planetId', 'side', 'base', 'quote'], where: { state: { in: OPEN_STATES } }, _sum: { [field]: true } });
    const out = new Map<string, number>();
    for (const r of rows) {
      const token = (r.side === 'sell' ? r.base : r.quote) as MarketTokenKey;
      const key = `${r.planetId}\u0000${token}`;
      const sum = num((r._sum as Record<string, { toString(): string } | null>)[field]);
      out.set(key, (out.get(key) ?? 0) + (isResourceToken(token) || sum >= 0 ? sum : 0));
    }
    return [...out].filter(([, v]) => v > 0).map(([k, v]) => { const [planet, token] = k.split('\u0000'); return [{ planet: planet!, token: token! }, v]; });
  }
}
