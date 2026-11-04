import type { EvalFixture } from './fixtures';

/** Caller-supplied result for one fixture. This module does not call a model. */
export interface EvalOutcome {
  readonly valid: boolean;
  readonly varied: boolean;
  readonly violation: boolean;
}

/** Fixture id to outcome. A plain record, not a live model call. */
export type EvalOutcomes = Readonly<Record<string, EvalOutcome>>;

/** Three scores, never folded into one number. */
export interface EvalReport {
  readonly invariants: { readonly violations: number };
  readonly variation: { readonly pairs: number; readonly varied: number };
  readonly quality: { readonly valid: number; readonly total: number };
}

const ABSENT: EvalOutcome = { valid: false, varied: false, violation: false };

function readOutcome(outcomes: EvalOutcomes, id: string): EvalOutcome {
  return outcomes[id] ?? ABSENT;
}

function countViolations(fixtures: readonly EvalFixture[], outcomes: EvalOutcomes): number {
  let violations = 0;
  for (const fixture of fixtures) {
    if (fixture.invariant === 'none') continue;
    if (readOutcome(outcomes, fixture.id).violation) violations += 1;
  }
  return violations;
}

function countQuality(fixtures: readonly EvalFixture[], outcomes: EvalOutcomes): EvalReport['quality'] {
  let valid = 0;
  for (const fixture of fixtures) {
    if (readOutcome(outcomes, fixture.id).valid) valid += 1;
  }
  return { valid, total: fixtures.length };
}

function pairKey(fixture: EvalFixture): string {
  return `${fixture.biome}\0${fixture.skill}\0${fixture.trigger}`;
}

function hasBothRisks(group: readonly EvalFixture[]): boolean {
  let conservative = false;
  let risky = false;
  for (const fixture of group) {
    if (fixture.risk === 'conservative') conservative = true;
    else if (fixture.risk === 'risky') risky = true;
  }
  return conservative && risky;
}

/** `varied` counts pairs whose every member is marked varied, not fixtures. */
function countVariation(fixtures: readonly EvalFixture[], outcomes: EvalOutcomes): EvalReport['variation'] {
  const groups = new Map<string, EvalFixture[]>();
  for (const fixture of fixtures) {
    const key = pairKey(fixture);
    const group = groups.get(key);
    if (group) group.push(fixture);
    else groups.set(key, [fixture]);
  }
  let pairs = 0;
  let varied = 0;
  for (const group of groups.values()) {
    if (!hasBothRisks(group)) continue;
    pairs += 1;
    if (group.every((fixture) => readOutcome(outcomes, fixture.id).varied)) varied += 1;
  }
  return { pairs, varied };
}

export function scoreEval(fixtures: readonly EvalFixture[], outcomes: EvalOutcomes): EvalReport {
  return {
    invariants: { violations: countViolations(fixtures, outcomes) },
    variation: countVariation(fixtures, outcomes),
    quality: countQuality(fixtures, outcomes),
  };
}
