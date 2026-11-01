import { z } from 'zod';
import { defineEvent } from './define';

export const event = defineEvent({
  kind: 'groundRevealed',
  wave: 'W01',
  severity: 'info',
  audience: 'player',
  data: z.strictObject({
    colonyId: z.string(),
    playerId: z.string().optional(),
    q: z.number().int(),
    r: z.number().int(),
    deposit: z.enum(['metals', 'minerals', 'oil']),
    richnessBp: z.number().int().nonnegative(),
  }),
  summary: 'Emitted when a Clear / Break uncovers a buried deposit from the hidden subsurface (D-38).',
});
