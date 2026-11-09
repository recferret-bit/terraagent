import { z } from 'zod';
import { PlayerId } from '../ids';
import { HomeColonyId } from '../rest/home';
import { NotificationChannelSchema, NotificationKindSchema } from './kinds';

const WebPushKeysSchema = z.strictObject({
  p256dh: z.string().min(1).max(200),
  auth: z.string().min(1).max(64),
});

/**
 * `core.notification_subscription` (DATA_MODEL §11, CT-35).
 * A missing kind toggle means that kind is on. `revokedAt` set means the row is dead.
 */
export const NotificationSubscriptionSchema = z.strictObject({
  id: z.string().min(1).max(80),
  playerId: PlayerId,
  colonyId: HomeColonyId.optional(),
  channel: NotificationChannelSchema,
  endpoint: z.string().min(1).max(500).optional(),
  keys: WebPushKeysSchema.optional(),
  chatId: z.string().min(1).max(64).optional(),
  kinds: z.record(NotificationKindSchema, z.boolean()).optional(),
  createdAt: z.string().min(1).max(40),
  revokedAt: z.string().min(1).max(40).nullable().optional(),
}).superRefine((row, ctx) => {
  if (row.channel === 'webpush' && !row.endpoint) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endpoint'], message: 'web push needs an endpoint' });
  }
  if (row.channel === 'telegram' && !row.chatId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['chatId'], message: 'telegram needs a chat id' });
  }
});
export type NotificationSubscription = z.infer<typeof NotificationSubscriptionSchema>;
