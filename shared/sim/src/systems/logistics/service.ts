import type { CompiledRow } from '../../data';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import type { AttackCommand, UnitCtx, UnitCommandDef } from '../../units/types';
import { deliveredServiceBp, FULL_SERVICE_BP } from './state';
import { w01Row } from '../rows';

/**
 * Attack/work cadence factor of an army unit (ECON-LOG-02): `max(minCombatServiceFraction, deliveredServiceRatio)`, in bp.
 * Pure: a later combat system calls it (or `suppliedCombatFactorBp`) and applies the result ONCE to its cadence. Never
 * touches damage or armour rules, HP or debt.
 */
export function combatServiceFactor(deliveredBp: number, minBp: number): number {
  const lo = Math.min(FULL_SERVICE_BP, Math.max(0, minBp));
  return Math.min(FULL_SERVICE_BP, Math.max(lo, Math.max(0, deliveredBp)));
}

/** `combatServiceFactor` for entity `id` of `colony` with the data's `minCombatServiceBp`; 10000 with W13 off. */
export function suppliedCombatFactorBp(state: PlanetState, ctx: Pick<StepContext, 'data' | 'flags'>, colony: number, id: number): number {
  if (!ctx.flags.has('W13')) return FULL_SERVICE_BP;
  const row: CompiledRow = w01Row(ctx.data, 'logistics', 'coefficients');
  return combatServiceFactor(deliveredServiceBp(state, colony, id), Number(row.minCombatServiceBp));
}

/**
 * Wraps the `attack` command so its combat-slot damage steps run at the supplied cadence (the unit's DPS scaled by the
 * factor, applied once here). Approach and retreat are untouched.
 */
export function withSuppliedCadence(def: UnitCommandDef<AttackCommand>): UnitCommandDef<AttackCommand> {
  return {
    ...def,
    work(u: UnitCtx, c: AttackCommand) {
      const bp = suppliedCombatFactorBp(u.state, u.ctx, u.owner, u.id);
      if (bp >= FULL_SERVICE_BP) return def.work!(u, c);
      return def.work!({ ...u, stats: { ...u.stats, dps: (u.stats.dps * bp) / FULL_SERVICE_BP } }, c);
    },
  };
}

/**
 * W09 away-budget hook. W09 is not in this tree: a documented no-op. When it lands it returns the spend cap (whole units per
 * window) of an away colony; `undefined` means "no budget", and an exhausted budget is handled like any supply shortage
 * (the ratio drops, retreat stays possible).
 */
export function awayBudgetCap(_state: PlanetState, _colony: number): number | undefined {
  return undefined;
}
