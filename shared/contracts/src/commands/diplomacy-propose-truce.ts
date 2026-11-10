import { z } from 'zod';
import { ColonyTargetIdSchema, TruceDurationHoursSchema } from '../diplomacy';
import { defineCommand } from './define';

export const ProposeTruceArgsSchema = z
  .strictObject({
    targetColonyId: ColonyTargetIdSchema.optional(),
    targetColonyIndex: z.number().int().nonnegative().optional(),
    targetColony: ColonyTargetIdSchema.optional(),
    hours: TruceDurationHoursSchema,
  })
  .refine(
    (v) =>
      v.targetColonyId !== undefined ||
      v.targetColonyIndex !== undefined ||
      v.targetColony !== undefined,
    { message: 'proposeTruce requires targetColonyId, targetColonyIndex, or targetColony.' },
  );
export type ProposeTruceArgs = z.infer<typeof ProposeTruceArgsSchema>;

export const command = defineCommand({
  kind: 'diplomacy.proposeTruce',
  wave: 'W18',
  origin: 'client',
  args: ProposeTruceArgsSchema,
  summary: 'Proposes a fixed-term bilateral truce (2 / 6 / 24 / 72 h) to a contacted colony (`UO-DIP-01..02`, W18-01, W18-11..12).',
});
