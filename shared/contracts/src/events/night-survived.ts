import { z } from 'zod';
import { defineEvent } from './define';

export const event = defineEvent({
  kind: 'nightSurvived',
  wave: 'W03',
  severity: 'info',
  audience: 'player',
  data: z.strictObject({
    colonyId: z.string().optional(),
    playerId: z.string().optional(),
    dayNumber: z.number().int().nonnegative().optional(),
    capacitorChargeRemainingE: z.number().nonnegative().optional(),
  }),
  summary: 'Emitted at dawn when a colony survives the full night without shedding beyond group 1 (SIM §9, W03-15).',
});
