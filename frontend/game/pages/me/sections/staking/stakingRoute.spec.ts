import { describe, expect, it } from 'vitest';
import { STAKING_RULES } from '@terra/contracts/staking/tiers';
import { MAX_PREVIEW_NEAR, parseStakingHash, sanitizeStakeAmount, stakingHash } from './stakingRoute';

const DEF = STAKING_RULES.defaultPreviewNear;

describe('W28-09 staking hash/amount parser', () => {
  it('positive: reads the amount inside the hash fragment', () => {
    expect(parseStakingHash('#staking?amount=200')).toEqual({ active: true, amount: 200 });
    expect(parseStakingHash('staking?amount=12.5')).toEqual({ active: true, amount: 12.5 });
    expect(parseStakingHash('#STAKING?amount=500')).toEqual({ active: true, amount: 500 });
  });

  it('positive: bare #staking is active with the default amount', () => {
    expect(parseStakingHash('#staking')).toEqual({ active: true, amount: DEF });
    expect(parseStakingHash('#staking?')).toEqual({ active: true, amount: DEF });
  });

  it('negative: other hashes are inactive', () => {
    expect(parseStakingHash('')).toEqual({ active: false, amount: DEF });
    expect(parseStakingHash('#pilot')).toEqual({ active: false, amount: DEF });
    expect(parseStakingHash('#stakingx?amount=5').active).toBe(false);
  });

  it('negative: junk, negative, zero, NaN and infinity fall back to the default', () => {
    for (const bad of ['abc', '-5', '0', 'NaN', 'Infinity', '', ' ', '1,5', 'null']) {
      expect(parseStakingHash(`#staking?amount=${encodeURIComponent(bad)}`).amount).toBe(DEF);
    }
    expect(sanitizeStakeAmount(undefined)).toBe(DEF);
    expect(sanitizeStakeAmount(null)).toBe(DEF);
    expect(sanitizeStakeAmount(Number.NaN)).toBe(DEF);
  });

  it('corner: clamps above 10^6, keeps the boundary, rounds to cents, ignores a second param', () => {
    expect(sanitizeStakeAmount(MAX_PREVIEW_NEAR)).toBe(MAX_PREVIEW_NEAR);
    expect(sanitizeStakeAmount(MAX_PREVIEW_NEAR + 1)).toBe(MAX_PREVIEW_NEAR);
    expect(sanitizeStakeAmount('1e9')).toBe(MAX_PREVIEW_NEAR);
    expect(sanitizeStakeAmount('0.004')).toBe(DEF);
    expect(sanitizeStakeAmount('10.126')).toBe(10.13);
    expect(parseStakingHash('#staking?foo=1&amount=7')).toEqual({ active: true, amount: 7 });
  });

  it('round-trips through stakingHash', () => {
    expect(stakingHash(200)).toBe('#staking?amount=200');
    expect(parseStakingHash(stakingHash(-3)).amount).toBe(DEF);
  });
});
