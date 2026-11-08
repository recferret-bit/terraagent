import { expect, test } from './harness';
import type { BotApi } from './w13-bots-api';

/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed JSON replies */
/** `GET /v1/trade/agent/quote`: reason codes while the market has no organic reference, and the order bodies it returns. */
export function registerQuoteSteps(api: BotApi): void {
  test('@hack 9f-22. Agent quote without an organic reference: both sides paused with no_reference, unmeasured cost adds no_unit_cost, inputs echo the colony; a session works too', async () => {
    test.setTimeout(120_000);
    const w = await api.world();
    await api.reset();
    const q = async (query: string, who: any = { key: w.bc.key }): Promise<any> => {
      const r = await api.trade('GET', `/agent/quote?resource=${api.ctx.water}${query}`, who);
      expect(r.status, JSON.stringify(r.json)).toBe(200);
      return r.json;
    };
    const none = await q('&keep=50');
    expect(none.bid).toBeNull();
    expect(none.ask).toBeNull();
    expect(none.basis).toBeNull();
    expect(none.bidReasons).toContain('no_reference');
    expect(none.askReasons, 'own unit cost not given: the ask pauses on it first').toContain('no_unit_cost');
    expect(BigInt(none.inputs.freeUnits)).toBeGreaterThan(0n);
    expect(['number', 'object']).toContain(typeof none.inputs.referenceAgeS); // age of the last organic trade, null when there is none (earlier steps made some)
    const costed = await q('&ownUnitCost=1000&transportPerUnit=0&keep=50');
    test.info().annotations.push({ type: 'observed', description: `quote with cost: ${JSON.stringify({ basis: costed.basis, bid: costed.bid, ask: costed.ask, bidReasons: costed.bidReasons, askReasons: costed.askReasons })}` });
    expect(costed.bidReasons).toContain('no_reference');
    expect(costed.askReasons).not.toContain('no_unit_cost');
    expect((await q(`&planetId=${api.ctx.planetId()}`, { as: 'a' })).bidReasons).toContain('no_reference');
    expect((await api.trade('GET', '/agent/quote?resource=gold.t9', { key: w.bc.key })).status).toBe(400);
    expect((await api.trade('GET', '/agent/quote?resource=bio.water&quote=NEAR', { key: w.bc.key })).status, 'pair exists').toBeLessThan(500);
    // when a scenario with >= 3 colonies gives the board a reference, the returned bodies must POST as they are
    if (costed.bid || costed.ask) {
      for (const side of [costed.bid, costed.ask]) {
        if (!side) continue;
        const r = await api.trade('POST', '/orders', { key: w.bc.key, body: side.order, idem: api.idem('qt') });
        expect([201, 202], JSON.stringify(r.json)).toContain(r.status);
      }
      await api.reset();
    }
  });

  test.fixme('@hack 9f-22b. Agent quote after organic trades: real bid/ask, stale_reference once the last organic trade is old; the returned order POSTs as is (needs the >= 3 colony scenario, see 9f-1b)', () => undefined);
}
