import { z } from 'zod';
import { ResourceFamily, ResourceKey } from '../ws/sim';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'dev.fill',
  wave: 'W02',
  origin: 'client',
  dev: true,
  args: z.strictObject({
    resource: z.union([ResourceKey, ResourceFamily, z.literal('all')]).optional(),
    res: z.union([ResourceKey, ResourceFamily, z.literal('all')]).optional(),
    amount: z.number().nonnegative().optional(),
    colonyIndex: z.number().int().nonnegative().optional(),
  }),
  summary: 'Dev console: fills a resource (or family / all T1 resources) up to its colony family storage cap (W02-30).',
});
