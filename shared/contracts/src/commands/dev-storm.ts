import { z } from 'zod';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'dev.storm',
  wave: 'W05',
  origin: 'client',
  dev: true,
  args: z.strictObject({
    active: z.boolean().optional(),
    rain: z.enum(['none', 'minor', 'heavy']).optional(),
    lightning: z.boolean().optional(),
    colonyIndex: z.number().int().nonnegative().optional(),
  }),
  summary: 'Dev console: toggles or configures storm + rain + lightning weather state on the planet (W05).',
});
