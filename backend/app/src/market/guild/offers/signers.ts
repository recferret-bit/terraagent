import { MARKET_TOKENS, toChainUnits, type MarketTokenKey } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import type { AppEnv } from '../../../core/tokens.js';
import { nearAdapterFor } from '../../../near/infrastructure/adapter-selection.js';
import { kekEnv } from '../../../near/identity/colony-accounts.js';
import { loadKekRing } from '../../../near/keystore/kek.js';
import { KeyStore } from '../../../near/keystore/keys.js';
import { ensureCustodialAccount } from '../../dev/market-accounts.bootstrap.js';

function isProdMainnetIntents(env?: AppEnv): boolean {
  if (!env || env.NODE_ENV !== 'production') return false;
  return nearAdapterFor('Intents', env as unknown as Record<string, string | undefined>) === 'mainnet';
}

/** Ensures every participant account has a KEK-sealed custodial signing key in `chain.near_colony_account` (skipped on production Mainnet). */
export async function ensureMockSigners(env: AppEnv, prisma: PrismaClient, accountIds: readonly string[]): Promise<void> {
  if (isProdMainnetIntents(env)) return;
  let keys: KeyStore;
  try {
    keys = new KeyStore(loadKekRing(kekEnv(env)));
  } catch {
    return;
  }
  for (const accountId of accountIds) await ensureCustodialAccount(prisma, keys, accountId);
}

/**
 * Ensures `chain.mock_chain_intents_balance` holds at least `units` (in sim units) for `accountId` and `token`
 * so Guild NPC and live-planet barter trades settle cleanly through the NEP-413 verifier ledger in dev/testnet.
 * Never seeds synthetic balances on production Mainnet.
 */
export async function ensureVerifierBalance(
  prisma: PrismaClient,
  accountId: string,
  token: MarketTokenKey,
  units: bigint,
  env?: AppEnv,
): Promise<void> {
  if (units <= 0n || isProdMainnetIntents(env)) return;
  const required = BigInt(toChainUnits(token, units));
  const tokenId = MARKET_TOKENS[token].verifierId;
  await prisma.mockChainAccount.upsert({
    where: { accountId },
    create: { accountId, kind: 'system' },
    update: {},
  });
  const current = await prisma.mockChainIntentsBalance.findUnique({
    where: { accountId_tokenId: { accountId, tokenId } },
    select: { amount: true },
  });
  const have = current ? BigInt(current.amount.toFixed(0)) : 0n;
  if (have >= required) return;
  await prisma.mockChainIntentsBalance.upsert({
    where: { accountId_tokenId: { accountId, tokenId } },
    create: { accountId, tokenId, amount: required.toString() },
    update: { amount: required.toString() },
  });
}
