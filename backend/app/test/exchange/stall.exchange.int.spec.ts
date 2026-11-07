import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Exchange, sleep } from './exchange-harness.js';

let ex: Exchange;
beforeAll(async () => { ex = await Exchange.boot(); });
afterAll(async () => { await ex?.close(); });

const stallCmds = () => ex.simCmds.filter((c) => c.kind === 'market.setHubFee');

describe('PUT/GET /v1/trade/stall', () => {
  it('a player sets the own stall fee through the sim command; GET shows it with range and earned', async () => {
    const w = ex.world();
    const alice = await w.player({ name: `st${Date.now()}a` });
    const before = await ex.api('GET', `/trade/stall?planetId=${w.planetId}`, { as: alice.name });
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({ planetId: w.planetId, hubFeeBp: 100, minBp: 0, maxBp: 100, defaultBp: 100, earned: {} });
    const put = await ex.api('PUT', '/trade/stall', { as: alice.name, body: { bp: 40, planetId: w.planetId } });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ planetId: w.planetId, hubFeeBp: 40, maxBp: 100 });
    expect(stallCmds().at(-1)).toMatchObject({ source: 'player', colonyIndex: alice.idx, args: { bp: 40 } });
    let got = 0;
    for (let i = 0; i < 50 && got !== 40; i++) {
      got = (await ex.api('GET', `/trade/stall?planetId=${w.planetId}`, { as: alice.name })).body.hubFeeBp;
      if (got !== 40) await sleep(40);
    }
    expect(got).toBe(40);
  });

  it('out of range is 422 fee_out_of_range and never reaches the sim', async () => {
    const w = ex.world();
    const a = await w.player({ name: `st${Date.now()}b` });
    const n = stallCmds().length;
    const r = await ex.api('PUT', '/trade/stall', { as: a.name, body: { bp: 101, planetId: w.planetId } });
    expect(r.status).toBe(422);
    expect(r.body.error).toMatchObject({ code: 'fee_out_of_range', details: { minBp: 0, maxBp: 100 } });
    expect((await ex.api('PUT', '/trade/stall', { as: a.name, body: { bp: -1, planetId: w.planetId } })).status).toBe(400);
    expect(stallCmds().length).toBe(n);
  });

  it('only the own colony: another owner changes only their own stall, an API key is refused', async () => {
    const w = ex.world();
    const [a, b] = [await w.player({ name: `st${Date.now()}c` }), await w.player({ name: `st${Date.now()}d` })];
    await ex.api('PUT', '/trade/stall', { as: a.name, body: { bp: 10, planetId: w.planetId } });
    const putB = await ex.api('PUT', '/trade/stall', { as: b.name, body: { bp: 90, planetId: w.planetId } });
    expect(putB.body.hubFeeBp).toBe(90);
    expect(stallCmds().slice(-2).map((c) => [c.colonyIndex, (c.args as { bp: number }).bp])).toEqual([[a.idx, 10], [b.idx, 90]]);
    await sleep(200);
    expect((await ex.api('GET', `/trade/stall?planetId=${w.planetId}`, { as: a.name })).body.hubFeeBp).toBe(10);
    const bot = await w.bot();
    const key = await ex.api('PUT', '/trade/stall', { auth: bot.secret, body: { bp: 5 } });
    expect(key.status).toBe(403);
    expect(key.body.error.code).toBe('forbidden_scope');
    expect((await ex.api('PUT', '/trade/stall', { body: { bp: 5, planetId: w.planetId } })).status).toBe(401);
  });
});
