import { z } from 'zod';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'dev.time',
  wave: 'W02',
  origin: 'client',
  dev: true,
  args: z.strictObject({
    target: z.string().min(1).max(16),
  }),
  summary: 'Dev console: sets the planet day/night clock to `day`, `night`, or `hh:mm` (W02-30).',
});
