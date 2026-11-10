import { describe, expect, it } from 'vitest';
import { parseEnv } from '@terra/config';
import { nearEnv } from '../../src/near/infrastructure/near-infrastructure.module';
import {
  DEFAULT_STAKING_APY_BP,
   parseStakingPoolsConfig,
} from '../../src/near/staking/staking-pools.config';

describe('W20-17 NEAR_STAKING_POOLS whitelist config & boot validation', () => {
  it('returns the default 3 mock validator pools at 9% APY when NEAR_STAKING_POOLS is unset', () => {
    const pools = parseStakingPoolsConfig(undefined);
    expect(pools).toHaveLength(3);
    expect(pools[0]).toEqual({
      poolId: 'astro-stakers.pool.mock',
      name: 'Astro Stakers',
      apyBp: DEFAULT_STAKING_APY_BP,
    });
  });

  it('parses custom pool lists with explicit or derived names and APYs', () => {
    const pools = parseStakingPoolsConfig(
      'alpha-node.pool.mock, beta-node.pool.mock:Beta Validator:1100',
    );
    expect(pools).toEqual([
      { poolId: 'alpha-node.pool.mock', name: 'Alpha Node', apyBp: 900 },
      { poolId: 'beta-node.pool.mock', name: 'Beta Validator', apyBp: 1100 },
    ]);
  });

  it('acceptance: malformed pool list refuses to start at boot via nearEnv validation', () => {
    const malformedCases = [
      '',
      '   ',
      'NOT_A_POOL',
      'UPPERCASE.pool.mock',
      'astro.pool.mock,,other.pool.mock',
      'astro.pool.mock:Astro:notanumber',
      'astro.pool.mock:Astro:0',
      'astro.pool.mock:Astro:900,astro.pool.mock:Dup:900',
    ];
    for (const raw of malformedCases) {
      expect(() => parseStakingPoolsConfig(raw)).toThrow();
      expect(() =>
        parseEnv([nearEnv], { NODE_ENV: 'test', NEAR_STAKING_POOLS: raw }),
      ).toThrow(/NEAR_STAKING_POOLS/);
    }
  });
});
