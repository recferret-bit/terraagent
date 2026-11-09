import { fileURLToPath } from 'node:url';
import type { PrismaClient } from '@prisma/client';
import { NotificationPayloadSchema, type NotificationPayload } from '@terra/contracts';
import { ZodError } from 'zod';
import { describe, expect, it } from 'vitest';
import { discoverAdapters } from '../../src/ports/adapters';
import { NotifierPort } from '../../src/ports/notifier.port';
import { MockNotifier, SKIPPED_NOTIFY_ID } from '../../src/notify/mock-notifier';
import { PrismaMockNotifyStore, type MockNotifyRow, type MockNotifyStore } from '../../src/notify/mock-notify.store';
import { notifyListLimit } from '../../src/notify/notify-list';
import { MemoryPresence } from '../../src/notify/presence';
import { holdColonySocket, releaseColonySocket } from '../../src/game/presence/socket-presence';

const COLONY = 'co_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const OTHER = 'co_01ARZ3NDEKTSV4RRFFQ69G5FBV';

const note = (over: Partial<NotificationPayload> = {}): NotificationPayload => ({
  colonyId: COLONY,
  eventId: 'evt_raid',
  kind: 'under_attack',
  channel: 'webpush',
  to: 'https://push.example/a',
  title: 'Under attack',
  body: 'A raid reached the Hub.',
  ...over,
});

class FakeStore implements MockNotifyStore {
  readonly rows: MockNotifyRow[] = [];
  async put(payload: NotificationPayload): Promise<MockNotifyRow> {
    const hit = this.rows.find((r) => r.colonyId === payload.colonyId && r.eventId === payload.eventId && r.channel === payload.channel);
    if (hit) return hit;
    const row = { id: String(this.rows.length + 1), colonyId: payload.colonyId, eventId: payload.eventId, channel: payload.channel };
    this.rows.push(row);
    return row;
  }
}

function notifier(store = new FakeStore(), presence = new MemoryPresence()) {
  return { store, presence, notifier: new MockNotifier(store, presence) };
}

describe('mock notifier', () => {
  it('stores one row when the same under_attack event is sent twice', async () => {
    const { store, notifier: n } = notifier();
    const first = await n.send(note());
    const second = await n.send(note({ title: 'again' }));
    expect(first).toEqual({ id: '1', status: 'sent' });
    expect(second).toEqual(first);
    expect(store.rows).toHaveLength(1);
  });

  it('writes nothing while the colony is connected', async () => {
    const { store, presence, notifier: n } = notifier();
    presence.connect(COLONY);
    const skipped = await n.send(note());
    expect(skipped).toEqual({ id: SKIPPED_NOTIFY_ID, status: 'skipped' });
    expect(store.rows).toHaveLength(0);
    presence.disconnect(COLONY);
    expect(await n.send(note())).toMatchObject({ status: 'sent' });
    expect(store.rows).toHaveLength(1);
  });

  it('writes one row when the colony is disconnected', async () => {
    const { store, notifier: n } = notifier();
    expect(await n.send(note())).toEqual({ id: '1', status: 'sent' });
    expect(store.rows).toEqual([{ id: '1', colonyId: COLONY, eventId: 'evt_raid', channel: 'webpush' }]);
  });

  it('treats another channel or colony as a second row', async () => {
    const { store, notifier: n } = notifier();
    await n.send(note());
    await n.send(note({ channel: 'telegram' }));
    await n.send(note({ colonyId: OTHER }));
    expect(store.rows.map((r) => [r.colonyId, r.channel])).toEqual([
      [COLONY, 'webpush'],
      [COLONY, 'telegram'],
      [OTHER, 'webpush'],
    ]);
  });

  it('rejects an empty eventId before insert, even while connected', async () => {
    const { store, presence, notifier: n } = notifier();
    presence.connect(COLONY);
    const bad = note({ eventId: '' });
    expect(NotificationPayloadSchema.safeParse(bad).success).toBe(false);
    await expect(n.send(bad)).rejects.toBeInstanceOf(ZodError);
    expect(store.rows).toHaveLength(0);
  });

  it('keeps a colony connected until every held socket releases', () => {
    const presence = new MemoryPresence();
    holdColonySocket(COLONY, presence);
    holdColonySocket(COLONY, presence);
    releaseColonySocket(COLONY, presence);
    expect(presence.isConnected(COLONY)).toBe(true);
    releaseColonySocket(COLONY, presence);
    expect(presence.isConnected(COLONY)).toBe(false);
    releaseColonySocket(COLONY, presence);
    expect(presence.isConnected(COLONY)).toBe(false);
  });

  it('clamps the dev list limit', () => {
    expect(notifyListLimit(undefined)).toBe(50);
    expect(notifyListLimit('nope')).toBe(50);
    expect(notifyListLimit('0')).toBe(1);
    expect(notifyListLimit('999')).toBe(200);
  });

  it('discovers only the mock adapter', async () => {
    const defs = await discoverAdapters(fileURLToPath(new URL('../../src/notify/adapters/', import.meta.url)));
    expect(defs.map((d) => d.kind)).toEqual(['mock']);
    expect(defs[0]?.port).toBe(NotifierPort);
  });
});

describe('prisma mock store idempotency', () => {
  it('returns the existing row when the insert hits a unique violation', async () => {
    const existing = { id: 7n, colonyId: COLONY, eventId: 'evt_raid', channel: 'webpush' };
    const prisma = {
      mockNotify: {
        create: () => Promise.reject(Object.assign(new Error('unique'), { code: 'P2002' })),
        findUnique: () => Promise.resolve(existing),
      },
    } as unknown as PrismaClient;
    const row = await new PrismaMockNotifyStore(prisma).put(note());
    expect(row).toEqual({ id: '7', colonyId: COLONY, eventId: 'evt_raid', channel: 'webpush' });
  });

  it('rethrows a unique violation when the row is gone', async () => {
    const prisma = {
      mockNotify: {
        create: () => Promise.reject(Object.assign(new Error('unique'), { code: 'P2002' })),
        findUnique: () => Promise.resolve(null),
      },
    } as unknown as PrismaClient;
    await expect(new PrismaMockNotifyStore(prisma).put(note())).rejects.toThrow(/unique/);
  });

  it('rethrows anything that is not a unique violation', async () => {
    const prisma = {
      mockNotify: { create: () => Promise.reject(new Error('db down')) },
    } as unknown as PrismaClient;
    await expect(new PrismaMockNotifyStore(prisma).put(note())).rejects.toThrow(/db down/);
  });
});
