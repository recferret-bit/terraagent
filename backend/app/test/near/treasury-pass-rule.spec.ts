import { compileData, dataRow } from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { PASS_ABOVE_BP, PASS_MIN_YES, proposalPasses, tallyVotes } from '../../src/near/treasury/pass-rule';

describe('treasury pass rule', () => {
  it('reads passAboveBp and passMinYes from treasuryPolicy.vote', () => {
    const row = dataRow(compileData(new Set(['W22'])), 'treasuryPolicy', 'vote');
    expect(PASS_ABOVE_BP).toBe(row.passAboveBp);
    expect(PASS_MIN_YES).toBe(row.passMinYes);
    expect(PASS_ABOVE_BP).toBe(5000);
    expect(PASS_MIN_YES).toBe(2);
  });

  it('passes strictly above 50% of members, or with 2 yes and no no', () => {
    expect(proposalPasses({ yes: 2, no: 0, members: 3 })).toBe(true);
    expect(proposalPasses({ yes: 1, no: 0, members: 3 })).toBe(false);
    expect(proposalPasses({ yes: 1, no: 0, members: 2 })).toBe(false);
    expect(proposalPasses({ yes: 2, no: 0, members: 4 })).toBe(true);
    expect(proposalPasses({ yes: 2, no: 0, members: 5 })).toBe(true);
    expect(proposalPasses({ yes: 2, no: 1, members: 5 })).toBe(false);
    expect(proposalPasses({ yes: 3, no: 1, members: 5 })).toBe(true);
    expect(proposalPasses({ yes: 2, no: 0, members: 0 })).toBe(false);
    expect(proposalPasses({ yes: 0, no: 0, members: 3 })).toBe(false);
  });

  it('counts reject and remove as no', () => {
    expect(tallyVotes([
      { voter: 'a.near', vote: 'approve' },
      { voter: 'b.near', vote: 'reject' },
      { voter: 'c.near', vote: 'remove' },
    ])).toEqual({ yes: 1, no: 2 });
  });
});
