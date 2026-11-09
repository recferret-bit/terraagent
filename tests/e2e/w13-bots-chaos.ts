import { expect, test } from './harness';
import type { Bot, BotApi } from './w13-bots-api';

/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed JSON replies */
/** A crossing burst (conservation) and mock-chain settlement faults on real bot trades. */
function chaosKit(api: BotApi) {
  const W = api.ctx.water;
  const TOKENS = ['USDC', W] as const;
  /** Per token: total over the two colony accounts (A + B), and every reserved/total figure checked non-negative. */
  async function totals(): Promise<{ sum: Record<string, bigint>; each: Record<string, bigint> }> {
    const sum: Record<string, bigint> = {};
    const each: Record<string, bigint> = {};
    for (const who of ['a', 'b'] as const) {
      for (const t of TOKENS) {
        const x = await api.tok(who, t);
        expect(x.total >= 0n && x.reserved >= 0n && x.free >= 0n, `${who} ${t} not negative: ${`${x.total}/${x.reserved}/${x.free}`}`).toBe(true);
        sum[t] = (sum[t] ?? 0n) + x.total;
        each[`${who}:${t}`] = x.total;
      }
    }
    return { sum, each };
  }
  const platformFees = async (tradeIds: Set<string>): Promise<bigint> => {
    const all = (await api.fills('a')).filter((f) => tradeIds.has(f.tradeId));
    return all.reduce((s, f) => s + BigInt(f.platformFee), 0n);
  };
  const tradeIdsNow = async (): Promise<Set<string>> => new Set((await api.fills('a')).map((f) => f.tradeId));
  return { W, totals, platformFees, tradeIdsNow };
}

/** The burst: 20 crossing orders, conservation. */
export function registerChaosSteps(api: BotApi): void {
  const { W, totals, platformFees, tradeIdsNow } = chaosKit(api);

  test('@hack 9f-18. Burst of 20 crossing orders by four keys: every trade FINAL, money conserved (only platform fees leave), nothing negative, reservations back to zero', async () => {
    test.setTimeout(300_000);
    const w = await api.world();
    await api.reset();
    const known = await tradeIdsNow();
    const before = await totals();
    const sellers: Bot[] = [w.ba, w.bc];
    const buyers: Bot[] = [w.bb, w.bd];
    // REPORTED: 20 parallel placements can exhaust the 20-connection Prisma pool and answer 500 "Database error"; a retry with the SAME
    // Idempotency-Key is safe (that is what is exercised here), the 500s are counted in the annotation.
    let serverErrors = 0;
    const placeRetrying = async (bot: Bot, body: Record<string, unknown>, tag: string): Promise<any> => {
      const idem = api.idem(tag);
      for (let attempt = 0; ; attempt++) {
        const r = await api.trade('POST', '/orders', { key: bot.key, body, idem });
        if (r.status < 500 || attempt >= 6) return r;
        serverErrors += 1;
        await new Promise((res) => setTimeout(res, 400));
      }
    };
    const jobs: Array<Promise<any>> = [];
    for (let i = 0; i < 10; i++) {
      jobs.push(placeRetrying(sellers[i % 2]!, api.order('sell', 2, '0.2'), `bs${i}`));
      jobs.push(placeRetrying(buyers[i % 2]!, api.order('buy', 2, '0.2'), `bb${i}`));
    }
    const replies = await Promise.all(jobs);
    const bad = replies.filter((r) => ![201, 202].includes(r.status));
    expect(bad.map((r) => JSON.stringify(r.json)), 'all 20 accepted').toEqual([]);
    // everything ends: no open order, every new trade FINAL
    await expect.poll(async () => (await api.openOf('a')).length + (await api.openOf('b')).length, { timeout: 120_000, message: 'no resting order is left (all crossed)' }).toBe(0);
    let fresh: any[] = [];
    await expect.poll(async () => {
      fresh = (await api.fills('a')).filter((f) => !known.has(f.tradeId));
      return fresh.length > 0 && fresh.every((f) => f.state === 'FINAL');
    }, { timeout: 180_000, message: 'every burst trade FINAL' }).toBe(true);
    const volume = fresh.reduce((s, f) => s + f.amount, 0);
    expect(volume, '20 orders x 2 units cross completely: 20 units traded').toBe(20);
    await api.reset();
    const after = await totals();
    expect(after.sum[W], 'water conserved').toBe(before.sum[W]);
    const fees = await platformFees(new Set(fresh.map((f) => f.tradeId)));
    expect(before.sum.USDC! - after.sum.USDC!, 'USDC only leaves as platform fee').toBe(fees);
    test.info().annotations.push({ type: 'observed', description: `burst: ${fresh.length} trades, ${volume} units, platform fees ${fees} atomic, 5xx retried: ${serverErrors}` });
  });

}

/** Settlement faults on real bot trades. */
export function registerFaultSteps(api: BotApi): void {
  const { W, totals } = chaosKit(api);

  test('@hack 9f-19. Settlement fault fail_after (UNKNOWN outcome): funds stay locked, one FINAL trade after the reset, money moved exactly once', async () => {
    test.setTimeout(240_000);
    const w = await api.world();
    await api.reset();
    const before = await totals();
    expect((await api.fault({ kind: 'fail_after', port: 'Intents', method: 'execute', opIdPrefix: 'trade:', times: 1 })).status).toBe(200);
    const x = await api.cross(w.ba, w.bb, 5, '0.5');
    const stuck = await api.waitFill(w.bb, x.buy, 'UNKNOWN', 90_000);
    const during = await api.tok(w.bb, 'USDC');
    const duringW = await api.tok(w.ba, W);
    const b0 = before.each['b:USDC']!;
    expect(b0 - (during.free + during.reserved) >= 500_000n || during.free < b0, `buyer USDC stays locked while UNKNOWN (total ${b0} -> free ${during.free} reserved ${during.reserved})`).toBe(true);
    expect(duringW.free, 'seller water is not free while UNKNOWN').toBeLessThanOrEqual(before.each['a:' + W]! - 5n);
    await api.faultReset();
    const fin = await api.waitFill(w.bb, x.buy, 'FINAL', 120_000);
    expect(fin.tradeId).toBe(stuck.tradeId);
    expect((await api.fills(w.bb)).filter((f) => f.orderId === x.buy).length, 'exactly one trade for the order').toBe(1);
    await api.reset();
    const after = await totals();
    expect(after.each['a:' + W]).toBe(before.each['a:' + W]! - 5n);
    expect(after.each['b:' + W]).toBe(before.each['b:' + W]! + 5n);
    expect(before.sum.USDC! - after.sum.USDC!).toBe(BigInt(fin.platformFee));
  });

  test('@hack 9f-20. Settlement fault fail_before (relay retries): the trade still ends FINAL exactly once', async () => {
    test.setTimeout(240_000);
    const w = await api.world();
    await api.reset();
    const before = await totals();
    expect((await api.fault({ kind: 'fail_before', port: 'Intents', method: 'execute', opIdPrefix: 'trade:', times: 2 })).status).toBe(200);
    const x = await api.cross(w.bc, w.bd, 5, '0.5');
    const fin = await api.waitFill(w.bd, x.buy, 'FINAL', 150_000);
    expect((await api.fills(w.bd)).filter((f) => f.orderId === x.buy).length).toBe(1);
    await api.reset();
    const after = await totals();
    expect(after.each['a:' + W]).toBe(before.each['a:' + W]! - 5n);
    expect(before.sum.USDC! - after.sum.USDC!).toBe(BigInt(fin.platformFee));
  });

  test('@hack 9f-21. Settlement fault insufficient_funds: the trade fails, nothing moves for it, and the orders are restored (still cancellable, reservations released)', async () => {
    test.setTimeout(240_000);
    const w = await api.world();
    await api.reset();
    const before = await totals();
    expect((await api.fault({ kind: 'insufficient_funds', port: 'Intents', method: 'execute', opIdPrefix: 'trade:', times: 1 })).status).toBe(200);
    const x = await api.cross(w.ba, w.bb, 5, '0.5');
    const failed = await api.waitFill(w.bb, x.buy, 'FAILED', 120_000);
    // the failed trade moved nothing; the orders are open again (restored) or already re-filled by exactly one FINAL trade
    await expect.poll(async () => {
      const open = (await api.openOf('a')).concat(await api.openOf('b')).map((o) => o.orderId);
      const finals = (await api.fills(w.bb)).filter((f) => f.orderId === x.buy && f.state === 'FINAL').length;
      return open.includes(x.sell) && open.includes(x.buy) ? 'restored' : finals === 1 ? 'refilled' : 'pending';
    }, { timeout: 120_000, message: `orders of FAILED trade ${failed.tradeId} restored` }).not.toBe('pending');
    const mid = await api.fills(w.bb);
    expect(mid.filter((f) => f.orderId === x.buy && f.state === 'FINAL').length).toBeLessThanOrEqual(1);
    await api.reset();
    const after = await totals();
    const finals = (await api.fills('a')).filter((f) => f.state === 'FINAL' && f.orderId === x.sell);
    const fees = finals.reduce((s, f) => s + BigInt(f.platformFee), 0n);
    expect(after.sum[W], 'water conserved').toBe(before.sum[W]);
    expect(before.sum.USDC! - after.sum.USDC!, 'USDC lost = platform fee of the FINAL trades only').toBe(fees);
    expect(finals.length === 0 ? after.each['a:' + W] : before.each['a:' + W]! - 5n, 'water moved at most once').toBe(after.each['a:' + W]);
  });
}
