import { z } from 'zod';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'dev.reveal',
  wave: 'W01',
  origin: 'client',
  dev: true,
  args: z.strictObject({}),
  summary: 'Dev console: marks every tile explored for the caller colony.',
});
