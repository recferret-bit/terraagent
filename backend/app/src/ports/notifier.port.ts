export interface Notification {
  readonly channel: 'webpush' | 'telegram';
  readonly to: string;
  readonly title: string;
  readonly body: string;
  readonly data?: Readonly<Record<string, unknown>>;
}
export interface NotificationResult { readonly id: string; readonly status: 'sent' | 'queued' | 'failed' }

export abstract class NotifierPort {
  abstract send(n: Notification): Promise<NotificationResult>;
}
