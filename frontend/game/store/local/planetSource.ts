import { flagsFromList, newId } from '@terra/contracts';
import { createScenarioPlanet } from '@terra/scenarios';
import { SimHost, type LedgerPosting, type PlanetState } from '@terra/sim';

/** A fresh planet and the ledger postings its setup made (the host's journal starts from them). */
export interface SeededPlanet {
  readonly host: SimHost;
  readonly setupPostings: readonly LedgerPosting[];
}

/**
 * Where a browser host's planet comes from: a scenario (`?host=local`) or a planet built in code (the in-process
 * `LocalHost`: the dev fallback's seated dev planet, test planets). `seed()` builds a fresh one each call (first boot,
 * `local.reset`, a restore after a failed step with no snapshot). `name` keys the snapshot (`terra-local:<name>`) and
 * names the planet in `welcome` (`local <name>`).
 */
export interface PlanetSource {
  readonly name: string;
  seed(): SeededPlanet;
}

/** The scenario `id` (`w00`), running `flags` intersected with the scenario's waves. */
export const scenarioSource = (id: string, flags: readonly string[]): PlanetSource => ({
  name: id,
  seed: () => createScenarioPlanet(id, { planetId: newId('pl'), flags }),
});

/** A planet made by `make` on a fresh `SimHost` running `flags`; `setup` may step it (e.g. seat a colony), its postings seed the journal. */
export function builtPlanetSource(name: string, flags: readonly string[], make: () => PlanetState, setup?: (host: SimHost) => void): PlanetSource {
  return {
    name,
    seed: () => {
      const host = new SimHost({ flags: flagsFromList(flags) });
      host.load(make());
      const setupPostings: LedgerPosting[] = [];
      const off = host.onPostings((p) => { setupPostings.push(...p); });
      try { setup?.(host); } finally { off(); }
      return { host, setupPostings };
    },
  };
}
