import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseScenarioManifest } from '@terra/contracts';
import { createRegionHost, type ExperimentScenarioDef } from '@terra/sim';

/**
 * Region / logistics experiment fixtures (W13-56): each `*.json` here is a `ScenarioManifest` whose `assumptions.region`
 * describes a seeded regional planet with colonies, depots and a logistics load (see `RegionFixtureSpec`). Grids are
 * expanded by {@link variant}, not by more files.
 */
const DIR = import.meta.dirname;

export function regionScenario(manifest: ExperimentScenarioDef['manifest']): ExperimentScenarioDef {
  return { manifest, createHost: (input) => createRegionHost(manifest.assumptions, input) };
}

export function loadRegionScenarios(dir: string = DIR): ExperimentScenarioDef[] {
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => {
    const parsed = parseScenarioManifest(JSON.parse(readFileSync(join(dir, f), 'utf8')));
    if (!parsed.ok) throw new Error(`region fixture ${f} is invalid: ${parsed.errors.map((e) => `${e.code} ${e.path ?? ''}`).join(', ')}`);
    return regionScenario(parsed.value);
  });
}

/** A grid point of `def`: `region` fields patched, id suffixed (`<id>+<suffix>`), version unchanged. */
export function variant(def: ExperimentScenarioDef, suffix: string, region: Record<string, unknown>): ExperimentScenarioDef {
  const base = def.manifest.assumptions.region as Record<string, unknown>;
  return regionScenario({ ...def.manifest, id: `${def.manifest.id}+${suffix}`, assumptions: { ...def.manifest.assumptions, region: { ...base, ...region } } });
}
