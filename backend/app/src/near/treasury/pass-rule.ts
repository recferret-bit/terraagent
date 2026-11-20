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

/** One vote counts `10 000` bp. W28-06: a Tier 3+ wallet's vote is stored with `15 000` (`1.5x`). */
export const BASE_VOTE_WEIGHT_BP = 10_000;

export interface StoredVote {
  readonly voter: string;
  readonly vote: DaoVoteValue;
  /** Absent = `BASE_VOTE_WEIGHT_BP` (every vote cast before W28 or by a lower tier). */
  readonly weightBp?: number;
}

export interface VoteTally {
  readonly yes: number;
  readonly no: number;
  readonly members: number;
  /** Sum of the yes weights in bp (`yes * 10 000` when nobody has extra weight). Absent = unweighted. */
  readonly yesWeightBp?: number;
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
 * Yes/no among `memberIds` only. A voter who has left the council is ignored.
 * `members` is the full council size, including members who did not vote.
 */
export function tallyMemberVotes(votes: readonly StoredVote[], memberIds: readonly string[]): VoteTally {
  const allowed = new Set(memberIds);
  const counted = votes.filter((vote) => allowed.has(vote.voter));
  const tally = tallyVotes(counted);
  const yesWeightBp = counted.reduce((sum, v) => (v.vote === 'approve' ? sum + (v.weightBp ?? BASE_VOTE_WEIGHT_BP) : sum), 0);
  return { yes: tally.yes, no: tally.no, members: memberIds.length, yesWeightBp };
}

/**
 * Passes when `yes / members` is strictly above `passAboveBp`, or when `yes >= passMinYes` and `no === 0`.
 * The ratio uses integer basis points (`yesWeightBp > passAboveBp * members`, which is `yes * 10000 > ...` at the base
 * weight), so 50 % exactly does not pass. The second clause counts heads, not weight.
 */
export function proposalPasses(tally: VoteTally, aboveBp = PASS_ABOVE_BP, minYes = PASS_MIN_YES): boolean {
  if (tally.members <= 0 || tally.yes <= 0) return false;
  const yesBp = BigInt(tally.yesWeightBp ?? tally.yes * BASE_VOTE_WEIGHT_BP);
  if (yesBp > BigInt(aboveBp) * BigInt(tally.members)) return true;
  return tally.yes >= minYes && tally.no === 0;
}
