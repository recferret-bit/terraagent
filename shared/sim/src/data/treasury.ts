import { defineTable } from './_define';

/**
 * Planet council projects (W22-13 proposed numbers, NEAR-102, D-35).
 * `cost` is cargo-equivalent whole units paid from the DAO. `durationH` is real hours;
 * the server turns that into `untilTick` on `system.treasuryEffect` (the sim has no wall clock).
 * `magnitudeBp` is 7500 for a −75 % hazard rate and 2500 for a −25 % Living-op cost.
 * `visits` is the extra Orbital Guild visit for `guild_subsidy`.
 * The platform-fee share stays on `market.policy.treasuryShareBp` (2 000 bp, NEAR-101).
 * The vote window, pass rule, and hazard clock (`intervalTicks`, `baseStrikeBp`) live in `treasury-policy.ts`.
 * Rows drop out when flag W22 is off.
 */
export default defineTable({
  name: 'treasury',
  summary: 'Planet council project kinds: duration, magnitude and DAO cost (W22, NEAR-102).',
  amounts: ['cost'],
  rows: [
    { id: 'meteor_shield', wave: 'W22', durationH: 6, magnitudeBp: 7500, cost: 1500, visits: 0 },
    { id: 'terraform_boost', wave: 'W22', durationH: 12, magnitudeBp: 2500, cost: 1000, visits: 0 },
    { id: 'guild_subsidy', wave: 'W22', durationH: 0, magnitudeBp: 0, cost: 800, visits: 1 },
  ],
});
