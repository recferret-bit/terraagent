/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed JSON replies */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRISMA } from '../../src/db/db.module.js';
import { Exchange, ord } from './exchange-harness.js';

let ex: Exchange;
beforeAll(async () => { ex = await Exchange.boot(); });
afterAll(async () => { await ex?.close(); });

const raw = (method: string, path: string, headers: Record<string, string> = {}) => fetch(`${ex.url}/v1${path}`, { method, headers });

describe('429 carries Retry-After', () => {
  it('a key over its bucket: whole-second Retry-After header and details.retryAfterMs', async () => {
    const a = await ex.world().bot();
    const rs = await Promise.all(Array.from({ length: 60 }, () => raw('GET', '/trade/balances', { authorization: `Bearer ${a.secret}` })));
    const limited = rs.filter((r) => r.status === 429);
    expect(limited.length).toBeGreaterThan(0);
    for (const r of limited) {
      const secs = Number(r.headers.get('retry-after'));
      expect(Number.isInteger(secs) && secs >= 1).toBe(true);
      const body: any = await r.json();
      expect(body.error.code).toBe('rate_limited');
      expect(body.error.details.retryAfterMs).toBeGreaterThan(0);
      expect(secs).toBe(Math.ceil(body.error.details.retryAfterMs / 1000));
    }
  });
});

describe('path and query ids are validated everywhere', () => {
  const routes = (id: string) => [
    ['DELETE', `/trade/orders/${id}`], ['DELETE', `/trade/keys/${id}`], ['PATCH', `/trade/keys/${id}/allowance`], ['GET', `/trade/book/${id}/bio.water%2FUSDC`],
    ['GET', `/trade/book/w13-dev/${id}`], ['GET', `/trade/book/${id}/bio.water%2FUSDC/orders`], ['GET', `/trade/board/${id}`], ['GET', `/market/${id}`],
    ['GET', `/trade/orders?planetId=${id}`], ['GET', `/trade/orders?pair=${id}`], ['GET', `/trade/fills?planetId=${id}`], ['GET', `/trade/balances?planetId=${id}`],
    ['GET', `/trade/stall?planetId=${id}`], ['GET', `/trade/stream?planetId=${id}`], ['GET', `/trade/stream?pairs=${id}`], ['GET', `/trade/agent/quote?resource=bio.water&planetId=${id}`],
    ['GET', `/trade/policy?as=${id}`], ['GET', `/market/w13-dev?as=${id}`],
  ] as const;

  for (const [label, id] of [['NUL byte', '%00%00'], ['overlong', 'a'.repeat(300)], ['control char', '%0a%1f']] as const) {
    it(`${label}: every id route answers 400 invalid_request, never 5xx or DB text`, async () => {
      const a = await ex.world().bot();
      const headers = { authorization: `Bearer ${a.secret}`, 'content-type': 'application/json' };
      for (const [method, path] of routes(id)) {
        // the public routes share a per-IP bucket: space the calls so the throttle never answers instead of the validator
        const r = await fetch(`${ex.url}/v1${path}`, { method, headers, ...(method === 'PATCH' ? { body: '{}' } : {}) });
        const text = await r.text();
        expect([method, path, r.status], text).toEqual([method, path, 400]);
        expect(JSON.parse(text).error.code, `${method} ${path}`).toBe('invalid_request');
        expect(text).not.toMatch(/prisma|postgres|22021|invalid byte/i);
      }
    });
  }

  it('NUL in a body planetId or label is 400 invalid_request', async () => {
    const a = await ex.world().bot();
    const r = await a.req('POST', '/trade/orders', { body: ord('sell', 1, 100_000, { planetId: 'x\u0000y' }), idem: randomUUID() });
    expect([r.status, r.body.error.code]).toEqual([400, 'invalid_request']);
    const k = await ex.api('POST', '/trade/keys', { as: 'alice', body: { planetId: 'w13-dev', label: 'a\u0000b' } });
    expect([k.status, k.body.error.code]).toEqual([400, 'invalid_request']);
  });
});

describe('internal errors never leak', () => {
  it('an unexpected DB failure answers 500 internal with a generic message and a request id', async () => {
    const a = await ex.world().bot();
    const prisma = ex.app.get(PRISMA) as unknown as { marketOrder: { findMany: (...x: unknown[]) => unknown } };
    const orig = prisma.marketOrder.findMany;
    prisma.marketOrder.findMany = () => Promise.reject(new Error('invalid byte sequence for encoding "UTF8": 0x00 (secret-table chain.market_order)'));
    try {
      const r = await a.req('DELETE', '/trade/orders/some-order');
      expect(r.status).toBe(500);
      expect(JSON.stringify(r.body)).not.toMatch(/invalid byte|secret-table|UTF8/);
      expect(r.body.error.code).toBe('internal');
      expect(typeof r.body.requestId).toBe('string');
    } finally { prisma.marketOrder.findMany = orig; }
  });
});

describe('idempotent rejections replay identically', () => {
  it('a stored max_open_orders rejection returns the same code, message and details on every replay', async () => {
    const w = ex.world();
    const a = await w.bot({ allowance: { maxOpenOrders: 1 } });
    expect((await a.place(ord('sell', 5, 500_000))).status).toBe(201);
    const key = randomUUID();
    const first = await a.place(ord('sell', 5, 500_000), key);
    expect([first.status, first.body.error.code]).toEqual([422, 'max_open_orders']);
    expect(first.body.error.details).toMatchObject({ max: 1 });
    const again = await a.place(ord('sell', 5, 500_000), key);
    expect(again.status).toBe(422);
    expect(again.body.error).toEqual(first.body.error);
    expect(again.body.requestId).toBe(first.body.requestId);
  });
});

describe('per-IP throttle', () => {
  it('the per-IP public throttle answers 429 with Retry-After too', async () => {
    const rs = await Promise.all(Array.from({ length: 200 }, () => raw('GET', '/trade/pairs')));
    const limited = rs.find((r) => r.status === 429);
    expect(limited).toBeTruthy();
    expect(Number(limited!.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(((await limited!.json()) as any).error.details.retryAfterMs).toBeGreaterThan(0);
  });
});
