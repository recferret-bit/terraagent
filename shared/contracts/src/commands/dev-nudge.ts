import { z } from 'zod';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'dev.nudge',
  wave: 'W00',
  origin: 'client',
  dev: true,
  args: z.strictObject({ id: z.number().int().nonnegative(), dq: z.number().min(-1).max(1).optional(), dr: z.number().min(-1).max(1).optional() }),
  summary: 'Moves a test entity by dev.probe.nudgeTiles tiles along (dq, dr); default direction +q.',
});
