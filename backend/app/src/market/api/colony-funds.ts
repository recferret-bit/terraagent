import { MARKET_TOKEN_KEYS, type MarketTokenKey } from '@terra/contracts';
import type { FundsView, OrderFunds } from '../orders/order-funds.js';

/** The colony whose funds are read: its sim colony id and its mock chain account. */
export interface FundsColony { readonly colonyId: string; readonly accountId: string }

/** Funds of one colony in every market token (cargo account, verifier, reservations, free): shared by the snapshot and the trade API balances. */
export async function colonyFunds(funds: OrderFunds, colony: FundsColony): Promise<Record<MarketTokenKey, FundsView>> {
  const views = await Promise.all(MARKET_TOKEN_KEYS.map(async (token) => [token, await funds.view(colony.accountId, token)] as const));
  return Object.fromEntries(views) as Record<MarketTokenKey, FundsView>;
}
