import { z } from 'zod';

/** One product-analytics event (CLIENT §10.2). `ts` is epoch milliseconds on the client clock. */
export const AnalyticsEventV1 = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
    ts: z.number().int().nonnegative(),
    props: z.record(z.string().max(64), z.union([z.string().max(256), z.number(), z.boolean(), z.null()])).refine((p) => Object.keys(p).length <= 20, 'at most 20 props').default({}),
  })
  .strict();
export type AnalyticsEventV1 = z.infer<typeof AnalyticsEventV1>;

export const ANALYTICS_BATCH_MAX = 20;

/** `POST /v1/analytics/events` body. */
export const AnalyticsBatchV1 = z
  .object({
    anonId: z.uuid(),
    sessionId: z.string().min(1).max(64),
    events: z.array(AnalyticsEventV1).min(1).max(ANALYTICS_BATCH_MAX),
  })
  .strict();
export type AnalyticsBatchV1 = z.infer<typeof AnalyticsBatchV1>;
