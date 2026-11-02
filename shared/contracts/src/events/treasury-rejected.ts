import { z } from 'zod';
import { defineEvent } from './define';

export const event = defineEvent({
  kind: 'treasuryRejected',
  wave: 'W01',
  severity: 'warn',
  audience: 'server',
  data: z.strictObject({
    colonyId: z.string(),
    /** The ledger reason of the refused change (`terraform.yield`, `construction.refund`, …). */
    reason: z.string(),
    code: z.enum(['invalid_resource', 'invalid_reason', 'invalid_amount', 'insufficient_funds']),
    resource: z.string().optional(),
    detail: z.string().optional(),
    ref: z.string().optional(),
  }),
  summary: 'A resource change a sim system expected to succeed (a terraform yield, a construction refund) was refused by the colony treasury (bad data); nothing moved.',
});
