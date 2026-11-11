import { Prisma, type PrismaClient } from '@prisma/client';
import type { NotificationPayload } from '@terra/contracts';

export interface MockNotifyRow {
  readonly id: string;
  readonly colonyId: string;
  readonly eventId: string;
  readonly channel: string;
}

export interface MockNotifyPut {
  readonly row: MockNotifyRow;
  /** False when `(colonyId, eventId, channel)` already had a row. */
  readonly inserted: boolean;
}

/** Idempotent insert of one `core.mock_notify` row. The key is `(colonyId, eventId, channel)`. */
export interface MockNotifyStore {
  put(payload: NotificationPayload): Promise<MockNotifyPut>;
}

export interface StoredMockNotification extends MockNotifyRow {
  readonly kind: NotificationPayload['kind'];
  readonly payload: NotificationPayload;
}

/** In-memory `MockNotifyStore` for unit and integration tests without Postgres. */
export class InMemoryMockNotifyStore implements MockNotifyStore {
  readonly rows: StoredMockNotification[] = [];

  async put(payload: NotificationPayload): Promise<MockNotifyPut> {
    const existing = this.rows.find(
      (r) => r.colonyId === payload.colonyId && r.eventId === payload.eventId && r.channel === payload.channel,
    );
    if (existing) {
      return {
        row: { id: existing.id, colonyId: existing.colonyId, eventId: existing.eventId, channel: existing.channel },
        inserted: false,
      };
    }
    const row: StoredMockNotification = {
      id: String(this.rows.length + 1),
      colonyId: payload.colonyId,
      eventId: payload.eventId,
      channel: payload.channel,
      kind: payload.kind,
      payload,
    };
    this.rows.push(row);
    return {
      row: { id: row.id, colonyId: row.colonyId, eventId: row.eventId, channel: row.channel },
      inserted: true,
    };
  }

  list(colonyId?: string): NotificationPayload[] {
    return this.rows.filter((r) => !colonyId || r.colonyId === colonyId).map((r) => r.payload);
  }

  clear(): void {
    this.rows.length = 0;
  }
}

type NotifyIdRow = { id: bigint; colonyId: string; eventId: string; channel: string };

/** Postgres store. A unique violation is success: the existing row is returned, not a second insert. */
export class PrismaMockNotifyStore implements MockNotifyStore {
  constructor(private readonly prisma: PrismaClient) {}

  async put(payload: NotificationPayload): Promise<MockNotifyPut> {
    const data = {
      colonyId: payload.colonyId,
      eventId: payload.eventId,
      channel: payload.channel,
      kind: payload.kind,
      payload: JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue,
    };
    try {
      return { row: toRow(await this.prisma.mockNotify.create({ data })), inserted: true };
    } catch (e) {
      if (!isUnique(e)) throw e;
      const existing = await this.prisma.mockNotify.findUnique({
        where: { colonyId_eventId_channel: { colonyId: data.colonyId, eventId: data.eventId, channel: data.channel } },
      });
      if (!existing) throw e;
      return { row: toRow(existing), inserted: false };
    }
  }
}

function toRow(row: NotifyIdRow): MockNotifyRow {
  return { id: row.id.toString(), colonyId: row.colonyId, eventId: row.eventId, channel: row.channel };
}

function isUnique(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002';
}
