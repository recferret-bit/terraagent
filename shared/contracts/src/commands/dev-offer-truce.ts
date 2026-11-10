import { z } from 'zod';
import { ColonyTargetIdSchema, TruceDurationHoursSchema } from '../diplomacy';
import { defineCommand } from './define';

export const DevOfferTruceArgsSchema = z.strictObject({
  fromColony: ColonyTargetIdSchema.optional(),
  toColony: ColonyTargetIdSchema.optional(),
  colony: ColonyTargetIdSchema.optional(),
  hours: TruceDurationHoursSchema.optional(),
  durationHours: TruceDurationHoursSchema.optional(),
});
export type DevOfferTruceArgs = z.infer<typeof DevOfferTruceArgsSchema>;

export const command = defineCommand({
  kind: 'dev.offerTruce',
  wave: 'W18',
  origin: 'client',
  dev: true,
  args: DevOfferTruceArgsSchema,
  summary: 'Dev console: injects a truce offer from a neighbor colony into the player colony (`UO-DIP-02`, W18-25).',
});
