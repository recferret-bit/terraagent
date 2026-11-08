/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed JSON replies */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InflightGate } from '../../src/market/trade/inflight-gate.js';
import { auditPlanet, expectLedgerDelta } from './exchange-audit.js';
import { Exchange, ord } from './exchange-harness.js';

let ex: Exchange;
beforeAll(async () => { ex = await Exchange.boot({ TA_DB_POOL_SIZE: '10', ...(process.env.EX_INFLIGHT ? { TA_TRADE_MAX_INFLIGHT: process.env.EX_INFLIGHT } : {}) }); });
afterAll(async () => { await ex?.close(); });

describe('a parallel burst on a small connection pool', () => {
  it('40 concurrent placements from 8 keys: each succeeds or gets a clean 429/503, never 5xx, conservation holds', async () => {
    const w = ex.world();
    const bots = await Promise.all(Array.from({ length: 8 }, (_, i) => w.bot(i % 2 === 0 ? { allowance: { maxOpenOrders: 50 } } : { fund: { USDC: '500' }, allowance: { maxOpenOrders: 50 } })));
    const supply = await ex.supply();
    const ledger = await ex.ledger();
    const rs: Array<{ status: number; body: any }> = await Promise.all(Array.from({ length: 40 }, (_, i) => {
      const a = bots[i % 8]!;
      return a.place(i % 2 === 0 ? ord('sell', 2, 200_000 + i) : ord('buy', 2, 200_000 + i));
    }));
    const bad = rs.filter((r) => ![201, 202, 422, 429, 503].includes(r.status));
    expect(bad.map((r) => [r.status, r.body]), 'no 5xx').toEqual([]);
    for (const r of rs.filter((x) => x.status === 503)) expect(r.body.error.code).toBe('server_busy');
    expect(rs.filter((r) => r.status === 201).length).toBeGreaterThan(0);
    await ex.until(async () => (await ex.prisma.tradeApiRequest.count({ where: { planetId: w.planetId, state: { in: ['PENDING', 'SUBMITTED', 'LINKED'] } } })) === 0, 60_000, 'requests to finish');
    await ex.settle();
    expect(await ex.supply()).toEqual(supply);
    await expectLedgerDelta(ex, w.planetId, ledger);
    await auditPlanet(ex, w.planetId);
  });

  it('a full queue answers server_busy (503) with a retry hint, and the gate is sized under the pool', async () => {
    const g = new InflightGate(1, 30);
    let release!: () => void;
    const hold = g.run(() => new Promise<void>((r) => { release = r; }));
    const err: any = await g.run(async () => 1).catch((e: unknown) => e);
    expect([err.status, err.code, err.details.retryAfterMs]).toEqual([503, 'server_busy', 1000]);
    release();
    await hold;
    expect(await g.run(async () => 7)).toBe(7);
    expect(InflightGate.fromEnv({ TA_DB_POOL_SIZE: 10 }).limit).toBe(4);
    expect(InflightGate.fromEnv({ TA_DB_POOL_SIZE: 20 }).limit).toBe(9);
    expect(InflightGate.fromEnv({ TA_DB_POOL_SIZE: 2 }).limit).toBe(1);
  });
});
