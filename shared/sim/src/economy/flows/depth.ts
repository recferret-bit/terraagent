import { chargeBucketed, feeBucketKey, type FeeBuckets } from '../../systems/trade/market-fees';

/**
 * Depth-aware cost of a market order against the visible book levels (ECONOMY §3, W13-55). Pure, exact (bigint).
 * A level is `amount` whole base units offered at the rational `num / den` (quote atomic per whole base unit), best first
 * as a snapshot lists them; the walk sorts by price anyway (ties keep the given order = time priority of the level).
 *
 * Rounding (documented once, used by the Supply & trade preview):
 *  - Buy notional of the units taken at one level is `ceil(units * num / den)`, an upper bound of settlement (which floors
 *    per maker order), so a preview never promises less than the book can charge.
 *  - Buyer fees follow settlement: one cumulative bucket per fee type (`platform`, `stall`), each `floor(cum * bp / 10000)`
 *    (`chargeBucketed`), driven level by level. The stall bucket assumes one stall rate for the whole walk (levels carry no
 *    maker rate), which can differ slightly from a book whose makers charge different stall rates.
 *  - Sell proceeds at a level are `floor(units * num / den)` (the seller never gets more than the book pays); sellers pay no fee.
 * Levels are only the snapshot's visible depth: `fillable` is what the shown levels cover, not the whole book.
 */
export interface DepthLevel {
  readonly num: bigint;
  readonly den: bigint;
  /** Whole base units available at this level. */
  readonly amount: bigint;
}

/** `full`: the whole quantity is covered. `partial`: some of it. `insufficient_depth`: nothing can be filled (empty or unusable levels). */
export type DepthState = 'full' | 'partial' | 'insufficient_depth';

export interface DepthFill {
  readonly requested: bigint;
  /** Whole units the levels cover (never above `requested`). */
  readonly fillable: bigint;
  /** `requested - fillable`. */
  readonly missing: bigint;
  readonly state: DepthState;
  /** Levels the walk touched. */
  readonly levelsUsed: number;
  /** Cheapest usable level, or null. */
  readonly best: DepthLevel | null;
}

export interface BuyDepthQuote extends DepthFill {
  /** Quote atomic for the fillable units, before fees (ceil per level). */
  readonly notional: bigint;
  readonly platformFee: bigint;
  readonly stallFee: bigint;
  readonly fees: bigint;
  /** `notional + fees`. */
  readonly total: bigint;
}

export interface SellDepthQuote extends DepthFill {
  /** Quote atomic the seller receives for the fillable units (floor per level). */
  readonly proceeds: bigint;
}

export interface BuyFeeTerms {
  readonly platformFeeBp: number;
  readonly stallFeeBp: number;
  /** Quote token name, only part of the fee bucket key. */
  readonly quote?: string;
}

const usable = (l: DepthLevel): boolean => l.num > 0n && l.den > 0n && l.amount > 0n;

/** Cross-multiplied price order: negative when `a` is cheaper than `b`. */
const cmpPrice = (a: DepthLevel, b: DepthLevel): number => {
  const d = a.num * b.den - b.num * a.den;
  return d < 0n ? -1 : d > 0n ? 1 : 0;
};

function sorted(levels: readonly DepthLevel[], dir: 1 | -1): DepthLevel[] {
  return levels.filter(usable).map((l, i) => ({ l, i })).sort((x, y) => dir * cmpPrice(x.l, y.l) || x.i - y.i).map((x) => x.l);
}

const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

function shape(requested: bigint, fillable: bigint, levelsUsed: number, best: DepthLevel | null): DepthFill {
  const want = requested > 0n ? requested : 0n;
  const state: DepthState = want === 0n ? 'full' : fillable === 0n ? 'insufficient_depth' : fillable >= want ? 'full' : 'partial';
  return { requested: want, fillable, missing: want - fillable, state, levelsUsed, best };
}

/** Walks `levels` taking up to `qty` units; calls `take(level, units)` for every level used. */
function walk(levels: readonly DepthLevel[], qty: bigint, take: (l: DepthLevel, units: bigint) => void): { fillable: bigint; used: number } {
  let left = qty > 0n ? qty : 0n;
  let used = 0;
  for (const l of levels) {
    if (left === 0n) break;
    const units = l.amount < left ? l.amount : left;
    take(l, units);
    left -= units;
    used++;
  }
  return { fillable: (qty > 0n ? qty : 0n) - left, used };
}

/** Cost of buying `qty` units from `asks` (any order; the cheapest levels are taken first), with buyer fees. */
export function walkAsks(asks: readonly DepthLevel[], qty: bigint, fees: BuyFeeTerms): BuyDepthQuote {
  const levels = sorted(asks, 1);
  const quote = fees.quote ?? 'USDC';
  const platformKey = feeBucketKey(quote, fees.platformFeeBp, 'platform', 'preview');
  const stallKey = feeBucketKey(quote, fees.stallFeeBp, 'stall', 'preview');
  let buckets: FeeBuckets = {};
  let notional = 0n, platformFee = 0n, stallFee = 0n;
  const { fillable, used } = walk(levels, qty, (l, units) => {
    const n = ceilDiv(units * l.num, l.den);
    notional += n;
    const p = chargeBucketed(buckets, platformKey, n, fees.platformFeeBp);
    const s = chargeBucketed(p.buckets, stallKey, n, fees.stallFeeBp);
    buckets = s.buckets;
    platformFee += p.fee;
    stallFee += s.fee;
  });
  const total = platformFee + stallFee;
  return { ...shape(qty, fillable, used, levels[0] ?? null), notional, platformFee, stallFee, fees: total, total: notional + total };
}

/** Proceeds of selling `qty` units into `bids` (the best-paying levels first). */
export function walkBids(bids: readonly DepthLevel[], qty: bigint): SellDepthQuote {
  const levels = sorted(bids, -1);
  let proceeds = 0n;
  const { fillable, used } = walk(levels, qty, (l, units) => { proceeds += (units * l.num) / l.den; });
  return { ...shape(qty, fillable, used, levels[0] ?? null), proceeds };
}
