import { describe, expect, it } from 'vitest';
import { AutoTradeLimitSchema, type AutoTradeLimit, type AutoTradeOrder } from '@terra/contracts';
import { withinAutoTrade } from '../../src/systems/away/auto-trade';

const limit: AutoTradeLimit = { maxPerTrade: 100, maxPerSession: 150, minStock: 40, partners: 'anyone' };

function order(over: Partial<AutoTradeOrder> = {}): AutoTradeOrder {
  return { resource: 'metals.t1', give: 50, stock: 200, sessionSpent: 0, partner: 'guild', ...over };
}

describe('W09-13 withinAutoTrade', () => {
  it('accepts a give under the per-trade max', () => {
    expect(withinAutoTrade(limit, order())).toBe(true);
  });

  it('rejects a give of 200 when the per-trade max is 100', () => {
    expect(withinAutoTrade(limit, order({ give: 200 }))).toBe(false);
  });

  it('rejects a give that would drop stock below the floor', () => {
    expect(withinAutoTrade(limit, order({ give: 20, stock: 50 }))).toBe(false);
  });

  it('accepts the exact cap and the exact floor, and rejects one unit past each', () => {
    expect(withinAutoTrade(limit, order({ give: 100, stock: 140 }))).toBe(true);
    expect(withinAutoTrade(limit, order({ give: 101 }))).toBe(false);
    expect(withinAutoTrade(limit, order({ give: 10, stock: 50 }))).toBe(true);
    expect(withinAutoTrade(limit, order({ give: 11, stock: 50 }))).toBe(false);
  });

  it('rejects a session that would pass the session cap, including the exact boundary', () => {
    expect(withinAutoTrade(limit, order({ give: 50, sessionSpent: 100 }))).toBe(true);
    expect(withinAutoTrade(limit, order({ give: 51, sessionSpent: 100 }))).toBe(false);
  });

  it('rejects a partner the limit does not allow, and a negative max in the schema', () => {
    expect(withinAutoTrade({ ...limit, partners: 'guild' }, order({ partner: 'anyone' }))).toBe(false);
    expect(withinAutoTrade({ ...limit, partners: 'truce' }, order({ partner: 'truce' }))).toBe(true);
    expect(withinAutoTrade({ ...limit, partners: 'guild' }, order({ partner: 'guild' }))).toBe(true);
    expect(AutoTradeLimitSchema.safeParse({ ...limit, maxPerTrade: -1 }).success).toBe(false);
    expect(AutoTradeLimitSchema.safeParse(limit).success).toBe(true);
  });
});

const demo: AutoTradeLimit = {
  maxPerTrade: 300, maxPerSession: 600, minStock: 200, partners: 'guild', sellAboveStoragePct: 80,
};

describe('W15-19 withinAutoTrade', () => {
  it('accepts a 300 give at the per-trade max that leaves minStock', () => {
    expect(withinAutoTrade(demo, order({ give: 300, stock: 500, storagePct: 90 }))).toBe(true);
  });

  it('rejects 301, a partner outside guild, and truce when the feature is off', () => {
    expect(withinAutoTrade(demo, order({ give: 301, stock: 800, storagePct: 90 }))).toBe(false);
    expect(withinAutoTrade(demo, order({ give: 300, stock: 500, storagePct: 90, partner: 'anyone' }))).toBe(false);
    expect(withinAutoTrade(
      { ...demo, partners: 'truce' },
      order({ give: 100, stock: 500, storagePct: 90, partner: 'truce' }),
      { truceEnabled: false },
    )).toBe(false);
    expect(withinAutoTrade(demo, order({ partner: 'nope' as AutoTradeOrder['partner'] }))).toBe(false);
  });

  it('corners: zero give, the exact session cap, and storage at 80 versus just below', () => {
    expect(withinAutoTrade(demo, order({ give: 0, stock: 500, storagePct: 90 }))).toBe(true);
    expect(withinAutoTrade(demo, order({ give: 300, stock: 800, sessionSpent: 300, storagePct: 90 }))).toBe(true);
    expect(withinAutoTrade(demo, order({ give: 300, stock: 800, sessionSpent: 301, storagePct: 90 }))).toBe(false);
    expect(withinAutoTrade(demo, order({ give: 100, stock: 800, storagePct: 80 }))).toBe(true);
    expect(withinAutoTrade(demo, order({ give: 100, stock: 799, storageCap: 1000 }))).toBe(false);
    expect(withinAutoTrade(demo, order({ give: 100, stock: 800, storagePct: 79.9 }))).toBe(false);
  });

  it('ignores the new fields when they are absent, and applies an inclusive buy floor when set', () => {
    expect(withinAutoTrade(limit, order())).toBe(true);
    expect(AutoTradeLimitSchema.parse(limit).sellAboveStoragePct).toBeUndefined();
    expect(AutoTradeLimitSchema.parse(limit).buyBelowStock).toBeUndefined();
    const buy = { ...demo, buyBelowStock: 200 };
    expect(withinAutoTrade(buy, order({ side: 'buy', give: 50, stock: 200, storagePct: 10 }))).toBe(true);
    expect(withinAutoTrade(buy, order({ side: 'buy', give: 50, stock: 201, storagePct: 10 }))).toBe(false);
    expect(AutoTradeLimitSchema.safeParse({ ...demo, sellAboveStoragePct: 101 }).success).toBe(false);
    expect(AutoTradeLimitSchema.safeParse({ ...demo, buyBelowStock: -1 }).success).toBe(false);
    expect(AutoTradeLimitSchema.safeParse({ ...demo, sellAboveStoragePct: 0, buyBelowStock: 0 }).success).toBe(true);
  });

  it('refuses a sell-above rule when the order has no fill percent', () => {
    expect(withinAutoTrade(demo, order({ give: 10, stock: 500 }))).toBe(false);
  });
});
