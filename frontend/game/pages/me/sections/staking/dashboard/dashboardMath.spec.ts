import { describe, expect, it } from 'vitest';
import type { PerformancePoint } from '@terra/contracts';
import {
  buildChartPaths, earlyExitFeeNear, formatCountdown, formatMicroNear, tickedYieldNear, tierProgress, topUpAmountNear,
  totalStakedNear, yieldPerSecondNear,
} from './dashboardMath';
import { makePerformance } from './dashboardFixtures';

const G = { width: 100, height: 50, padX: 5, padY: 5 };
const pt = (tMs: number, valueNear: number, kind: 'realized' | 'projected' = 'realized'): PerformancePoint => ({ tMs, valueNear, kind });

describe('ticker math', () => {
  it('totals native stake plus LST NEAR value', () => {
    expect(totalStakedNear(makePerformance().balances)).toBeCloseTo(70.5, 9);
  });
  it('rate = total x net APY / seconds per year; zero for no stake or no APY (corner)', () => {
    expect(yieldPerSecondNear(100, 720)).toBeCloseTo((100 * 0.072) / (365 * 86_400), 12);
    expect(yieldPerSecondNear(0, 720)).toBe(0);
    expect(yieldPerSecondNear(100, 0)).toBe(0);
    expect(yieldPerSecondNear(Number.NaN, 720)).toBe(0);
  });
  it('ticked yield grows with elapsed time, never goes backwards or NaN', () => {
    const rate = yieldPerSecondNear(100, 720);
    expect(tickedYieldNear(1, rate, 10_000)).toBeCloseTo(1 + rate * 10, 12);
    expect(tickedYieldNear(1, rate, -5)).toBe(1);
    expect(tickedYieldNear(Number.NaN, rate, 1000)).toBeCloseTo(rate, 12);
    expect(formatMicroNear(1.23456789)).toBe('1.234568');
    expect(formatMicroNear(Number.NaN)).toBe('0.000000');
  });
});

describe('top-up, early exit, progress', () => {
  it('top-up fills the gap to the next tier minimum, rounded up to 4 dp', () => {
    expect(topUpAmountNear(70.5, 200)).toBe(129.5);
    expect(topUpAmountNear(49.99999, 50)).toBe(0.0001);
  });
  it('top-up is 0 when already past the minimum and null at the top tier (corner)', () => {
    expect(topUpAmountNear(250, 200)).toBe(0);
    expect(topUpAmountNear(600, null)).toBeNull();
  });
  it('early-exit fee preview: 25 bp of 100 NEAR = 0.25; 0 after 7 days or for empty amounts', () => {
    expect(earlyExitFeeNear(100, 25)).toBeCloseTo(0.25, 12);
    expect(earlyExitFeeNear(100, 0)).toBe(0);
    expect(earlyExitFeeNear(0, 25)).toBe(0);
    expect(earlyExitFeeNear(-5, 25)).toBe(0);
  });
  it('tier progress is clamped to 0..1 and full at the top tier', () => {
    expect(tierProgress(25, 50)).toBe(0.5);
    expect(tierProgress(80, 50)).toBe(1);
    expect(tierProgress(-1, 50)).toBe(0);
    expect(tierProgress(5, null)).toBe(1);
  });
  it('countdown formats d/h/m/s, Ready when past, dash for null', () => {
    const now = 1_000_000;
    expect(formatCountdown(now + 3 * 86_400_000 + 4 * 3_600_000, now)).toBe('3d 4h');
    expect(formatCountdown(now + 4 * 3_600_000 + 12 * 60_000, now)).toBe('4h 12m');
    expect(formatCountdown(now + 125_000, now)).toBe('2m 05s');
    expect(formatCountdown(now + 45_000, now)).toBe('45s');
    expect(formatCountdown(now - 1, now)).toBe('Ready');
    expect(formatCountdown(null, now)).toBe('—');
  });
});

describe('buildChartPaths', () => {
  it('empty series is flagged empty with no paths', () => {
    const p = buildChartPaths([], G);
    expect(p).toMatchObject({ empty: true, realizedD: '', projectedD: '', nowMarker: null });
  });
  it('single point: marker only, no path (corner)', () => {
    const p = buildChartPaths([pt(1000, 2)], G);
    expect(p.empty).toBe(false);
    expect(p.realizedD).toBe('');
    expect(p.projectedD).toBe('');
    expect(p.nowMarker).not.toBeNull();
    expect(Number.isFinite(p.nowMarker!.y)).toBe(true);
  });
  it('realized -> projected split: solid path stops at now, dashed path starts at the last realized point', () => {
    const p = buildChartPaths([pt(0, 0), pt(10, 1), pt(20, 2, 'projected'), pt(30, 3, 'projected')], G);
    const realizedPoints = p.realizedD.split(/(?=[ML])/);
    const projectedPoints = p.projectedD.split(/(?=[ML])/);
    expect(realizedPoints).toHaveLength(2);
    expect(projectedPoints).toHaveLength(3);
    expect(projectedPoints[0]!.replace('M', '').trim()).toBe(realizedPoints[1]!.replace('L', '').trim());
    expect(p.nowMarker!.x).toBeCloseTo(5 + (10 / 30) * 90, 1);
  });
  it('all-realized series has no dashed path; unsorted input is sorted by time', () => {
    const p = buildChartPaths([pt(20, 2), pt(0, 0), pt(10, 1)], G);
    expect(p.projectedD).toBe('');
    expect(p.realizedD.startsWith('M5.0 45.0')).toBe(true);
    expect(p.startMs).toBe(0);
    expect(p.endMs).toBe(20);
  });
  it('flat series does not divide by zero; non-finite points are dropped', () => {
    const p = buildChartPaths([pt(0, 3), pt(10, 3), pt(20, Number.NaN)], G);
    expect(p.realizedD).not.toMatch(/NaN|Infinity/);
  });
  it('window switch: a longer window spreads the same values over a wider span (x scale changes)', () => {
    const short = buildChartPaths([pt(0, 0), pt(10, 1)], G);
    const long = buildChartPaths([pt(0, 0), pt(10, 1), pt(100, 1, 'projected')], G);
    expect(short.nowMarker!.x).toBeGreaterThan(long.nowMarker!.x);
  });
});
