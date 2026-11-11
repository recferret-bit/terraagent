import { defineTable } from './_define';

/**
 * Council vote rules (W22-09 proposed defaults, NEAR-102) and the meteor-shield hazard clock (W22-10).
 * `proposalTtlH` is the real-hour deadline (`TREASURY_PROPOSAL_TTL_H`, default 6).
 * A proposal passes at more than `passAboveBp` of members (5 000 = 50 %, so the check is strict `>`)
 * or with at least `passMinYes` yes votes and zero no votes before the deadline.
 * The fee share is `market.policy.treasuryShareBp`, not a second copy of that number.
 * `hazard.intervalTicks` is already ticks (do not list it under `units`: compileData would convert seconds).
 * `hazard.baseStrikeBp` is the unshielded strike chance out of 10 000. An active shield keeps
 * `(10 000 - magnitudeBp) / 10 000` of that chance. Strikes are counters only (GP-116).
 */
export default defineTable({
  name: 'treasuryPolicy',
  summary: 'Planet council vote rule and meteor-shield hazard clock (W22, NEAR-102).',
  rows: [
    { id: 'vote', wave: 'W22', proposalTtlH: 6, passAboveBp: 5000, passMinYes: 2 },
    { id: 'hazard', wave: 'W22', intervalTicks: 180, baseStrikeBp: 10000 },
  ],
});