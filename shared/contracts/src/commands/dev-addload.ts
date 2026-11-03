import { z } from 'zod';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'dev.addload',
  wave: 'W03',
  origin: 'client',
  dev: true,
  args: z.strictObject({
    loadPerS: z.number().optional(),
    ePerS: z.number().optional(),
    amount: z.number().optional(),
    entityId: z.number().int().positive().optional(),
    colonyIndex: z.number().int().nonnegative().optional(),
  }),
  summary: 'Dev console: injects synthetic electrical load (E/s) onto a colony or specific pylon branch (W03-27).',
});
