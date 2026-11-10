import { z } from 'zod';
import { HomeColonyId } from '../rest/home';
import { NotificationChannelSchema, NotifierKindSchema } from './kinds';

/**
 * What `NotifierPort.send` carries (CT-38). Idempotency key is `(colonyId, eventId, channel)`.
 * Nothing is sent while the player is connected; that gate lives in the notify module, not here.
 */
export const NotificationPayloadSchema = z.strictObject({
  colonyId: HomeColonyId,
  eventId: z.string().min(1).max(128),
  kind: NotifierKindSchema,
  channel: NotificationChannelSchema,
  to: z.string().min(1).max(500),
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(600),
  deepLink: z.string().min(1).max(200).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});
export type NotificationPayload = z.infer<typeof NotificationPayloadSchema>;

export const NotificationResultSchema = z.strictObject({
  id: z.string().min(1).max(128),
  status: z.enum(['sent', 'queued', 'failed', 'skipped']),
});
export type NotificationResultPayload = z.infer<typeof NotificationResultSchema>;
