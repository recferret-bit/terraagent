import { expect, test } from './harness';
import type { Bot, BotApi } from './w13-bots-api';

/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed JSON replies */
/** Allowance rails, kill switch, revoke, fill policy and idempotency on the real sim (every order really rests on the book). */
function railKit(api: BotApi) {
  const fund = (): Record<string, string> => ({ USDC: '50', [api.ctx.water]: '100' });
  /** A resting ask far above any bid (no crossing). */
  const ask = (amount: number, usdc: string, extra: Record<string, unknown> = {}): Record<string, unknown> => api.order('sell', amount, usdc, extra);
  const code = (r: { json: any }): string | undefined => r.json.error?.code;
  const fresh = (name: string, allowance: Record<string, unknown>, colonyIndex = 0): Promise<Bot> => api.bot(`${name}${Date.now().toString(36).slice(-5)}`, colonyIndex, { fund: fund(), allowance });

  return { fund, ask, code, fresh };
}

/** Allowance rails. */
export function registerRailSteps(api: BotApi): void {
  const { ask, code, fresh } = railKit(api);

  test('@hack 9f-5. max_open_orders: the third resting order is refused with a stable code; cancelling one frees a slot', async () => {
    test.setTimeout(120_000);
    await api.reset();
    const bot = await fresh('rmo', { maxOpenOrders: 2 });
    const o1 = await api.place(bot, ask(5, '40'));
    const o2 = await api.place(bot, ask(5, '41'));
    expect([o1.status, o2.status], JSON.stringify([o1.json, o2.json])).toEqual([201, 201]);
    const o3 = await api.place(bot, ask(5, '42'));
    expect([o3.status, o3.json.status, code(o3)]).toEqual([422, 'rejected', 'max_open_orders']);
    expect((await api.trade('DELETE', `/orders/${o1.json.order.orderId}`, { key: bot.key })).status).toBe(200);
    await expect.poll(async () => (await api.openOf(bot)).length).toBe(1);
    expect((await api.place(bot, ask(5, '43'))).status).toBe(201);
    await api.reset();
  });

  test('@hack 9f-6. daily_budget_exceeded counts open and pending orders in full; a cancelled order frees its share; two parallel orders cannot both fit', async () => {
    test.setTimeout(120_000);
    await api.reset();
    const bot = await fresh('rdb', { dailyBudget: api.usdc('5'), maxOrderNotional: api.usdc('10') });
    const first = await api.place(bot, ask(5, '3'));
    expect(first.status, JSON.stringify(first.json)).toBe(201);
    expect(code(await api.place(bot, ask(5, '3')))).toBe('daily_budget_exceeded');
    await api.trade('DELETE', `/orders/${first.json.order.orderId}`, { key: bot.key });
    await expect.poll(async () => (await api.openOf(bot)).length).toBe(0);
    expect((await api.place(bot, ask(5, '3'))).status, 'a cancelled, unfilled order commits nothing').toBe(201);
    await api.reset();
    const racer = await fresh('rdr', { dailyBudget: api.usdc('5'), maxOrderNotional: api.usdc('10') });
    const both = await Promise.all([api.place(racer, ask(5, '3'), 'r1'), api.place(racer, ask(5, '3'), 'r2')]);
    expect(both.map((r) => r.status === 201 || r.status === 202).sort(), JSON.stringify(both.map((r) => r.json))).toEqual([false, true]);
    expect(both.map(code).filter(Boolean)).toEqual(['daily_budget_exceeded']);
    await api.reset();
  });

  test('@hack 9f-7. price_out_of_band is skipped while no organic reference exists; pair_not_allowed and max_order_notional hold', async () => {
    test.setTimeout(120_000);
    await api.reset();
    const banded = await fresh('rpb', { priceBandBp: 100 });
    const wild = await api.place(banded, ask(5, '90'));
    expect(wild.status, `no reference yet, so the 1% band cannot apply: ${JSON.stringify(wild.json)}`).toBe(201);
    const pairs = await fresh('rpa', { allowedPairs: ['bio.biomass/USDC'] });
    expect(code(await api.place(pairs, ask(5, '1')))).toBe('pair_not_allowed');
    const notional = await fresh('rmn', { maxOrderNotional: api.usdc('2') });
    expect(code(await api.place(notional, ask(5, '3')))).toBe('max_order_notional');
    expect((await api.place(notional, ask(5, '2'))).status, 'at the cap passes').toBe(201);
    await api.reset();
  });

  test.fixme('@hack 9f-7b. price_out_of_band fires once an organic reference exists (needs the >= 3 colony scenario, see 9f-1b)', () => undefined);

}

/** Kill switch, revoke, fill policy, idempotency. */
export function registerKeyRailSteps(api: BotApi): void {
  const { fund, ask, code, fresh } = railKit(api);

  test('@hack 9f-8. kill_switch (the key\'s own manage scope) cancels its resting orders and refuses new ones; a trade-only key cannot flip it; a stranger gets 404', async () => {
    test.setTimeout(120_000);
    await api.reset();
    const bot = await fresh('rks', {});
    const tradeOnly = await api.bot(`rkt${Date.now().toString(36).slice(-5)}`, 0, { fund: fund(), scopes: ['read', 'trade'] });
    for (const p of ['44', '45']) expect((await api.place(bot, ask(5, p))).status).toBe(201);
    const denied = await api.trade('PATCH', `/keys/${tradeOnly.keyId}/allowance`, { key: tradeOnly.key, body: { killSwitch: true } });
    expect([denied.status, code(denied)]).toEqual([403, 'forbidden_scope']);
    expect((await api.trade('PATCH', `/keys/${bot.keyId}/allowance`, { as: 'a', body: { killSwitch: true } })).status, 'not the owner').toBe(404);
    const loosen = await api.trade('PATCH', `/keys/${bot.keyId}/allowance`, { key: bot.key, body: { maxOpenOrders: 500 } });
    expect([loosen.status, code(loosen)], 'a key may never loosen its own rails').toEqual([403, 'forbidden_scope']);
    const ks = await api.trade('PATCH', `/keys/${bot.keyId}/allowance`, { key: bot.key, body: { killSwitch: true } });
    expect(ks.status, JSON.stringify(ks.json)).toBe(200);
    await expect.poll(async () => (await api.openOf(bot)).filter((o) => o.actorKind === 'bot').length, { timeout: 20_000, message: 'resting orders cancelled by the kill switch' }).toBe(0);
    const after = await api.place(bot, ask(5, '46'));
    expect([after.status, code(after)]).toEqual([422, 'kill_switch']);
    await api.reset();
  });

  test('@hack 9f-9. Revoking a key cancels its resting orders and kills the key; only the owner can revoke', async () => {
    test.setTimeout(120_000);
    await api.reset();
    const created = await api.trade('POST', '/keys', { as: 'a', body: { planetId: api.ctx.planetId(), label: 'revoke me', scopes: ['read', 'trade'] } });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    const key: string = created.json.secret;
    for (const p of ['47', '48']) expect((await api.trade('POST', '/orders', { key, body: ask(5, p), idem: api.idem('rv') })).status).toBe(201);
    expect((await api.openOf('a')).length).toBe(2);
    expect((await api.trade('DELETE', `/keys/${created.json.keyId}`, { as: 'b' })).status, 'B does not own it').toBe(404);
    const rv = await api.trade('DELETE', `/keys/${created.json.keyId}`, { as: 'a' });
    expect([rv.status, rv.json.revoked]).toEqual([200, true]);
    await expect.poll(async () => (await api.openOf('a')).length, { timeout: 20_000, message: 'resting orders cancelled by the revoke' }).toBe(0);
    const dead = await api.trade('POST', '/orders', { key, body: ask(5, '49'), idem: api.idem('rv') });
    expect([dead.status, code(dead)]).toEqual([401, 'key_revoked']);
    await api.reset();
  });

  test('@hack 9f-10. Fill policy belongs to the account: a custodial colony asking all_or_nothing is refused (details.allowed), partial is fine', async () => {
    test.setTimeout(120_000);
    await api.reset();
    const w = await api.world();
    const aon = await api.place(w.ba, ask(5, '50', { fillPolicy: 'all_or_nothing' }));
    expect([aon.status, code(aon)]).toEqual([422, 'fill_policy_not_allowed']);
    expect(aon.json.error.details).toMatchObject({ allowed: 'partial' });
    const human = await api.place('a', ask(5, '50', { fillPolicy: 'all_or_nothing' }));
    expect(code(human)).toBe('fill_policy_not_allowed');
    const ok = await api.place(w.ba, ask(5, '50', { fillPolicy: 'partial' }));
    expect(ok.status, JSON.stringify(ok.json)).toBe(201);
    expect(ok.json.order.fillPolicy).toBe('partial');
    await api.reset();
  });

  test('@hack 9f-11. Idempotent retry in parallel: one request id, one order, one reservation', async () => {
    test.setTimeout(120_000);
    await api.reset();
    const bot = await fresh('rid', {});
    const water0 = await api.tok(bot, api.ctx.water);
    const idem = api.idem('par');
    const body = ask(7, '60');
    const replies = await Promise.all(Array.from({ length: 6 }, () => api.trade('POST', '/orders', { key: bot.key, body, idem })));
    for (const r of replies) expect([201, 202], JSON.stringify(r.json)).toContain(r.status);
    expect(new Set(replies.map((r) => r.json.requestId)).size).toBe(1);
    await expect.poll(async () => (await api.openOf(bot)).length, { timeout: 20_000 }).toBe(1);
    const water1 = await api.tok(bot, api.ctx.water);
    expect(water1.reserved - water0.reserved, 'reserved once, not six times').toBe(7n);
    const reuse = await api.trade('POST', '/orders', { key: bot.key, body: ask(8, '60'), idem });
    expect(code(reuse)).toBe('idempotency_key_reuse');
    await api.reset();
  });
}
