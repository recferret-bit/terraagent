import { z } from 'zod';
import { defineCommand } from './define';

export const SetAiEnabledArgsSchema = z.strictObject({ enabled: z.boolean() });
export type SetAiEnabledArgs = z.infer<typeof SetAiEnabledArgsSchema>;

export const command = defineCommand({
  kind: 'setAiEnabled',
  wave: 'W08',
  origin: 'client',
  args: SetAiEnabledArgsSchema,
  summary:
    'Turns the colony AI (autonomous goal breakdown and rule-engine autopilot) on or off. Default off: bots only run explicit player commands.',
});
