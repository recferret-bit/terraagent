import { describe, expect, it } from 'vitest';
import { AutoTradeLimitsSchema, AutoTradeOrderSchema } from '../src';

describe('W09-13 autoTrade contract', () => {
  const row = { maxPerTrade: 100, maxPerSession: 150, minStock: 40, partners: 'anyone' as const };

  it('parses a metals.t1 limit and an order under it', () => {
    expect(AutoTradeLimitsSchema.safeParse({ 'metals.t1': row }).success).toBe(true);
    expect(AutoTradeOrderSchema.safeParse({
      resource: 'metals.t1', give: 100, stock: 140, sessionSpent: 0, partner: 'guild',
    }).success).toBe(true);
  });

  it('rejects an unknown resource key and a negative floor', () => {
    expect(AutoTradeLimitsSchema.safeParse({ oil: row }).success).toBe(false);
    expect(AutoTradeLimitsSchema.safeParse({ 'metals.t1': { ...row, minStock: -1 } }).success).toBe(false);
  });

  it('accepts a zero give and rejects a partner outside the enum', () => {
    expect(AutoTradeOrderSchema.safeParse({
      resource: 'bio.biomass', give: 0, stock: 0, sessionSpent: 0, partner: 'truce',
    }).success).toBe(true);
    expect(AutoTradeOrderSchema.safeParse({
      resource: 'metals.t1', give: 1, stock: 1, sessionSpent: 0, partner: 'public',
    }).success).toBe(false);
  });
});
