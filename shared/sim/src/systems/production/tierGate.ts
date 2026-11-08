import type { ResourceFamily, ResourceKey } from '@terra/contracts';
import { DEPOSIT } from '../../grid/layers';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import type { ColonyState, PlanetState } from '../../kernel/state';
import { creditResource } from '../economy/ledger';
import { colonyWho } from '../find';
import { depositFamilyAndKey } from '../harvest/adjacency';
import { colonyTerraformStats } from '../terraform-basic/rules';
import { getExtractorRingStats, type ExtractorRingStats } from './extractorRing';
import { colonyGateOpen, resolveTierGateSpecs, ringGateOpen, type TierGateRowSpec } from './tierGateSpecs';

/**
 * Resource tier gate (D-34, W05-34), the orchestrator: the gate rows come from `tierGateSpecs.ts`, the cached ring
 * ratios from `extractorRing.ts`; this file decides each extractor's open tier, its yield split, the colony summary,
 * the `tierUnlocked` event and how an extracted slice is credited.
 */
export * from './extractorRing';
export * from './tierGateSpecs';

export interface ExtractorYieldShares {
  t1Share: number;
  t2Share: number;
  t3Share: number;
}

export interface ExtractorTierGateResult {
  enabled: boolean;
  unlockedTier: 1 | 2 | 3;
  colonyTerraformPct: number;
  colonyT2Open: boolean;
  colonyT3Open: boolean;
  ringT2Open: boolean;
  ringT3Open: boolean;
  ring: ExtractorRingStats;
  shares: ExtractorYieldShares;
}

export interface ColonyTierGateView {
  open: boolean;
  minTerraformPct: number;
  ringRadius: number;
  minRingTerraformedRatio: number;
  minRingTerraformedPct: number;
  minRingLivingRatio: number;
  minRingLivingPct: number;
  t1Share: number;
  t2Share: number;
  t3Share: number;
}

export interface ColonyTierGatesSummary {
  enabled: boolean;
  colonyTerraformPct: number;
  tier2: ColonyTierGateView;
  tier3: ColonyTierGateView;
}

const pct1 = (ratio: number): number => Number((ratio * 100).toFixed(1));
const sharesOf = (spec: TierGateRowSpec): ExtractorYieldShares => ({ t1Share: spec.t1Share, t2Share: spec.t2Share, t3Share: spec.t3Share });

function gateView(spec: TierGateRowSpec, open: boolean): ColonyTierGateView {
  return {
    open,
    minTerraformPct: spec.minTerraformPct,
    ringRadius: spec.ringRadius,
    minRingTerraformedRatio: spec.minRingTerraformedRatio,
    minRingTerraformedPct: pct1(spec.minRingTerraformedRatio),
    minRingLivingRatio: spec.minRingLivingRatio,
    minRingLivingPct: pct1(spec.minRingLivingRatio),
    ...sharesOf(spec),
  };
}

/**
 * Computes the colony-level D-34 tier gate summary (`colonyTerraformPct`, `tier2`, `tier3`) exposed on `colony.tierGates`.
 * `terraformPct` lets a caller that already has the colony's Terraform % this step skip the grid scan.
 */
export function computeColonyTierGates(
  state: PlanetState,
  colonyIndex: number,
  data?: CompiledDataLike,
  terraformPct: number = colonyTerraformStats(state, colonyIndex).percent,
): ColonyTierGatesSummary {
  const specs = resolveTierGateSpecs(data);
  return {
    enabled: specs.enabled,
    colonyTerraformPct: terraformPct,
    tier2: gateView(specs.tier2, colonyGateOpen(specs, specs.tier2, terraformPct)),
    tier3: gateView(specs.tier3, colonyGateOpen(specs, specs.tier3, terraformPct)),
  };
}

/**
 * Evaluates the D-34 resource tier gate for a single extractor at `(q, r)` with footprint `(w, d)`:
 * - T2 opens when colony Terraform % `>= tier2Gate.minTerraformPct` (`30`) and ring Irrigated+Living ratio `>= 0.5`.
 * - T3 opens when colony Terraform % `>= tier3Gate.minTerraformPct` (`70`) and ring Living ratio `>= 0.5`.
 * - Each gate reads the ring of its own `ringRadius`; `ring` reports the T2 ring.
 * - Returns `unlockedTier` (`1 | 2 | 3`), `shares` (`70/30` or `50/30/20`), and cached `ring` stats.
 */
export function evaluateExtractorTierGate(
  state: PlanetState,
  colonyIndex: number,
  q: number,
  r: number,
  w = 2,
  d = 2,
  rot = 0,
  data?: CompiledDataLike,
  terraformPct: number = colonyTerraformStats(state, colonyIndex).percent,
): ExtractorTierGateResult {
  const specs = resolveTierGateSpecs(data);
  const ring = getExtractorRingStats(state, q, r, w, d, rot, specs.tier2.ringRadius);
  const ring3 = specs.tier3.ringRadius === specs.tier2.ringRadius ? ring : getExtractorRingStats(state, q, r, w, d, rot, specs.tier3.ringRadius);
  const colonyT2Open = colonyGateOpen(specs, specs.tier2, terraformPct);
  const colonyT3Open = colonyGateOpen(specs, specs.tier3, terraformPct);
  const ringT2Open = ringGateOpen(specs, specs.tier2, ring);
  const ringT3Open = ringGateOpen(specs, specs.tier3, ring3);
  const unlockedTier: 1 | 2 | 3 = colonyT3Open && ringT3Open ? 3 : colonyT2Open && ringT2Open ? 2 : 1;
  const shares = unlockedTier === 3 ? sharesOf(specs.tier3) : unlockedTier === 2 ? sharesOf(specs.tier2) : { t1Share: 1, t2Share: 0, t3Share: 0 };
  return { enabled: specs.enabled, unlockedTier, colonyTerraformPct: terraformPct, colonyT2Open, colonyT3Open, ringT2Open, ringT3Open, ring, shares };
}

/**
 * Emits `tierUnlocked` once per `(colony, extractorEntityId, tier)` when `unlockedTier` reaches `2` or `3` (`W05-34`).
 * "Once" is kept on the colony (`unlockedExtractorTiers`), so it survives snapshots and is the same on every host.
 */
export function emitTierUnlockedIfNeeded(
  state: PlanetState,
  colony: ColonyState,
  owner: number,
  extractorEntityId: number,
  family: ResourceFamily,
  q: number,
  r: number,
  unlockedTier: 1 | 2 | 3,
  ctx?: StepContext,
): void {
  if (unlockedTier < 2) return;
  const persisted = ((colony as { unlockedExtractorTiers?: Record<string, boolean> }).unlockedExtractorTiers ??= {});
  for (const tier of [2, 3] as const) {
    const key = `${extractorEntityId}:${tier}`;
    if (unlockedTier < tier || persisted[key]) continue;
    persisted[key] = true;
    colony.changedAt = ctx?.tick ?? state.meta.tick;
    const { colonyIdStr, who } = colonyWho(state, owner);
    ctx?.emit?.({
      kind: 'tierUnlocked',
      severity: 'info',
      colonyIds: [colonyIdStr],
      data: { ...who, family, tier, extractorEntityId, q, r },
    });
  }
}

/**
 * Credits `got` units extracted from a deposit tile with `depositTier` (`0 = legacy T1`, `1..3`) using the D-34 yield split
 * when `tierGate.unlockedTier >= 2` on a T1 deposit (`DEPOSIT.metals` or `DEPOSIT.minerals`).
 */
export function creditExtractedDepositSlice(
  colony: ColonyState,
  depositKind: number,
  depositTier: number,
  got: number,
  tick: number,
  tierGate?: ExtractorTierGateResult,
  fallbackKey?: ResourceKey,
  out: Map<ResourceKey, number> = new Map(),
): Map<ResourceKey, number> {
  if (got <= 0) return out;
  const credit = (key: ResourceKey, amount: number) => {
    creditResource(colony, key, amount, tick);
    out.set(key, (out.get(key) ?? 0) + amount);
  };
  const isSplittableFamily = depositKind === DEPOSIT.metals || depositKind === DEPOSIT.minerals;
  if (isSplittableFamily && depositTier <= 1 && tierGate && tierGate.unlockedTier >= 2) {
    const { t1Share, t2Share, t3Share } = tierGate.shares;
    for (const [shareTier, share] of [[1, t1Share], [2, t2Share], [3, t3Share]] as const) {
      if (share > 0) credit(depositFamilyAndKey(depositKind, shareTier)!.key, got * share);
    }
    return out;
  }
  const key = fallbackKey && depositKind === DEPOSIT.oil && depositTier !== 3 ? fallbackKey : depositFamilyAndKey(depositKind, depositTier)!.key;
  credit(key, got);
  return out;
}
