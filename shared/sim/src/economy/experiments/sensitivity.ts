import type { ExperimentManifest } from '@terra/contracts';

/** Default range of the unknown-demand assumption: half, assumed, and double the per-actor budget (basis points of the assumed value). */
export const DEFAULT_DEMAND_FACTORS_BP: readonly number[] = [5_000, 10_000, 20_000];

export interface SensitivityManifest { readonly label: string; readonly factorBp: number; readonly manifest: ExperimentManifest }

/**
 * Derived manifests for the demand sensitivity re-runs (ECONOMY §6: unknown demand is an assumption, never a fact): each one
 * is the given manifest with `demandModel.perPayingActorMonthlyBudgetUsdcAtomic` scaled by `factorBp / 10000` (exact
 * integer arithmetic, rounded down). Submit one per factor for the baseline and for the candidate, then pass the pairs to
 * `compareExperiments` as `sensitivity`. Pure.
 */
export function sensitivityManifests(manifest: ExperimentManifest, factorsBp: readonly number[] = DEFAULT_DEMAND_FACTORS_BP): SensitivityManifest[] {
  const budget = BigInt(manifest.demandModel.perPayingActorMonthlyBudgetUsdcAtomic);
  return factorsBp.map((factorBp) => ({
    label: `demand-${factorBp}bp`, factorBp,
    manifest: { ...manifest, demandModel: { ...manifest.demandModel, source: 'assumed-sensitivity', perPayingActorMonthlyBudgetUsdcAtomic: ((budget * BigInt(factorBp)) / 10_000n).toString() } },
  }));
}
