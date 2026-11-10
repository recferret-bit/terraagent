import { describe, expect, it } from 'vitest';
import type { AutoTradeLimit, AutoTradeOrder } from '@terra/contracts';
import { withinAutoTrade } from '../../src/systems/away/auto-trade';
import { decideDirectorTrade, isDirectorTrade, type AutoTradeForecastInput } from '../../src/systems/trade/autotrade';

const limit: AutoTradeLimit = {
  maxPerTrade: 300,
  maxPerSession: 600,
  minStock: 200,
  partners: 'guild',
  sellAboveStoragePct: 80,
};

function order(give: number, sessionSpent = 0): AutoTradeOrder {
  return {
    resource: 'metals.t1',
    give,
    stock: 1400,
    sessionSpent,
    partner: 'guild',
    side: 'sell',
    storagePct: 93,
    storageCap: 1500,
  };
}

function input(quantity: number, sessionSpent = 0): AutoTradeForecastInput {
  return {
    resource: 'metals.t1',
    stock: 1400,
    storageCap: 1500,
    queued: 0,
    reserved: 0,
    serviceWindow: 0,
    reserveFloor: 200,
    reserveHorizon: 0,
    sessionSpent,
    partner: 'guild',
    side: 'sell',
    quantity,
    limit,
  };
}

describe('W15-20 withinAutoTrade on a director order', () => {
  it('rejects give 400 when maxPerTrade is 300 and accepts 300', () => {
    expect(withinAutoTrade(limit, order(400))).toBe(false);
    expect(decideDirectorTrade(input(400))).toEqual({ skip: 'autotrade_limit' });
    expect(withinAutoTrade(limit, order(300))).toBe(true);
    const ok = decideDirectorTrade(input(300));
    expect(isDirectorTrade(ok) && ok.amount).toBe(300);
  });

  it('treats the caps as inclusive', () => {
    expect(withinAutoTrade(limit, order(300))).toBe(true);
    expect(withinAutoTrade(limit, order(301))).toBe(false);
    expect(withinAutoTrade(limit, order(300, 300))).toBe(true);
    expect(withinAutoTrade(limit, order(300, 301))).toBe(false);
    expect(isDirectorTrade(decideDirectorTrade(input(300, 300)))).toBe(true);
    expect(isDirectorTrade(decideDirectorTrade(input(300, 301)))).toBe(false);
  });
});
