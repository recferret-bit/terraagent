import { z } from 'zod';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'dev.seed',
  wave: 'W01',
  origin: 'client',
  dev: true,
  args: z.strictObject({
    seed: z.string().min(1).max(64),
  }),
  summary: 'Dev console: regenerates the dev planet terrain with the given seed.',
});
