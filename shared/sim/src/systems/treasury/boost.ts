import type { ResourceKey } from '@terra/contracts';
import type { CompiledDataLike } from '../../kernel/config';
import type { PlanetState } from '../../kernel/state';
import { isTerraformOpCompiled } from '../terraform-basic/ops';
import { readTreasury } from './blob';

/** Basis points. A full bill is 10_000; `terraform_boost` at 2500 leaves 7500 (the payer pays 75 %). */
const BASIS_POINTS = 10_000;

/** Living ops only (W05). Grade, clear, break, level, fill, reclaim and deep reclaim stay full price. */
const LIVING_OPS: ReadonlySet<string> = new Set(['irrigate', 'seed']);

/**
 * `10000`, or `10000 - magnitudeBp` while `effects.terraform_boost` is active (`tick < untilTick`).
 * Magnitude 0 and a missing or expired effect leave the bill unchanged. The result is never above 10_000
 * and never below 0, so a cost cannot grow or go negative.
 */
export function terraformBoostMultiplierBp(state: PlanetState, tick: number): number {
  const effect = readTreasury(state).effects.terraform_boost;
  if (!effect || !(tick < effect.untilTick)) return BASIS_POINTS;
  const kept = BASIS_POINTS - effect.magnitudeBp;
  if (!Number.isFinite(kept) || kept >= BASIS_POINTS) return BASIS_POINTS;
  return kept > 0 ? Math.floor(kept) : 0;
}

/**
 * Whole-unit bill after the boost. Non-living ops, and living ops that are not in this step's compiled
 * `opsBasic` (W05 off), are returned unchanged. Each positive amount is `floor(amount * multiplier / 10000)`;
 * 0 stays 0. The price is locked by the caller at enqueue — do not scale a stored bill again.
 */
export function discountTerraformCost(
  cost: Partial<Record<ResourceKey, number>>,
  state: PlanetState,
  tick: number,
  op: string,
  data?: CompiledDataLike,
): Partial<Record<ResourceKey, number>> {
  const multiplierBp = livingMultiplierBp(op, state, tick, data);
  if (multiplierBp === null) return cost;
  const out: Partial<Record<ResourceKey, number>> = {};
  for (const [key, amount] of Object.entries(cost) as [ResourceKey, number][]) {
    out[key] = scaleWhole(amount, multiplierBp);
  }
  return out;
}

/** Same floor rule for the job's `totalEnergyE`. The W03 queue entry has no energy field; do not invent one. */
export function discountTerraformEnergy(
  energy: number,
  state: PlanetState,
  tick: number,
  op: string,
  data?: CompiledDataLike,
): number {
  const multiplierBp = livingMultiplierBp(op, state, tick, data);
  return multiplierBp === null ? energy : scaleWhole(energy, multiplierBp);
}

/** `null` when this op is not a compiled Living op or the boost is not taking a cut. */
function livingMultiplierBp(op: string, state: PlanetState, tick: number, data?: CompiledDataLike): number | null {
  if (!LIVING_OPS.has(op) || !isTerraformOpCompiled(op as 'irrigate' | 'seed', data)) return null;
  const multiplierBp = terraformBoostMultiplierBp(state, tick);
  return multiplierBp >= BASIS_POINTS ? null : multiplierBp;
}

function scaleWhole(amount: number, multiplierBp: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const kept = multiplierBp > 0 ? multiplierBp : 0;
  return Math.floor((amount * kept) / BASIS_POINTS);
}
