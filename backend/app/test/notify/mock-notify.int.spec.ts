import type { INestApplication } from '@nestjs/common';
import type { NotificationPayload } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { NotifierPort } from '../../src/ports/notifier.port';
import { SKIPPED_NOTIFY_ID } from '../../src/notify/mock-notifier';
import { colonyPresence } from '../../src/notify/presence';
import { UNIT_APP_ENV } from '../unit-app-env';

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

let db: TestDatabase;
let app: INestApplication;
let url: string;
let notifier: NotifierPort;

const count = async (eventId = 'evt_raid') => {
  const rows = await db.prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM core.mock_notify WHERE event_id = ${eventId}`;
  return rows[0]?.n ?? 0;
};

beforeAll(async () => {
  db = await createTestDatabase();
  const created = await createApp({
    source: { ...UNIT_APP_ENV, NODE_ENV: 'test', DATABASE_URL: db.url, LOG_LEVEL: 'silent', NOTIFY_ADAPTER: 'mock' },
  });
  app = created.app;
  notifier = app.get(NotifierPort);
  await app.listen(0, '127.0.0.1');
  url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
});

beforeEach(async () => {
  colonyPresence.clear();
  await db.prisma.mockNotify.deleteMany();
});

afterAll(async () => {
  colonyPresence.clear();
  await app?.close();
  await db?.drop();
});

describe('mock notifier against Postgres', () => {
  it('fires the same under_attack event twice and keeps one row', async () => {
    const first = await notifier.send(note());
    const second = await notifier.send(note());
    expect(second).toEqual(first);
    expect(first.status).toBe('sent');
    expect(await count()).toBe(1);
    const listed = await fetch(`${url}/v1/dev/notify?colonyId=${COLONY}`);
    expect(listed.status).toBe(200);
    const body = await listed.json() as { rows: Array<{ id: string; eventId: string; channel: string; kind: string }> };
    expect(body.rows).toEqual([expect.objectContaining({ id: first.id, eventId: 'evt_raid', channel: 'webpush', kind: 'under_attack' })]);
  });

  it('writes zero rows while the colony is connected', async () => {
    colonyPresence.connect(COLONY);
    const skipped = await notifier.send(note({ eventId: 'evt_live' }));
    expect(skipped).toEqual({ id: SKIPPED_NOTIFY_ID, status: 'skipped' });
    expect(await count('evt_live')).toBe(0);
    const listed = await fetch(`${url}/v1/dev/notify?colonyId=${COLONY}&limit=10`);
    expect(await listed.json()).toEqual({ rows: [] });
  });

  it('stores a second row for another channel and hides the other colony', async () => {
    await notifier.send(note({ eventId: 'evt_split' }));
    await notifier.send(note({ eventId: 'evt_split', channel: 'telegram' }));
    await notifier.send(note({ eventId: 'evt_split', colonyId: OTHER }));
    expect(await count('evt_split')).toBe(3);
    const listed = await fetch(`${url}/v1/dev/notify?colonyId=${COLONY}`);
    const body = await listed.json() as { rows: Array<{ colonyId: string; channel: string }> };
    expect(body.rows.map((r) => r.channel).sort()).toEqual(['telegram', 'webpush']);
    expect(body.rows.every((r) => r.colonyId === COLONY)).toBe(true);
  });

  it('rejects an empty eventId and inserts nothing', async () => {
    await expect(notifier.send(note({ eventId: '' }))).rejects.toThrow();
    expect(await count('')).toBe(0);
    const all = await db.prisma.mockNotify.count();
    expect(all).toBe(0);
  });
});
