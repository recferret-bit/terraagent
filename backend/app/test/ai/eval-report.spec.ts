import { describe, expect, it } from 'vitest';
import { buildFixtures, type EvalFixture } from '../../src/ai/eval/fixtures';
import { scoreEval, type EvalOutcome } from '../../src/ai/eval/report';

const QUIET: EvalOutcome = { valid: false, varied: false, violation: false };

function blank(fixtures: readonly EvalFixture[]): Record<string, EvalOutcome> {
  return Object.fromEntries(fixtures.map((fixture) => [fixture.id, { ...QUIET }]));
}

function groups(fixtures: readonly EvalFixture[]): Map<string, EvalFixture[]> {
  const grouped = new Map<string, EvalFixture[]>();
  for (const fixture of fixtures) {
    const key = `${fixture.biome}|${fixture.skill}|${fixture.trigger}`;
    const group = grouped.get(key);
    if (group) group.push(fixture);
    else grouped.set(key, [fixture]);
  }
  return grouped;
}

describe('W16-22 director eval report', () => {
  it('builds at least 60 fixtures and pairs both risks', () => {
    const fixtures = buildFixtures();
    const again = buildFixtures();
    expect(fixtures.length).toBeGreaterThanOrEqual(60);
    expect(fixtures.map((fixture) => fixture.id)).toEqual(again.map((fixture) => fixture.id));
    expect(fixtures[0]?.id).toBe('fx-0');
    expect(fixtures.at(-1)?.id).toBe(`fx-${fixtures.length - 1}`);
    const paired = groups(fixtures);
    expect(paired.size).toBeGreaterThanOrEqual(1);
    for (const group of paired.values()) {
      expect(group.some((fixture) => fixture.risk === 'conservative')).toBe(true);
      expect(group.some((fixture) => fixture.risk === 'risky')).toBe(true);
    }
  });

  it('counts an invariant violation without changing quality.valid', () => {
    const fixtures = buildFixtures();
    const table = blank(fixtures);
    const held = fixtures.find((fixture) => fixture.invariant !== 'none');
    const open = fixtures.find((fixture) => fixture.invariant === 'none');
    if (!held || !open) throw new Error('expected both invariant kinds');
    const before = scoreEval(fixtures, table);
    table[held.id] = { valid: false, varied: false, violation: true };
    const violated = scoreEval(fixtures, table);
    expect(violated.invariants.violations).toBe(before.invariants.violations + 1);
    expect(violated.quality.valid).toBe(before.quality.valid);
    table[held.id] = { valid: true, varied: false, violation: true };
    const stillViolated = scoreEval(fixtures, table);
    expect(stillViolated.invariants.violations).toBe(violated.invariants.violations);
    expect(stillViolated.quality.valid).toBe(1);
    table[open.id] = { valid: false, varied: false, violation: true };
    const ignored = scoreEval(fixtures, table);
    expect(ignored.invariants.violations).toBe(stillViolated.invariants.violations);
    expect(ignored.quality.valid).toBe(stillViolated.quality.valid);
  });

  it('counts a pair as varied only when both risks vary, and quality only when valid', () => {
    const fixtures = buildFixtures();
    const table = blank(fixtures);
    const group = [...groups(fixtures).values()][0];
    if (!group) throw new Error('expected a pair');
    const conservative = group.find((fixture) => fixture.risk === 'conservative');
    const risky = group.find((fixture) => fixture.risk === 'risky');
    if (!conservative || !risky) throw new Error('expected both risks');
    const base = scoreEval(fixtures, table);
    expect(base.variation.varied).toBe(0);
    expect(base.variation.pairs).toBeGreaterThanOrEqual(1);
    table[conservative.id] = { valid: true, varied: true, violation: false };
    expect(scoreEval(fixtures, table).variation.varied).toBe(0);
    expect(scoreEval(fixtures, table).quality.valid).toBe(1);
    table[risky.id] = { valid: false, varied: true, violation: false };
    const varied = scoreEval(fixtures, table);
    expect(varied.variation.varied).toBe(base.variation.varied + 1);
    expect(varied.variation.pairs).toBe(base.variation.pairs);
    expect(varied.quality.valid).toBe(1);
    expect(varied.quality.total).toBe(fixtures.length);
    expect(varied.invariants.violations).toBe(0);
  });
});
