import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mockChainControls } from '../../src/near/infrastructure/mock/mock-controls.js';
import { acct, bootHarness, opIdOf, USDC, WATER, type Harness } from './market-harness.js';

let h: Harness;
let n = 100;
beforeAll(async () => { h = await bootHarness(); });
afterEach(() => mockChainControls.reset());
afterAll(async () => { await h?.close(); });

const settledFor = (tradeId: string) => h.cmds.filter((c) => c.kind === 'market.settled' && (c.args as { tradeId: string }).tradeId === tradeId);
const releases = (orderId: string) => h.cmds.filter((c) => c.kind === 'market.release' && (c.args as { orderId?: string }).orderId === orderId);

describe('W13-14 final failure: orders return executable with reservations reacquired', () => {
  it('buyer cannot pay at execute time: trade FAILED, row never re-run, seller back to OPEN with its reservation, buyer REJECTED', async () => {
    const t = await h.matched(++n);
    const before = await h.order$(t.askId);
    expect(before.state).toBe('FILLED');
    await h.setVerifier(acct(t.buyer), USDC, 0n); // the funds vanished after matching
    const exec = vi.spyOn(h.intents, 'execute');
    await h.relay.pollOnce();
    expect(exec).toHaveBeenCalledTimes(1);
    expect((await h.trades.find(t.tradeId))!.state).toBe('FAILED');
    expect((await h.db.prisma.chainOutbox.findUnique({ where: { opId: opIdOf(t.tradeId) } }))!.status).toBe('DEAD');
    const ask = await h.order$(t.askId);
    expect(ask).toMatchObject({ state: 'OPEN', filled: expect.anything() });
    expect(ask.filled.toFixed()).toBe('0');
    expect(ask.cumNotional.toFixed()).toBe('0');
    expect(ask.reservedPrincipal.toFixed()).toBe('300');
    expect(Object.values(ask.feeBuckets as Record<string, { base: string; fee: string }>).every((b) => b.base === '0' && b.fee === '0')).toBe(true);
    const bid = await h.order$(t.bidId);
    expect(bid.state).toBe('REJECTED');
    expect(bid.filled.toFixed()).toBe('0');
    expect(bid.reservedPrincipal.toFixed()).toBe('0');
    expect(bid.reservedFees.toFixed()).toBe('0');
    expect(releases(t.bidId).some((c) => (c.args as { reason: string }).reason === 'settlement_failed')).toBe(true);
    expect(settledFor(t.tradeId)).toHaveLength(0);
    await h.relay.pollOnce();
    expect(exec).toHaveBeenCalledTimes(1); // retries/restarts never execute it again
    exec.mockRestore();
  });

  it('the executable order is matched again: a new bid trades against the restored ask', async () => {
    const t = await h.matched(++n);
    await h.setVerifier(acct(t.buyer), USDC, 0n);
    await h.relay.pollOnce();
    expect((await h.order$(t.askId)).state).toBe('OPEN');
    await h.colony(`b${n}x`, { usdc: 10_000_000n });
    await h.place.handle(h.order(t.planetId, `b${n}x`, { side: 'buy', price: { token: 'USDC', amount: '5000000' }, maxStallFeeBp: 100 }));
    const trades = await h.db.prisma.intentTrade.findMany({ where: { planetId: t.planetId }, orderBy: { id: 'asc' } });
    expect(trades.map((x) => x.state)).toEqual(['FAILED', 'PENDING']);
    await h.relay.pollOnce();
    expect((await h.db.prisma.intentTrade.findMany({ where: { planetId: t.planetId }, orderBy: { id: 'asc' } })).map((x) => x.state)).toEqual(['FAILED', 'FINAL']);
    expect(await h.verifier(acct(t.seller), USDC)).toBe('5050000');
  });

  it('seller cannot deliver: the buyer keeps its order with the full reservation restored, the seller is rejected', async () => {
    const t = await h.matched(++n);
    await h.setVerifier(acct(t.seller), WATER, 0n);
    await h.relay.pollOnce();
    expect((await h.trades.find(t.tradeId))!.state).toBe('FAILED');
    const bid = await h.order$(t.bidId);
    expect(bid.state).toBe('OPEN');
    expect(bid.reservedPrincipal.toFixed()).toBe('5000000');
    expect(bid.reservedFees.toFixed()).toBe('100000');
    expect(Object.values(bid.feeBuckets as Record<string, { base: string; fee: string }>).every((b) => b.base === '0' && b.fee === '0')).toBe(true);
    expect((await h.order$(t.askId)).state).toBe('REJECTED');
    const w = releases(t.askId).find((c) => (c.args as { reason: string }).reason === 'settlement_failed')!;
    expect((w.args as { deltas: Record<string, number> }).deltas).toEqual({ 'bio.water': 300 });
  });

  it('an order cancelled while its fill is in flight stays cancelled; the failure restores the fill fields and releases the mirror', async () => {
    const t = await h.matched(++n);
    await h.setVerifier(acct(t.buyer), USDC, 0n);
    // the seller's order is FILLED (nothing resting): cancel is a no-op; the buyer's too. Cancel the ask after the failure instead.
    await h.relay.pollOnce();
    expect((await h.order$(t.askId)).state).toBe('OPEN');
    expect((await h.release.release(t.askId, 'cancelled')).kind).toBe('released');
    const ask = await h.order$(t.askId);
    expect(ask).toMatchObject({ state: 'CANCELLED' });
    expect(ask.reservedPrincipal.toFixed()).toBe('0');
    expect((await h.release.release(t.askId, 'cancelled')).kind).toBe('noop');
  });
});

describe('W13-14 ambiguous outcome: quarantined, reconciled by the same opId', () => {
  it('unknown outcome: UNKNOWN, funds stay held, the reconciler finalizes once without a second ledger change', async () => {
    const t = await h.matched(++n);
    mockChainControls.setOutcomeUnknown('Intents', true);
    await h.relay.pollOnce();
    expect((await h.trades.find(t.tradeId))!.state).toBe('UNKNOWN');
    const usdc = await h.verifier(acct(t.buyer), USDC);
    expect(usdc).toBe((10_000_000n - 5_100_000n).toString()); // the mock applied the batch before reporting "unavailable"
    // the buyer's in-flight debit still counts, so the same funds cannot back a new order
    const view = await h.funds.view(acct(t.buyer), t.buyer, 'USDC');
    expect(view.free).toBe(0n);
    expect(settledFor(t.tradeId)).toHaveLength(0);
    expect(await h.recovery.reconcile()).toBe(0); // still unknown: nothing released, nothing finalized
    expect((await h.trades.find(t.tradeId))!.state).toBe('UNKNOWN');

    mockChainControls.reset();
    const intentRows = await h.db.prisma.mockChainIntent.count();
    expect(await h.recovery.reconcile()).toBe(1);
    expect((await h.trades.find(t.tradeId))!.state).toBe('FINAL');
    expect(await h.verifier(acct(t.buyer), USDC)).toBe(usdc);
    expect(await h.db.prisma.mockChainIntent.count()).toBe(intentRows);
    expect(settledFor(t.tradeId)).toHaveLength(3);
    expect(await h.recovery.reconcile()).toBe(0);
    expect(settledFor(t.tradeId)).toHaveLength(3);
  });
});

describe('W13-14 notification survives a crash between FINAL and the sim sends', () => {
  it('recover() re-sends market.settled and the push for a FINAL trade that was not notified, once', async () => {
    const t = await h.matched(++n);
    h.settlement.onModuleDestroy();
    await h.relay.pollOnce();
    const row = (await h.db.prisma.chainOutbox.findUnique({ where: { opId: opIdOf(t.tradeId) } }))!;
    expect(row.status).toBe('DONE');
    expect(await h.trades.finalize(t.tradeId, row.txHash)).toBe(true); // FINAL committed, then the process died before notifying
    expect(settledFor(t.tradeId)).toHaveLength(0);
    h.pushes.length = 0;
    expect(await h.settlement.recover()).toBeGreaterThanOrEqual(1);
    expect(settledFor(t.tradeId)).toHaveLength(3);
    expect(h.pushes.filter((p) => p.payload.trade.tradeId === t.tradeId)).toHaveLength(1);
    expect(await h.settlement.recover()).toBe(0);
    expect(settledFor(t.tradeId)).toHaveLength(3);
    h.settlement.onModuleInit();
  });
});
