import { z } from 'zod';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'dev.damage',
  wave: 'W03',
  origin: 'client',
  dev: true,
  args: z.strictObject({
    entityId: z.number().int().positive(),
    pct: z.number().min(0).max(100),
    colonyIndex: z.number().int().nonnegative().optional(),
  }),
  summary: 'Dev console: damages an entity by `pct` percent of its max HP (clamped above 1 HP unless pct >= 100, W03-27).',
});
