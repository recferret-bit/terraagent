import { RESOURCE_KEYS } from '@terra/contracts';
import market from '../../data/market';
import type { ParamRegistry } from './registry';
import type { ParamUnit } from './types';
import { registerField } from './fields';

const BP = { min: 0, max: 10000 } as const;
const ATOMIC_MAX = '1000000000000000000000000000000'; // 1e30

/**
 * `market` data table (shared/sim/src/data/market.ts): policy fees/limits, per-quote lot/tick/min notional and the
 * per-resource policy of ALL ten ResourceKeys. Fees apply to new orders only (standing orders pin their policy).
 */
export function registerMarketParams(r: ParamRegistry): void {
  const t = market;
  registerField(r, t, 'policy', 'policyVersion', { description: 'Identifies the pinned market policy; a new version is a new profile.', unit: 'enum', type: 'enum', enumValues: ['bootstrap-1'] });
  registerField(r, t, 'policy', 'platformFeeBp', { description: 'Buyer-paid platform fee on notional.', unit: 'bp', type: 'int', bounds: { min: 0, max: 1000 } });
  registerField(r, t, 'policy', 'stallFeeMinBp', { description: 'Lowest Hub stall fee an owner may set.', unit: 'bp', type: 'int', bounds: BP, dependencies: [{ path: 'market.policy.stallFeeMaxBp', relation: 'lte' }] });
  registerField(r, t, 'policy', 'stallFeeMaxBp', { description: 'Highest Hub stall fee an owner may set.', unit: 'bp', type: 'int', bounds: { min: 0, max: 1000 } });
  registerField(r, t, 'policy', 'stallFeeDefaultBp', {
    description: 'Stall fee a new Trade Hub starts with.', unit: 'bp', type: 'int', bounds: { min: 0, max: 1000 },
    dependencies: [{ path: 'market.policy.stallFeeMaxBp', relation: 'lte' }, { path: 'market.policy.stallFeeMinBp', relation: 'gte' }],
  });
  registerField(r, t, 'policy', 'treasuryShareBp', { description: 'Share of the platform fee routed to the W22 treasury (applied only while W22 is on).', unit: 'bp', type: 'int', bounds: BP });
  registerField(r, t, 'policy', 'ttlOptionsS', { description: 'Order time-to-live choices.', unit: 'seconds', type: 'intList', bounds: { min: 60, max: 2592000 }, maxItems: 8 });
  registerField(r, t, 'policy', 'openOrderLimit', { description: 'Open orders per colony.', unit: 'count', type: 'int', bounds: { min: 1, max: 1000 } });
  registerField(r, t, 'policy', 'baseLotUnits', { description: 'Default base lot in whole resource units.', unit: 'whole_units', type: 'int', bounds: { min: 1, max: 1000000 } });
  registerField(r, t, 'policy', 'bookDepthLevels', { description: 'Order-book levels per side in snapshots/pushes.', unit: 'count', type: 'int', bounds: { min: 1, max: 100 } });
  registerField(r, t, 'policy', 'bookPushHz', { description: 'Order-book push rate.', unit: 'hz', type: 'int', bounds: { min: 1, max: 10 } });
  registerField(r, t, 'quote.*', 'minNotionalAtomic', { description: 'Minimum order notional in the quote token market atomic units (USDC micro, NEAR yocto, resources whole units).', unit: 'atomic', type: 'atomic', bounds: { min: 0, max: ATOMIC_MAX } });
  registerField(r, t, 'quote.*', 'tickAtomic', { description: 'Price tick in the quote token market atomic units.', unit: 'atomic', type: 'atomic', bounds: { min: 1, max: '1000000000000' } });
  registerBoard(r);
  registerSupply(r);
  registerDevSeed(r);
  registerAgent(r);
  for (const k of RESOURCE_KEYS) registerResource(r, k);
}

/** Price-board limits (W13-18): decide when finalized trades may establish an organic reference price. */
function registerBoard(r: ParamRegistry): void {
  const row = 'board';
  const int = (f: string, description: string, unit: ParamUnit, min: number, max: number): void =>
    registerField(r, market, row, f, { description, unit, type: 'int', bounds: { min, max } });
  int('windowS', 'Price board: look-back window of 24 h change, volume and VWAP.', 'seconds', 60, 2592000);
  int('candleS', 'Price board: candle size.', 'seconds', 60, 86400);
  int('minEligibleTrades', 'Price board: organic trades needed before a reference price exists.', 'count', 1, 1000);
  int('minEligibleVolume', 'Price board: organic base volume (whole units) needed before a reference price exists.', 'whole_units', 1, 1000000000);
  int('minCounterparties', 'Price board: distinct organic counterparties needed before a reference price exists.', 'count', 2, 1000);
  int('counterpartyWeightCapBp', 'Price board: largest share of organic volume one counterparty may take part in (bp of 2x volume); above it the reference is withheld.', 'ratio_bp', 1, 10000);
  int('maxMoveBp', 'Price board: organic trades further than this from the median organic price are excluded as outliers.', 'ratio_bp', 1, 1000000);
  int('stalenessS', 'Price board: the newest organic trade must be younger than this.', 'seconds', 1, 2592000);
}

/** Badge thresholds of the Supply & trade panel (W13-55). */
function registerSupply(r: ParamRegistry): void {
  registerField(r, market, 'supply', 'abundantWeightBp', { description: 'A resource whose pinned occurrence weight is at least this (bp, 10000 = reference) is badged abundant.', unit: 'ratio_bp', type: 'int', bounds: { min: 1, max: 1000000 }, dependencies: [{ path: 'market.supply.scarceWeightBp', relation: 'gte' }] });
  registerField(r, market, 'supply', 'scarceWeightBp', { description: 'A resource whose pinned occurrence weight is at most this (bp, 10000 = reference) is badged scarce.', unit: 'ratio_bp', type: 'int', bounds: { min: 0, max: 1000000 } });
}

/** Quote agent knobs (`systems/trade/agent/`, ECONOMY section 4): every number of the need/value quote functions. */
function registerAgent(r: ParamRegistry): void {
  const row = 'agent';
  const int = (f: string, description: string, unit: ParamUnit, min: number, max: number): void =>
    registerField(r, market, row, f, { description, unit, type: 'int', bounds: { min, max } });
  int('scarcityExponentNum', 'Agent quote: numerator of the mid-price exponent k = num / den (mid = reference * clamp(scarcity)^k).', 'count', 0, 32);
  int('scarcityExponentDen', 'Agent quote: denominator of the exponent k (an exact integer root is taken).', 'count', 1, 8);
  int('epsilonUnits', 'Agent quote: epsilon added to target and inventory so an empty store is finite.', 'whole_units', 1, 1000000);
  registerField(r, market, row, 'clampLowBp', { description: 'Agent quote: lower clamp of (target + eps) / (inventory + eps), bp of 1.0.', unit: 'ratio_bp', type: 'int', bounds: { min: 1, max: 10000 }, dependencies: [{ path: 'market.agent.clampHighBp', relation: 'lte' }] });
  int('clampHighBp', 'Agent quote: upper clamp of (target + eps) / (inventory + eps), bp of 1.0.', 'ratio_bp', 10000, 1000000);
  int('bidHalfSpreadBp', 'Agent quote: bid = mid * (1 - this).', 'bp', 0, 5000);
  int('askHalfSpreadBp', 'Agent quote: ask = mid * (1 + this).', 'bp', 0, 5000);
  int('minSavingBp', 'Agent bid: a bid must stay this far below the cheapest alternative (own production or need value).', 'bp', 0, 10000);
  int('reserveMarginBp', 'Agent ask: markup over own unit cost that stands for the value of keeping the unit.', 'bp', 0, 100000);
  int('maxOrderUnits', 'Agent: largest order, whole base units.', 'whole_units', 1, 1000000000);
  registerField(r, market, row, 'maxOrderQuoteAtomic', { description: 'Agent: largest quote amount of one bid (budget per order), quote atomic.', unit: 'atomic', type: 'atomic', bounds: { min: 1, max: ATOMIC_MAX } });
  int('referenceMaxAgeS', 'Agent: a reference price older than this pauses bids.', 'seconds', 1, 2592000);
  int('minReferenceVolume', 'Agent: a reference built on less eligible volume (whole units) is thin and pauses bids.', 'whole_units', 0, 1000000000);
}

/** Dev fixture ladder of `market.seed` (never used by the sim or settlement). */
function registerDevSeed(r: ParamRegistry): void {
  const row = 'dev.seed';
  const atomic = { unit: 'atomic', type: 'atomic', bounds: { min: 1, max: ATOMIC_MAX } } as const;
  registerField(r, market, row, 'levels', { description: 'Dev seed: bid and ask orders per side.', unit: 'count', type: 'int', bounds: { min: 1, max: 10 } });
  registerField(r, market, row, 'stepBp', { description: 'Dev seed: price distance between ladder levels.', unit: 'ratio_bp', type: 'int', bounds: { min: 1, max: 5000 } });
  registerField(r, market, row, 'sizeUnits', { description: 'Dev seed: whole base units per order.', unit: 'whole_units', type: 'int', bounds: { min: 1, max: 100000 } });
  registerField(r, market, row, 'ttlS', { description: 'Dev seed: order time-to-live.', unit: 'seconds', type: 'int', bounds: { min: 60, max: 2592000 } });
  registerField(r, market, row, 'midUsdcAtomic', { description: 'Dev seed: mid price in USDC micro per base unit.', ...atomic });
  registerField(r, market, row, 'midNearAtomic', { description: 'Dev seed: mid price in NEAR yocto per base unit.', ...atomic });
  registerField(r, market, row, 'midResourceAtomic', { description: 'Dev seed: mid price in whole quote-resource units per base unit (barter).', ...atomic });
}

function registerResource(r: ParamRegistry, key: string): void {
  const row = `resource.${key}`;
  registerField(r, market, row, 'reserveHorizonS', { description: `${key}: seconds of consumption a colony should keep in reserve.`, unit: 'seconds', type: 'int', bounds: { min: 0, max: 31536000 } });
  registerField(r, market, row, 'targetBandLoBp', {
    description: `${key}: lower edge of the target inventory band (bp of the family storage cap).`, unit: 'ratio_bp', type: 'int', bounds: BP,
    dependencies: [{ path: `market.${row}.targetBandHiBp`, relation: 'lte' }],
  });
  registerField(r, market, row, 'targetBandHiBp', { description: `${key}: upper edge of the target inventory band (bp of the family storage cap).`, unit: 'ratio_bp', type: 'int', bounds: BP });
  registerField(r, market, row, 'lotUnits', { description: `${key}: base lot in whole units.`, unit: 'whole_units', type: 'int', bounds: { min: 1, max: 1000000 } });
  registerField(r, market, row, 'tradable', { description: `${key}: whether the resource can be listed on the market (energy never can).`, unit: 'flag', type: 'bool' });
}
