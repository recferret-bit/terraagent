import { z } from 'zod';
import { NearAccountId } from '../rest/near-account';
import { defineEvent } from './define';

/** The relayed action is final. The client fades the pending chip. */
export const event = defineEvent({
  kind: 'relay.settled',
  wave: 'W06',
  severity: 'info',
  audience: 'player',
  data: z.strictObject({
    opId: z.string().min(1).max(200),
    txHash: z.string().min(1),
    signerId: NearAccountId,
    receiverId: NearAccountId,
    status: z.literal('FINAL'),
  }),
  summary: 'A gasless action settled.',
});
