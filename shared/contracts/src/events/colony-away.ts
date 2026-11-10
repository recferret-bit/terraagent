import { z } from 'zod';
import { HomeColonyId } from '../rest/home';
import { defineEvent } from './define';

export const ColonyAwayDataSchema = z.strictObject({
  colonyId: HomeColonyId,
  colonyIndex: z.number().int().nonnegative().optional(),
  atTick: z.number().int().nonnegative(),
});
export type ColonyAwayData = z.infer<typeof ColonyAwayDataSchema>;

export const event = defineEvent({
  kind: 'colonyAway',
  wave: 'W09',
  severity: 'info',
  audience: 'server',
  data: ColonyAwayDataSchema,
  summary: 'The colony has had no socket for AWAY_AFTER_S (CT-11, CT-12).',
});
