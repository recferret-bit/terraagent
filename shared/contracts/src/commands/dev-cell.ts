import { z } from 'zod';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'dev.cell',
  wave: 'W01',
  origin: 'client',
  dev: true,
  args: z.strictObject({
    energy: z.number().min(0).max(50000),
  }),
  summary: 'Dev console: sets the colony HQ power cell energy to `energy` (clamped to cell capacity).',
});
