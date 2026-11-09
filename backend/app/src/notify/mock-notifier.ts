import { NotificationPayloadSchema } from '@terra/contracts';
import type { Notification, NotificationResult } from '../ports/notifier.port.js';
import { noteNotifySent, noteNotifySuppressedConnected } from './metrics.js';
import type { MockNotifyStore } from './mock-notify.store.js';
import type { PresenceQuery } from './presence.js';

/** `NotificationResult.id` when nothing was written because the colony has a socket. Not a `mock_notify` id. */
export const SKIPPED_NOTIFY_ID = 'skipped';

/**
 * Mock `NotifierPort` send (CT-38). Validates, skips while connected, then inserts once per
 * `(colonyId, eventId, channel)`. A repeat returns the first row.
 */
export class MockNotifier {
  constructor(
    private readonly store: MockNotifyStore,
    private readonly presence: PresenceQuery,
  ) {}

  async send(n: Notification): Promise<NotificationResult> {
    const payload = NotificationPayloadSchema.parse(n);
    if (await this.presence.isConnected(payload.colonyId)) {
      noteNotifySuppressedConnected();
      return { id: SKIPPED_NOTIFY_ID, status: 'skipped' };
    }
    const put = await this.store.put(payload);
    if (put.inserted) noteNotifySent(payload.kind, payload.channel);
    return { id: put.row.id, status: 'sent' };
  }
}
