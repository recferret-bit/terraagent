import type { PrismaClient } from '@terra/db';
import type { AppEnv } from '../../../core/tokens.js';
import { kekEnv } from '../../../near/identity/colony-accounts.js';
import { loadKekRing } from '../../../near/keystore/kek.js';
import { KeyStore } from '../../../near/keystore/keys.js';
import { ensureCustodialAccount } from '../../dev/market-accounts.bootstrap.js';

/** Mock settlement signs with a custodial key. Production keeps whatever key provisioning already stored. */
export async function ensureMockSigners(env: AppEnv, prisma: PrismaClient, accountIds: readonly string[]): Promise<void> {
  if (env.NODE_ENV === 'production') return;
  const keys = new KeyStore(loadKekRing(kekEnv(env)));
  for (const accountId of accountIds) await ensureCustodialAccount(prisma, keys, accountId);
}
