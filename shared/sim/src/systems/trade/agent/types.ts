import type { QuoteToken, ResourceKey } from '@terra/contracts';
import type { Ratio } from '../../../economy/flows/ratio';
import type { AgentParams } from './params';

/**
 * Why an agent side (bid or ask) is not quoted. A reason is always returned instead of a fabricated price: no reference,
 * unmeasured cost, zero denominators and exhausted limits all pause the side.
 */
export type AgentReason =
  | 'no_reference' // no reference price exists
  | 'stale_reference' // older than `referenceMaxAgeS`
  | 'thin_reference' // built on less than `minReferenceVolume` eligible units
  | 'zero_denominator' // inventory + epsilon is not positive (or a zero denominator in an input)
  | 'no_walkaway_value' // nothing says what a bought unit saves: no production cost, no need value
  | 'no_unit_cost' // own unit cost unmeasured, so no ask floor
  | 'transport_unknown' // transport cost per unit unmeasured (pass zero when it is known to be free)
  | 'no_need' // nothing to buy
  | 'no_surplus' // nothing to sell above the keep level
  | 'no_cash' // free quote or session budget is zero
  | 'below_walkaway' // after fees and transport the walk-away price leaves no valid price
  | 'size_zero' // per-order size, lot, cash or stock leaves zero units
  | 'below_min_notional'; // the order would be under the minimum notional

/** `subsidy` marks a manually funded bootstrap price (bounded, labelled, excluded from organic-price validation). */
export type ReferenceBasis = 'organic' | 'bootstrap_subsidy';

export interface ReferenceInput {
  /** Quote atomic per whole base unit (exact), or null when the board has none. */
  readonly price: Ratio | null;
  /** Seconds since the newest eligible trade (or since the bootstrap price was set); null when unknown. */
  readonly ageS: number | null;
  /** Eligible (organic) base volume behind the price; null when unknown. Bootstrap prices pass `null` and skip the thin check. */
  readonly eligibleVolume: number | null;
  readonly basis: ReferenceBasis;
}

/** What buying saves: the cheapest alternative to a purchase, all in quote atomic per unit. Null members are unknown. */
export interface WalkAwayInputs {
  /** `unitCost` metric of local production. */
  readonly localUnitCost: Ratio | null;
  /** `recipeMinutesPerUnit` of local production, valued with `minuteValue`. */
  readonly localMinutesPerUnit: Ratio | null;
  /** Quote atomic per production minute (what an idle builder or extractor minute is worth). */
  readonly minuteValue: Ratio | null;
  /** What a missing unit is worth when nothing can substitute it (an idle job): the last resort. */
  readonly needValue: Ratio | null;
}

export interface AgentColonyInput {
  readonly resource: ResourceKey;
  readonly quote: QuoteToken;
  /** `potentialBuy` inputs (whole units). */
  readonly need: { readonly planned: bigint; readonly reserve: bigint; readonly available: bigint; readonly expectedOwn: bigint };
  /** Units counted as inventory for the scarcity ratio, and the target inventory (e.g. the middle of the target band). */
  readonly inventory: bigint;
  readonly target: bigint;
  /** Free units a sell may offer (stock/orbit minus open-order reservations) and the units to keep. */
  readonly freeUnits: bigint;
  readonly keepUnits: bigint;
  readonly reference: ReferenceInput;
  readonly walkAway: WalkAwayInputs;
  /** Own unit cost (quote atomic per unit); null when unmeasured. */
  readonly ownUnitCost: Ratio | null;
  /** Transport cost per unit (quote atomic); null when unmeasured. */
  readonly transportPerUnit: Ratio | null;
  /** Free quote (balance minus reservations) and the remaining session/daily budget; null budget is unlimited. */
  readonly freeQuote: bigint;
  readonly budgetLeft: bigint | null;
  readonly platformFeeBp: number;
  /** Highest stall fee the bid accepts (reserved with the order). */
  readonly maxStallFeeBp: number;
  readonly lotUnits: number;
  /** Minimum notional of the quote token, atomic. */
  readonly minNotionalAtomic: bigint;
}

export interface SideQuote {
  readonly side: 'buy' | 'sell';
  readonly token: QuoteToken;
  /** Whole base units. */
  readonly amount: bigint;
  /** TOTAL quote atomic for `amount` (the `market.placeOrder` price). Bids are rounded down, asks up. */
  readonly priceAmount: bigint;
  /** Quote the colony must hold for a bid (principal + maximum fees + transport); 0 for asks. */
  readonly maxSpend: bigint;
}

export interface AgentQuotes {
  readonly basis: ReferenceBasis | null;
  /** Mid price, quote atomic per unit (exact rational); null when no mid exists. */
  readonly mid: Ratio | null;
  readonly bid: SideQuote | null;
  readonly ask: SideQuote | null;
  /** Why a side is null (empty when quoted). */
  readonly bidReasons: readonly AgentReason[];
  readonly askReasons: readonly AgentReason[];
}

export type { AgentParams };
