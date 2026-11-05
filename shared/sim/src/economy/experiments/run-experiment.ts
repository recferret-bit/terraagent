import { GateResult as GateResultSchema, type ExperimentManifest, type GateResult } from '@terra/contracts';
import type { CompiledProfile } from '../compile-profile';
import { plannedSeeds } from './seeds';
import { ExperimentInputError } from './errors';
import { evaluateGates, parseGateDefs } from './gates';
import { replayCommand } from './replay';
import { runScenario } from './run-scenario';
import type { ExperimentScenarioDef, RunResult } from './types';

export interface RunRecord {
  readonly run: RunResult;
  readonly gates: GateResult[];
}

export interface FailingSeed {
  readonly scenarioId: string;
  readonly scenarioVersion: number;
  readonly seed: number;
  readonly gateId: string;
  readonly outcome: 'fail' | 'insufficient_data';
  /** The command line that reruns exactly this (scenario, seed). */
  readonly replay: string;
}

export type ExperimentOutcome = 'pass' | 'fail' | 'incomplete';

export interface ExperimentResult {
  /** `incomplete` when the budget stopped the experiment before every (scenario, seed) ran; never a pass. */
  readonly status: 'completed' | 'incomplete';
  readonly outcome: ExperimentOutcome;
  readonly plannedRuns: number;
  readonly runs: RunRecord[];
  readonly failing: FailingSeed[];
}

/** Injected by the caller: the pure core has no clock, so the wall-time budget lives in the CLI. */
export interface RunPorts {
  readonly shouldStop?: () => boolean;
  /** Replay command context (the manifest the CLI was given). */
  readonly replay?: { readonly manifestPath: string; readonly profilePath?: string; readonly outDir: string };
}

/** Looks the manifest's scenario refs up (id and version must both match: never a silent substitute). */
export function resolveScenarios(manifest: ExperimentManifest, available: readonly ExperimentScenarioDef[]): ExperimentScenarioDef[] {
  return manifest.scenarios.map((ref) => {
    const def = available.find((s) => s.manifest.id === ref.id && s.manifest.version === ref.version);
    if (!def) {
      const known = available.map((s) => `${s.manifest.id}@${s.manifest.version}`).join(', ');
      throw new ExperimentInputError('unknown_scenario', `scenario ${ref.id}@${ref.version} is not available (known: ${known})`);
    }
    return def;
  });
}

export interface RunFilter {
  readonly scenarioId?: string;
  readonly seed?: number;
}

/**
 * Runs every (scenario, seed) of `manifest` on `compiled`, evaluates the hard gates and each scenario's economic gates,
 * and lists the failing seeds with their replay commands. Stops early (status `incomplete`) at `budget.maxRuns` or when
 * `ports.shouldStop()` says so. `filter` narrows the plan to one scenario/seed (the replay of a failing seed).
 */
export function runExperiment(
  manifest: ExperimentManifest,
  scenarios: readonly ExperimentScenarioDef[],
  compiled: CompiledProfile,
  ports: RunPorts = {},
  filter: RunFilter = {},
): ExperimentResult {
  const plan = scenarios
    .filter((s) => filter.scenarioId === undefined || s.manifest.id === filter.scenarioId)
    .flatMap((s) => plannedSeeds(manifest).filter((seed) => filter.seed === undefined || seed === filter.seed).map((seed) => ({ s, seed })));
  if (plan.length === 0) throw new ExperimentInputError('empty_plan', 'the scenario/seed filter selects no run of this manifest');
  const runs: RunRecord[] = [];
  const failing: FailingSeed[] = [];
  let stopped = false;
  for (const { s, seed } of plan) {
    if (runs.length >= manifest.budget.maxRuns || ports.shouldStop?.()) { stopped = true; break; }
    const run = runScenario(manifest, s, seed, compiled);
    const gates = evaluateGates(run, parseGateDefs(s.manifest.assumptions.gates));
    // A future-wave mechanic is a counterfactual (labelled in `assumptions.counterfactual`): it can never pass the current gates.
    if (s.manifest.assumptions.counterfactual) {
      gates.push(GateResultSchema.parse({ gateId: 'hard.counterfactual_not_evidence', gateVersion: 1, outcome: 'insufficient_data', observed: null, threshold: 'current-wave', runId: run.runId }));
    }
    runs.push({ run, gates });
    for (const g of gates) {
      if (g.outcome === 'pass') continue;
      const replay = ports.replay ? replayCommand({ ...ports.replay, scenarioId: s.manifest.id, seed }) : '';
      failing.push({ scenarioId: s.manifest.id, scenarioVersion: s.manifest.version, seed, gateId: g.gateId, outcome: g.outcome, replay });
    }
  }
  const outcome: ExperimentOutcome = stopped ? 'incomplete' : failing.length > 0 ? 'fail' : 'pass';
  return { status: stopped ? 'incomplete' : 'completed', outcome, plannedRuns: plan.length, runs, failing };
}
