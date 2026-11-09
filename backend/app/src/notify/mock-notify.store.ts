import { Prisma, type PrismaClient } from '@prisma/client';
import type { NotificationPayload } from '@terra/contracts';

export interface MockNotifyRow {
  readonly id: string;
  readonly colonyId: string;
  readonly eventId: string;
  readonly channel: string;
}

/** Idempotent insert of one `core.mock_notify` row. The key is `(colonyId, eventId, channel)`. */
export interface MockNotifyStore {
  put(payload: NotificationPayload): Promise<MockNotifyRow>;
}

type NotifyIdRow = { id: bigint; colonyId: string; eventId: string; channel: string };

/** Postgres store. A unique violation is success: the existing row is returned, not a second insert. */
export class PrismaMockNotifyStore implements MockNotifyStore {
  constructor(private readonly prisma: PrismaClient) {}

  async put(payload: NotificationPayload): Promise<MockNotifyRow> {
    const data = {
      colonyId: payload.colonyId,
      eventId: payload.eventId,
      channel: payload.channel,
      kind: payload.kind,
      payload: JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue,
    };
    try {
      return toRow(await this.prisma.mockNotify.create({ data }));
    } catch (e) {
      if (!isUnique(e)) throw e;
      const existing = await this.prisma.mockNotify.findUnique({
        where: { colonyId_eventId_channel: { colonyId: data.colonyId, eventId: data.eventId, channel: data.channel } },
      });
      if (!existing) throw e;
      return toRow(existing);
    }
  }
}

function toRow(row: NotifyIdRow): MockNotifyRow {
  return { id: row.id.toString(), colonyId: row.colonyId, eventId: row.eventId, channel: row.channel };
}

function isUnique(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002';
}
