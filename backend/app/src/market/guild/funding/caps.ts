import { loadPolicy } from '../guild-plan.js';
import { databaseEnabled } from '../../../core/persistence.js';
import type { AppEnv } from '../../../core/tokens.js';

/** W15 on and a database this process is allowed to write. Unit tests without `DATABASE_URL` stay off. */
export function fundingEnabled(flags: { has(wave: string): boolean }, env?: AppEnv): boolean {
  return flags.has('W15') && databaseEnabled(env);
}

/** Whole units. The same number is seeded onto each npc, then added to the global inventory cap once. */
export function inventoryCapOf(has: (wave: string) => boolean): bigint {
  return BigInt(loadPolicy(has).inventoryCapUnits);
}
