import { formatAtomic, mockLabel, parseDisplayAmount, type MarketPolicyView, type MarketTokenKey, type OrderSide, type ResourceKey } from '@terra/contracts';
import { maxBuyerFees, maxBuyerSpend } from '@terra/sim/systems/trade/market-fees';

export interface PreviewInput {
  readonly side: OrderSide;
  readonly base: ResourceKey;
  readonly quote: MarketTokenKey;
  readonly amountText: string;
  readonly priceText: string;
  readonly maxStallFeeBp: number;
  readonly policy: MarketPolicyView | undefined;
  readonly balances: Readonly<Partial<Record<MarketTokenKey, string>>> | undefined;
}

export interface OrderPreview {
  /** Parsed, valid order terms; absent while the amount or price text is not valid yet. */
  readonly terms?: { amount: number; priceAtomic: bigint };
  /** Buyer-side numbers (quote atomic); zero for sells, where the seller pays no fee. */
  readonly platformFee: bigint;
  readonly stallFee: bigint;
  /** Buy: `maxBuyerSpend` (the exact quote reserved). Sell: the base units given up. */
  readonly totalMax: bigint;
  readonly spendToken: MarketTokenKey;
  /** Why Submit is disabled; absent when the order can be sent. */
  readonly blocked?: string;
}

const NO_FEE = { platformFee: 0n, stallFee: 0n } as const;

function parseTerms(i: PreviewInput): { terms?: { amount: number; priceAtomic: bigint }; error?: string } {
  if (!/^[1-9]\d{0,9}$/.test(i.amountText.trim())) return { error: 'Enter a whole amount of at least 1.' };
  const amount = Number(i.amountText.trim());
  if (amount > 1_000_000_000) return { error: 'Amount is too large.' };
  let priceAtomic: bigint;
  try { priceAtomic = parseDisplayAmount(i.quote, i.priceText); } catch { return { error: `Enter the total price in ${mockLabel(i.quote)}.` }; }
  if (priceAtomic <= 0n) return { error: 'Total price must be above zero.' };
  return { terms: { amount, priceAtomic } };
}

/**
 * Preview of an order form (W13-21): the same pure functions the server reserves with (`maxBuyerSpend`, `maxBuyerFees`), so the
 * "total maximum spend" shown is exactly what the host holds. A buy is charged in the quote token (principal + max fees); a sell
 * gives up base units. Rejects the form before sending when the free balance does not cover it.
 */
export function previewOrder(i: PreviewInput): OrderPreview {
  const spendToken = i.side === 'buy' ? i.quote : i.base;
  const empty = { ...NO_FEE, totalMax: 0n, spendToken };
  const { terms, error } = parseTerms(i);
  if (!i.policy) return { ...empty, ...(terms ? { terms } : {}), blocked: 'Market policy not loaded yet.' };
  if (!terms) return { ...empty, blocked: error ?? 'Invalid order.' };
  const p = i.policy;
  if (!i.balances) return { ...empty, terms, blocked: 'Balances unavailable: no colony account on this planet yet.' };
  const have = BigInt(i.balances[spendToken] ?? '0');
  const withTerms = { terms };
  if (i.side === 'sell') {
    const need = BigInt(terms.amount);
    const min = BigInt(p.minNotional[i.quote] ?? '0');
    const blocked = terms.priceAtomic < min ? minText(i.quote, min) : have < need ? shortText(spendToken, need, have) : undefined;
    return { ...withTerms, ...NO_FEE, totalMax: need, spendToken, ...(blocked ? { blocked } : {}) };
  }
  const platformFee = maxBuyerFees(terms.priceAtomic, p.platformFeeBp, 0);
  const stallFee = maxBuyerFees(terms.priceAtomic, 0, i.maxStallFeeBp);
  const totalMax = maxBuyerSpend(terms.priceAtomic, p.platformFeeBp, i.maxStallFeeBp);
  const min = BigInt(p.minNotional[i.quote] ?? '0');
  let blocked: string | undefined;
  if (i.maxStallFeeBp < 0 || i.maxStallFeeBp > p.stallFeeMaxBp) blocked = `Max stall fee must be 0 to ${p.stallFeeMaxBp} bp.`;
  else if (terms.priceAtomic < min) blocked = minText(i.quote, min);
  else if (have < totalMax) blocked = shortText(spendToken, totalMax, have);
  return { ...withTerms, platformFee, stallFee, totalMax, spendToken, ...(blocked ? { blocked } : {}) };
}

const minText = (q: MarketTokenKey, min: bigint): string => `Total price is below the minimum of ${formatAtomic(q, min)} ${mockLabel(q)}.`;
const shortText = (t: MarketTokenKey, need: bigint, have: bigint): string =>
  `Insufficient ${mockLabel(t)}: need ${formatAtomic(t, need)}, free ${formatAtomic(t, have)}.`;
