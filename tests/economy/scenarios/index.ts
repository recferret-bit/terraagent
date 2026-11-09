import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseScenarioManifest, type ResourceKey } from '@terra/contracts';
import { creditResource, ensureColonyLedger, type ExperimentScenarioDef } from '@terra/sim';
import { createScenarioPlanet } from '../../scenarios/_loader';
import { loadStressScenarios } from './stress';

/**
 * Experiment scenario fixtures (W13-44): each `*.json` here is a pinned `ScenarioManifest`. Its `assumptions.baseScenario`
 * names the seed scenario (tests/scenarios) that builds the planet; `assumptions.stockGrants` tops colonies' stock up
 * (colony index -> resource -> units) before tick 0 (a fixture, not a flow: the runner measures from the measure window).
 */
const DIR = import.meta.dirname;

type Grants = Record<string, Partial<Record<ResourceKey, number>>>;

export function loadExperimentScenarios(dir: string = DIR): ExperimentScenarioDef[] {
  return [...loadBaseScenarios(dir), ...(dir === DIR ? loadStressScenarios() : [])];
}

function loadBaseScenarios(dir: string): ExperimentScenarioDef[] {
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => {
    const parsed = parseScenarioManifest(JSON.parse(readFileSync(join(dir, f), 'utf8')));
    if (!parsed.ok) throw new Error(`scenario fixture ${f} is invalid: ${parsed.errors.map((e) => `${e.code} ${e.path ?? ''}`).join(', ')}`);
    return fromManifest(parsed.value);
  });
}

export function fromManifest(manifest: ExperimentScenarioDef['manifest']): ExperimentScenarioDef {
  const base = String(manifest.assumptions.baseScenario ?? '');
  const grants = (manifest.assumptions.stockGrants ?? {}) as Grants;
  return {
    manifest,
    createHost({ flags, data }) {
      const { host } = createScenarioPlanet(base, { planetId: 'pl_exp', flags, data });
      for (const [index, amounts] of Object.entries(grants)) {
        const colony = host.state.colonies[Number(index)];
        if (!colony) continue;
        ensureColonyLedger(colony);
        for (const [key, units] of Object.entries(amounts)) creditResource(colony, key as ResourceKey, units, host.tick);
      }
      return host;
    },
  };
}
