import type { QuoteToken, ResourceKey } from '@terra/contracts';
import { ratio, type Ratio } from '../../../economy/flows/ratio';
import { quoteColony, type AgentParams } from '../agent';

export interface DirectorQuoteInput {
  readonly resource: ResourceKey;
  readonly side: 'sell' | 'buy';
  readonly amount: number;
  readonly stock: number;
  readonly target: number;
  /** Board price, quote atomic per whole unit. Null when the board has none. */
  readonly reference: Ratio | null;
  /** Measured unit cost. When null and a reference exists, the reference is the cost input (not a second price). */
  readonly ownUnitCost: Ratio | null;
  readonly platformFeeBp: number;
  readonly maxStallFeeBp: number;
  readonly lotUnits: number;
  readonly minNotionalAtomic: bigint;
}

export interface DirectorPricedOrder {
  readonly price: { readonly token: QuoteToken; readonly amount: string };
  /** Sell: the base resource. Buy: the quote token, fee-inclusive (`maxSpend`). */
  readonly reserveToken: string;
  readonly reserveAmount: string;
}

function costOf(input: DirectorQuoteInput): Ratio | null {
  return input.ownUnitCost ?? input.reference;
}

/**
 * Price one already-decided amount with `quoteColony`. `maxOrderUnits` is raised to that amount so the
 * library prices the authorized lot (the data cap is 100; the demo sell is 300). No second price formula.
 */
export function priceDirectorOrder(input: DirectorQuoteInput, params: AgentParams): DirectorPricedOrder | null {
  const cost = costOf(input);
  if (!cost || input.amount <= 0) return null;
  const buying = input.side === 'buy';
  const sized: AgentParams = { ...params, maxOrderUnits: Math.max(params.maxOrderUnits, input.amount) };
  const quoted = quoteColony(
    {
      resource: input.resource,
      quote: 'USDC',
      need: buying
        ? { planned: BigInt(input.amount), reserve: 0n, available: 0n, expectedOwn: 0n }
        : { planned: 0n, reserve: 0n, available: BigInt(input.stock), expectedOwn: 0n },
      inventory: BigInt(Math.max(0, input.stock)),
      target: BigInt(Math.max(0, input.target)),
      freeUnits: buying ? 0n : BigInt(input.amount),
      keepUnits: 0n,
      reference: input.reference
        ? { price: input.reference, ageS: 1, eligibleVolume: 1_000_000, basis: 'organic' }
        : { price: null, ageS: null, eligibleVolume: null, basis: 'organic' },
      walkAway: { localUnitCost: cost, localMinutesPerUnit: null, minuteValue: null, needValue: null },
      ownUnitCost: cost,
      transportPerUnit: ratio(0n),
      freeQuote: buying ? sized.maxOrderQuoteAtomic : 0n,
      budgetLeft: buying ? sized.maxOrderQuoteAtomic : null,
      platformFeeBp: input.platformFeeBp,
      maxStallFeeBp: input.maxStallFeeBp,
      lotUnits: input.lotUnits,
      minNotionalAtomic: input.minNotionalAtomic,
    },
    sized,
  );
  const side = input.side === 'sell' ? quoted.ask : quoted.bid;
  if (!side || side.amount !== BigInt(input.amount)) return null;
  const reserveAmount =
    input.side === 'sell' ? String(input.amount) : (side.maxSpend > 0n ? side.maxSpend : side.priceAmount).toString();
  const reserveToken = input.side === 'sell' ? input.resource : side.token;
  return { price: { token: side.token, amount: side.priceAmount.toString() }, reserveToken, reserveAmount };
}
