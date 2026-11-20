import { describe, expect, it } from 'vitest';
import { ValidatorApyReader, type ApyProbe } from '../../src/near/infrastructure/adapters/real/validator-apy';

const YEAR = 365 * 86_400_000;
const SUPPLY = 1_000_000_000n * 10n ** 24n;

/** Supply grew 5 % per year over a 2-day window; 40 % of the supply is staked. */
const goodProbe = (over: Partial<{ growthPpm: bigint; stakeShareBp: bigint; elapsedMs: number }> = {}): ApyProbe => ({
  async samples() {
    const elapsedMs = over.elapsedMs ?? 2 * 86_400_000;
    const growth = (SUPPLY * (over.growthPpm ?? 50_000n) * BigInt(elapsedMs)) / (1_000_000n * BigInt(YEAR));
    return {
      now: { totalSupplyYocto: SUPPLY + growth, blockTimeMs: 1_000_000 + elapsedMs },
      then: { totalSupplyYocto: SUPPLY, blockTimeMs: 1_000_000 },
      totalStakeYocto: (SUPPLY * (over.stakeShareBp ?? 4_000n)) / 10_000n,
    };
  },
});

describe('W28-04 ValidatorApyReader', () => {
  it('derives a trailing APY from supply growth and stake share (5 % inflation / 40 % staked, net of 10 % treasury)', async () => {
    const apy = await new ValidatorApyReader(goodProbe()).read();
    expect(apy.source).toBe('live');
    // 5 % / 0.40 = 12.5 %, times 0.9 = 11.25 % -> about 1125 bp
    expect(apy.apyBp).toBeGreaterThan(1_100);
    expect(apy.apyBp).toBeLessThan(1_150);
  });

  it('caches a live sample for the TTL and re-samples afterwards', async () => {
    let now = 1_000;
    let calls = 0;
    const probe: ApyProbe = { samples: async () => { calls += 1; return goodProbe().samples(4); } };
    const reader = new ValidatorApyReader(probe, () => now, 10_000);
    await reader.read();
    now += 5_000;
    await reader.read();
    expect(calls).toBe(1);
    now += 6_000;
    await reader.read();
    expect(calls).toBe(2);
  });

  it('serves the last good value flagged cached when the probe fails, and the Sim APY when it never worked', async () => {
    let now = 0;
    let fail = false;
    const probe: ApyProbe = { samples: async () => { if (fail) throw new Error('request timed out'); return goodProbe().samples(4); } };
    const reader = new ValidatorApyReader(probe, () => now, 1_000);
    const live = await reader.read();
    fail = true;
    now += 5_000;
    expect(await reader.read()).toMatchObject({ source: 'cached', apyBp: live.apyBp, sampledAtMs: 0, error: 'rpc_timeout' });
    expect(await new ValidatorApyReader({ samples: async () => { throw new Error('boom'); } }).read()).toMatchObject({ source: 'sim', apyBp: 900, sampledAtMs: null, error: 'rpc_error' });
  });

  it('rejects inconsistent samples (no elapsed time, shrinking supply, zero stake) instead of dividing by zero', async () => {
    for (const probe of [goodProbe({ elapsedMs: 0 }), goodProbe({ stakeShareBp: 0n })]) {
      expect(await new ValidatorApyReader(probe).read()).toMatchObject({ source: 'sim', error: 'apy_unavailable' });
    }
    const shrinking: ApyProbe = { samples: async () => ({ now: { totalSupplyYocto: 1n, blockTimeMs: 2 }, then: { totalSupplyYocto: 2n, blockTimeMs: 1 }, totalStakeYocto: 1n }) };
    expect(await new ValidatorApyReader(shrinking).read()).toMatchObject({ source: 'sim', error: 'apy_unavailable' });
  });

  it('clamps an absurd APY to 5000 bp', async () => {
    const apy = await new ValidatorApyReader(goodProbe({ growthPpm: 900_000n, stakeShareBp: 100n })).read();
    expect(apy.apyBp).toBe(5_000);
  });
});
