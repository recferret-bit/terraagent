import { z } from 'zod';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'dev.godmode',
  wave: 'W07',
  origin: 'client',
  dev: true,
  args: z.strictObject({
    enabled: z.boolean().optional(),
    colonyIndex: z.number().int().nonnegative().optional(),
  }),
  summary: 'Dev console (`godMode`): toggles or sets damage immunity for the colony (W07-29).',
});
