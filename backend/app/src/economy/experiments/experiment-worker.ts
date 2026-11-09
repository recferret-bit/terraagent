import { parentPort, workerData } from 'node:worker_threads';
import { parseWaves, type ExperimentManifest, type ProfileContent } from '@terra/contracts';
import { evaluateGates, parseGateDefs, runScenario, tryCompileProfile } from '@terra/sim';
import { loadExperimentScenarios } from '../../../../../tests/economy/scenarios';

/**
 * Experiment run thread (W13-45): runs ONE (scenario, seed) of a pinned manifest in its own `worker_thread`, so the app's
 * sim threads are never blocked or touched. It compiles its own profile from the pinned content and never reads the
 * database or any loaded planet: input in, result out.
 */
export interface RunJob {
  readonly manifest: ExperimentManifest;
  readonly content: ProfileContent;
  readonly scenarioId: string;
  readonly scenarioVersion: number;
  readonly seed: number;
}
export type RunMessage = { readonly ok: true; readonly run: ReturnType<typeof runScenario>; readonly gates: ReturnType<typeof evaluateGates> } | { readonly ok: false; readonly error: string };

function execute(job: RunJob): RunMessage {
  try {
    const compiled = tryCompileProfile(job.content, flagsOf(job.manifest));
    if (!compiled.ok) return { ok: false, error: `invalid profile: ${JSON.stringify(compiled.errors)}` };
    const scenario = loadExperimentScenarios().find((s) => s.manifest.id === job.scenarioId && s.manifest.version === job.scenarioVersion);
    if (!scenario) return { ok: false, error: `unknown scenario ${job.scenarioId}@${job.scenarioVersion}` };
    const manifest = { ...job.manifest, profile: { ...job.manifest.profile, hash: compiled.compiled.overridesHash } };
    const run = runScenario(manifest, scenario, job.seed, compiled.compiled);
    return { ok: true, run, gates: evaluateGates(run, parseGateDefs(scenario.manifest.assumptions.gates)) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const flagsOf = (m: ExperimentManifest): string[] => [...parseWaves(m.waves).list];

if (parentPort) parentPort.postMessage(execute(workerData as RunJob));
