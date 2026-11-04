import { RESOURCE_KEYS } from '@terra/contracts';
import market from '../../data/market';
import type { ParamRegistry } from './registry';
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
  registerDevSeed(r);
  for (const k of RESOURCE_KEYS) registerResource(r, k);
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
