import { ACHIEVEMENT_FAMILY_BY_ID, marketToken, type MarketTokenKey, type ProgressEventV1 } from '@terra/contracts';

/** What the producer needs of a sim `tradeSettled` / `feeEarned` event (both carry the colony and the trade id). */
export interface MarketProgressSource {
  readonly planetId: string;
  readonly tick?: number;
  readonly colonyId: string;
  readonly playerId: string;
  readonly tradeId: string;
}

/**
 * One Port Authority "fee unit" is one whole display unit of the token the stall fee was paid in (1 USDC, 1 NEAR, 1
 * resource unit = `10^decimals` atoms), counted per realized fee and **rounded up**: every FINAL trade whose stall fee
 * is above zero earns at least 1 unit, so small-fee trades still progress; a zero fee earns 0. Exact atoms stay in
 * `chain.intent_trade`; this number only feeds the achievement counter (W13-27).
 */
export function feeUnitsOf(token: MarketTokenKey, atoms: string): number {
  const amount = BigInt(atoms);
  if (amount <= 0n) return 0;
  const unit = 10n ** BigInt(marketToken(token).decimals);
  return Number((amount + unit - 1n) / unit);
}

const base = (s: MarketProgressSource, kind: string, family: 'merchant' | 'port-authority', value: number): ProgressEventV1 => ({
  eventId: `market:${kind}:${s.tradeId}:${s.colonyId}`,
  playerId: s.playerId,
  colonyId: s.colonyId,
  planetId: s.planetId,
  family,
  metric: ACHIEVEMENT_FAMILY_BY_ID.get(family)!.metric,
  value,
  atTick: s.tick ?? 0,
});

/** Merchant: +1 per FINAL trade for every participating colony's player (buyer and seller roles). */
export const merchantEvent = (s: MarketProgressSource): ProgressEventV1 => base(s, 'merchant', 'merchant', 1);

/** Port Authority: the stall owner's realized fee in {@link feeUnitsOf} units; null when the fee rounds to nothing. */
export function portAuthorityEvent(s: MarketProgressSource, token: MarketTokenKey, atoms: string): ProgressEventV1 | null {
  const units = feeUnitsOf(token, atoms);
  return units > 0 ? base(s, 'portAuthority', 'port-authority', units) : null;
}
