import type { TreasuryTerms } from '@terra/sim/systems/trade/market-batch';
import { nearAdapterFor } from '../../near/infrastructure/adapter-selection.js';
import { resolveNearNetworkConfig } from '../../near/infrastructure/network/near-network.config.js';

/** Verifier account bootstrapped with a custodial key (`MarketAccountsBootstrap`). Not the planet DAO. */
export const TREASURY_ACCOUNT_ID = 'treasury.terraagent.mock';

export function resolveTreasurySystemAccountId(envSource?: Record<string, string | undefined>): string {
  const bag = (envSource ?? process.env) as Record<string, string | undefined>;
  const adapter = nearAdapterFor('Intents', bag);
  if (adapter === 'mock') return TREASURY_ACCOUNT_ID;
  const net = adapter === 'mainnet' ? 'mainnet' : 'testnet';
  return resolveNearNetworkConfig(bag, net).contracts.dao;
}

/** Outbox-style id of one fill's DAO credit. A second call with the same trade does not deposit again. */
export const treasuryFeeOpId = (tradeId: string): string => `treasury-fee:${tradeId}`;

/**
 * Carve-out terms for one fill. `enabled` is the W22 flag. `shareBp` is the active market policy
 * (`market.policy.treasuryShareBp`), never a copied 2 000. `accountId` is the planet DAO when `get` found one,
 * otherwise the stable `treasury:{planetId}` label stored on the batch.
 */
export function treasuryTerms(
  flags: { has(wave: string): boolean },
  policy: { readonly treasuryShareBp: number },
  accountId: string,
): TreasuryTerms {
  return { enabled: flags.has('W22'), shareBp: policy.treasuryShareBp, accountId };
}

/** Planet DAO account, or `treasury:{planetId}` when none is resolved. The label is not a NEAR account id. */
export function treasuryBatchAccount(planetId: string, daoAccountId: string | null | undefined): string {
  return daoAccountId && daoAccountId.length > 0 ? daoAccountId : `treasury:${planetId}`;
}
