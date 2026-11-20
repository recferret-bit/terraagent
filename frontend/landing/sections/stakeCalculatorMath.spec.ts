import { describe, expect, it } from 'vitest';
import { STAKING_RULES, STAKING_TIERS } from '@terra/contracts/staking/tiers';
import { clampStake, fallbackApy, netApyBpFrom, parseOverviewApy, pillBadge, quoteStake, stakeCta, tierMarkers } from './stakeCalculatorMath';

const NET = netApyBpFrom(STAKING_RULES.simGrossApyBp, STAKING_RULES.protocolYieldShareBp);

describe('clampStake', () => {
  it('passes whole values and floors fractions', () => { expect(clampStake(200)).toBe(200); expect(clampStake(49.9)).toBe(49); });
  it('collapses negative / NaN / -Infinity to 0', () => { expect(clampStake(-5)).toBe(0); expect(clampStake(NaN)).toBe(0); expect(clampStake(-Infinity)).toBe(0); });
  it('clamps above the slider max', () => { expect(clampStake(9999)).toBe(STAKING_RULES.calculatorMaxNear); expect(clampStake(Infinity)).toBe(STAKING_RULES.calculatorMaxNear); });
});

describe('fallback / live APY', () => {
  it('fallback is gross x (1 - protocol share) = 7.20% SIM APY', () => {
    expect(fallbackApy()).toEqual({ netApyBp: 720, source: 'sim' });
    expect(pillBadge(fallbackApy())).toBe('7.20% SIM APY');
  });
  it('live payload shows its own net APY without the SIM word', () => {
    const apy = parseOverviewApy({ apy: { netApyBp: 512, source: 'live' } });
    expect(pillBadge(apy)).toBe('5.12% APY');
  });
  it('sim source from the endpoint keeps the SIM badge', () => { expect(pillBadge(parseOverviewApy({ apy: { netApyBp: 720, source: 'sim' } }))).toBe('7.20% SIM APY'); });
  it.each([null, undefined, {}, { apy: {} }, { apy: { netApyBp: 'x' } }, { apy: { netApyBp: -1 } }, { apy: { netApyBp: NaN } }])('malformed %j falls back', (p) => {
    expect(parseOverviewApy(p)).toEqual(fallbackApy());
  });
});

describe('quoteStake tier boundaries and fee savings', () => {
  it.each([[0, 0], [9, 0], [10, 1], [49, 1], [50, 2], [199, 2], [200, 3], [499, 3], [500, 4], [750, 4]])('stake %i -> tier %i', (stake, tier) => {
    expect(quoteStake(stake, 1000, NET, STAKING_RULES.simGrossApyBp).tier.id).toBe(tier);
  });
  it('fee comes from the tier row and saving = volume x (standard - tier) bp', () => {
    const q = quoteStake(200, 5000, NET, STAKING_RULES.simGrossApyBp);
    expect(q.feeBp).toBe(STAKING_TIERS[3]!.takerFeeBp);
    expect(q.feeSavedUsdc).toBeCloseTo((5000 * (STAKING_TIERS[0]!.takerFeeBp - STAKING_TIERS[3]!.takerFeeBp)) / 10_000);
  });
  it('warmup note only for tier 2-4', () => {
    expect(quoteStake(10, 0, NET, 900).warmupHours).toBeNull();
    expect(quoteStake(50, 0, NET, 900).warmupHours).toBe(24);
    expect(quoteStake(0, 0, NET, 900).warmupHours).toBeNull();
  });
  it('cadet saves nothing; negative or NaN volume is 0; tier 4 has no next tier', () => {
    expect(quoteStake(0, 5000, NET, 900).feeSavedUsdc).toBe(0);
    expect(quoteStake(50, -100, NET, 900).feeSavedUsdc).toBe(0);
    expect(quoteStake(50, NaN, NET, 900).feeSavedUsdc).toBe(0);
    expect(quoteStake(500, 0, NET, 900).nextTier).toBeNull();
  });
  it('yield split: 100 NEAR at 9% gross -> 7.20 net + 1.80 protocol', () => {
    const q = quoteStake(100, 0, NET, STAKING_RULES.simGrossApyBp);
    expect(q.netYieldNear).toBeCloseTo(7.2); expect(q.protocolYieldNear).toBeCloseTo(1.8);
  });
});

describe('stakeCta', () => {
  it('200 NEAR -> unlock tier 3 with the amount in the href', () => {
    expect(stakeCta(200)).toEqual({ amount: 200, tierId: 3, label: 'STAKE 200 NEAR · UNLOCK TIER 3 →', href: '/me.html#staking?amount=200' });
  });
  it('below the first threshold offers the Tier 1 entry amount', () => {
    expect(stakeCta(0).label).toBe('STAKE 10 NEAR · UNLOCK TIER 1 →');
    expect(stakeCta(9).href).toBe('/me.html#staking?amount=10');
  });
  it('49 -> tier 1, 50 -> tier 2, 500 -> tier 4; NaN / overflow are clamped', () => {
    expect(stakeCta(49).tierId).toBe(1); expect(stakeCta(50).tierId).toBe(2); expect(stakeCta(500).tierId).toBe(4);
    expect(stakeCta(NaN).amount).toBe(10); expect(stakeCta(1e9).amount).toBe(500);
  });
});

describe('tierMarkers', () => {
  it('one marker per tier row 1..4 at threshold / max', () => {
    const m = tierMarkers();
    expect(m.map((x) => x.minNear)).toEqual([10, 50, 200, 500]);
    expect(m.at(-1)!.leftPct).toBe(100);
  });
});
