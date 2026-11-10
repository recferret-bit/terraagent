import { defineTable } from './_define';

/**
 * Mercenary NPC roster (W22-02, W22-27, NEAR-112, D-35). PROPOSED DEFAULT, owner-tunable:
 * three accounts `merc-N.npc.terraagent.mock` (N = 1..3; the pattern W22-27 creates).
 * Light squad: 4 × `robot.recon` at 100 `metals.t1` per game-hour.
 * Heavy squad: 6 × `robot.recon` at 200 `metals.t1` per game-hour.
 * Reserve squad: the same size and price as light (a third account; no Tank or Artillery while W17 is postponed).
 * `pricePerGameHour` and `fundingCap` are whole-unit resource maps.
 * `fundingCap` is a proposed default of 10000 `metals.t1` per NPC (LED-33): a ceiling, not a mint.
 * Rows drop out when flag W22 is off.
 */
export default defineTable({
  name: 'mercenary',
  summary: 'Tier-1 mercenary squads: account, robot.recon count, price per game-hour, and funding cap (W22, NEAR-112).',
  amounts: ['pricePerGameHour', 'fundingCap'],
  rows: [
    {
      id: 'light',
      wave: 'W22',
      accountId: 'merc-1.npc.terraagent.mock',
      archetype: 'robot.recon',
      count: 4,
      pricePerGameHour: { 'metals.t1': 100 },
      fundingCap: { 'metals.t1': 10000 },
    },
    {
      id: 'heavy',
      wave: 'W22',
      accountId: 'merc-2.npc.terraagent.mock',
      archetype: 'robot.recon',
      count: 6,
      pricePerGameHour: { 'metals.t1': 200 },
      fundingCap: { 'metals.t1': 10000 },
    },
    {
      id: 'reserve',
      wave: 'W22',
      accountId: 'merc-3.npc.terraagent.mock',
      archetype: 'robot.recon',
      count: 4,
      pricePerGameHour: { 'metals.t1': 100 },
      fundingCap: { 'metals.t1': 10000 },
    },
  ],
});
