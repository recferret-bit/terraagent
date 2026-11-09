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
