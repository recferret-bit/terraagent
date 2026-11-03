import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { attackCommand } from '../../units/commands/attack';
import { dieCommand } from '../../units/commands/die';
import { moveCommand } from '../../units/commands/move';
import { stopCommand } from '../../units/commands/stop';
import { issueUnitCommand as issueWith, stepUnitWork as workWith, stepUnits as stepWith, type IssueOpts } from '../../units/runner';
import { createUnitRegistry, type UnitCommand, type UnitWorkPhase, type UnitWorkProvider } from '../../units/types';
import { buildCommand, buildProvider } from '../construction/work';
import { linkedPrepProvider, terraformCommand, terraformProvider } from '../terraform-basic/work';
import { hasActiveWorkJobForWorker } from '../terraform-basic/workJobs';

/**
 * A worker that carries out a work job (`blobs.workJobs`: a `work` order, a terraform chain) is driven by the work-jobs
 * system until the job (and its chain) ends; no provider hands it other work meanwhile, so the chain is not hijacked.
 */
const unlessOnWorkJob = (p: UnitWorkProvider): UnitWorkProvider => ({
  id: p.id,
  propose: (u) => (hasActiveWorkJobForWorker(u.state, u.id) ? null : p.propose(u)),
});

/**
 * Every unit command kind and work provider. Add a command: one `defineUnitCommand` file + one entry here.
 * Providers are asked in this order (GP-04): a Hub's linked site prep (a site is prepared before it is built on), then
 * construction, then the player's manual terraform orders.
 */
export const UNIT_REGISTRY = createUnitRegistry(
  [moveCommand, stopCommand, dieCommand, attackCommand, buildCommand, terraformCommand],
  [linkedPrepProvider, buildProvider, terraformProvider].map(unlessOnWorkJob),
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
