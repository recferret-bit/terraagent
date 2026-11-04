import { checkProfileContent, type EconomyError, type ProfileContent } from '@terra/contracts';
import { RESOURCE_KEYS, type ResourceKey } from '@terra/contracts';
import { totalCapped, totalProduction, type FlowReport } from './accounting';

/**
 * Per-resource coverage of a profile (ECONOMY §2): every ResourceKey has a source, a repeatable consumer, a producer
 * cohort and a buyer cohort. Reuses `checkProfileContent` (the one definition) and keeps only its
 * `missing_resource_coverage` errors.
 */
export function checkResourceCoverage(content: Pick<ProfileContent, 'resourcePolicies' | 'recipes' | 'marketPolicies'>): EconomyError[] {
  return checkProfileContent(content).filter((e) => e.code === 'missing_resource_coverage');
}

export interface ObservedSupply {
  readonly resource: ResourceKey;
  /** Credited production of the window (starter grants and subsidies included only through `bySource`). */
  readonly produced: bigint;
  /** Output lost to the storage cap: reported apart, never added to `produced`. */
  readonly capped: bigint;
  /** Potential output = produced + capped. */
  readonly potential: bigint;
}

/** Actual vs cap-suppressed production per resource at global scope, from a flow report. */
export function observedSupply(report: FlowReport): ObservedSupply[] {
  return RESOURCE_KEYS.map((resource) => {
    const f = report.global[resource];
    const produced = totalProduction(f), capped = totalCapped(f);
    return { resource, produced, capped, potential: produced + capped };
  });
}
