import { STAKING_RULES } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { buildApyView } from '../../src/near/staking/performance/apy';
import { buildEcosystemView } from '../../src/near/staking/performance/ecosystem.reader';
import { quoteToUsd } from '../../src/near/staking/performance/fill-income.reader';
import { effectiveApyBp, MAX_EFFECTIVE_APY_BP, parsePreviewAmount, projectIncome, YEAR_MS } from '../../src/near/staking/performance/income-math';
import { identityResolver, isSelfFill, type FillParties } from '../../src/near/staking/performance/self-fill';
import { buildSeries, MAX_REALIZED_POINTS, PROJECTED_STEPS, WINDOW_MS } from '../../src/near/staking/performance/series.builder';

describe('effectiveApyBp', () => {
  const base = { netApyBp: 720, windowMs: 30 * 86_400_000 };
  it('is zero when nothing is staked (even with huge extras)', () => {
    expect(effectiveApyBp({ ...base, stakedUsd: 0, extrasUsd: 1e9 })).toBe(0);
    expect(effectiveApyBp({ ...base, stakedUsd: Number.NaN, extrasUsd: 5 })).toBe(0);
  });
  it('equals the net APY with no extras', () => {
    expect(effectiveApyBp({ ...base, stakedUsd: 1000, extrasUsd: 0 })).toBe(720);
  });
  it('adds annualized extras over staked value', () => {
    // 10 USD in 30d on 1000 USD staked = 1.0 % * 365/30 = 12.1667 % = 1217 bp
    expect(effectiveApyBp({ ...base, stakedUsd: 1000, extrasUsd: 10 })).toBe(720 + 1217);
  });
  it('never goes negative and ignores negative / non-finite extras', () => {
    expect(effectiveApyBp({ ...base, stakedUsd: 1000, extrasUsd: -500 })).toBe(720);
    expect(effectiveApyBp({ ...base, stakedUsd: 1000, extrasUsd: Number.NaN })).toBe(720);
    expect(effectiveApyBp({ netApyBp: -5, windowMs: 1, stakedUsd: 10, extrasUsd: 0 })).toBe(0);
  });
  it('caps absurd royalties at 1000 %', () => {
    expect(effectiveApyBp({ ...base, stakedUsd: 1, extrasUsd: 1e12 })).toBe(MAX_EFFECTIVE_APY_BP);
  });
  it('a zero window counts as a year (no division by zero)', () => {
    expect(effectiveApyBp({ netApyBp: 100, windowMs: 0, stakedUsd: 100, extrasUsd: 10 })).toBe(100 + 1000);
    expect(YEAR_MS).toBeGreaterThan(0);
  });
});

describe('parsePreviewAmount / projectIncome', () => {
  it('defaults on bad input, clamps 0..10^6', () => {
    const d = STAKING_RULES.defaultPreviewNear;
    for (const bad of [undefined, '', 'abc', 'NaN', 'Infinity', '1e3', {}, null]) expect(parsePreviewAmount(bad)).toBe(d);
    expect(parsePreviewAmount('250')).toBe(250);
    expect(parsePreviewAmount('12.5')).toBe(12.5);
    expect(parsePreviewAmount('-7')).toBe(0);
    expect(parsePreviewAmount('99999999')).toBe(1_000_000);
    expect(parsePreviewAmount('1'.repeat(400))).toBe(d);
  });
  it('projects net yield per day/month/year in NEAR and USD', () => {
    const p = projectIncome(1000, 720, 4);
    expect(p.yearlyNear).toBeCloseTo(72, 9);
    expect(p.dailyNear).toBeCloseTo(72 / 365, 9);
    expect(p.monthlyNear).toBeCloseTo(6, 9);
    expect(p.yearlyUsd).toBeCloseTo(288, 9);
  });
  it('zero / invalid inputs project zeros, never NaN', () => {
    for (const p of [projectIncome(0, 720, 4), projectIncome(Number.NaN, 720, 4), projectIncome(10, -1, Number.NaN)]) {
      expect(Object.values(p).every((v) => Number.isFinite(v) && v >= 0)).toBe(true);
    }
  });
});

describe('isSelfFill', () => {
  const fill = (o: Partial<FillParties> = {}): FillParties => ({
    buyerAccountId: 'buyer.c', sellerAccountId: 'seller.c', stallAccountId: 'stall.c',
    buyerColonyId: 'cb', sellerColonyId: 'cs', stallColonyId: 'cst', ...o,
  });
  const rows = [
    { accountId: 'buyer.c', playerId: 'p1', ownerAccountId: 'alice.near' },
    { accountId: 'buyer2.c', playerId: 'p1', ownerAccountId: 'alice.near' },
    { accountId: 'seller.c', playerId: 'p2', ownerAccountId: 'bob.near' },
    { accountId: 'stall.c', playerId: 'p3', ownerAccountId: 'carol.near', claimedByAccountId: 'alice.near' },
    { accountId: 'stall2.c', playerId: 'p4', ownerAccountId: 'dave.near' },
  ];
  const ids = identityResolver(rows);
  it('real counterparty fill is not self', () => {
    expect(isSelfFill(fill({ stallAccountId: 'stall2.c' }), ids)).toBe(false);
  });
  it('same owner on buyer and seller (two colonies of one player) is self', () => {
    expect(isSelfFill(fill({ sellerAccountId: 'buyer2.c', stallAccountId: 'stall2.c' }), ids)).toBe(true);
  });
  it('buyer == stall owner (via claim wallet) is self', () => {
    expect(isSelfFill(fill(), ids)).toBe(true);
  });
  it('same colony on both sides is self', () => {
    expect(isSelfFill(fill({ sellerColonyId: 'cb', stallAccountId: 'stall2.c' }), ids)).toBe(true);
    expect(isSelfFill(fill({ stallColonyId: 'cb', stallAccountId: 'stall2.c' }), ids)).toBe(true);
  });
  it('unknown accounts differ unless identical', () => {
    const none = identityResolver([]);
    expect(isSelfFill(fill(), none)).toBe(false);
    expect(isSelfFill(fill({ sellerAccountId: 'buyer.c' }), none)).toBe(true);
  });
});

describe('quoteToUsd', () => {
  it('converts USDC micro, NEAR yocto, and ignores resource quotes', () => {
    expect(quoteToUsd('USDC', 2_500_000n, 4)).toBe(2.5);
    expect(quoteToUsd('NEAR', 5n * 10n ** 23n, 4)).toBeCloseTo(2, 9);
    expect(quoteToUsd('bio.water', 100n, 4)).toBe(0);
    expect(quoteToUsd('USDC', 0n, 4)).toBe(0);
  });
});

describe('buildSeries', () => {
  const now = 1_700_000_000_000;
  const common = { nowMs: now, stakedNear: 100, netApyBp: 720, extraNearPerYear: 2 };
  const mono = (pts: Array<{ tMs: number; valueNear: number }>): boolean => pts.every((p, i) => i === 0 || (p.tMs >= pts[i - 1]!.tMs && p.valueNear >= pts[i - 1]!.valueNear));

  it('empty history still yields start, now and projected points, monotone', () => {
    const s = buildSeries({ ...common, window: '30d', events: [] });
    expect(s.points.length).toBe(2 + PROJECTED_STEPS);
    expect(s.points[0]).toMatchObject({ tMs: now - WINDOW_MS['30d'], valueNear: 0, kind: 'realized' });
    expect(s.points[1]).toMatchObject({ tMs: now, valueNear: 0, kind: 'realized' });
    expect(s.points.at(-1)).toMatchObject({ tMs: now + WINDOW_MS['30d'], kind: 'projected' });
    expect(s.points.at(-1)!.valueNear).toBeGreaterThan(0);
    expect(mono(s.points)).toBe(true);
  });

  it('single event accumulates and the projection continues from the realized total', () => {
    const s = buildSeries({ ...common, window: '90d', events: [{ tMs: now - 86_400_000, valueNear: 3 }] });
    const realized = s.points.filter((p) => p.kind === 'realized');
    expect(realized.at(-1)!.valueNear).toBe(3);
    expect(s.points.find((p) => p.kind === 'projected')!.valueNear).toBeGreaterThanOrEqual(3);
    expect(mono(s.points)).toBe(true);
  });

  it('zero stake and zero extras project flat', () => {
    const s = buildSeries({ ...common, window: '1y', stakedNear: 0, extraNearPerYear: 0, events: [{ tMs: now, valueNear: 1 }] });
    expect(new Set(s.points.filter((p) => p.kind === 'projected').map((p) => p.valueNear))).toEqual(new Set([1]));
  });

  it('drops invalid, out-of-window and future events; downsamples dense history', () => {
    const dense = Array.from({ length: 500 }, (_, i) => ({ tMs: now - WINDOW_MS['30d'] + ((i + 1) * WINDOW_MS['30d']) / 501, valueNear: 1 }));
    const s = buildSeries({
      ...common,
      window: '30d',
      events: [...dense, { tMs: now - WINDOW_MS['30d'] - 1, valueNear: 99 }, { tMs: now + 5, valueNear: 99 }, { tMs: now, valueNear: -4 }, { tMs: Number.NaN, valueNear: 1 }],
    });
    const realized = s.points.filter((p) => p.kind === 'realized');
    expect(realized.length).toBeLessThanOrEqual(MAX_REALIZED_POINTS + 2);
    expect(realized.at(-1)!.valueNear).toBe(500);
    expect(mono(s.points)).toBe(true);
  });
});

describe('buildApyView / buildEcosystemView', () => {
  it('sim APY off mainnet, even if a live read exists', () => {
    expect(buildApyView('mock', 1500)).toMatchObject({ source: 'sim', grossApyBp: STAKING_RULES.simGrossApyBp, netApyBp: 720, protocolYieldShareBp: 2000 });
    expect(buildApyView('testnet', 1500).source).toBe('sim');
  });
  it('live only on mainnet with a positive finite read', () => {
    expect(buildApyView('mainnet', 1000)).toMatchObject({ source: 'live', grossApyBp: 1000, netApyBp: 800 });
    for (const bad of [null, 0, -1, Number.NaN]) expect(buildApyView('mainnet', bad).source).toBe('sim');
  });
  it('ecosystem shares sum to 100 and an empty TVL is all zero', () => {
    const e = buildEcosystemView({ near: 3n * 10n ** 24n, stNEAR: 10n ** 24n });
    expect(e.totalNear).toBe('4');
    expect(e.entries.map((x) => x.sharePct)).toEqual([25, 0, 75]);
    const z = buildEcosystemView({});
    expect(z.totalNear).toBe('0');
    expect(z.entries).toHaveLength(3);
    expect(z.entries.every((x) => x.sharePct === 0)).toBe(true);
  });
});
