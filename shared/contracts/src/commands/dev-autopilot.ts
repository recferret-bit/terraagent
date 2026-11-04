import { z } from 'zod';
import { defineCommand } from './define';

export const DevAutopilotArgsSchema = z.strictObject({
  op: z.enum(['next', 'step']).optional(),
  colonyIndex: z.number().int().nonnegative().optional(),
});

export type DevAutopilotArgs = z.infer<typeof DevAutopilotArgsSchema>;

export const command = defineCommand({
  kind: 'dev.autopilot',
  wave: 'W08',
  origin: 'client',
  dev: true,
  args: DevAutopilotArgsSchema,
  summary: 'Dev command to inspect or step the HQ rule-engine decision (`autopilot next`).',
});
