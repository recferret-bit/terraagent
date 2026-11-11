import { z } from 'zod';
import { ColonyTargetIdSchema } from '../diplomacy';
import { defineCommand } from './define';

export const DevSetShieldArgsSchema = z.strictObject({
  hours: z.number().min(0).max(720),
  colonyIndex: z.number().int().nonnegative().optional(),
  colonyId: ColonyTargetIdSchema.optional(),
});
export type DevSetShieldArgs = z.infer<typeof DevSetShieldArgsSchema>;

export const command = defineCommand({
  kind: 'dev.setShield',
  wave: 'W18',
  origin: 'client',
  dev: true,
  args: DevSetShieldArgsSchema,
  summary: 'Dev console: sets newcomer raid protection (`raidProtectedUntil`) on a colony for `hours` hours (`UO-T-05`, W18-25).',
});
