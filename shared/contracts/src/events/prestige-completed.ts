import { z } from 'zod';
import { defineEvent } from './define';

export const event = defineEvent({
  kind: 'prestigeCompleted',
  wave: 'W13',
  severity: 'info',
  audience: 'player',
  data: z.strictObject({
    colonyId: z.string().min(1),
    playerId: z.string().min(1).optional(),
    /** `prestige` row id, e.g. `project.survey_array`. */
    project: z.string().min(1).max(64),
    /** How many times this colony completed this project (the new value of its counter). */
    count: z.number().int().positive(),
  }),
  summary: 'A colony finished a prestige project (a non-tradable fact: no cash, no production multiplier); repeating it consumes its inputs again (W13-43).',
});
