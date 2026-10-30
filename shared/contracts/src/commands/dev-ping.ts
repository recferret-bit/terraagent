import { z } from 'zod';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'dev.ping',
  wave: 'W00',
  origin: 'client',
  dev: true,
  args: z.strictObject({ note: z.string().max(64).optional() }),
  summary: 'No-op command that round-trips through the sim; acked with the tick it was applied at.',
});
