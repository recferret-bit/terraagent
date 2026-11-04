import { z } from 'zod';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'dev.cargoCapReset',
  wave: 'W10',
  origin: 'client',
  dev: true,
  args: z.strictObject({
    colonyIndex: z.number().int().nonnegative().optional(),
    colony: z.union([z.string().min(1).max(64), z.number().int().nonnegative()]).optional(),
  }),
  summary: 'Dev console (`cargo.cap.reset <colony>`): clears the rolling 60 s and UTC-day cargo mint counters for the colony (W10-26).',
});
