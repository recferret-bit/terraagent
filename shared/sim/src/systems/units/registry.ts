import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { attackCommand } from '../../units/commands/attack';
import { dieCommand } from '../../units/commands/die';
import { moveCommand } from '../../units/commands/move';
import { stopCommand } from '../../units/commands/stop';
import { issueUnitCommand as issueWith, stepUnitWork as workWith, stepUnits as stepWith, type IssueOpts } from '../../units/runner';
import { createUnitRegistry, type UnitCommand, type UnitWorkPhase } from '../../units/types';
import { buildCommand, buildProvider } from '../construction/work';
import { terraformCommand, terraformProvider } from '../terraform-basic/work';

/**
 * Every unit command kind and work provider. Add a command: one `defineUnitCommand` file + one entry here.
 * Providers are asked in this order (terraform first: a site must be prepared before it can be built on).
 */
export const UNIT_REGISTRY = createUnitRegistry(
  [moveCommand, stopCommand, dieCommand, attackCommand, buildCommand, terraformCommand],
  [terraformProvider, buildProvider],
);

/**
 * Issues a command to unit `row`: the single entry point for unit input (player command handlers, systems, tests).
 * Returns a reject code or nothing.
 */
export function issueUnitCommand(state: PlanetState, row: number, cmd: UnitCommand, ctx: StepContext, opts?: IssueOpts): string | void {
  return issueWith(UNIT_REGISTRY, state, row, cmd, ctx, opts);
}

/** The `work` of commands acting in `phase` (construction slot 6, combat slot 10). */
export function stepUnitWork(phase: UnitWorkPhase, state: PlanetState, ctx: StepContext): void {
  workWith(UNIT_REGISTRY, phase, state, ctx);
}

/** One step of the units runner with the full registry. */
export function stepUnits(state: PlanetState, ctx: StepContext): void {
  stepWith(UNIT_REGISTRY, state, ctx);
}
