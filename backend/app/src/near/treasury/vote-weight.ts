import type { PrismaClient } from '@terra/db';
import { resolveDbStakerPerks } from '../staking/staker-perks.js';
import { BASE_VOTE_WEIGHT_BP } from './pass-rule.js';

/**
 * W28-06: the weight of `accountId`'s council vote in bp. Tier 3+ wallets (`daoVoteWeightBp = 15 000`) count `1.5x` in
 * W22 planet DAO proposals; `W28` off, no database or no stake is the base weight. Never touches `@terra/sim`.
 */
export async function voteWeightBp(
  prisma: PrismaClient | undefined,
  env: Record<string, string | undefined>,
  w28: boolean,
  accountId: string,
): Promise<number> {
  if (!w28 || !prisma) return BASE_VOTE_WEIGHT_BP;
  const perks = await resolveDbStakerPerks(prisma, { accountId, env, w28: true });
  return Math.max(BASE_VOTE_WEIGHT_BP, perks.daoVoteWeightBp);
}
