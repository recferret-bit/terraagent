import type { INestApplication } from '@nestjs/common';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';

let db: TestDatabase;
let app: INestApplication;
let url: string;
const anonId = '3f0c6f0e-6a53-4d34-9a3e-2f1b6a1a9c11';
const batch = { anonId, sessionId: 's1', events: [{ name: 'test_event', ts: Date.now(), props: { a: 1, b: 'x' } }] };
const post = (body: string, type: string) => fetch(`${url}/v1/analytics/events`, { method: 'POST', headers: { 'content-type': type }, body });
const rows = () => db.prisma.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM core.analytics_event ORDER BY id`);

beforeAll(async () => {
  db = await createTestDatabase();
  const created = await createApp({ source: { NODE_ENV: 'test', SIM_THREADS: '1', DATABASE_URL: db.url } });
  app = created.app;
  await app.listen(0, '127.0.0.1');
  url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
});
afterAll(async () => {
  await app?.close();
  await db?.drop();
});

describe('POST /v1/analytics/events', () => {
  it('stores one row for test_event, no IP column', async () => {
    const r = await post(JSON.stringify(batch), 'application/json');
    expect(r.status).toBe(204);
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ name: 'test_event', anon_id: anonId, session_id: 's1', props: { a: 1, b: 'x' } });
    expect(Object.keys(all[0]!).filter((k) => /ip|addr|agent/i.test(k))).toEqual([]);
  });

  it('accepts a text/plain body as sent by sendBeacon', async () => {
    const r = await post(JSON.stringify({ ...batch, events: [{ ...batch.events[0], name: 'beacon_event' }] }), 'text/plain;charset=UTF-8');
    expect(r.status).toBe(204);
    expect((await rows()).map((x) => x.name)).toContain('beacon_event');
  });

  it('rejects invalid batches with 400 and stores nothing', async () => {
    const before = (await rows()).length;
    expect((await post(JSON.stringify({ ...batch, extra: 1 }), 'application/json')).status).toBe(400);
    expect((await post('not json', 'text/plain')).status).toBe(400);
    expect((await rows()).length).toBe(before);
  });

  it('counts events in /v1/metrics', async () => {
    const text = await (await fetch(`${url}/v1/metrics`)).text();
    expect(text).toMatch(/ta_analytics_events_total\{name="test_event"\} 1/);
  });
});
