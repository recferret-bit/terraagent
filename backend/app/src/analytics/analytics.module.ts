import { Global, Module } from '@nestjs/common';
import { defineEnv, zFlag } from '@terra/config';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsCounters } from './analytics.counters';
import { AnalyticsService } from './analytics.service';

export { AnalyticsCounters } from './analytics.counters';

/** `ANALYTICS_DISABLED=true` is a fail-closed kill switch: the intake still answers 204 but stores nothing. */
export const env = defineEnv('analytics', { ANALYTICS_DISABLED: zFlag() });

/** Product analytics intake (CLIENT §10) and the server counters API. Global so any module can inject `AnalyticsCounters`. */
@Global()
@Module({ controllers: [AnalyticsController], providers: [AnalyticsService, AnalyticsCounters], exports: [AnalyticsCounters] })
export class AnalyticsModule {}
