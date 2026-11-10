import type { NotificationChannel, NotifierKind } from '@terra/contracts';

/**
 * Payload for `NotifierPort.send`. The zod source of truth is `NotificationPayloadSchema`
 * (`@terra/contracts`). Idempotency key is `(colonyId, eventId, channel)` (CT-38).
 */
export interface Notification {
  readonly colonyId: string;
  readonly eventId: string;
  readonly kind: NotifierKind;
  readonly channel: NotificationChannel;
  readonly to: string;
  readonly title: string;
  readonly body: string;
  readonly deepLink?: string;
  readonly data?: Readonly<Record<string, unknown>>;
}
export interface NotificationResult { readonly id: string; readonly status: 'sent' | 'queued' | 'failed' | 'skipped' }

export abstract class NotifierPort {
  abstract send(n: Notification): Promise<NotificationResult>;
}
