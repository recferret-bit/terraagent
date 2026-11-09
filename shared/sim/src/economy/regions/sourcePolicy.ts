import { RESOURCE_KEYS, type ResourceField, type ResourceKey } from '@terra/contracts';
import { DEPOSIT_BP_PER_UNIT, DEPOSIT_MAX_UNITS } from '../../data/terrain';
import { DEPOSIT } from '../../grid/layers';
import { depositFamilyAndKey } from '../../systems/harvest/adjacency';

/**
 * The ONE regional source policy (ECONOMY §2.2 ECON-GEO-01, W13-51): every place that creates or pays a physical resource
 * (world-gen surface deposits, buried deposits, terraform finds, clearing yields, built extractors, renewable water) asks
 * {@link regionalSourcePolicy} for the resolved region's weights, reserves and yield. Pure; reads numbers only.
 */
export const REGIONAL_SOURCE_KINDS = ['surfaceDeposit', 'subsurfaceDeposit', 'terraformFind', 'clearing', 'extractor', 'renewable'] as const;
export type RegionalSourceKind = (typeof REGIONAL_SOURCE_KINDS)[number];

/** The part of a resolved region a source reads (a `ResolvedRegion` or the pinned/active runtime view of one). */
export interface RegionView {
  readonly resources: readonly { readonly resource: ResourceKey; readonly fields: Readonly<Record<ResourceField, number>> }[];
}

export interface SourcePolicy {
  readonly resource: ResourceKey;
  readonly sourceKind: RegionalSourceKind;
  /** Whether this source kind may produce this resource at all in the region (zero weight, zero reserve or zero yield = no). */
  readonly eligible: boolean;
  /** Relative pick weight among eligible deposits (occurrence weight, or find weight for a terraform find); 0 when not eligible. */
  readonly weightBp: number;
  readonly reserveUnitsMin: number;
  readonly reserveUnitsMax: number;
  /** Output per work unit; scales removed reserve and credited units together (never credits more than it removes). */
  readonly extractionYieldBp: number;
  /** Sector-total renewable allowance per sim hour (0 = no renewal). */
  readonly renewableUnitsPerSimHour: number;
}

/** The nine resources a physical deposit can hold, with its `DEPOSIT` code and tier (`bio.water` is renewable, not a deposit). */
export const DEPOSIT_RESOURCES: readonly { readonly key: ResourceKey; readonly deposit: number; readonly tier: 1 | 2 | 3 }[] = (() => {
  const out: { key: ResourceKey; deposit: number; tier: 1 | 2 | 3 }[] = [];
  for (const deposit of [DEPOSIT.metals, DEPOSIT.minerals, DEPOSIT.oil]) {
    for (const tier of [1, 2, 3] as const) out.push({ key: depositFamilyAndKey(deposit, tier)!.key, deposit, tier });
  }
  return out;
})();

const DEPOSIT_INFO = new Map(DEPOSIT_RESOURCES.map((d) => [d.key, d]));
export const isDepositResource = (key: ResourceKey): boolean => DEPOSIT_INFO.has(key);
/** The resource key a deposit of `deposit` code and `tier` holds (tier 0 = legacy 1). */
export const depositResourceKey = (deposit: number, tier: number): ResourceKey | null => depositFamilyAndKey(deposit, tier)?.key ?? null;

const WATER: ResourceKey = 'bio.water';

/** Regional policy of `resourceKey` for one source kind; an unknown key or an absent resource row is not eligible. */
export function regionalSourcePolicy(region: RegionView, resourceKey: ResourceKey, sourceKind: RegionalSourceKind): SourcePolicy {
  const f = region.resources.find((r) => r.resource === resourceKey)?.fields;
  const none: SourcePolicy = { resource: resourceKey, sourceKind, eligible: false, weightBp: 0, reserveUnitsMin: 0, reserveUnitsMax: 0, extractionYieldBp: 0, renewableUnitsPerSimHour: 0 };
  if (!f) return none;
  const base = { resource: resourceKey, sourceKind, reserveUnitsMin: f.reserveUnitsMin, reserveUnitsMax: f.reserveUnitsMax, extractionYieldBp: f.extractionYieldBp, renewableUnitsPerSimHour: f.renewableUnitsPerSimHour };
  const deposit = isDepositResource(resourceKey);
  const tierOne = !DEPOSIT_INFO.has(resourceKey) || DEPOSIT_INFO.get(resourceKey)!.tier === 1;
  let weightBp = 0;
  let eligible: boolean;
  if (sourceKind === 'surfaceDeposit' || sourceKind === 'subsurfaceDeposit') {
    weightBp = deposit && f.reserveUnitsMax > 0 ? f.occurrenceWeightBp : 0;
    eligible = weightBp > 0;
  } else if (sourceKind === 'terraformFind') {
    weightBp = deposit && f.reserveUnitsMax > 0 ? f.terraformFindWeightBp : 0;
    eligible = weightBp > 0;
  } else if (sourceKind === 'extractor') {
    eligible = deposit && f.extractionYieldBp > 0;
  } else if (sourceKind === 'clearing') {
    eligible = f.extractionYieldBp > 0 && (tierOne || f.occurrenceWeightBp > 0);
  } else {
    eligible = resourceKey === WATER && f.renewableUnitsPerSimHour > 0 && f.extractionYieldBp > 0;
  }
  return { ...base, eligible, weightBp: eligible ? weightBp : 0 };
}

export interface DepositRoll {
  readonly key: ResourceKey;
  readonly deposit: number;
  readonly tier: 1 | 2 | 3;
  readonly reserveUnits: number;
  /** Tile `richness` layer value (20 bp per unit, capped at one full deposit of `DEPOSIT_MAX_UNITS`). */
  readonly richnessBp: number;
}

/**
 * Picks the resource (and so the tier) of a NEW deposit by the region's weights among eligible keys, then its finite
 * reserve in `[reserveUnitsMin, reserveUnitsMax]` (clamped to what one tile can hold). `u.pick` / `u.reserve` are uniform
 * draws in `[0, 1)`. An all-zero eligible set returns `null`: no deposit appears, never a uniform fallback. `deposits`
 * restricts the candidates to those deposit codes (a buried vein is metals or minerals, not whatever is rare).
 */
export function rollRegionalDeposit(
  region: RegionView,
  sourceKind: 'surfaceDeposit' | 'subsurfaceDeposit' | 'terraformFind',
  u: { readonly pick: number; readonly reserve: number },
  deposits?: readonly number[],
): DepositRoll | null {
  const cands = DEPOSIT_RESOURCES.filter((d) => !deposits || deposits.includes(d.deposit)).map((d) => ({ d, p: regionalSourcePolicy(region, d.key, sourceKind) })).filter((c) => c.p.weightBp > 0);
  const total = cands.reduce((s, c) => s + c.p.weightBp, 0);
  if (total <= 0) return null;
  let target = Math.min(total - 1, Math.floor(u.pick * total));
  const hit = cands.find((c) => (target < c.p.weightBp ? true : ((target -= c.p.weightBp), false))) ?? cands[cands.length - 1]!;
  const lo = Math.min(hit.p.reserveUnitsMin, hit.p.reserveUnitsMax);
  const reserveUnits = Math.min(DEPOSIT_MAX_UNITS, lo + Math.floor(u.reserve * (hit.p.reserveUnitsMax - lo + 1)));
  return { key: hit.d.key, deposit: hit.d.deposit, tier: hit.d.tier, reserveUnits, richnessBp: reserveUnits * DEPOSIT_BP_PER_UNIT };
}

/** `ResourceKey`s that have a resource row in `region` (all ten when resolved). */
export const regionResourceKeys = (region: RegionView): ResourceKey[] => RESOURCE_KEYS.filter((k) => region.resources.some((r) => r.resource === k));
