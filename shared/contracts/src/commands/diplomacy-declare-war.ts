import { z } from 'zod';
import { ColonyTargetIdSchema, DiplomacyBondTokenSchema } from '../diplomacy';
import { defineCommand } from './define';

export const DeclareWarArgsSchema = z
  .strictObject({
    targetColonyId: ColonyTargetIdSchema.optional(),
    targetColonyIndex: z.number().int().nonnegative().optional(),
    targetColony: ColonyTargetIdSchema.optional(),
    toColony: ColonyTargetIdSchema.optional(),
    bondToken: DiplomacyBondTokenSchema.default('metals.t1'),
    bondAmount: z.number().positive(),
  })
  .refine(
    (v) =>
      v.targetColonyId !== undefined ||
      v.targetColonyIndex !== undefined ||
      v.targetColony !== undefined ||
      v.toColony !== undefined,
    { message: 'declareWar requires targetColonyId, targetColonyIndex, targetColony, or toColony.' },
  );
export type DeclareWarArgs = z.infer<typeof DeclareWarArgsSchema>;

export const command = defineCommand({
  kind: 'diplomacy.declareWar',
  wave: 'W22',
  origin: 'client',
  args: DeclareWarArgsSchema,
  summary:
    'Locks a 6-hour War Bond in escrow for 2x raid siphon cap; refunded on war objective (>=1 structure destroyed or >=200 siphoned), otherwise slashed 90% to defender + 10% to TerraAgent Protocol.',
});
