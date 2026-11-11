import { z } from 'zod';
import { defineCommand } from './define';

export const CancelTruceArgsSchema = z.strictObject({
  truceId: z.string().min(1).max(64),
});
export type CancelTruceArgs = z.infer<typeof CancelTruceArgsSchema>;

export const command = defineCommand({
  kind: 'diplomacy.cancelTruce',
  wave: 'W18',
  origin: 'client',
  args: CancelTruceArgsSchema,
  summary: 'Starts the 10-minute cancellation notice on an active truce and marks the canceller Oathbreaker for 24 h (`UO-DIP-04`, W18-01, W18-14).',
});
