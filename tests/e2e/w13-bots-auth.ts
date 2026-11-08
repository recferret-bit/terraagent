import { expect, test } from './harness';
import { openSse, type BotApi } from './w13-bots-api';

/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed JSON replies */
/** Authentication, scopes, malformed input, rate limiting and the session-only stall endpoint, over real HTTP. */
const code = (r: { json: any }): string | undefined => r.json.error?.code;
const pace = (): Promise<void> => new Promise((r) => setTimeout(r, 110)); // stay under the key's own 10/s so the validators, not the limiter, answer
const nonce = (): string => Date.now().toString(36).slice(-5);


/** Keys and scopes. */
export function registerAuthSteps(api: BotApi): void {
  test('@hack 9f-12. Forged, truncated and revoked keys are refused with stable codes; a key of another planet cannot be pointed elsewhere', async () => {
    test.setTimeout(120_000);
    const w = await api.world();
    const secret = w.ba.key;
    const forged = `${secret.slice(0, -4)}AAAA`;
    for (const [key, want] of [[forged, 'unauthorized'], ['ta_bot_key_0000000000000000_aaaaaaaaaaaaaaaaaaaaaaaa', 'unauthorized'], ['ta_bot_garbage', 'unauthorized'], ['not-a-key', 'unauthorized']] as const) {
      const r = await api.trade('GET', '/balances', { key });
      expect([r.status, code(r)], key).toEqual([401, want]);
    }
    expect((await api.trade('GET', '/balances')).status, 'no credentials').toBe(401);
    expect((await api.trade('POST', '/orders', { body: api.order('sell', 1, '1'), idem: api.idem('nk') })).status).toBe(401);
    const other = await api.trade('POST', '/orders', { key: secret, body: { ...api.order('sell', 1, '1'), planetId: 'pl_someone_else' }, idem: api.idem('wp') });
    expect([other.status, code(other)]).toEqual([409, 'wrong_planet']);
    expect(code(await api.trade('GET', `/balances?planetId=pl_someone_else`, { key: secret }))).toBe('wrong_planet');
    const doomed = await api.bot(`rev${nonce()}`, 0);
    expect((await api.trade('GET', '/balances', { key: doomed.key })).status).toBe(200);
    // dev bots belong to `bot:<name>`, no session can revoke them: use a human key for the revoked-key probe
    const human = await api.trade('POST', '/keys', { as: 'b', body: { planetId: api.ctx.planetId(), label: 'to revoke', scopes: ['read'] } });
    expect(human.status).toBe(201);
    expect((await api.trade('DELETE', `/keys/${human.json.keyId}`, { as: 'b' })).status).toBe(200);
    for (const probe of [() => api.trade('GET', '/balances', { key: human.json.secret }), () => api.trade('GET', '/orders', { key: human.json.secret }), () => openSse(api, { key: human.json.secret })]) {
      const r = (await probe()) as any;
      if ('events' in r) { expect(r.status).toBe(401); r.close(); } else expect([r.status, code(r)]).toEqual([401, 'key_revoked']);
    }
  });

  test('@hack 9f-13. Scopes: a read-only key cannot place or cancel; a trade-only key cannot read; read works and streams', async () => {
    test.setTimeout(120_000);
    await api.reset();
    const readOnly = await api.bot(`ro${nonce()}`, 0, { scopes: ['read'] });
    const tradeOnly = await api.bot(`to${nonce()}`, 0, { scopes: ['trade'], fund: { [api.ctx.water]: '50' } });
    for (const r of [await api.trade('POST', '/orders', { key: readOnly.key, body: api.order('sell', 1, '1'), idem: api.idem('ro') }), await api.trade('DELETE', '/orders/mo_nothing', { key: readOnly.key })]) {
      expect([r.status, code(r)]).toEqual([403, 'forbidden_scope']);
    }
    for (const path of ['/balances', '/orders', '/fills', '/agent/quote?resource=bio.water']) expect((await api.trade('GET', path, { key: readOnly.key })).status, path).toBe(200);
    const sse = await openSse(api, { key: readOnly.key });
    expect(sse.status).toBe(200);
    await sse.waitFor((e) => e.type === 'hello', 10_000);
    sse.close();
    for (const path of ['/balances', '/orders', '/fills']) expect([(await api.trade('GET', path, { key: tradeOnly.key })).status, path]).toEqual([403, path]);
    expect((await openSse(api, { key: tradeOnly.key })).status).toBe(403);
    const placed = await api.trade('POST', '/orders', { key: tradeOnly.key, body: api.order('sell', 1, '5'), idem: api.idem('to') });
    expect([201, 202], JSON.stringify(placed.json)).toContain(placed.status);
    await api.reset();
  });

}

/** Malformed input. */
export function registerInputSteps(api: BotApi): void {
  test('@hack 9f-14. Malformed input never produces a 5xx: every bad body answers 4xx with {error:{code,message}}', async () => {
    test.setTimeout(180_000);
    const w = await api.world();
    const good = api.order('sell', 5, '1');
    const bodies: Array<[string, { raw?: string; body?: unknown }]> = [
      ['broken json', { raw: '{"side":' }], ['array', { body: [1, 2] }], ['null', { raw: 'null' }], ['string', { raw: '"sell"' }], ['empty', { raw: '' }],
      ['unknown field', { body: { ...good, admin: true } }], ['side', { body: { ...good, side: 'hold' } }], ['resource', { body: { ...good, resource: 'gold.t9' } }],
      ['amount 0', { body: { ...good, amount: 0 } }], ['amount negative', { body: { ...good, amount: -3 } }], ['amount fraction', { body: { ...good, amount: 1.5 } }],
      ['amount string', { body: { ...good, amount: '5' } }], ['amount huge', { body: { ...good, amount: 1e21 } }], ['amount NaN-ish', { raw: '{"side":"sell","resource":"bio.water","amount":1e999,"price":{"token":"USDC","amount":"1"},"ttlS":60}' }],
      ['price negative', { body: { ...good, price: { token: 'USDC', amount: '-5' } } }], ['price text', { body: { ...good, price: { token: 'USDC', amount: 'abc' } } }], ['price number', { body: { ...good, price: { token: 'USDC', amount: 5 } } }],
      ['price giant', { body: { ...good, price: { token: 'USDC', amount: '9'.repeat(400) } } }], ['price token', { body: { ...good, price: { token: 'DOGE', amount: '5' } } }], ['price missing', { body: { ...good, price: undefined } }],
      ['ttl 0', { body: { ...good, ttlS: 0 } }], ['ttl huge', { body: { ...good, ttlS: 99_999_999 } }], ['stall fee', { body: { ...good, maxStallFeeBp: 99_999 } }],
      ['fillPolicy', { body: { ...good, fillPolicy: 'sometimes' } }], ['planetId type', { body: { ...good, planetId: 42 } }], ['prototype pollution', { raw: '{"__proto__":{"x":1},"side":"sell"}' }],
      ['dust notional', { body: { ...good, price: { token: 'USDC', amount: '1' } } }], ['self pair', { body: { ...good, resource: 'bio.water', price: { token: 'bio.water', amount: '5' } } }],
    ];
    const seen: string[] = [];
    for (const [name, b] of bodies) {
      const r = await api.trade('POST', '/orders', { key: w.bc.key, idem: api.idem('mf'), ...b });
      seen.push(`${name}=${r.status}:${code(r) ?? r.json.status}`);
      expect(r.status, `${name}: ${JSON.stringify(r.json)}`).toBeLessThan(500);
      if (r.status >= 400) expect(typeof code(r), `${name}: error shape ${JSON.stringify(r.json)}`).toBe('string');
      await pace();
    }
    for (const idem of ['bad key!', 'x'.repeat(200), 'a b']) {
      const r = await api.trade('POST', '/orders', { key: w.bc.key, body: good, headers: { 'idempotency-key': idem } });
      expect([r.status, typeof code(r)], `idempotency-key ${idem.slice(0, 12)}`).toEqual([400, 'string']);
      await pace();
    }
    const reads: Array<[string, string]> = [['GET', '/orders?limit=abc'], ['GET', '/orders?limit=999999'], ['GET', '/orders?state=weird'], ['GET', '/fills?limit=-4'], ['GET', '/book/nope/not-a-pair'], ['GET', '/book/pl_x/bio.water%2FUSDC/orders?limit=zzz'], ['DELETE', '/orders/%E2%82%AC-not-an-id'], ['DELETE', `/keys/key_nope`], ['PATCH', `/keys/${w.bc.keyId}/allowance`], ['GET', '/agent/quote'], ['GET', '/agent/quote?resource=bio.water&ownUnitCost=-5'], ['GET', '/agent/quote?resource=bio.water&planned=1e9'], ['PUT', '/stall']];
    for (const [m, path] of reads) {
      const r = await api.trade(m, path, { key: w.bc.key, ...(m === 'PATCH' ? { body: { maxOpenOrders: 'many' } } : {}) });
      seen.push(`${m} ${path}=${r.status}`);
      expect(r.status, `${m} ${path}: ${JSON.stringify(r.json)}`).toBeLessThan(500);
      await pace();
    }
    test.info().annotations.push({ type: 'observed', description: seen.join(' | ') });
    expect((await api.trade('GET', '/balances', { key: w.bc.key })).status, 'the server is still alive').toBe(200);
  });

  // fixed (U): ids are validated, a NUL byte answers 400 invalid_request and no DB text leaks
  test('@hack 9f-14b. A NUL byte in an order id answers 4xx, not 500, and leaks no internal text', async () => {
    const w = await api.world();
    const r = await api.trade('DELETE', '/orders/%00%00', { key: w.bc.key });
    expect(r.status, JSON.stringify(r.json)).toBe(400);
    expect(JSON.stringify(r.json)).not.toMatch(/prisma|postgres|22021/i);
  });

}

/** Rate limits and the stall endpoint. */
export function registerLimitSteps(api: BotApi): void {
  test('@hack 9f-15. Rate limiter: a burst beyond the bucket answers 429 rate_limited and the key recovers', async () => {
    test.setTimeout(120_000);
    const bot = await api.bot(`rl${nonce()}`, 0);
    const burst = await Promise.all(Array.from({ length: 80 }, () => api.trade('GET', '/balances', { key: bot.key })));
    const limited = burst.filter((r) => r.status === 429);
    expect(limited.length, `statuses ${burst.map((r) => r.status).join(',')}`).toBeGreaterThan(0);
    expect(burst.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(10);
    expect(code(limited[0]!)).toBe('rate_limited');
    expect(limited[0]!.json.error.details).toMatchObject({ perSecond: 10, burst: 20 });
    await expect.poll(async () => (await api.trade('GET', '/balances', { key: bot.key })).status, { timeout: 10_000 }).toBe(200);
    // other keys have their own bucket
    expect((await api.trade('GET', '/balances', { key: (await api.world()).ba.key })).status).toBe(200);
  });

  // fixed (U): every 429/503 of /v1/trade/* carries Retry-After
  test('@hack 9f-15b. Rate limiter 429 carries a Retry-After header', async () => {
    test.setTimeout(120_000);
    const bot = await api.bot(`rr${nonce()}`, 0);
    const burst = await Promise.all(Array.from({ length: 80 }, () => api.trade('GET', '/balances', { key: bot.key })));
    const limited = burst.find((r) => r.status === 429);
    expect(limited, 'a 429 happened').toBeTruthy();
    expect(Number(limited!.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  test('@hack 9f-16. Stall endpoint: session only (keys get 403), range checked, restored afterwards', async () => {
    test.setTimeout(120_000);
    const w = await api.world();
    const planetId = api.ctx.planetId();
    for (const r of [await api.trade('GET', `/stall?planetId=${planetId}`, { key: w.bb.key }), await api.trade('PUT', '/stall', { key: w.bb.key, body: { bp: 10 } })]) {
      expect([r.status, code(r)]).toEqual([403, 'forbidden_scope']);
      expect(r.json.error.details).toMatchObject({ reason: 'session_only' });
    }
    expect((await api.trade('GET', `/stall?planetId=${planetId}`)).status, 'anonymous').toBe(401);
    const before = await api.trade('GET', `/stall?planetId=${planetId}`, { as: 'b' });
    expect(before.status, JSON.stringify(before.json)).toBe(200);
    try {
      const set = await api.trade('PUT', '/stall', { as: 'b', body: { bp: 40, planetId } });
      expect([set.status, set.json.hubFeeBp], JSON.stringify(set.json)).toEqual([200, 40]);
      await expect.poll(async () => (await api.trade('GET', `/stall?planetId=${planetId}`, { as: 'b' })).json.hubFeeBp, { timeout: 15_000 }).toBe(40);
      const over = await api.trade('PUT', '/stall', { as: 'b', body: { bp: before.json.maxBp + 1, planetId } });
      expect([over.status, code(over)]).toEqual([422, 'fee_out_of_range']);
      expect(code(await api.trade('PUT', '/stall', { as: 'b', body: { bp: 10_001, planetId } }))).toBe('invalid_request');
      expect(code(await api.trade('PUT', '/stall', { as: 'b', body: { bp: -1, planetId } }))).toBe('invalid_request');
    } finally {
      await api.trade('PUT', '/stall', { as: 'b', body: { bp: before.json.hubFeeBp, planetId } });
    }
    await expect.poll(async () => (await api.trade('GET', `/stall?planetId=${planetId}`, { as: 'b' })).json.hubFeeBp, { timeout: 15_000 }).toBe(before.json.hubFeeBp);
  });
}
