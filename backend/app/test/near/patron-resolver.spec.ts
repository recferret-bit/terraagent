import { describe, expect, it } from 'vitest';
import { PATRON_MIN_YOCTO, resolveLeadPatron, type PatronCandidate } from '../../src/near/staking/perks/patron-resolver';
import { nearToYocto } from '../../src/near/staking/yocto';

const c = (accountId: string, stakeNear: number | string, stakedSinceMs: number | null = 1_000): PatronCandidate => ({
  accountId,
  activeStakedYocto: BigInt(nearToYocto(stakeNear)),
  stakedSinceMs,
});

describe('W28-03 King-of-the-Hill Lead Patron (pure)', () => {
  it('nobody nominating, or nobody at 500 NEAR, leaves the seat empty', () => {
    expect(resolveLeadPatron([], null)).toBeNull();
    expect(resolveLeadPatron([c('a.near', '499.999999')], null)).toBeNull();
    expect(PATRON_MIN_YOCTO).toBe(BigInt(nearToYocto(500)));
  });

  it('exactly 500 NEAR qualifies', () => {
    expect(resolveLeadPatron([c('a.near', 500)], null)?.accountId).toBe('a.near');
  });

  it('550 overtakes the 500 incumbent', () => {
    expect(resolveLeadPatron([c('a.near', 500), c('b.near', 550)], 'a.near')?.accountId).toBe('b.near');
  });

  it('a tie keeps the incumbent regardless of order or stake age', () => {
    const cands = [c('a.near', 600, 1), c('b.near', 600, 99)];
    expect(resolveLeadPatron(cands, 'b.near')?.accountId).toBe('b.near');
    expect(resolveLeadPatron([...cands].reverse(), 'b.near')?.accountId).toBe('b.near');
  });

  it('a tie with no incumbent among the leaders goes to the earliest stake, then the account id', () => {
    expect(resolveLeadPatron([c('a.near', 600, 50), c('b.near', 600, 10)], 'z.near')?.accountId).toBe('b.near');
    expect(resolveLeadPatron([c('b.near', 600, 10), c('a.near', 600, 10)], null)?.accountId).toBe('a.near');
    expect(resolveLeadPatron([c('a.near', 600, null), c('b.near', 600, 10)], null)?.accountId).toBe('b.near');
  });

  it('the incumbent unstaking to 499 loses the seat to a qualifying runner-up, or leaves it empty', () => {
    expect(resolveLeadPatron([c('a.near', 499), c('b.near', 520)], 'a.near')?.accountId).toBe('b.near');
    expect(resolveLeadPatron([c('a.near', 499), c('b.near', 300)], 'a.near')).toBeNull();
  });

  it('the incumbent unstaking below the runner-up (both >= 500) transfers the seat', () => {
    expect(resolveLeadPatron([c('a.near', 510), c('b.near', 520)], 'a.near')?.accountId).toBe('b.near');
    expect(resolveLeadPatron([c('a.near', 520), c('b.near', 520)], 'a.near')?.accountId).toBe('a.near');
  });
});
