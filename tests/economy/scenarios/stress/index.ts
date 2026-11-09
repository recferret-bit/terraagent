import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseScenarioManifest } from '@terra/contracts';
import type { ExperimentScenarioDef } from '@terra/sim';
import { buildStressHost, type StressSpec } from './build';

/** Stress-suite fixtures (W13-47): every `*.json` here is a versioned `ScenarioManifest` whose `assumptions.stress` is a {@link StressSpec}. */
const DIR = import.meta.dirname;

export function loadStressScenarios(dir: string = DIR): ExperimentScenarioDef[] {
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => {
    const parsed = parseScenarioManifest(JSON.parse(readFileSync(join(dir, f), 'utf8')));
    if (!parsed.ok) throw new Error(`stress fixture ${f} is invalid: ${parsed.errors.map((e) => `${e.code} ${e.path ?? ''}`).join(', ')}`);
    const manifest = parsed.value;
    const spec = manifest.assumptions.stress as StressSpec;
    return { manifest, createHost: (input) => buildStressHost(spec, input) };
  });
}
