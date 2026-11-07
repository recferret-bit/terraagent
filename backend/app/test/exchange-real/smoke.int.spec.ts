import { afterAll, beforeAll, describe, it } from 'vitest';
import { Exchange, ord } from '../exchange/exchange-harness.js';
import { realWorld, simColony } from './real-planet.js';

let ex: Exchange;
beforeAll(async () => { ex = await Exchange.boot({}, { realSim: true }); });
afterAll(async () => { await ex?.close(); });

describe('explore', () => {
  it('edge', async () => {
    const w = await realWorld(ex, 2);
    const a = await w.bot({ idx: 0, allowance: { maxOpenOrders: 50 } });
    const b = await w.bot({ idx: 1, fund: { USDC: '100' }, allowance: { maxOpenOrders: 50 } });
    for (let i = 0; i < 22; i++) {
      await a.place(ord('sell', 1, 100_000));
      const r = await b.place(ord('buy', 1, 100_000));
      if (r.body.error) { console.log('BUYERR', i, JSON.stringify(r.body)); break; }
    }
    await ex.settle();
    await new Promise((x) => setTimeout(x, 1000));
    console.log('BUY', JSON.stringify((await simColony(ex, w.planetId, 1)).openRefs.length));
    const r = await b.place(ord('buy', 1, 100_000));
    console.log('NEXT', JSON.stringify(r.body).slice(0, 300), await ex.prisma.marketOrder.count({ where: { planetId: w.planetId, colonyId: b.colonyId, state: { in: ['OPEN', 'PARTIAL'] } } }));
  });
});
