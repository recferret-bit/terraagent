import guild from '../../data/guild';
import { registerField } from './fields';
import type { ParamRegistry } from './registry';
import type { ParamUnit } from './types';

const ATOMIC_MAX = '1000000000000000000000000000000';
const NPCS = ['kestrel', 'vanguard'] as const;

/**
 * `guild` data table (`data/guild.ts`): roster, spreads, caps and the kill switch. Registered so a profile version
 * can override them. `policyVersion` and `accountSlot` are fixed. Pair lists stay on the row (not a parameter type).
 */
export function registerGuildParams(r: ParamRegistry): void {
  registerPolicy(r);
  registerNpcs(r);
}

function registerPolicy(r: ParamRegistry): void {
  const row = 'policy';
  const int = (field: string, description: string, unit: ParamUnit, min: number, max: number): void =>
    registerField(r, guild, row, field, { description, unit, type: 'int', bounds: { min, max } });
  registerField(r, guild, row, 'policyVersion', {
    description: 'Identifies the pinned Guild policy. A new version is a new profile.',
    unit: 'enum', type: 'enum', enumValues: ['guild-mock-1'],
  });
  int('cashEnabled', '1 = real NEAR/cash bids may be placed. 0 keeps them disabled (the mock default).', 'count', 0, 1);
  int('killSwitch', '1 cancels Guild quoting. Default 0 (off). Enforcement is W15-12.', 'count', 0, 1);
  int('npcNearFloatCap', 'Per-NPC NEAR float cap, whole NEAR. Stored even while cashEnabled is 0.', 'whole_units', 0, 1_000_000);
  registerField(r, guild, row, 'globalNearFloatCap', {
    description: 'Global NEAR float cap, whole NEAR, shared by every Guild NPC. Stored even while cash is off.',
    unit: 'whole_units', type: 'int', bounds: { min: 0, max: 10_000_000 },
    dependencies: [{ path: 'guild.policy.npcNearFloatCap', relation: 'gte' }],
  });
  int('dockWindowS', 'Seconds a docked Guild ship stays (demo countdown starts at 12:00).', 'seconds', 60, 86_400);
  int('visitGapS', 'Seeded seconds between visits. One number, not a range (LED-32).', 'seconds', 60, 86_400);
  int('scarcityExponentNum', 'Guild quote: numerator of k = num / den. Starts equal to market.agent.', 'count', 0, 32);
  int('scarcityExponentDen', 'Guild quote: denominator of k.', 'count', 1, 8);
  int('epsilonUnits', 'Guild quote: epsilon added to target and inventory.', 'whole_units', 1, 1_000_000);
  registerField(r, guild, row, 'clampLowBp', {
    description: 'Guild quote: lower scarcity clamp, bp of 1.0.',
    unit: 'ratio_bp', type: 'int', bounds: { min: 1, max: 10000 },
    dependencies: [{ path: 'guild.policy.clampHighBp', relation: 'lte' }],
  });
  int('clampHighBp', 'Guild quote: upper scarcity clamp, bp of 1.0.', 'ratio_bp', 10000, 1_000_000);
  int('bidHalfSpreadBp', 'Guild bid = mid * (1 - this). Max legal is 9999 (10000 is rejected).', 'bp', 0, 9999);
  int('askHalfSpreadBp', 'Guild ask = mid * (1 + this). Max legal is 9999.', 'bp', 0, 9999);
  int('minSavingBp', 'Guild bid must stay this far below the walk-away price.', 'bp', 0, 10000);
  int('reserveMarginBp', 'Guild ask markup over own unit cost.', 'bp', 0, 100_000);
  int('maxOrderUnits', 'Largest Guild order, whole base units.', 'whole_units', 1, 1_000_000_000);
  atomic(r, 'maxOrderQuoteAtomic', 'Largest quote amount of one Guild bid (the library size cap).');
  atomic(r, 'perOrderExposureAtomic', 'Per-order exposure ceiling. Stored for W15-12; the quote size cap is maxOrderQuoteAtomic.');
  atomic(r, 'globalExposureAtomic', 'Global open exposure ceiling across Guild NPCs. Stored for W15-12.');
  atomic(r, 'dailyLossAtomic', 'Daily loss ceiling, quote atomic. Stored for W15-12.');
  atomic(r, 'dailySpendAtomic', 'Daily spend ceiling, quote atomic. Stored for W15-12.');
  int('referenceMaxAgeS', 'A reference older than this pauses Guild bids.', 'seconds', 1, 2_592_000);
  int('minReferenceVolume', 'A reference with less eligible volume is thin and pauses Guild bids.', 'whole_units', 0, 1_000_000_000);
  int('minEligibleTrades', 'Organic trades required before a Guild reference counts. Stored; quoteColony uses minReferenceVolume.', 'count', 1, 1000);
  int('inventoryCapUnits', 'Inventory cap per Tier-1 resource per NPC, whole units.', 'whole_units', 0, 1_000_000);
}

function atomic(r: ParamRegistry, field: string, description: string): void {
  registerField(r, guild, 'policy', field, { description, unit: 'atomic', type: 'atomic', bounds: { min: 1, max: ATOMIC_MAX } });
}

function registerNpcs(r: ParamRegistry): void {
  const ints: readonly [string, string, ParamUnit, number, number][] = [
    ['accountSlot', 'Sub-account slot N in guild-N.npc.terraagent.mock.', 'count', 1, 8],
    ['routeLoop', '1 = the route loops the single local planet while W11 is off.', 'count', 0, 1],
    ['targetMetalsT1', 'Target inventory of metals.t1, whole units.', 'whole_units', 0, 1_000_000],
    ['targetMineralsT1', 'Target inventory of minerals.t1, whole units.', 'whole_units', 0, 1_000_000],
    ['targetWater', 'Target inventory of bio.water, whole units.', 'whole_units', 0, 1_000_000],
    ['targetBiomass', 'Target inventory of bio.biomass, whole units.', 'whole_units', 0, 1_000_000],
  ];
  for (const id of NPCS) {
    for (const [field, description, unit, min, max] of ints) {
      registerField(r, guild, id, field, { description, unit, type: 'int', bounds: { min, max } });
    }
  }
}
