import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@terra/db';
import { PRISMA } from '../../db/db.module.js';
import { MarketPolicyProvider } from '../orders/market-policy.provider.js';
import { computeMarketAnalytics, type MarketAnalytics } from './market-analytics.js';

export const DEFAULT_WINDOW_HOURS = 24;
const MAX_WINDOW_HOURS = 24 * 30;

/** Loads the FINAL trades of a planet window and runs the pure aggregate (W13-28). Read-only; nothing here touches settlement. */
@Injectable()
export class MarketAnalyticsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient, private readonly policy: MarketPolicyProvider) {}

  async report(planetId: string, hours = DEFAULT_WINDOW_HOURS): Promise<MarketAnalytics> {
    const h = Math.min(Math.max(1, Math.floor(hours) || DEFAULT_WINDOW_HOURS), MAX_WINDOW_HOURS);
    const since = new Date(Date.now() - h * 3_600_000);
    const rows = await this.prisma.intentTrade.findMany({
      where: { planetId, state: 'FINAL', settledAt: { gte: since } },
      select: { quote: true, buyerColonyId: true, sellerColonyId: true, buyerActorKind: true, sellerActorKind: true, organic: true, notional: true, platformFee: true, stallFee: true },
    });
    const platformFeeBp = this.policy.current().platformFeeBp;
    return computeMarketAnalytics(rows.map((r) => ({
      ...r, notional: BigInt(r.notional.toFixed(0)), platformFee: BigInt(r.platformFee.toFixed(0)), stallFee: BigInt(r.stallFee.toFixed(0)),
    })), h, platformFeeBp);
  }
}
