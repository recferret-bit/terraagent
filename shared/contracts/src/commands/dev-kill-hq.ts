import { z } from 'zod';
import { ColonyTargetIdSchema } from '../diplomacy';
import { defineCommand } from './define';

export const DevKillHqArgsSchema = z.strictObject({
  colonyIndex: z.number().int().nonnegative().optional(),
  colonyId: ColonyTargetIdSchema.optional(),
});
export type DevKillHqArgs = z.infer<typeof DevKillHqArgsSchema>;

export const command = defineCommand({
  kind: 'dev.killHq',
  wave: 'W18',
  origin: 'client',
  dev: true,
  args: DevKillHqArgsSchema,
  summary: 'Dev console: destroys the target colony HQ Drone (`UO-HQ-04`, W18-25).',
});
