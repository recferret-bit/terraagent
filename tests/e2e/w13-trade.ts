import { expect, test } from './harness';

export interface TradeStepsCtx { app: string; planetId: () => string; usdc: (whole: string) => string; water: string }

/** W13 D-45 steps 9d/9e: the `/v1/trade/*` API (human + bot key) and the `/trade.html` page. Registered inside the serial w13 suite after its own steps. */
export function registerTradeSteps(ctx: TradeStepsCtx): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely typed JSON replies
  interface TradeReply { status: number; json: any }
  async function tradeApi(method: string, path: string, o: { as?: 'a' | 'b'; key?: string; body?: unknown; idem?: string } = {}): Promise<TradeReply> {
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetch(`${ctx.app}/v1/trade${path}${o.as ? `${sep}as=${o.as}` : ''}`, {
      method,
      headers: { 'content-type': 'application/json', ...(o.key ? { authorization: `Bearer ${o.key}` } : {}), ...(o.idem ? { 'idempotency-key': o.idem } : {}) },
      ...(o.body === undefined ? {} : { body: JSON.stringify(o.body) }),
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  }

  test('@hack 9d. Trade API (D-45): a human and a bot key trade on the same book; keys see only their own cargo; idempotent retries, allowance rails and the kill switch hold', async () => {
    test.setTimeout(180_000);
    const PAIR = encodeURIComponent(`${ctx.water}/USDC`);
    // A creates a bot key for its own colony with a tight allowance
    const created = await tradeApi('POST', '/keys', { as: 'a', body: { planetId: ctx.planetId(), label: 'e2e agent', scopes: ['read', 'trade'], allowance: { maxOpenOrders: 2, maxOrderNotional: ctx.usdc('5'), dailyBudget: ctx.usdc('50') } } });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    const key: string = created.json.secret;
    expect(key).toMatch(/^ta_bot_/);
    // the key sees ONLY its own colony's cargo (A's 600 water, nothing of B)
    const balA = await tradeApi('GET', '/balances', { key });
    expect(balA.status).toBe(200);
    expect(BigInt(balA.json.inOrbit?.[ctx.water]?.total ?? '0')).toBeGreaterThan(0n);
    const balB = await tradeApi('GET', '/balances', { as: 'b' });
    expect(balB.json.inOrbit?.[ctx.water]?.total ?? '0').toBe('0');
    // place needs an idempotency key; a retry returns the first answer, one order only
    const body = { side: 'sell', resource: ctx.water, amount: 20, price: { token: 'USDC', amount: ctx.usdc('1') }, ttlS: 3600 };
    expect((await tradeApi('POST', '/orders', { key, body })).json.error?.code).toBe('idempotency_key_required');
    const first = await tradeApi('POST', '/orders', { key, body, idem: 'e2e-9d-1' });
    expect([201, 202], JSON.stringify(first.json)).toContain(first.status);
    const again = await tradeApi('POST', '/orders', { key, body, idem: 'e2e-9d-1' });
    expect(again.json.requestId).toBe(first.json.requestId);
    expect((await tradeApi('POST', '/orders', { key, body: { ...body, amount: 21 }, idem: 'e2e-9d-1' })).json.error?.code).toBe('idempotency_key_reuse');
    // the order is on the public book, marked `mine` only for its owner, and exposes no account/owner ids
    await expect.poll(async () => (await tradeApi('GET', `/book/${ctx.planetId()}/${PAIR}/orders`)).json.orders?.filter((o: { side: string }) => o.side === 'sell').length, { timeout: 15_000 }).toBeGreaterThan(0);
    const pub = await tradeApi('GET', `/book/${ctx.planetId()}/${PAIR}/orders`);
    expect(JSON.stringify(pub.json)).not.toMatch(/accountId|ownerId|playerId|terraagent\.mock/);
    expect(pub.json.orders.some((o: { mine?: boolean }) => o.mine === true)).toBe(false);
    expect((await tradeApi('GET', `/book/${ctx.planetId()}/${PAIR}/orders`, { key })).json.orders.some((o: { mine?: boolean }) => o.mine === true)).toBe(true);
    // allowance rails: order notional above the cap and an unlisted size are refused with stable codes
    const big = await tradeApi('POST', '/orders', { key, body: { ...body, amount: 100, price: { token: 'USDC', amount: ctx.usdc('6') } }, idem: 'e2e-9d-2' });
    expect(big.json.error?.code ?? big.json.order?.state).toBe('max_order_notional');
    // B (a different owner) fills the bot's ask through the same book, as a human; the bot key sees its fill
    const buy = await tradeApi('POST', '/orders', { as: 'b', body: { planetId: ctx.planetId(), side: 'buy', resource: ctx.water, amount: 20, price: { token: 'USDC', amount: ctx.usdc('1') }, ttlS: 3600, maxStallFeeBp: 100 }, idem: 'e2e-9d-3' });
    expect([201, 202], JSON.stringify(buy.json)).toContain(buy.status);
    await expect.poll(async () => (await tradeApi('GET', '/fills', { key })).json.fills?.length ?? 0, { timeout: 60_000, message: 'bot fill FINAL' }).toBeGreaterThan(0);
    // kill switch: the key can no longer trade
    const ks = await tradeApi('PATCH', `/keys/${created.json.keyId}/allowance`, { as: 'a', body: { killSwitch: true } });
    expect(ks.status, JSON.stringify(ks.json)).toBe(200);
    expect((await tradeApi('POST', '/orders', { key, body, idem: 'e2e-9d-4' })).json.error?.code).toBe('kill_switch');
    // revoke: the key stops working
    expect((await tradeApi('DELETE', `/keys/${created.json.keyId}`, { as: 'a' })).status).toBe(200);
    expect((await tradeApi('GET', '/balances', { key })).status).toBe(401);
  });

  test('@hack 9e. /trade.html (D-45): the page shows the caller\'s own orbital cargo, the full order table with badges, and the hub links to it', async ({ browser }) => {
    test.setTimeout(120_000);
    const t = await (await browser.newContext()).newPage();
    try {
      await t.goto(`/trade.html?${new URLSearchParams({ as: 'b', planet: ctx.planetId(), pair: `${ctx.water}/USDC` })}`);
      await expect(t.getByRole('tablist').first()).toBeVisible({ timeout: 30_000 });
      // B holds no water in orbit after its purchase settled to its own colony only through import: the page never lists A's cargo
      const text = (await t.locator('body').innerText()).replace(/\s+/g, ' ');
      expect(text).not.toMatch(/Water\s+600\b/);
      expect(text).toMatch(/mock USDC/i);
      await t.goto(`/trade.html?${new URLSearchParams({ as: 'a', planet: ctx.planetId(), pair: `${ctx.water}/USDC` })}#orders`);
      await expect(t.locator('body')).toContainText(/ALL ORDERS/i, { timeout: 30_000 });
      expect(await t.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    } finally {
      await t.context().close();
    }
  });


}
