import { z } from 'zod';
import { defineCommand } from './define';

export const RespondTruceArgsSchema = z.strictObject({
  offerId: z.string().min(1).max(64),
  accept: z.boolean(),
});
export type RespondTruceArgs = z.infer<typeof RespondTruceArgsSchema>;

export const command = defineCommand({
  kind: 'diplomacy.respondTruce',
  wave: 'W18',
  origin: 'client',
  args: RespondTruceArgsSchema,
  summary: 'Accepts or declines an incoming truce offer before its 10-minute expiry (`UO-DIP-02`, W18-01, W18-12).',
});
