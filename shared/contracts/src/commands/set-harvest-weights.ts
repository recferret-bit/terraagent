import { z } from 'zod';
import { defineCommand } from './define';

export const HarvestFamilyWeights = z.strictObject({
  metals: z.number().min(0).max(100).optional(),
  minerals: z.number().min(0).max(100).optional(),
  bio: z.number().min(0).max(100).optional(),
});

export const command = defineCommand({
  kind: 'setHarvestWeights',
  wave: 'W02',
  origin: 'client',
  args: z.union([
    HarvestFamilyWeights,
    z.strictObject({
      weights: HarvestFamilyWeights,
    }),
  ]),
  summary: 'Immediately updates the per-family harvest weights for standing Harvester jobs (UO-L-01, W02-12).',
});
