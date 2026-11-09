import { TRADE_API_ROUTES, TRADE_KEY_PREFIX, tradeApiOpenApi, PlaceTradeOrderRequest, CreateTradeKeyRequest } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { checkAllowance, dayStart, outOfBand, type AllowanceUsage } from '../../src/market/trade/allowance.js';
import { defaultAllowance, hashSecret, keyIdOfSecret, newKey, secretMatches } from '../../src/market/trade/trade-keys.js';

const PAIR = 'bio.water/USDC';
const allowance = (over = {}) => ({ ...defaultAllowance([PAIR]), ...over });
const order = (notional: bigint, amount = 100n) => ({ pair: PAIR, amount, notional });
const use = (over: Partial<AllowanceUsage> = {}): AllowanceUsage => ({ outstandingOrders: 0, committedToday: 0n, reference: null, ...over });

describe('checkAllowance: each rail and its stable code', () => {
  it('passes a small order', () => expect(checkAllowance(allowance(), order(1_000_000n), use())).toBeNull());
  it('kill switch wins over everything', () => expect(checkAllowance(allowance({ killSwitch: true, allowedPairs: [] }), order(1n), use())?.code).toBe('kill_switch'));
  it('pair not allowed', () => expect(checkAllowance(allowance({ allowedPairs: ['metals.t1/USDC'] }), order(1n), use())?.code).toBe('pair_not_allowed'));
  it('order notional above the cap, equal passes', () => {
    const a = allowance({ maxOrderNotional: '5000000' });
    expect(checkAllowance(a, order(5_000_001n), use())?.code).toBe('max_order_notional');
    expect(checkAllowance(a, order(5_000_000n), use())).toBeNull();
  });
  it('outstanding orders count against max open orders, including in-flight ones', () => {
    const a = allowance({ maxOpenOrders: 2 });
    expect(checkAllowance(a, order(1n), use({ outstandingOrders: 1 }))).toBeNull();
    expect(checkAllowance(a, order(1n), use({ outstandingOrders: 2 }))?.code).toBe('max_open_orders');
  });
  it('max open orders 0 blocks all orders', () => expect(checkAllowance(allowance({ maxOpenOrders: 0 }), order(1n), use())?.code).toBe('max_open_orders'));
  it('daily budget: committed + this order may reach the budget but not pass it', () => {
    const a = allowance({ dailyBudget: '10000000' });
    expect(checkAllowance(a, order(4_000_000n), use({ committedToday: 6_000_000n }))).toBeNull();
    expect(checkAllowance(a, order(4_000_001n), use({ committedToday: 6_000_000n }))?.code).toBe('daily_budget_exceeded');
  });
  it('price band applies only with a reference', () => {
    const a = allowance({ priceBandBp: 1000 }); // 10 %
    const far = order(2_000_000n, 100n); // 20000 per unit
    expect(checkAllowance(a, far, use())).toBeNull();
    expect(checkAllowance(a, far, use({ reference: { num: 10_000n, den: 1n } }))?.code).toBe('price_out_of_band');
    expect(checkAllowance(a, order(1_050_000n, 100n), use({ reference: { num: 10_000n, den: 1n } }))).toBeNull();
    expect(checkAllowance(allowance({ priceBandBp: null }), far, use({ reference: { num: 10_000n, den: 1n } }))).toBeNull();
  });
  it('rail order: notional is checked before open orders and budget', () => {
    const a = allowance({ maxOrderNotional: '10', maxOpenOrders: 0, dailyBudget: '0' });
    expect(checkAllowance(a, order(11n), use())?.code).toBe('max_order_notional');
  });
});

describe('outOfBand exact arithmetic', () => {
  const ref = { num: 50_000n, den: 3n }; // 16666.67 per unit
  it('is symmetric around the reference and exact at the boundary', () => {
    expect(outOfBand({ pair: PAIR, amount: 3n, notional: 55_000n }, ref, 1000)).toBe(false); // exactly +10 %
    expect(outOfBand({ pair: PAIR, amount: 3n, notional: 55_001n }, ref, 1000)).toBe(true);
    expect(outOfBand({ pair: PAIR, amount: 3n, notional: 45_000n }, ref, 1000)).toBe(false); // exactly -10 %
    expect(outOfBand({ pair: PAIR, amount: 3n, notional: 44_999n }, ref, 1000)).toBe(true);
  });
  it('ignores a degenerate reference', () => {
    expect(outOfBand({ pair: PAIR, amount: 3n, notional: 1n }, { num: 0n, den: 1n }, 1)).toBe(false);
    expect(outOfBand({ pair: PAIR, amount: 3n, notional: 1n }, { num: 1n, den: 0n }, 1)).toBe(false);
  });
});

describe('dayStart', () => {
  it('is UTC midnight', () => expect(dayStart(Date.UTC(2026, 10, 7, 23, 59)).toISOString()).toBe('2026-11-07T00:00:00.000Z'));
});

describe('API key secrets', () => {
  it('has the prefix, embeds its id, and only the hash identifies it', () => {
    const k = newKey();
    expect(k.secret.startsWith(TRADE_KEY_PREFIX)).toBe(true);
    expect(keyIdOfSecret(k.secret)).toBe(k.keyId);
    expect(k.hash).toBe(hashSecret(k.secret));
    expect(k.hash).not.toContain(k.secret);
    expect(secretMatches(k.secret, k.hash)).toBe(true);
  });
  it('rejects wrong, truncated and foreign secrets', () => {
    const k = newKey();
    expect(secretMatches(`${k.secret}x`, k.hash)).toBe(false);
    expect(secretMatches(k.secret, 'zz')).toBe(false);
    expect(keyIdOfSecret('dev:alice')).toBeNull();
    expect(keyIdOfSecret(`${TRADE_KEY_PREFIX}key_short_abc`)).toBeNull();
    expect(newKey().secret).not.toBe(k.secret);
  });
});

describe('trade API contract', () => {
  it('rejects fractional / unknown fields in an order and an empty scope list', () => {
    const ok = { side: 'sell', resource: 'bio.water', amount: 10, price: { token: 'USDC', amount: '1000' }, ttlS: 3600 };
    expect(PlaceTradeOrderRequest.safeParse(ok).success).toBe(true);
    expect(PlaceTradeOrderRequest.safeParse({ ...ok, amount: 1.5 }).success).toBe(false);
    expect(PlaceTradeOrderRequest.safeParse({ ...ok, price: { token: 'USDC', amount: 'abc' } }).success).toBe(false);
    expect(PlaceTradeOrderRequest.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    expect(CreateTradeKeyRequest.safeParse({ planetId: 'p', label: 'x', scopes: [] }).success).toBe(false);
  });
  it('generates an OpenAPI document for every route', () => {
    const doc = tradeApiOpenApi() as { paths: Record<string, Record<string, { operationId: string }>> };
    const ops = Object.values(doc.paths).flatMap((m) => Object.values(m).map((o) => o.operationId)).sort();
    expect(ops).toEqual(Object.keys(TRADE_API_ROUTES).sort());
    expect(doc.paths['/v1/trade/book/{planetId}/{pair}']).toBeDefined();
  });
});
