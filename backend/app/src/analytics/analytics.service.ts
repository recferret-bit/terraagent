import { Inject, Injectable, Optional } from '@nestjs/common';
import { clientMaySend, type AnalyticsBatchV1, type AnalyticsSurfacePingV1 } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { APP_ENV, type AppEnv } from '../core/tokens';
import { PRISMA } from '../db/db.module';
import { AnalyticsCounters } from './analytics.counters';
import type { AnalyticsRelayContext } from './geo-context';
import { PostHogClient } from './posthog-client';

/** Stores consented events. Deliberately takes no request metadata into Postgres: no IP, no user agent. */
@Injectable()
export class AnalyticsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly counters: AnalyticsCounters,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
    @Optional() private readonly posthog?: PostHogClient,
  ) {}

  async ingest(batch: AnalyticsBatchV1, geo?: AnalyticsRelayContext): Promise<number> {
    if (this.env?.ANALYTICS_DISABLED === true) return 0;
    const kept = [];
    for (const event of batch.events) {
      if (!clientMaySend(event.name)) {
        this.counters.count('ta_analytics_spoof_total', { name: event.name });
        continue;
      }
      kept.push(event);
    }
    if (kept.length === 0) return 0;
    const rows = kept.map((e) => ({ name: e.name, ts: new Date(e.ts), anonId: batch.anonId, sessionId: batch.sessionId, props: e.props }));
    const { count } = await this.prisma.analyticsEvent.createMany({ data: rows });
    for (const e of kept) this.counters.count('ta_analytics_events_total', { name: e.name });
    await this.posthog?.forwardClient(batch.anonId, kept, geo);
    return count;
  }

  /** Cookieless load counter. No row, no anon id. */
  surface(ping: AnalyticsSurfacePingV1): void {
    if (this.env?.ANALYTICS_DISABLED === true) return;
    this.counters.count('ta_surface_views_total', { surface: ping.surface, consent: ping.consent });
  }
}
