import { z } from 'zod';
import { ResourceKey } from '../ws/sim';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'dev.grant',
  wave: 'W01',
  origin: 'client',
  dev: true,
  args: z.strictObject({
    resource: ResourceKey,
    amount: z.number(),
  }),
  summary: 'Dev console: adds or subtracts `amount` of `resource` on the caller colony (clamped to >= 0).',
});
