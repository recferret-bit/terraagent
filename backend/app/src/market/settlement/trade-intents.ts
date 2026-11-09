import { createHash } from 'node:crypto';
import { marketToken, toChainUnits, type MarketTokenKey } from '@terra/contracts';
import type { Leg } from '@terra/sim/systems/trade/market-batch';
import type { IntentsPort, SignedIntent } from '../../near/application/ports/intents.port.js';

/** Deterministic 32-byte nonce (base64) of one account's intent in one trade: a retry re-signs identically. */
export const tradeNonce = (tradeId: string, accountId: string): string =>
  createHash('sha256').update(`trade-nonce\u0000${tradeId}\u0000${accountId}`).digest('base64');

/** Intent validity after enqueue; a trade that is not relayed within it fails `NEAR_INTENT_EXPIRED` (W13-14 recovery). */
export const TRADE_INTENT_TTL_MS = 60 * 60 * 1000;

/** One signed `token_diff` per account of the batch, in chain base units (resources x 10^18; USDC/NEAR unchanged). */
export async function signTradeLegs(intents: IntentsPort, tradeId: string, legs: readonly Leg[], deadlineMs: number): Promise<SignedIntent[]> {
  const byAccount = new Map<string, Record<string, string>>();
  for (const l of legs) {
    const deltas = byAccount.get(l.accountId) ?? {};
    deltas[marketToken(l.token as MarketTokenKey).verifierId] = toChainUnits(l.token as MarketTokenKey, l.delta).toString();
    byAccount.set(l.accountId, deltas);
  }
  const out: SignedIntent[] = [];
  for (const accountId of [...byAccount.keys()].sort()) {
    out.push(await intents.signTokenDiff({ accountId, deltas: byAccount.get(accountId)!, deadlineMs, nonce: tradeNonce(tradeId, accountId) }));
  }
  return out;
}
