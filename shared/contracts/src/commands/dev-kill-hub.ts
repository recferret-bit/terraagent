import { z } from 'zod';
import { ColonyTargetIdSchema } from '../diplomacy';
import { defineCommand } from './define';

export const DevKillHubArgsSchema = z.strictObject({
  colonyIndex: z.number().int().nonnegative().optional(),
  colonyId: ColonyTargetIdSchema.optional(),
});
export type DevKillHubArgs = z.infer<typeof DevKillHubArgsSchema>;

export const command = defineCommand({
  kind: 'dev.killHub',
  wave: 'W18',
  origin: 'client',
  dev: true,
  args: DevKillHubArgsSchema,
  summary: 'Dev console: destroys the target colony Command Hub (`UO-HQ-04`, W18-25).',
});
