import { z } from 'zod';
import { defineCommand } from './define';

export const CancelWarArgsSchema = z.strictObject({
  warId: z.string().min(1).max(64),
});
export type CancelWarArgs = z.infer<typeof CancelWarArgsSchema>;

export const command = defineCommand({
  kind: 'diplomacy.cancelWar',
  wave: 'W22',
  origin: 'client',
  args: CancelWarArgsSchema,
  summary:
    'Cancels an active 6-hour War Bond before objective completion, slashing 90% of the bond to the defender and 10% to TerraAgent Protocol.',
});
