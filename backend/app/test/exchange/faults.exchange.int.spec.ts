import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { auditPlanet, expectLedgerDelta } from './exchange-audit.js';
import { Exchange, mockChainControls, ord, type Actor } from './exchange-harness.js';

let ex: Exchange;
beforeAll(async () => { ex = await Exchange.boot({ OUTBOX_MAX_ATTEMPTS: '3' }); });
afterEach(() => mockChainControls.reset());
afterAll(async () => { await ex?.close(); });

const TRADE = { port: 'Intents', method: 'execute', opIdPrefix: 'trade:' } as const;
const ID = (r: { body: any }): string => r.body.order.orderId;
const snap = async () => { await ex.settle(); return { sup: await ex.supply(), led: await ex.ledger() }; };
const runRelay = async () => { await ex.prisma.$executeRaw`UPDATE chain.chain_outbox SET next_attempt_at = now() WHERE status IN ('PENDING', 'FAILED')`; return ex.relay.pollOnce(); };

/** Seller offers 100 water for 5 USDC, buyer bids the same: one PENDING trade, nothing moved on the chain yet. */
async function matched() {
  const w = ex.world();
  const [seller, buyer] = [await w.bot(), await w.bot({ fund: { USDC: '50' } })];
  const before = await snap();
  const ask = ID(await seller.place(ord('sell', 100, 5_000_000)));
  const bid = ID(await buyer.place(ord('buy', 100, 5_000_000)));
  const [t] = await ex.tradesOf(w.planetId);
  expect(t!.state).toBe('PENDING');
  return { w, seller, buyer, ask, bid, tradeId: t!.tradeId, before };
}
const trade = async (tradeId: string) => (await ex.trades.find(tradeId))!;
async function conserved(c: Awaited<ReturnType<typeof matched>>) {
  expect(await ex.supply()).toEqual(c.before.sup);
  await expectLedgerDelta(ex, c.w.planetId, c.before.led);
  await auditPlanet(ex, c.w.planetId);
}
const effects = (tradeId: string) => ex.prisma.mockChainReceipt.count({ where: { opId: `trade:${tradeId}`, status: 'success' } });

describe('fail_before / retries', () => {
  it('fail_before once: nothing moved, the row is retried with the same opId and settles exactly once', async () => {
    const c = await matched();
    const h = mockChainControls.faults.inject({ kind: 'fail_before', ...TRADE, times: 1 });
    const buyerBefore = await c.buyer.bal('USDC');
    await runRelay();
    expect(h.fired()).toBe(1);
    expect(await c.buyer.bal('USDC')).toBe(buyerBefore); // no balance change
    expect((await trade(c.tradeId)).state).toBe('PENDING');
    expect(await effects(c.tradeId)).toBe(0);
    await ex.settle();
    expect((await trade(c.tradeId)).state).toBe('FINAL');
    expect(await effects(c.tradeId)).toBe(1);
    expect(ex.settledCmds(c.tradeId)).toHaveLength(3);
    await conserved(c);
  });

  it('retries exhausted (DEAD) with nothing applied: UNKNOWN keeps everything held; reconcile executes the SAME opId once', async () => {
    const c = await matched();
    const h = mockChainControls.faults.inject({ kind: 'fail_before', ...TRADE, times: 3 });
    for (let i = 0; i < 3; i++) await runRelay();
    expect(h.fired()).toBe(3);
    expect((await ex.prisma.chainOutbox.findUniqueOrThrow({ where: { opId: `trade:${c.tradeId}` } })).status).toBe('DEAD');
    expect((await trade(c.tradeId)).state).toBe('UNKNOWN');
    expect(await effects(c.tradeId)).toBe(0);
    // reservations stay held: the buyer's funds cannot back a new order while the trade is unresolved
    expect((await ex.funds.view(c.buyer.accountId, 'USDC')).free).toBe(44_900_000n); // 50 USDC minus the 5.1 in flight
    expect(ex.settledCmds(c.tradeId)).toHaveLength(0);
    expect(await ex.recovery.reconcile()).toBe(1);
    expect((await trade(c.tradeId)).state).toBe('FINAL');
    expect(await effects(c.tradeId)).toBe(1);
    expect(await ex.recovery.reconcile()).toBe(0);
    expect(ex.settledCmds(c.tradeId)).toHaveLength(3);
    await conserved(c);
  });
});

describe('unknown outcome (fail_after)', () => {
  it('the chain applied it but said unavailable: quarantined, then finalized once without a second ledger change', async () => {
    const c = await matched();
    const h = mockChainControls.faults.inject({ kind: 'fail_after', ...TRADE, times: 1 });
    await runRelay();
    expect(h.fired()).toBe(1);
    expect((await trade(c.tradeId)).state).toBe('UNKNOWN');
    const buyerUsdc = await c.buyer.bal('USDC');
    expect(buyerUsdc).toBe(50_000_000n - 5_100_000n); // the batch is on chain
    // the debit still counts in flight on top of the applied batch (conservative: free never over-reports)
    expect((await ex.funds.view(c.buyer.accountId, 'USDC')).free).toBeLessThanOrEqual(buyerUsdc);
    expect(ex.settledCmds(c.tradeId)).toHaveLength(0);
    expect(ex.releasesOf(c.bid)).toHaveLength(0);
    // the buyer cannot spend the same money again meanwhile
    await ex.settle();
    await ex.recovery.reconcile();
    expect((await trade(c.tradeId)).state).toBe('FINAL');
    expect(await c.buyer.bal('USDC')).toBe(buyerUsdc);
    expect(await effects(c.tradeId)).toBe(1);
    expect(ex.settledCmds(c.tradeId)).toHaveLength(3);
    await conserved(c);
  });

  it('setOutcomeUnknown (every execute applies then throws) behaves the same and recovers after reset', async () => {
    const c = await matched();
    mockChainControls.setOutcomeUnknown('Intents', true);
    await runRelay();
    expect((await trade(c.tradeId)).state).toBe('UNKNOWN');
    mockChainControls.reset();
    await ex.settle();
    await ex.recovery.reconcile();
    expect((await trade(c.tradeId)).state).toBe('FINAL');
    expect(await effects(c.tradeId)).toBe(1);
    await conserved(c);
  });
});

describe('insufficient funds, duplicates, holds', () => {
  it('insufficient_funds mid-settlement: trade FAILED, nothing moved, the executable orders trade again and end FINAL', async () => {
    const c = await matched();
    const h = mockChainControls.faults.inject({ kind: 'insufficient_funds', ...TRADE, times: 1 });
    await runRelay();
    expect(h.fired()).toBe(1);
    expect((await trade(c.tradeId)).state).toBe('FAILED');
    expect(await effects(c.tradeId)).toBe(0);
    await ex.settle();
    const rows = await ex.tradesOf(c.w.planetId);
    // both orders are still funded, so they must end up traded (FINAL) and never stuck as FILLED-without-a-trade
    expect(rows.filter((t) => t.state === 'FINAL').length, JSON.stringify(rows.map((t) => [t.tradeId, t.state]))).toBe(1);
    expect((await ex.order(c.ask)).state).toBe('FILLED');
    expect(await c.buyer.bal('bio.water')).toBe(100n);
    await conserved(c);
  });

  it('duplicate delivery of the batch has one effect', async () => {
    const c = await matched();
    const h = mockChainControls.faults.inject({ kind: 'duplicate', ...TRADE, times: 1 });
    await ex.settle();
    expect(h.fired()).toBe(1);
    expect((await trade(c.tradeId)).state).toBe('FINAL');
    expect(await effects(c.tradeId)).toBe(1);
    expect(ex.settledCmds(c.tradeId)).toHaveLength(3);
    await conserved(c);
  });

  it('hold: delayed finality keeps the book and funds consistent, then the trade goes FINAL', async () => {
    const c = await matched();
    const h = mockChainControls.faults.inject({ kind: 'hold', ...TRADE, times: 1 });
    const run = runRelay();
    await h.waitHeld();
    expect((await trade(c.tradeId)).state).toBe('PENDING');
    expect([(await ex.order(c.ask)).state, (await ex.order(c.bid)).state]).toEqual(['FILLED', 'FILLED']);
    expect((await ex.books.book(c.w.planetId, 'bio.water/USDC')).size).toBe(0);
    expect((await ex.funds.view(c.seller.accountId, 'bio.water')).free).toBe(400n); // 500 - 100 in flight
    await auditPlanet(ex, c.w.planetId, { inFlight: true });
    // a new bid cannot trade against the in-flight sell; it rests
    const late = await c.buyer.place(ord('buy', 5, 250_000));
    expect(late.body.order?.state ?? late.body.error.code).not.toBe('FILLED');
    h.release();
    await run;
    await ex.settle();
    expect((await trade(c.tradeId)).state).toBe('FINAL');
    expect(ex.settledCmds(c.tradeId)).toHaveLength(3);
    await ex.prisma.marketOrder.updateMany({ where: { planetId: c.w.planetId, state: 'OPEN' }, data: {} });
    expect(await effects(c.tradeId)).toBe(1);
  });
});

describe('process restarts', () => {
  it('restart between PENDING and FINAL: boot recovery leaves the row to the relay, which settles once', async () => {
    const c = await matched();
    await ex.restart();
    await ex.settle();
    await ex.until(async () => (await trade(c.tradeId)).state === 'FINAL', 8000, 'FINAL after restart');
    expect(await effects(c.tradeId)).toBe(1);
    await conserved(c);
  });

  it('killed after execute, before FINAL: restart finalizes it, no second execute, notifications sent once', async () => {
    const c = await matched();
    const spy = vi.spyOn(ex.intents, 'execute');
    ex.settlement.onModuleDestroy(); // the FINAL step never runs
    await runRelay();
    expect(spy).toHaveBeenCalledTimes(1);
    expect((await trade(c.tradeId)).state).toBe('PENDING');
    expect(ex.settledCmds(c.tradeId)).toHaveLength(0);
    spy.mockRestore();
    await ex.restart();
    await ex.until(async () => (await trade(c.tradeId)).state === 'FINAL', 8000, 'FINAL after restart');
    await ex.settle();
    await ex.until(async () => ex.settledCmds(c.tradeId).length >= 3, 8000, 'notifications');
    expect(await effects(c.tradeId)).toBe(1);
    expect(ex.settledCmds(c.tradeId)).toHaveLength(3);
    await conserved(c);
  });

  it('restart with an UNKNOWN trade: boot reconcile resolves it without a second effect', async () => {
    const c = await matched();
    mockChainControls.faults.inject({ kind: 'fail_after', ...TRADE, times: 1 });
    await runRelay();
    expect((await trade(c.tradeId)).state).toBe('UNKNOWN');
    await ex.restart(); // clears the fault rules too
    await ex.until(async () => (await trade(c.tradeId)).state === 'FINAL', 8000, 'reconcile at boot');
    await ex.settle();
    await ex.until(async () => ex.settledCmds(c.tradeId).length >= 3, 8000, 'notifications');
    expect(await effects(c.tradeId)).toBe(1);
    expect(ex.settledCmds(c.tradeId)).toHaveLength(3);
    await conserved(c);
  });

  it('restart rebuilds the book exactly: resting orders keep their reservations and still match', async () => {
    const w = ex.world();
    const [s, b] = [await w.bot(), await w.bot({ fund: { USDC: '50' } })];
    const before = await snap();
    const ask = ID(await s.place(ord('sell', 100, 5_000_000)));
    await ex.restart();
    const book = await ex.books.book(w.planetId, 'bio.water/USDC');
    expect(book.get(ask)).toMatchObject({ filled: 0n, reservedPrincipal: 100n });
    const bid = await b.req('POST', '/trade/orders', { body: { planetId: w.planetId, ...ord('buy', 100, 5_000_000) }, idem: 'after-restart' });
    expect(bid.body.order.state).toBe('FILLED');
    await ex.settle();
    expect(await ex.supply()).toEqual(before.sup);
    await expectLedgerDelta(ex, w.planetId, before.led);
    await auditPlanet(ex, w.planetId);
  });
});

void ({} as Actor);
