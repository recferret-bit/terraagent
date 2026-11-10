import { describe, expect, it } from 'vitest';
import type { AutoTradeLimit } from '@terra/contracts';
import { parseCommandArgs } from '@terra/contracts';
import { ratio } from '../../src/economy/flows/ratio';
import { forecastAutoTrade, type AutoTradeForecastInput } from '../../src/systems/trade/autotrade';

const limit: AutoTradeLimit = {
  maxPerTrade: 300, maxPerSession: 600, minStock: 200, partners: 'guild', sellAboveStoragePct: 80,
};

function input(over: Partial<AutoTradeForecastInput> = {}): AutoTradeForecastInput {
  return {
    resource: 'metals.t1',
    stock: 1400,
    storageCap: 1500,
    queued: 100,
    reserved: 50,
    serviceWindow: 50,
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

const remedies: NonNullable<AutoTradeForecastInput['remedies']> = {
  ask: { num: 1n, den: 1n, quote: 'USDC', platformFeeBp: 0, stallFeeBp: 0 },
  localMinutesPerUnit: ratio(2n),
  depot: null,
};

describe('W15-19 autoTrade forecast', () => {
  it('reports surplus after queues, reservations and the service window, and authorizes the demo sell', () => {
    const f = forecastAutoTrade(input());
    expect(f.surplus).toBe(1200);
    expect(f.shortage).toBe(0);
    expect(f.storagePct).toBeCloseTo(1400 / 1500 * 100);
    expect(f.authorized).toBe(true);
    expect(f.reason).toBeUndefined();
    expect(f.partner).toBe('guild');
  });

  it('rejects an unknown partner, a disabled truce, and a tier the slice does not trade', () => {
    const nope = forecastAutoTrade(input({ partner: 'nope', side: 'buy', quantity: 40, stock: 10, storageCap: 100, queued: 0, reserved: 0, serviceWindow: 0, reserveFloor: 50, remedies }));
    expect(nope.authorized).toBe(false);
    expect(nope.reason).toBe('partner');
    expect(nope.partner).toBe('nope');
    expect(nope.remedies.find((r) => r.kind === 'buy')?.authorized).toBe(false);
    expect(nope.preference).toBe('produce');

    const truce = forecastAutoTrade(input({
      partner: 'truce', truceEnabled: false, limit: { ...limit, partners: 'truce' },
    }));
    expect(truce.authorized).toBe(false);
    expect(truce.reason).toBe('truce_disabled');
    expect(truce.partner).toBe('truce');

    const tier = forecastAutoTrade(input({ resource: 'metals.t2' }));
    expect(tier.authorized).toBe(false);
    expect(tier.reason).toBe('tier');
    expect(tier.resource).toBe('metals.t2');
  });

  it('corners: exact surplus, one unit past it, exact session cap, storage at 80 and just below, inclusive buy', () => {
    const wide: AutoTradeLimit = { maxPerTrade: 2000, maxPerSession: 2000, minStock: 0, partners: 'guild' };
    const held = { stock: 100, storageCap: 1000, queued: 0, reserved: 90, serviceWindow: 0, limit: wide };
    expect(forecastAutoTrade(input({ ...held, quantity: 10 })).surplus).toBe(10);
    expect(forecastAutoTrade(input({ ...held, quantity: 10 })).authorized).toBe(true);
    expect(forecastAutoTrade(input({ ...held, quantity: 11 })).reason).toBe('no_surplus');

    expect(forecastAutoTrade(input({ sessionSpent: 300, quantity: 300 })).authorized).toBe(true);
    expect(forecastAutoTrade(input({ sessionSpent: 301, quantity: 300 })).reason).toBe('limit');

    expect(forecastAutoTrade(input({ stock: 800, storageCap: 1000, queued: 0, reserved: 0, serviceWindow: 0, quantity: 100 })).authorized).toBe(true);
    expect(forecastAutoTrade(input({ stock: 799, storageCap: 1000, queued: 0, reserved: 0, serviceWindow: 0, quantity: 100 })).reason).toBe('limit');

    const buy = forecastAutoTrade(input({
      side: 'buy', stock: 10, storageCap: 100, queued: 0, reserved: 0, serviceWindow: 0,
      reserveFloor: 50, quantity: 40, limit: { ...limit, buyBelowStock: 10 }, remedies,
    }));
    expect(buy.shortage).toBe(40);
    expect(buy.authorized).toBe(true);
    expect(buy.preference).toBe('buy');
    expect(buy.remedies.map((r) => r.kind)).toEqual(['produce', 'buy', 'haul', 'depot', 'reserve']);

    const aboveFloor = forecastAutoTrade(input({
      side: 'buy', stock: 11, storageCap: 100, queued: 0, reserved: 0, serviceWindow: 0,
      reserveFloor: 50, quantity: 40, limit: { ...limit, buyBelowStock: 10 },
    }));
    expect(aboveFloor.authorized).toBe(false);
  });

  it('round-trips the optional fields through setAutoTrade and allows T2 only when asked', () => {
    const parsed = parseCommandArgs('setAutoTrade', {
      limits: { 'metals.t1': { maxPerTrade: 300, maxPerSession: 600, minStock: 200, partners: 'guild', sellAboveStoragePct: 80, buyBelowStock: 40 } },
    });
    if (!parsed.success || !('limits' in parsed.data)) throw new Error('setAutoTrade did not parse');
    expect(parsed.data.limits['metals.t1']).toMatchObject({ sellAboveStoragePct: 80, buyBelowStock: 40, partners: 'guild' });
    const open = forecastAutoTrade(input({
      resource: 'metals.t2', tier1Only: false, limit: { ...limit, sellAboveStoragePct: undefined },
      stock: 500, storageCap: 0, queued: 0, reserved: 0, serviceWindow: 0, quantity: 10,
    }));
    expect(open.authorized).toBe(true);
  });
});
