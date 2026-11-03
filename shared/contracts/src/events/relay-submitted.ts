import { z } from 'zod';
import { NearAccountId } from '../rest/near-account';
import { defineEvent } from './define';

/** The relayer accepted a meta-tx and is waiting for it to settle (W06-20 chip "Saving to orbit…"). */
export const event = defineEvent({
  kind: 'relay.submitted',
  wave: 'W06',
  severity: 'info',
  audience: 'player',
  data: z.strictObject({
    opId: z.string().min(1).max(200),
    signerId: NearAccountId,
    receiverId: NearAccountId,
    method: z.string().min(1).max(64),
  }),
  summary: 'A gasless action was submitted through the relayer.',
});
