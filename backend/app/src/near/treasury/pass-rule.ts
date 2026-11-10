import { compileData, dataRow } from '@terra/sim';

const voteRow = dataRow(compileData(new Set(['W22'])), 'treasuryPolicy', 'vote');

/** Basis points from `treasuryPolicy.vote`. 5 000 means a strict `>` 50 % of members. */
export const PASS_ABOVE_BP = requireCount(voteRow.passAboveBp, 'passAboveBp');
/** Second clause: at least this many yes votes and zero no votes. */
export const PASS_MIN_YES = requireCount(voteRow.passMinYes, 'passMinYes');

function requireCount(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`treasuryPolicy.vote.${field} must be a non-negative integer`);
  }
  return value;
}

export type DaoVoteValue = 'approve' | 'reject' | 'remove';

export interface StoredVote {
  readonly voter: string;
  readonly vote: DaoVoteValue;
}

export interface VoteTally {
  readonly yes: number;
  readonly no: number;
  readonly members: number;
}

/** `approve` is yes. `reject` and `remove` both count as no (Sputnik `VoteRemove`). */
export function tallyVotes(votes: readonly StoredVote[]): { yes: number; no: number } {
  let yes = 0;
  let no = 0;
  for (const vote of votes) {
    if (vote.vote === 'approve') yes += 1;
    else no += 1;
  }
  return { yes, no };
}

/**
 * Passes when `yes / members` is strictly above `passAboveBp`, or when `yes >= passMinYes` and `no === 0`.
 * The ratio uses integer basis points (`yes * 10000 > passAboveBp * members`), so 50 % exactly does not pass.
 */
export function proposalPasses(tally: VoteTally, aboveBp = PASS_ABOVE_BP, minYes = PASS_MIN_YES): boolean {
  if (tally.members <= 0 || tally.yes <= 0) return false;
  if (BigInt(tally.yes) * 10_000n > BigInt(aboveBp) * BigInt(tally.members)) return true;
  return tally.yes >= minYes && tally.no === 0;
}
