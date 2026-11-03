import { z } from 'zod';
import { NearAccountId } from '../rest/near-account';
import { defineEvent } from './define';

/** The relayed action failed after its retry. `message` is player-facing (no chain wording). */
export const event = defineEvent({
  kind: 'relay.failed',
  wave: 'W06',
  severity: 'warn',
  audience: 'player',
  data: z.strictObject({
    opId: z.string().min(1).max(200),
    signerId: NearAccountId,
    receiverId: NearAccountId,
    errorCode: z.string().min(1).max(64),
    message: z.string().min(1).max(200),
  }),
  summary: 'A gasless action failed.',
});
