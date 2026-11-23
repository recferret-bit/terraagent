import { Global, Module } from '@nestjs/common';
import { defineEnv, zFlag } from '@terra/config';
import { z } from 'zod';
import { IpThrottleGuard } from '../core/ip-throttle.guard';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsCounters } from './analytics.counters';
import { AnalyticsService } from './analytics.service';
import { PostHogClient } from './posthog-client';
import { ProductRecorder } from './product-recorder';

export { AnalyticsCounters } from './analytics.counters';
export { ProductRecorder } from './product-recorder';

const blank = z.string().optional().transform((value) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
});

/**
 * `ANALYTICS_DISABLED=true` is fail-closed: intake and the surface ping still answer 204 and store nothing.
 * Server commits store nothing and do not call PostHog either.
 * `POSTHOG_ENABLED` is `zFlag`: only the exact string `true` turns PostHog on. `1` stays off.
 * `POSTHOG_DISABLED=true` never sends, even when enabled. A blank key is off. A blank person salt skips `$identify`.
 */
export const env = defineEnv('analytics', {
  ANALYTICS_DISABLED: zFlag(),
  POSTHOG_ENABLED: zFlag(),
  POSTHOG_DISABLED: zFlag(),
  /** Project token (`phc_`). Never a personal key. Never log it. */
  POSTHOG_KEY: blank,
  POSTHOG_HOST: z.string().optional().transform((value) => {
    const trimmed = value?.trim().replace(/\/+$/, '');
    return trimmed ? trimmed : 'https://eu.i.posthog.com';
  }),
  POSTHOG_PERSON_SALT: blank,
});

/** Product analytics intake (CLIENT §10) and server commits. Global so trade and identity can inject `ProductRecorder`. */
@Global()
@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsCounters, PostHogClient, ProductRecorder, IpThrottleGuard],
  exports: [AnalyticsCounters, ProductRecorder],
})
export class AnalyticsModule {}
