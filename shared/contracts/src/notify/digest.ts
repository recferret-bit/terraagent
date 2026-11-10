import { z } from 'zod';
import { HomeColonyId } from '../rest/ids';
import { ResourceKey } from '../ws/sim';
import { AWAY_STORY_MAX_CHARS, DIGEST_LIST_CAP } from './limits';

const delta = z.strictObject({ before: z.number(), after: z.number() });

/** One before/after pair for every stored sub-resource (D-34, CT-30). */
export const AwayResourcesSchema = z.strictObject({
  'metals.t1': delta,
  'metals.t2': delta,
  'metals.t3': delta,
  'minerals.t1': delta,
  'minerals.t2': delta,
  'minerals.t3': delta,
  'bio.water': delta,
  'bio.biomass': delta,
  'bio.t2': delta,
  'bio.t3': delta,
});
export type AwayResources = z.infer<typeof AwayResourcesSchema>;

const countByKind = z.strictObject({
  kind: z.string().min(1).max(64),
  tier: z.number().int().min(0).max(10),
  count: z.number().int().nonnegative(),
});

const lostByCause = countByKind.extend({
  cause: z.enum(['fauna', 'raid', 'lightning', 'meteor', 'other']),
});

const capped = <T extends z.ZodType>(item: T) => z.array(item).max(DIGEST_LIST_CAP);

/** One director fill on the away digest (W15-24). The sentence is `directorDigestLine`. */
export const DIGEST_DIRECTOR_TRADE = 'digest.directorTrade' as const;
export const DigestDirectorTradeSchema = z.strictObject({
  kind: z.literal(DIGEST_DIRECTOR_TRADE),
  line: z.string().min(1).max(200),
});
export type DigestDirectorTrade = z.infer<typeof DigestDirectorTradeSchema>;

/**
 * `AwayDigestV1` (CONTINUITY CT-30..34). Lists are capped at 20 (CT-31).
 * `story` is the optional CT-34 paragraph; it is omitted when no provider runs.
 */
export const AwayDigestV1Schema = z.strictObject({
  colonyId: HomeColonyId,
  awayFrom: z.string().min(1).max(40),
  awayTo: z.string().min(1).max(40),
  durationS: z.number().int().nonnegative(),
  resources: AwayResourcesSchema,
  energy: delta,
  built: capped(countByKind),
  lost: capped(lostByCause),
  robots: z.strictObject({
    before: z.number().int().nonnegative(),
    after: z.number().int().nonnegative(),
    produced: z.number().int().nonnegative(),
    lost: z.number().int().nonnegative(),
  }),
  territory: z.strictObject({
    before: z.number().int().nonnegative(),
    after: z.number().int().nonnegative(),
  }),
  attacks: z.strictObject({
    count: z.number().int().nonnegative(),
    repelled: z.number().int().nonnegative(),
    byColony: capped(z.strictObject({
      displayName: z.string().min(1).max(64),
      count: z.number().int().nonnegative(),
    })),
  }),
  hazards: capped(z.strictObject({
    kind: z.string().min(1).max(64),
    at: z.string().min(1).max(40),
    damage: z.number().nonnegative(),
  })),
  ai: z.strictObject({
    decisions: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    highlights: capped(z.strictObject({
      at: z.string().min(1).max(40),
      summary: z.string().min(1).max(200),
    })),
  }),
  trades: z.strictObject({
    settled: z.number().int().nonnegative(),
    items: capped(z.strictObject({
      with: z.string().min(1).max(64),
      gave: z.string().min(1).max(64),
      got: z.string().min(1).max(64),
    })),
  }),
  alerts: capped(z.strictObject({
    code: z.enum(['rocket_ready', 'power_deficit', 'storage_full', 'supply_cap', 'under_attack']),
    message: z.string().min(1).max(200),
  })),
  /** Director fills folded while this away row is open. Omitted when there are none. Capped at 20 (CT-31). */
  items: capped(DigestDirectorTradeSchema).optional(),
  story: z.string().max(AWAY_STORY_MAX_CHARS).optional(),
});
export type AwayDigestV1 = z.infer<typeof AwayDigestV1Schema>;

/** Headline `/me/home` returns within the 300 ms budget (CT-32, CT-04). */
export const AwaySummarySchema = z.strictObject({
  colonyId: HomeColonyId,
  durationS: z.number().int().nonnegative(),
  resourcesNet: z.partialRecord(ResourceKey, z.number()),
  built: z.number().int().nonnegative(),
  lost: z.number().int().nonnegative(),
  attacks: z.number().int().nonnegative(),
  repelled: z.number().int().nonnegative(),
  alerts: z.array(z.string().min(1).max(64)).max(3),
});
export type AwaySummary = z.infer<typeof AwaySummarySchema>;
