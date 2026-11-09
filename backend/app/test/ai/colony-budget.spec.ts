import { parseWaves } from '@terra/contracts';
import { compileData, dataRow } from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { ColonyBudget } from '../../src/ai/budget/colony';

function cadence(): { perDay: number; normalMs: number; criticalMs: number } {
  const row = dataRow(compileData(parseWaves('..16')), 'director', 'cadence');
  const perDay = numberField(row.colonyRequestsPerDay, 'colonyRequestsPerDay');
  const normalS = numberField(row.normalIntervalS, 'normalIntervalS');
  const criticalS = numberField(row.criticalIntervalS, 'criticalIntervalS');
  return { perDay, normalMs: normalS * 1000, criticalMs: criticalS * 1000 };
}

function numberField(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`director.cadence.${field} is not a number`);
  return value;
}

function utcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** UTC midnight that still contains `count` steps of `stepMs` on that same day. */
function dayStart(stepMs: number, count: number): number {
  const start = Date.UTC(2026, 5, 2);
  if (utcDay(start) !== utcDay(start + count * stepMs)) throw new Error('fixture crosses UTC midnight');
  return start;
}

function grant(budget: ColonyBudget, colonyId: string, nowMs: number, critical = false): string {
  const result = budget.reserve(colonyId, nowMs, critical);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('expected a reservation');
  expect(result.requestId.length).toBeGreaterThan(0);
  return result.requestId;
}

function takeDailyGrants(budget: ColonyBudget, colonyId: string, start: number, count: number, stepMs: number): void {
  for (let i = 0; i < count; i += 1) {
    grant(budget, colonyId, start + i * stepMs, false);
    budget.release(colonyId);
  }
}

describe('W16-07 one in-flight plan', () => {
  it('rejects a second reserve while one plan is in flight, even after the interval', () => {
    const budget = new ColonyBudget();
    const requestId = grant(budget, 'co-a', 0, false);
    expect(requestId).toEqual(expect.any(String));
    const raced = budget.reserve('co-a', cadence().normalMs + 1, true);
    expect(raced).toEqual({ ok: false, outcome: 'rate_limited' });
  });

  it('rejects an immediate non-critical reserve after release', () => {
    const budget = new ColonyBudget();
    grant(budget, 'co-a', 0, false);
    budget.release('co-a');
    expect(budget.reserve('co-a', 1, false)).toEqual({ ok: false, outcome: 'rate_limited' });
  });

  it('allows a critical reserve after the critical interval and still holds the normal interval', () => {
    const budget = new ColonyBudget();
    const { criticalMs, normalMs } = cadence();
    expect(criticalMs).toBeLessThan(normalMs);
    const at = Date.UTC(2026, 5, 2, 1);
    grant(budget, 'co-a', at, false);
    budget.release('co-a');
    expect(budget.reserve('co-a', at + criticalMs, false)).toEqual({ ok: false, outcome: 'rate_limited' });
    expect(budget.reserve('co-a', at + criticalMs, true).ok).toBe(true);
  });
});

describe('W16-07 daily cap', () => {
  it('rejects the reserve past the daily cap and does not refund it on release', () => {
    const budget = new ColonyBudget();
    const { perDay, normalMs } = cadence();
    const start = dayStart(normalMs, perDay);
    takeDailyGrants(budget, 'co-a', start, perDay, normalMs);
    const at = start + perDay * normalMs;
    expect(utcDay(at)).toBe(utcDay(start));
    expect(budget.reserve('co-a', at, false)).toEqual({ ok: false, outcome: 'rate_limited' });
    budget.release('co-a');
    expect(budget.reserve('co-a', at, true)).toEqual({ ok: false, outcome: 'rate_limited' });
  });

  it('does not let one colony block another', () => {
    const budget = new ColonyBudget();
    const { perDay, normalMs } = cadence();
    const start = dayStart(normalMs, perDay);
    const first = grant(budget, 'co-a', start, false);
    const second = grant(budget, 'co-b', start, false);
    expect(first).not.toBe(second);
    budget.release('co-a');
    takeDailyGrants(budget, 'co-a', start + normalMs, perDay - 1, normalMs);
    const later = start + perDay * normalMs;
    expect(budget.reserve('co-a', later, false)).toEqual({ ok: false, outcome: 'rate_limited' });
    budget.release('co-b');
    expect(budget.reserve('co-b', later, false).ok).toBe(true);
  });
});
