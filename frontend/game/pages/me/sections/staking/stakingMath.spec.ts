import { describe, expect, it } from 'vitest';
import { StakingOverviewResponse } from '@terra/contracts';
import { STAKING_RULES, STAKING_TIERS } from '@terra/contracts/staking/tiers';
import { fallbackOverview, formatNear, formatTvl, formatUsd, netApyBp, projectIncome, projectionFor } from './stakingMath';

describe('W28-09 staking projection math', () => {
  it('positive: yearly = amount x net APY, daily /365, monthly /12, USD at price', () => {
    const p = projectIncome(1000, 720, 4);
    expect(p.yearlyNear).toBeCloseTo(72, 9);
    expect(p.dailyNear).toBeCloseTo(72 / 365, 9);
    expect(p.monthlyNear).toBeCloseTo(6, 9);
    expect(p.yearlyUsd).toBeCloseTo(288, 9);
    expect(p.dailyUsd).toBeCloseTo((72 / 365) * 4, 9);
    expect(p.amountNear).toBe(1000);
  });

  it('positive: net APY applies the protocol slice from the data table', () => {
    expect(netApyBp(STAKING_RULES.simGrossApyBp, STAKING_RULES.protocolYieldShareBp)).toBe(720);
  });

  it('negative: bad input yields zeros, never NaN or negative', () => {
    for (const p of [projectIncome(Number.NaN, 720, 4), projectIncome(-5, 720, 4), projectIncome(10, Number.NaN, 4), projectIncome(10, 720, -1)]) {
      for (const v of Object.values(p)) expect(Number.isFinite(v) && v >= 0).toBe(true);
    }
    expect(projectIncome(10, 720, Number.NaN).yearlyUsd).toBe(0);
  });

  it('corner: zero amount, zero APY, huge amount stay finite', () => {
    expect(projectIncome(0, 720, 4).yearlyNear).toBe(0);
    expect(projectIncome(100, 0, 4).dailyUsd).toBe(0);
    expect(Number.isFinite(projectIncome(1_000_000, 720, 4).yearlyUsd)).toBe(true);
  });

  it('fallback overview is a valid StakingOverviewResponse with Est. price, sim APY and no ecosystem', () => {
    const ov = fallbackOverview(200, 1_700_000_000_000);
    expect(StakingOverviewResponse.safeParse(ov).success).toBe(true);
    expect(ov.price.source).toBe('est');
    expect(ov.apy.source).toBe('sim');
    expect(ov.apy.netApyBp).toBe(720);
    expect(ov.tiers).toEqual([...STAKING_TIERS]);
    expect(ov.ecosystem.entries).toEqual([]);
    expect(ov.projection.amountNear).toBe(200);
  });

  it('projectionFor reuses the server projection for the same amount, recomputes for another', () => {
    const ov = fallbackOverview(50);
    expect(projectionFor(ov, 50)).toBe(ov.projection);
    const other = projectionFor(ov, 500);
    expect(other.amountNear).toBe(500);
    expect(other.yearlyNear).toBeCloseTo(36, 9);
  });

  it('formatters handle non-finite input', () => {
    expect(formatNear(Number.NaN)).toBe('—');
    expect(formatUsd(Infinity)).toBe('—');
    expect(formatTvl('abc')).toBe('—');
    expect(formatTvl('1234567.4')).toBe('1,234,567');
    expect(formatUsd(1234.5)).toBe('$1,234.50');
    expect(formatNear(0)).toBe('0.00 NEAR');
    expect(formatNear(1)).toBe('1.00 NEAR');
    expect(formatNear(10)).toBe('10.00 NEAR');
    expect(formatNear(100)).toBe('100.00 NEAR');
    expect(formatNear(0.5)).toBe('0.5000 NEAR');
  });
});

describe('W28 formatUsdSmall (AI budget meter)', () => {
  it('shows fractions of a cent with 2 significant digits; cents and zero like formatUsd; junk as a dash', async () => {
    const { formatUsdSmall } = await import('./stakingMath');
    expect(formatUsdSmall(0.00346)).toBe('$0.0035');
    expect(formatUsdSmall(0.0000376)).toBe('$0.000038');
    expect(formatUsdSmall(0)).toBe('$0.00');
    expect(formatUsdSmall(0.01)).toBe('$0.01');
    expect(formatUsdSmall(12.345)).toBe('$12.35');
    expect(formatUsdSmall(Number.NaN)).toBe('—');
  });
});
