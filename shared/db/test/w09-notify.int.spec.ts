import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../src/testing';

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db?.drop();
});

describe('W09-01 notify tables', () => {
  it('creates the subscription, digest and mock notifier tables', async () => {
    const rows = await db.prisma.$queryRaw<{ table_schema: string; table_name: string }[]>`
      SELECT table_schema, table_name FROM information_schema.tables
      WHERE (table_schema, table_name) IN (
        ('core', 'notification_subscription'),
        ('core', 'mock_notify'),
        ('world', 'planet_event_digest')
      )
      ORDER BY table_schema, table_name`;
    expect(rows).toEqual([
      { table_schema: 'core', table_name: 'mock_notify' },
      { table_schema: 'core', table_name: 'notification_subscription' },
      { table_schema: 'world', table_name: 'planet_event_digest' },
    ]);
  });

  it('stores one mock row per colony, event and channel', async () => {
    const insert = (channel: string) => db.prisma.$executeRaw`
      INSERT INTO core.mock_notify (colony_id, event_id, channel, kind, payload)
      VALUES ('co_1', 'evt_raid', ${channel}, 'under_attack', '{}'::jsonb)`;
    await insert('webpush');
    await expect(insert('webpush')).rejects.toThrow();
    await insert('telegram');
    const n = await db.prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM core.mock_notify WHERE colony_id = 'co_1' AND event_id = 'evt_raid'`;
    expect(n[0]?.n).toBe(2);
  });

  it('keeps a revoked subscription and an open digest', async () => {
    await db.prisma.$executeRaw`
      INSERT INTO core.notification_subscription (id, player_id, channel, endpoint, revoked_at)
      VALUES ('sub_1', 'pr_1', 'webpush', 'https://push.example/a', NULL)`;
    await db.prisma.$executeRaw`
      UPDATE core.notification_subscription SET revoked_at = now() WHERE id = 'sub_1'`;
    const revoked = await db.prisma.$queryRaw<{ revoked: Date | null }[]>`
      SELECT revoked_at AS revoked FROM core.notification_subscription WHERE id = 'sub_1'`;
    expect(revoked[0]?.revoked).toBeInstanceOf(Date);

    await db.prisma.$executeRaw`
      INSERT INTO world.planet_event_digest (colony_id, planet_id, opened_at, body)
      VALUES ('co_1', 'pl_1', now(), '{"attacks":{"count":0}}'::jsonb)`;
    const open = await db.prisma.$queryRaw<{ closed: Date | null }[]>`
      SELECT closed_at AS closed FROM world.planet_event_digest WHERE colony_id = 'co_1'`;
    expect(open[0]?.closed).toBeNull();
  });
});
