/**
 * Bounty and mercenary funnel names. The server inserts each row.
 * This feature lists them and does not call `track()` (one writer per name, BE-89).
 */
export const BOUNTY_EVENTS = ['bounty_posted', 'bounty_claimed', 'bounty_paid', 'mercenary_hired'] as const;
