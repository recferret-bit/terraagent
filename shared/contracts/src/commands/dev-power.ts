import { z } from 'zod';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'dev.power',
  wave: 'W02',
  origin: 'client',
  dev: true,
  args: z.strictObject({
    colonyIndex: z.number().int().nonnegative().optional(),
  }),
  summary: 'Dev console: dumps the colony power grid component balance and shed states (W02-30).',
});
