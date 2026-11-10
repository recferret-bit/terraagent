import type { INestApplication } from '@nestjs/common';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { EventBus } from '../../src/bus/event-bus.js';

let db: TestDatabase;
let app: INestApplication;
let url: string;
let bus: EventBus;

beforeAll(async () => {
  db = await createTestDatabase();
  const created = await createApp({
    source: {
      NODE_ENV: 'test',
      SIM_THREADS: '1',
      DATABASE_URL: db.url,
      NEAR_MODE: 'mock',
      TA_WAVES: 'W00,W02,W05,W06,W08,W20',
    },
  });
  app = created.app;
  bus = app.get(EventBus);
  await app.listen(0, '127.0.0.1');
  url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
});

afterAll(async () => {
  await app?.close();
  await db?.drop();
});

describe('W20-25 Deed notifications integration (with W09 off)', () => {
  it('emits near.deed.updated bus events for milestones and settling without error when W09 is off', async () => {
    const received: Array<{ change: string; version: number; settled: boolean }> = [];
    const off = bus.on(
      'near.deed.updated',
      (ev) => {
        received.push({
          change: ev.payload.change,
          version: ev.payload.version,
          settled: ev.payload.deed?.settled ?? ev.payload.settled,
        });
      },
      { module: 'W20-25-test' },
    );

    try {
      // Seed and bump milestone via dev commands
      const bump = await fetch(`${url}/v1/dev/commands/deed.bump`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ field: 'terraform', value: 10 }),
      });
      expect(bump.status).toBe(200);

      // Flush debounce via settle (with W09 off, must succeed without error)
      const settle = await fetch(`${url}/v1/dev/commands/deed.settle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(settle.status).toBe(200);

      expect(received.some((r) => r.settled)).toBe(true);
    } finally {
      off();
    }
  });
});
