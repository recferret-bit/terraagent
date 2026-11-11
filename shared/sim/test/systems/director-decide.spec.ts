import { describe, expect, it } from 'vitest';
import type { AutoTradeLimit } from '@terra/contracts';
import { agentParamsFromData, compileData } from '../../src';
import { withinAutoTrade } from '../../src/systems/away/auto-trade';
import { orderFor } from '../../src/systems/trade/autotrade/authorize';
import {
  decideDirectorTrade,
  isDirectorTrade,
  priceDirectorOrder,
  proposeDirectorTrade,
  type AutoTradeForecastInput,
} from '../../src/systems/trade/autotrade';

const limit: AutoTradeLimit = {
  maxPerTrade: 300,
  maxPerSession: 600,
  minStock: 200,
  partners: 'guild',
  sellAboveStoragePct: 80,
};

function input(over: Partial<AutoTradeForecastInput> = {}): AutoTradeForecastInput {
  return {
    resource: 'metals.t1',
    stock: 1400,
    storageCap: 1500,
    queued: 0,
    reserved: 0,
    serviceWindow: 0,
    reserveFloor: 200,
    reserveHorizon: 0,
    sessionSpent: 0,
    partner: 'guild',
    side: 'sell',
    quantity: 300,
    limit,
    ...over,
  };
}

describe('W15-21 decideDirectorTrade', () => {
  it('sells exactly 300 metals when storage is above 80%', () => {
    const sell = decideDirectorTrade(input());
    expect(sell).toEqual({ side: 'sell', resource: 'metals.t1', amount: 300 });
    expect(proposeDirectorTrade(input())).toEqual(sell);
    expect(withinAutoTrade(limit, orderFor(input(), 'sell', 300))).toBe(true);
  });

  it('skips when stock is below the 80% line and allows the line itself', () => {
    expect(decideDirectorTrade(input({ stock: 1199 }))).toEqual({ skip: 'storage' });
    expect(decideDirectorTrade(input({ stock: 1200, storageCap: 1500, quantity: 100 }))).toEqual({
      side: 'sell',
      resource: 'metals.t1',
      amount: 100,
    });
  });

  it('rejects give 400 through withinAutoTrade and refuses a partner that is not guild', () => {
    const over = input({ quantity: 400 });
    expect(withinAutoTrade(limit, orderFor(over, 'sell', 400))).toBe(false);
    expect(decideDirectorTrade(over)).toEqual({ skip: 'autotrade_limit' });
    expect(decideDirectorTrade(input({ partner: 'anyone' }))).toEqual({ skip: 'partner' });
    expect(decideDirectorTrade(input({ partner: 'nope' }))).toEqual({ skip: 'partner' });
  });

  it('keeps a second 300 inside a 600 cap and refuses one unit past it', () => {
    const inside = input({ sessionSpent: 300 });
    expect(withinAutoTrade(limit, orderFor(inside, 'sell', 300))).toBe(true);
    const decided = decideDirectorTrade(inside);
    const proposed = proposeDirectorTrade(inside);
    expect(isDirectorTrade(decided) && decided.amount).toBe(300);
    expect(isDirectorTrade(proposed) && proposed.amount).toBe(300);
    expect(decideDirectorTrade(input({ sessionSpent: 301 }))).toEqual({ skip: 'session_cap' });
    expect(proposeDirectorTrade(input({ sessionSpent: 600 }))).toEqual({ skip: 'session_cap' });
  });
});

describe('W15-21 priceDirectorOrder', () => {
  const params = agentParamsFromData(compileData(new Set(['W13'])));

  it('prices the 300 sell with quoteColony and reserves the metal, not the quote', () => {
    const priced = priceDirectorOrder(
      {
        resource: 'metals.t1',
        side: 'sell',
        amount: 300,
        stock: 1400,
        target: 750,
        reference: { num: 1_000_000n, den: 1n },
        ownUnitCost: { num: 800_000n, den: 1n },
        platformFeeBp: 100,
        maxStallFeeBp: 100,
        lotUnits: 1,
        minNotionalAtomic: 100_000n,
      },
      params,
    );
    expect(priced?.reserveToken).toBe('metals.t1');
    expect(priced?.reserveAmount).toBe('300');
    expect(priced?.price.token).toBe('USDC');
    expect(BigInt(priced!.price.amount)).toBeGreaterThan(300n);
    expect(
      priceDirectorOrder(
        {
          resource: 'metals.t1',
          side: 'sell',
          amount: 300,
          stock: 1400,
          target: 750,
          reference: null,
          ownUnitCost: null,
          platformFeeBp: 100,
          maxStallFeeBp: 100,
          lotUnits: 1,
          minNotionalAtomic: 1n,
        },
        params,
      ),
    ).toBeNull();
  });
});
