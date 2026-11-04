import type { MarketTokenKey } from '@terra/contracts';

/**
 * Read-only view of the verifier (`intents.near`) balances, for the market module (W13-09/16/19). Amounts are **market atomic units**
 * (resources: whole units, fractions floored; USDC micro; NEAR yocto) as bigint. Bound with `IntentsPort` (same `NEAR_ADAPTER_INTENTS`).
 */
export abstract class IntentsBalanceReadPort {
  /** `token` is a market token key (`bio.water`, `USDC`) or a verifier id (`nep141:usdc.mock`). Unknown token: 0n. */
  abstract verifierBalance(accountId: string, token: string): Promise<bigint>;
  /** Every non-zero balance of the account by market token key. */
  abstract verifierBalances(accountId: string): Promise<Partial<Record<MarketTokenKey, bigint>>>;
}
