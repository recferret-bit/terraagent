import { expect, test } from './harness';
import type { BotApi } from './w13-bots-api';

/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed JSON replies */
/** Organic classification of fills (D-45) over the real sim, real settlement and the mock chain. */
export function registerFillSteps(api: BotApi): void {
  const trade = async (tradeId: string): Promise<any> => ((await api.market()).json.recentTrades as any[]).find((t) => t.tradeId === tradeId);

  test('@hack 9f-1. Bot vs bot with different owners: both fills FINAL and organic, the public trade list says organic; two counterparties never make a reference price', async () => {
    test.setTimeout(180_000);
    const w = await api.world();
    await api.reset();
    const { sell, buy } = await api.cross(w.ba, w.bb, 10, '1');
    const fb = await api.waitFill(w.bb, buy);
    const fa = await api.waitFill(w.ba, sell);
    expect(fa.tradeId).toBe(fb.tradeId);
    expect([fa.organic, fb.organic]).toEqual([true, true]);
    expect([fa.actorKind, fb.actorKind, fa.counterpartyKind, fb.counterpartyKind]).toEqual(['bot', 'bot', 'bot', 'bot']);
    expect([fa.side, fb.side]).toEqual(['sell', 'buy']);
    expect((await trade(fa.tradeId)).organic).toBe(true);
    const row = ((await api.market()).json.board as any[]).find((r) => r.pair === api.pair);
    // only two sim colonies exist: counterparties <= 2 and each holds 50% (> the 40% cap), so no VWAP can appear (see report)
    expect(row.vwap).toBeNull();
    expect(row.classification).toBe('insufficient_data');
    test.info().annotations.push({ type: 'observed', description: `board after organic bot trade: ${JSON.stringify({ classification: row.classification, reason: row.reason, counterparties: row.counterparties, concentrationBp: row.concentrationBp, eligibleVolume: row.eligibleVolume })}` });
  });

  test.fixme('@hack 9f-1b. Organic reference: 3 trades / 10 units / 3 counterparties flip the board from insufficient_data to organic with a VWAP (needs a scenario with >= 3 seated colonies with Trade Hubs; w13 has 2)', () => undefined);

  test('@hack 9f-2. Same-owner bots (one owner, two colonies) never trade organically', async () => {
    test.setTimeout(180_000);
    const w = await api.world();
    await api.reset();
    expect(w.ba.ownerId).toBe(w.ba2.ownerId);
    const before = ((await api.market()).json.board as any[]).find((r) => r.pair === api.pair);
    const { sell, buy } = await api.cross(w.ba, w.ba2, 10, '1');
    const fb = await api.waitFill(w.ba2, buy);
    const fa = await api.waitFill(w.ba, sell);
    expect([fa.organic, fb.organic]).toEqual([false, false]);
    expect((await trade(fa.tradeId)).organic).toBe(false);
    // the board still shows the trade (display), but the organic counters did not move
    const after = ((await api.market()).json.board as any[]).find((r) => r.pair === api.pair);
    expect(after.eligibleVolume ?? 0).toBe(before.eligibleVolume ?? 0);
    expect(after.counterparties ?? 0).toBe(before.counterparties ?? 0);
  });

  test('@hack 9f-3. Human vs bot, both directions: organic (different owners)', async () => {
    test.setTimeout(180_000);
    const w = await api.world();
    await api.reset();
    const x = await api.cross(w.bb, 'a', 10, '1'); // bot (col_1) sells, human A (col_0) buys
    const fa = await api.waitFill('a', x.buy);
    const fb = await api.waitFill(w.bb, x.sell);
    expect([fa.actorKind, fa.counterpartyKind, fb.actorKind, fb.counterpartyKind]).toEqual(['player', 'bot', 'bot', 'player']);
    expect([fa.organic, fb.organic]).toEqual([true, true]);
    const y = await api.cross('a', w.bd, 10, '1'); // human A sells, bot (col_1) buys
    const ga = await api.waitFill('a', y.sell);
    expect([ga.organic, ga.counterpartyKind]).toEqual([true, 'bot']);
  });

  test('@hack 9f-4. Fixture (market.seed) orders fill, but the fill is never organic', async () => {
    test.setTimeout(180_000);
    await api.world();
    await api.reset();
    const planetId = api.ctx.planetId();
    const seeded = await api.dev('market.seed', { planetId, pair: api.pair });
    expect(seeded.status, JSON.stringify(seeded.json)).toBe(200);
    try {
      const asks = (await api.trade('GET', `/book/${planetId}/${api.pairUrl}/orders?side=sell`)).json.orders as any[];
      const fixture = asks.find((o) => o.actorKind === 'fixture');
      expect(fixture, 'seeded fixture ask on the public book').toBeTruthy();
      const amount: number = fixture.remaining;
      const total = (BigInt(fixture.price.num) * BigInt(amount) + BigInt(fixture.price.den) - 1n) / BigInt(fixture.price.den);
      const placed = await api.place('b', { side: 'buy', resource: api.ctx.water, amount, price: { token: 'USDC', amount: total.toString() }, ttlS: 3600, maxStallFeeBp: 100 }, 'fx');
      expect([201, 202], JSON.stringify(placed.json)).toContain(placed.status);
      const orderId = placed.json.order?.orderId ?? (await api.orders('b')).find((o) => o.side === 'buy')!.orderId;
      const fill = await api.waitFill('b', orderId);
      expect(fill.organic).toBe(false);
      expect(fill.counterpartyKind).toBe('fixture');
      expect((await trade(fill.tradeId)).organic).toBe(false);
    } finally {
      await api.dev('market.clear', { planetId });
    }
  });
}
