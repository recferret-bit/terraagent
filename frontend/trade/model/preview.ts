import { formatAtomic, mockLabel, type MarketPolicyView, type MarketTokenKey, type OrderSide, type ResourceKey } from '@terra/contracts';
import { maxBuyerSpend } from '@terra/sim/systems/trade/market-fees';
import { fmtAmount, parseUnits, tryParse } from './units';

export interface TicketInput {
  readonly side: OrderSide;
  readonly base: ResourceKey;
  readonly quote: MarketTokenKey;
  readonly amountText: string;
  /** TOTAL quote price of the whole order (contract rule), display units. */
  readonly totalText: string;
  readonly stallBp: number;
  readonly policy: MarketPolicyView | null;
  readonly freeQuote: bigint | null;
  readonly freeUnits: bigint | null;
  readonly hasColony: boolean;
  readonly busy: boolean;
}

export interface TicketPreview {
  readonly amount: number | null;
  readonly total: bigint | null;
  readonly platformFee: bigint;
  readonly stallFee: bigint;
  /** Buy: exact quote reserved (`maxBuyerSpend`). Sell: base units given up. */
  readonly maxSpend: bigint;
  /** Sell: the quote the seller receives (fees are paid by the buyer). */
  readonly youReceive: bigint | null;
  readonly blocked: string | null;
}

const NONE = { platformFee: 0n, stallFee: 0n, maxSpend: 0n, youReceive: null } as const;

/** Exact reason the Place button is disabled, with the numbers the host would hold (same `maxBuyerSpend` the server reserves with). */
export function previewTicket(i: TicketInput): TicketPreview {
  const amount = parseUnits(i.amountText);
  const total = tryParse(i.quote, i.totalText);
  const base = { amount, total, ...NONE };
  if (!i.hasColony) return { ...base, blocked: 'No colony of yours on this planet: join it from the game first.' };
  if (!i.policy) return { ...base, blocked: 'Market policy is not loaded yet.' };
  if (amount === null) return { ...base, blocked: 'Enter a whole amount from 1 to 1,000,000,000.' };
  if (total === null) return { ...base, blocked: `Enter the TOTAL price for the whole amount in ${mockLabel(i.quote)} (above zero).` };
  const min = BigInt(i.policy.minNotional[i.quote] ?? '0');
  const minMsg = total < min ? `Below the minimum notional ${fmtAmount(i.quote, min)}.` : null;
  const busy = i.busy ? 'Sending the order...' : null;
  if (i.side === 'sell') {
    const give = BigInt(amount);
    const short = i.freeUnits === null ? 'Balances unavailable.'
      : i.freeUnits < give ? `Not enough free ${i.base} in orbit: need ${give}, free ${i.freeUnits}. Export surface stock via the Trade Hub.` : null;
    return { amount, total, platformFee: 0n, stallFee: 0n, maxSpend: give, youReceive: total, blocked: minMsg ?? short ?? busy };
  }
  const bp = i.policy.platformFeeBp;
  const platformFee = (total * BigInt(bp)) / 10_000n;
  const stallFee = (total * BigInt(i.stallBp)) / 10_000n;
  const maxSpend = maxBuyerSpend(total, bp, i.stallBp);
  const short = i.freeQuote === null ? 'Balances unavailable.'
    : i.freeQuote < maxSpend ? `Not enough free ${mockLabel(i.quote)}: need ${formatAtomic(i.quote, maxSpend)}, free ${formatAtomic(i.quote, i.freeQuote)}.` : null;
  return { amount, total, platformFee, stallFee, maxSpend, youReceive: null, blocked: minMsg ?? short ?? busy };
}
