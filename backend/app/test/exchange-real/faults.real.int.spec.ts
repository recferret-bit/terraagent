/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed JSON replies */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { auditPlanet } from '../exchange/exchange-audit.js';
import { Exchange, mockChainControls, ord } from '../exchange/exchange-harness.js';
import { expectConserved, snapshotOf } from './real-checks.js';
import { realWorld, simColony } from './real-planet.js';

let ex: Exchange;
beforeAll(async () => { ex = await Exchange.boot({ OUTBOX_MAX_ATTEMPTS: '3' }, { realSim: true }); });
afterEach(() => mockChainControls.reset());
afterAll(async () => { await ex?.close(); });

const TRADE = { port: 'Intents', method: 'execute', opIdPrefix: 'trade:' } as const;
const runRelay = async () => { await ex.prisma.$executeRaw`UPDATE chain.chain_outbox SET next_attempt_at = now() WHERE status IN ('PENDING', 'FAILED')`; return ex.relay.pollOnce(); };
const trade = async (id: string) => (await ex.trades.find(id))!;
const effects = (id: string) => ex.prisma.mockChainReceipt.count({ where: { opId: `trade:${id}`, status: 'success' } });

/** A bot ask and a bot bid of two colonies on a real planet: one PENDING trade, nothing on the chain yet. */
async function matched() {
  const w = await realWorld(ex, 2);
  const [seller, buyer] = [await w.bot({ idx: 0 }), await w.bot({ idx: 1, fund: { USDC: '50' } })];
  const before = await snapshotOf(ex);
  await seller.place(ord('sell', 100, 5_000_000));
  const bid = await buyer.place(ord('buy', 100, 5_000_000));
  expect(bid.status, JSON.stringify(bid.body)).toBe(201);
  const [t] = await ex.tradesOf(w.planetId);
  expect(t!.state).toBe('PENDING');
  return { w, seller, buyer, tradeId: t!.tradeId, before, actors: [seller, buyer] };
}
const conserved = (c: Awaited<ReturnType<typeof matched>>) => expectConserved(ex, c.w.planetId, c.before, c.actors);

describe('REAL sim: fault injection on bot trades', () => {
  it('fail_before once: nothing moved, retried with the same opId, settles once; the sim sees one settlement per role', async () => {
    const c = await matched();
    const h = mockChainControls.faults.inject({ kind: 'fail_before', ...TRADE, times: 1 });
    await runRelay();
    expect(h.fired()).toBe(1);
    expect((await trade(c.tradeId)).state).toBe('PENDING');
    expect(await effects(c.tradeId)).toBe(0);
    // while PENDING the sim still holds the seller's reservation
    expect((await simColony(ex, c.w.planetId, 0)).reservedInOrbit['bio.water']).toBe(100);
    await ex.settle();
    expect((await trade(c.tradeId)).state).toBe('FINAL');
    expect(await effects(c.tradeId)).toBe(1);
    expect(ex.settledCmds(c.tradeId)).toHaveLength(3);
    await conserved(c);
    expect((await simColony(ex, c.w.planetId, 1)).inOrbit['bio.water']).toBe(100);
  });

  it('retries exhausted: UNKNOWN keeps funds held, reconcile finalizes the SAME opId once', async () => {
    const c = await matched();
    mockChainControls.faults.inject({ kind: 'fail_before', ...TRADE, times: 3 });
    for (let i = 0; i < 3; i++) await runRelay();
    expect((await trade(c.tradeId)).state).toBe('UNKNOWN');
    expect(await effects(c.tradeId)).toBe(0);
    expect(await ex.recovery.reconcile()).toBe(1);
    expect(await ex.recovery.reconcile()).toBe(0);
    expect((await trade(c.tradeId)).state).toBe('FINAL');
    expect(await effects(c.tradeId)).toBe(1);
    await conserved(c);
  });

  it('fail_after (chain applied, said unavailable): UNKNOWN then FINAL with no second ledger change', async () => {
    const c = await matched();
    mockChainControls.faults.inject({ kind: 'fail_after', ...TRADE, times: 1 });
    await runRelay();
    expect((await trade(c.tradeId)).state).toBe('UNKNOWN');
    const paid = await c.buyer.bal('USDC');
    await ex.settle();
    await ex.recovery.reconcile();
    expect((await trade(c.tradeId)).state).toBe('FINAL');
    expect(await c.buyer.bal('USDC')).toBe(paid);
    expect(await effects(c.tradeId)).toBe(1);
    await conserved(c);
  });

  it('insufficient_funds mid-settlement: FAILED, nothing moved, the orders trade again and end FINAL (sim reservations survive)', async () => {
    const c = await matched();
    const h = mockChainControls.faults.inject({ kind: 'insufficient_funds', ...TRADE, times: 1 });
    await runRelay();
    expect(h.fired()).toBe(1);
    expect((await trade(c.tradeId)).state).toBe('FAILED');
    await ex.settle();
    const rows = await ex.tradesOf(c.w.planetId);
    expect(rows.filter((t) => t.state === 'FINAL')).toHaveLength(1);
    expect(rows.filter((t) => t.state === 'FAILED')).toHaveLength(1);
    await conserved(c);
  });

  it('a fault never leaks across planets: a faulted trade on one planet does not block another', async () => {
    const c = await matched();
    mockChainControls.faults.inject({ kind: 'fail_before', ...TRADE, times: 2 });
    const d = await matched();
    await ex.settle();
    await ex.recovery.reconcile();
    await ex.settle();
    for (const x of [c, d]) {
      expect((await trade(x.tradeId)).state).toBe('FINAL');
      expect(await effects(x.tradeId)).toBe(1);
      await auditPlanet(ex, x.w.planetId);
    }
  });
});
