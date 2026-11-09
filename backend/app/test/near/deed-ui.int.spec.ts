import type { INestApplication } from '@nestjs/common';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { JSDOM } from 'jsdom';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FeatureContext } from '../../../../frontend/game/core/registry/types.js';
import { DeedPanel } from '../../../../frontend/game/features/deed/deedPanel.js';
import { createApp } from '../../src/app.js';

let db: TestDatabase;
let app: INestApplication;
let url: string;
let jsdom: JSDOM;

beforeAll(async () => {
  jsdom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1/' });
  globalThis.window = jsdom.window as unknown as Window & typeof globalThis;
  globalThis.document = jsdom.window.document;

  db = await createTestDatabase();
  const created = await createApp({
    source: {
      NODE_ENV: 'test',
      SIM_THREADS: '1',
      DATABASE_URL: db.url,
      NEAR_MODE: 'mock',
      TA_WAVES: 'W00,W02,W05,W06,W08,W12,W20',
    },
  });
  app = created.app;
  await app.listen(0, '127.0.0.1');
  url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
});

afterAll(async () => {
  await app?.close();
  await db?.drop();
});

describe('W20-10 DeedPanel client <-> server HTTP integration', () => {
  it('loads the Colony Deed from GET /v1/near/deed and seals Settled Deed via POST /v1/near/deed/settle', async () => {
    const seed = await fetch(`${url}/v1/dev/commands/deed.show`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(seed.status).toBe(200);

    const parent = document.createElement('div');
    const ctx: FeatureContext = {
      flags: new Set(['W20']),
      host: 'server',
      services: {},
    };
    const fetchFn: typeof fetch = (input, init) => {
      const path = typeof input === 'string' ? input : input.toString();
      return fetch(path.startsWith('http') ? path : `${url}${path}`, init);
    };

    const panel = new DeedPanel(parent, ctx, { fetchFn });
    const loaded = await panel.refreshFromServer(true);
    expect(loaded?.tokenId).toBe('deed:col_0');
    expect(loaded?.settled).toBe(false);
    expect(panel.root.querySelector('[data-testid="deed-status-chip"]')?.textContent).toBe(
      'Active',
    );

    const settled = await panel.sealSettledDeed();
    expect(settled?.settled).toBe(true);
    expect(panel.root.querySelector('[data-testid="deed-status-chip"]')?.textContent).toBe(
      'Settled',
    );
    expect(panel.root.dataset.settled).toBe('true');

    panel.dispose();
  });
});
