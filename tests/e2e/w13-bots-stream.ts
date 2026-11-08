import { expect, test } from './harness';
import { openSse, type BotApi } from './w13-bots-api';

/** SSE `GET /v1/trade/stream` against the real stack: hello, own order and fill events, book updates, isolation, reconnect. */
export function registerStreamSteps(api: BotApi): void {
  test('@hack 9f-17. SSE stream: hello, own order + fill events, book updates for everyone, never another colony\'s orders; a pair filter silences other pairs; reconnect starts a fresh hello', async () => {
    test.setTimeout(180_000);
    const w = await api.world();
    await api.reset();
    expect((await openSse(api, {})).status, 'anonymous stream').toBe(401);
    expect((await openSse(api, { key: w.ba.key, query: 'planetId=pl_other' })).status, 'key bound to another planet').toBe(409);
    const sellS = await openSse(api, { key: w.ba.key });
    const buyS = await openSse(api, { key: w.bb.key });
    const quietS = await openSse(api, { key: w.bd.key, query: 'pairs=metals.t1%2FUSDC' }); // col_1 again, but only metals.t1/USDC
    try {
      for (const s of [sellS, buyS, quietS]) {
        const hello = await s.waitFor((e) => e.type === 'hello', 10_000);
        expect(hello.planetId).toBe(api.ctx.planetId());
        expect(s.events[0]!.type, 'hello comes first').toBe('hello');
      }
      const sell = await api.place(w.ba, api.order('sell', 10, '1'), 'ss');
      expect(sell.status, JSON.stringify(sell.json)).toBe(201);
      const sellId: string = sell.json.order.orderId;
      await sellS.waitFor((e) => e.type === 'order' && e.order.orderId === sellId && e.order.state === 'OPEN', 20_000);
      const bookSeen = await buyS.waitFor((e) => e.type === 'book' && e.book.pair === api.pair, 20_000);
      expect(JSON.stringify(bookSeen)).not.toMatch(/accountId|ownerId|colonyId|terraagent\.mock/);
      expect(buyS.events.some((e) => e.type === 'order' && e.order.orderId === sellId), 'B must not see the order of A\'s colony').toBe(false);
      const buy = await api.place(w.bb, api.order('buy', 10, '1'), 'sb');
      const buyId: string = buy.json.order?.orderId ?? (await api.orders(w.bb)).find((o) => o.side === 'buy')!.orderId;
      const fs = await sellS.waitFor((e) => e.type === 'fill' && e.fill.orderId === sellId, 60_000);
      const fb = await buyS.waitFor((e) => e.type === 'fill' && e.fill.orderId === buyId, 60_000);
      expect([fs.fill.side, fb.fill.side, fs.fill.tradeId === fb.fill.tradeId]).toEqual(['sell', 'buy', true]);
      expect(sellS.events.some((e) => e.type === 'order' && e.order.orderId === buyId)).toBe(false);
      expect(buyS.events.some((e) => e.type === 'order' && e.order.orderId === sellId)).toBe(false);
      expect(quietS.events.filter((e) => e.type !== 'hello'), 'pair filter: nothing about water reaches the metals-only stream').toEqual([]);
      // reconnect: nothing is replayed, a new stream says hello and carries the next events
      sellS.close();
      const missed = await api.place(w.ba, api.order('sell', 5, '40'), 'sm');
      expect(missed.status).toBe(201);
      const again = await openSse(api, { key: w.ba.key });
      try {
        await again.waitFor((e) => e.type === 'hello', 10_000);
        expect(again.events.some((e) => e.type === 'order' && e.order.orderId === missed.json.order.orderId), 'no replay of what was missed; GET /orders is the truth').toBe(false);
        expect((await api.openOf(w.ba)).some((o) => o.orderId === missed.json.order.orderId)).toBe(true);
        expect((await api.trade('DELETE', `/orders/${missed.json.order.orderId}`, { key: w.ba.key })).status).toBe(200);
        await again.waitFor((e) => e.type === 'order' && e.order.orderId === missed.json.order.orderId && e.order.state === 'CANCELLED', 20_000);
      } finally {
        again.close();
      }
    } finally {
      for (const s of [sellS, buyS, quietS]) s.close();
    }
    await api.reset();
  });
}
