import { z } from 'zod';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'dev.lightning',
  wave: 'W05',
  origin: 'client',
  dev: true,
  args: z.strictObject({
    q: z.number().int().optional(),
    r: z.number().int().optional(),
    hexCount: z.number().int().min(1).max(19).optional(),
    rain: z.boolean().optional(),
    colonyIndex: z.number().int().nonnegative().optional(),
  }),
  summary: 'Dev console: triggers a 4-hex lightning strike that heavily damages targets, overloads electricity, and puts damaged buildings offline temporarily (W05).',
});
