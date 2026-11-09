import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PrismaClient } from '@terra/db';
import { PRISMA } from '../../db/db.module.js';
import { adapterOf } from '../../ports/adapters.js';
import { NotifierPort, type Notification, type NotificationResult } from '../../ports/notifier.port.js';
import { MockNotifier } from '../mock-notifier.js';
import { PrismaMockNotifyStore } from '../mock-notify.store.js';
import { colonyPresence, PRESENCE, type PresenceQuery } from '../presence.js';

/** Postgres mock for `NotifierPort` (`NOTIFY_ADAPTER=mock`). No Web Push and no Telegram. */
@Injectable()
export class MockNotifierAdapter extends NotifierPort {
  private readonly notifier: MockNotifier;

  constructor(@Inject(PRISMA) prisma: PrismaClient, @Optional() @Inject(PRESENCE) presence?: PresenceQuery) {
    super();
    this.notifier = new MockNotifier(new PrismaMockNotifyStore(prisma), presence ?? colonyPresence);
  }

  send(n: Notification): Promise<NotificationResult> {
    return this.notifier.send(n);
  }
}

export const adapter = adapterOf({ port: NotifierPort, kind: 'mock', useClass: MockNotifierAdapter });
