import { defineTable } from './_define';

/**
 * Player-set away budget defaults (AW-20, D-35). Defense and repair are never capped.
 * `policyVersion` is fixed: snapshots store it (AW-21) and a tune must not rewrite history.
 * Percents must match `AWAY_DIRECTIVE_PCT_DEFAULT` / `AWAY_SESSION_PCT_DEFAULT` in `@terra/contracts`.
 */
export default defineTable({
  name: 'away',
  summary: 'Away-budget defaults: percent of stock per automated directive and per away session.',
  fixed: {
    fields: ['policyVersion'],
    why: 'AWAY_POLICY_VERSION is stored in snapshots (AW-21). Tuning it would desync a load.',
  },
  rows: [
    {
      id: 'defaults',
      wave: 'W09',
      perDirectivePct: 40,
      perSessionPct: 60,
      policyVersion: 1,
    },
  ],
});
