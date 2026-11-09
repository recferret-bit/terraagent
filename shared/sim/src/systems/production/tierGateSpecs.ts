import { compileData, type CompiledRow } from '../../data';
import type { CompiledDataLike } from '../../kernel/config';

/** One D-34 gate row (`terraform.tier2Gate` / `terraform.tier3Gate`, tunable via W00-59 / D-35). */
export interface TierGateRowSpec {
  tier: 2 | 3;
  minTerraformPct: number;
  ringRadius: number;
  minRingTerraformedRatio: number;
  minRingLivingRatio: number;
  t1Share: number;
  t2Share: number;
  t3Share: number;
}

export interface TierGateSpecs {
  enabled: boolean;
  tier2: TierGateRowSpec;
  tier3: TierGateRowSpec;
}

/** Ring share of Irrigated + Living and of Living tiles that a gate compares against its thresholds. */
export interface RingRatios {
  terraformedRatio: number;
  livingRatio: number;
}

const EPS = 1e-9;

const DEFAULT_TIER2_GATE: TierGateRowSpec = {
  tier: 2, minTerraformPct: 30, ringRadius: 2, minRingTerraformedRatio: 0.5, minRingLivingRatio: 0, t1Share: 0.7, t2Share: 0.3, t3Share: 0,
};

const DEFAULT_TIER3_GATE: TierGateRowSpec = {
  tier: 3, minTerraformPct: 70, ringRadius: 2, minRingTerraformedRatio: 0.5, minRingLivingRatio: 0.5, t1Share: 0.5, t2Share: 0.3, t3Share: 0.2,
};

let cachedDefaultW05Data: CompiledDataLike | null = null;
function defaultW05Data(): CompiledDataLike {
  cachedDefaultW05Data ??= compileData(new Set(['W00', 'W01', 'W02', 'W03', 'W05']));
  return cachedDefaultW05Data;
}

const num = (v: unknown, fallback: number): number => (typeof v === 'number' ? v : fallback);

function parseGateRow(row: CompiledRow | undefined, fallback: TierGateRowSpec): TierGateRowSpec {
  if (!row) return fallback;
  return {
    tier: fallback.tier,
    minTerraformPct: num(row.minTerraformPct, fallback.minTerraformPct),
    ringRadius: typeof row.ringRadius === 'number' ? Math.max(1, Math.round(row.ringRadius)) : fallback.ringRadius,
    minRingTerraformedRatio: num(row.minRingTerraformedRatio, fallback.minRingTerraformedRatio),
    minRingLivingRatio: num(row.minRingLivingRatio, fallback.minRingLivingRatio),
    t1Share: num(row.t1Share, fallback.t1Share),
    t2Share: num(row.t2Share, fallback.t2Share),
    t3Share: num(row.t3Share, fallback.t3Share),
  };
}

/**
 * Resolves the D-34 `tier2Gate` and `tier3Gate` data rows from `data` (tunable via `W00-59` / `D-35`).
 * When `data` is explicitly provided without `tables.terraform.tier2Gate` (e.g. `TA_WAVES=..04`), `enabled` is `false`.
 */
export function resolveTierGateSpecs(data?: CompiledDataLike): TierGateSpecs {
  const tfTable = (data ?? defaultW05Data()).tables?.terraform as Record<string, CompiledRow> | undefined;
  return {
    enabled: data ? Boolean(tfTable?.tier2Gate) : true,
    tier2: parseGateRow(tfTable?.tier2Gate, DEFAULT_TIER2_GATE),
    tier3: parseGateRow(tfTable?.tier3Gate, DEFAULT_TIER3_GATE),
  };
}

/** The colony half of a gate: its Terraform % reaches the row's `minTerraformPct`. */
export function colonyGateOpen(specs: TierGateSpecs, spec: TierGateRowSpec, terraformPct: number): boolean {
  return specs.enabled && terraformPct + EPS >= spec.minTerraformPct;
}

/** The extractor half of a gate: its ring reaches the row's Irrigated + Living and Living ratios. */
export function ringGateOpen(specs: TierGateSpecs, spec: TierGateRowSpec, ring: RingRatios): boolean {
  return specs.enabled && ring.terraformedRatio + EPS >= spec.minRingTerraformedRatio && ring.livingRatio + EPS >= spec.minRingLivingRatio;
}
