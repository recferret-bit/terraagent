import { z } from 'zod';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'dev.meteor',
  wave: 'W05',
  origin: 'client',
  dev: true,
  args: z.strictObject({
    q: z.number().int().optional(),
    r: z.number().int().optional(),
    hexCount: z.number().int().min(1).max(37).optional(),
    colonyIndex: z.number().int().nonnegative().optional(),
  }),
  summary: 'Dev console: triggers a meteor impact that destroys all entities in a 10-hex blast zone and leaves TERRAIN.hole craters (W05).',
});
