import { z } from 'zod';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'dev.rain',
  wave: 'W05',
  origin: 'client',
  dev: true,
  args: z.strictObject({
    level: z.enum(['none', 'minor', 'heavy']).optional(),
    intensity: z.number().min(0).max(1).optional(),
    colonyIndex: z.number().int().nonnegative().optional(),
  }),
  summary: 'Dev console: sets planet rain level (none, minor, heavy) and intensity (0..1) (W05).',
});
