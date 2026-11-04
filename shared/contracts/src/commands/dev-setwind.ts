import { z } from 'zod';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'dev.setwind',
  wave: 'W03',
  origin: 'client',
  dev: true,
  args: z.strictObject({
    pct: z.number().min(0).max(500),
    colonyIndex: z.number().int().nonnegative().optional(),
  }),
  summary: 'Dev console: sets the planet wind speed factor percentage (e.g. 50..140, W03-27).',
});
