import { z } from 'zod';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'dev.drainfuel',
  wave: 'W03',
  origin: 'client',
  dev: true,
  args: z.strictObject({
    colonyIndex: z.number().int().nonnegative().optional(),
  }),
  summary: 'Dev console: zeroes the colony biomass stock (`bio.biomass`) to test Thermal Plant fuel starvation (W03-27).',
});
