import { Inject, Injectable } from '@nestjs/common';
import type { AnalyticsBatchV1 } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { PRISMA } from '../db/db.module';
import { AnalyticsCounters } from './analytics.counters';

/** Stores consented events. Deliberately takes no request metadata: no IP, no user agent. */
@Injectable()
export class AnalyticsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient, private readonly counters: AnalyticsCounters) {}

  async ingest(batch: AnalyticsBatchV1): Promise<number> {
    const rows = batch.events.map((e) => ({ name: e.name, ts: new Date(e.ts), anonId: batch.anonId, sessionId: batch.sessionId, props: e.props }));
    const { count } = await this.prisma.analyticsEvent.createMany({ data: rows });
    for (const e of batch.events) this.counters.count('ta_analytics_events_total', { name: e.name });
    return count;
  }
}
