import { z } from 'zod';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'dev.teleport',
  wave: 'W00',
  origin: 'client',
  dev: true,
  args: z.strictObject({ id: z.number().int().nonnegative(), q: z.number().int().min(-32768).max(32767), r: z.number().int().min(-32768).max(32767) }),
  summary: 'Sets a test entity position directly to tile (q, r).',
});
