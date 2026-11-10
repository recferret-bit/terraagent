import { defineTable } from './_define';

/**
 * Council vote rules (W22-09 proposed defaults, NEAR-102).
 * `proposalTtlH` is the real-hour deadline (`TREASURY_PROPOSAL_TTL_H`, default 6).
 * A proposal passes at more than `passAboveBp` of members (5 000 = 50 %, so the check is strict `>`)
 * or with at least `passMinYes` yes votes and zero no votes before the deadline.
 * The fee share is `market.policy.treasuryShareBp`, not a second copy of that number.
 */
export default defineTable({
  name: 'treasuryPolicy',
  summary: 'Planet council proposal deadline and pass rule (W22, NEAR-102).',
  rows: [
    { id: 'vote', wave: 'W22', proposalTtlH: 6, passAboveBp: 5000, passMinYes: 2 },
  ],
});