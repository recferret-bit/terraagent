import { z } from 'zod';
import { HomeColonyId } from '../rest/home';
import { defineEvent } from './define';

export const ColonyBackDataSchema = z.strictObject({
  colonyId: HomeColonyId,
  colonyIndex: z.number().int().nonnegative().optional(),
  atTick: z.number().int().nonnegative(),
  awayForS: z.number().int().nonnegative().optional(),
});
export type ColonyBackData = z.infer<typeof ColonyBackDataSchema>;

export const event = defineEvent({
  kind: 'colonyBack',
  wave: 'W09',
  severity: 'info',
  audience: 'server',
  data: ColonyBackDataSchema,
  summary: 'The colony socket is back after an away period (CT-12).',
});
