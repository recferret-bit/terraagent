import { STAKING_RULES } from '@terra/contracts';
import { describe, expect, it, vi } from 'vitest';
import { NearUsdPriceCache, NEAR_PRICE_TTL_MS } from '../../src/near/staking/performance/near-usd-price.service';

const clock = (start = 1_000_000) => {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
};

describe('NearUsdPriceCache', () => {
  it('mock mode never calls the fetcher and answers the est price', async () => {
    const fetcher = vi.fn(async () => 9);
    const c = new NearUsdPriceCache({ live: false, fetcher });
    const v = await c.view();
    expect(v).toMatchObject({ nearUsd: STAKING_RULES.estNearUsd, source: 'est' });
    expect(await c.nearUsd()).toBe(STAKING_RULES.estNearUsd);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('live: caches within the TTL, refetches after it, flags live', async () => {
    const k = clock();
    const fetcher = vi.fn(async () => 5.5);
    const c = new NearUsdPriceCache({ live: true, fetcher, now: k.now });
    expect(await c.view()).toMatchObject({ nearUsd: 5.5, source: 'live', asOfMs: 1_000_000 });
    k.advance(NEAR_PRICE_TTL_MS - 1);
    await c.view();
    expect(fetcher).toHaveBeenCalledTimes(1);
    k.advance(2);
    await c.view();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('live: failure after a good read serves the stale price flagged est', async () => {
    const k = clock();
    let fail = false;
    const c = new NearUsdPriceCache({ live: true, now: k.now, fetcher: async () => { if (fail) throw new Error('down'); return 6; } });
    await c.view();
    fail = true;
    k.advance(NEAR_PRICE_TTL_MS + 1);
    expect(await c.view()).toMatchObject({ nearUsd: 6, source: 'est', asOfMs: 1_000_000 });
  });

  it('live: failure or garbage with no cache falls back to the table estimate', async () => {
    for (const bad of [async () => { throw new Error('x'); }, async () => null, async () => Number.NaN, async () => -3, async () => 0]) {
      const c = new NearUsdPriceCache({ live: true, fetcher: bad as () => Promise<number | null> });
      expect(await c.view()).toMatchObject({ nearUsd: STAKING_RULES.estNearUsd, source: 'est' });
    }
  });

  it('shares one in-flight fetch between concurrent callers', async () => {
    const fetcher = vi.fn(async () => 4.2);
    const c = new NearUsdPriceCache({ live: true, fetcher });
    const [a, b] = await Promise.all([c.nearUsd(), c.nearUsd()]);
    expect([a, b]).toEqual([4.2, 4.2]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
