import { z } from 'zod';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'dev.twister',
  wave: 'W05',
  origin: 'client',
  dev: true,
  args: z.strictObject({
    q: z.number().int().optional(),
    r: z.number().int().optional(),
    dirDeg: z.number().optional(),
    colonyIndex: z.number().int().nonnegative().optional(),
  }),
  summary: 'Dev console: spawns a rising twister that travels in a random direction, damages buildings, and sucks up units and trees (requires high wind and minor rain, W05).',
});
