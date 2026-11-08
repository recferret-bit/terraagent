import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Exchange, ord } from '../exchange/exchange-harness.js';
import { realWorld, simColony } from './real-planet.js';

let ex: Exchange;
beforeAll(async () => { ex = await Exchange.boot({}, { realSim: true }); });
afterAll(async () => { await ex?.close(); });

describe('REAL sim: open-order mirror of USDC buys', () => {
  // SIM-LEAK (source bug, shared/sim/src/systems/trade/module-commands.ts, found by T3, routed to the lead): a FILLED buy order paid in USDC
  // reserves no resource in the sim (`reserved` is `{}`), so `market.settled` never deletes its `openOrders` ref (`before > 0` is false) and
  // `market.release` is not sent for a filled order. After `openOrderLimit` (20) filled USDC buys the colony is refused `order_limit` with
  // zero open orders. This test states the CORRECT behaviour (fixed by the sim order lifecycle).
  it('a colony can keep buying after more filled USDC buys than the open-order limit', async () => {
    const w = await realWorld(ex, 2);
    const a = await w.bot({ idx: 0, allowance: { maxOpenOrders: 50, dailyBudget: '100000000000' } });
    const b = await w.bot({ idx: 1, fund: { USDC: '100' }, allowance: { maxOpenOrders: 50, dailyBudget: '100000000000' } });
    for (let i = 0; i < 21; i++) {
      await a.place(ord('sell', 1, 100_000));
      const r = await b.place(ord('buy', 1, 100_000));
      expect(r.body.error?.code, `buy #${i + 1}`).toBeUndefined();
      await ex.settle(); // the fill is FINAL (sim told) before the next order
    }
    await ex.settle();
    // the last fill's `market.settled` is applied on the sim's next tick: poll briefly
    let open = (await simColony(ex, w.planetId, 1)).openRefs.length;
    for (let i = 0; i < 20 && open > 0; i++) {
      await new Promise((r) => setTimeout(r, 250));
      open = (await simColony(ex, w.planetId, 1)).openRefs.length;
    }
    expect(open).toBe(0);
  }, 240_000);
});
