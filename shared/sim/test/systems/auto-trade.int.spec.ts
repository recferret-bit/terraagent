import { describe, expect, it } from 'vitest';
import { AutoTradeLimitSchema, AutoTradeOrderSchema } from '@terra/contracts';
import { withinAutoTrade } from '../../src/systems/away/auto-trade';

describe('W09-13 withinAutoTrade through the contract', () => {
  it('a parsed 200-metal give against a max of 100 is false', () => {
    const limit = AutoTradeLimitSchema.parse({ maxPerTrade: 100, maxPerSession: 500, minStock: 0, partners: 'anyone' });
    const order = AutoTradeOrderSchema.parse({
      resource: 'metals.t1', give: 200, stock: 400, sessionSpent: 0, partner: 'guild',
    });
    expect(withinAutoTrade(limit, order)).toBe(false);
  });

  it('a parsed give that lands on the floor is true, and one under it is false', () => {
    const limit = AutoTradeLimitSchema.parse({ maxPerTrade: 100, maxPerSession: 500, minStock: 40, partners: 'anyone' });
    const onFloor = AutoTradeOrderSchema.parse({
      resource: 'metals.t1', give: 10, stock: 50, sessionSpent: 0, partner: 'anyone',
    });
    const under = AutoTradeOrderSchema.parse({
      resource: 'metals.t1', give: 11, stock: 50, sessionSpent: 0, partner: 'anyone',
    });
    expect(withinAutoTrade(limit, onFloor)).toBe(true);
    expect(withinAutoTrade(limit, under)).toBe(false);
  });
});
