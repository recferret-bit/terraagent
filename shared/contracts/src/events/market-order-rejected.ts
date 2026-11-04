import { z } from 'zod';
import { RejectCode } from '../errors';
import { defineEvent } from './define';

export const event = defineEvent({
  kind: 'marketOrderRejected',
  wave: 'W13',
  severity: 'warn',
  audience: 'player',
  data: z.strictObject({
    colonyId: z.string().min(1),
    colonyIndex: z.number().int().nonnegative().optional(),
    ref: z.string().min(1).max(160),
    code: RejectCode,
    detail: z.string().max(200).optional(),
  }),
  summary: 'The market module refused an order the sim had accepted (funds changed under lock, policy, limit); nothing stays reserved (W13-09).',
});
