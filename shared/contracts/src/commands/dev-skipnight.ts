import { z } from 'zod';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'dev.skipnight',
  wave: 'W02',
  origin: 'client',
  dev: true,
  args: z.strictObject({}),
  summary: 'Dev console: advances the planet clock to sunrise if currently in night (W02-30).',
});
