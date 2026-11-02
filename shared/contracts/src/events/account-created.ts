import { z } from 'zod';
import { NearAccountId } from '../rest/near-account';
import { defineEvent } from './define';

/** A guest became a named Pilot ID (W06-06). Pushed to that player; not a sim event. */
export const event = defineEvent({
  kind: 'account.created',
  wave: 'W06',
  severity: 'info',
  audience: 'player',
  data: z.strictObject({
    playerId: z.string().min(1),
    accountId: NearAccountId,
    provider: z.string().min(1).max(32),
    subject: z.string().min(1).max(128),
  }),
  summary: 'Named account created and linked to the player (F5).',
});
