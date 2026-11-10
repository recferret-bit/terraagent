/**
 * Continuity numbers (CONTINUITY §8, ARCHITECTURE §15). Wall-clock values stay here so the
 * server and the contracts share one default. Player-set percents are also rows in `data/away.ts`
 * (D-35) and must match `AWAY_*_PCT_DEFAULT`.
 */
export const AWAY_AFTER_S = 60;
export const COARSE_DT = 5;
export const COARSE_STEP_MS = 1_000;
export const SNAPSHOT_EVERY_S = 60;
export const RESTART_FASTRUN_MAX_H = 24;
export const DIGEST_LIST_CAP = 20;
export const DIGEST_RETENTION_DAYS = 7;
export const UNDER_ATTACK_DEBOUNCE_S = 10 * 60;
export const AWAY_STORY_MAX_CHARS = 600;
/** Stored in snapshots (AW-21). Bump when `awayPolicy` decisions change. */
export const AWAY_POLICY_VERSION = 1;
/** AW-20 defaults: per automated directive, and per away session. Defense and repair are uncapped. */
export const AWAY_DIRECTIVE_PCT_DEFAULT = 40;
export const AWAY_SESSION_PCT_DEFAULT = 60;
