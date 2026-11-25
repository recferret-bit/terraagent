import { flagsFromList, newId, parseWaves, PlanetType } from '@terra/contracts';
import { createScenarioPlanet } from '@terra/scenarios';
import {
  createPlanet,
  COMBAT_TEST_FLAGS,
  createCombatTestHost,
  normalizeCombatTestBiome,
  prepareSpectatorScenarioHost,
  seedRivalAiColonies,
  SimHost,
  type LedgerPosting,
  type PlanetState,
} from '@terra/sim';

/** A fresh planet and the ledger postings its setup made (the host's journal starts from them). */
export interface SeededPlanet {
  readonly host: SimHost;
  readonly setupPostings: readonly LedgerPosting[];
}

/**
 * Where a browser host's planet comes from: a scenario (`?host=local`), a bot-only spectator planet, or a planet
 * built in code (the in-process `LocalHost`).
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

/** Zero-player scenario spectator planet (`?spectator=1&scenario=<id>`): adopts scenario colonies (or seeds bots on empty scenarios) under an isolated snapshot key. */
export function spectatorScenarioSource(
  id: string,
  opts: { waves?: readonly string[]; botCount?: number } = {},
): PlanetSource {
  const cleanId = id.trim().toLowerCase();
  const flagsList = opts.waves && opts.waves.length > 0 ? opts.waves : parseWaves(null).list;
  const botCount = Math.max(1, Math.min(6, opts.botCount ?? 2));
  return {
    name: botCount === 2 ? `spectator:scenario:${cleanId}` : `spectator:scenario:${cleanId}:${botCount}`,
    seed: () => {
      const built = createScenarioPlanet(cleanId, { planetId: newId('pl'), flags: flagsList });
      const prepared = prepareSpectatorScenarioHost(built, { botCount, fallbackFlags: flagsList });
      return { host: prepared.host, setupPostings: prepared.setupPostings };
    },
  };
}

/** Zero-player spectator planet (`?spectator=1&host=local`): seeds only Rival AI bots and zero human colonies. */
export function spectatorSource(opts: {
  planetType?: string;
  seed?: string;
  waves?: readonly string[];
  botCount?: number;
} = {}): PlanetSource {
  const aliased =
    opts.planetType === 'oceanForest'
      ? 'ocean'
      : opts.planetType === 'dune'
        ? 'desert'
        : opts.planetType === 'forestRock'
          ? 'temperate'
          : opts.planetType;
  const parsedType = PlanetType.safeParse(aliased);
  const planetType = parsedType.success ? parsedType.data : 'ocean';
  const seedStr = opts.seed && opts.seed.trim() ? opts.seed.trim() : `spec-${planetType}`;
  const botCount = Math.max(1, Math.min(6, opts.botCount ?? 2));
  const flagsList = opts.waves && opts.waves.length > 0 ? opts.waves : parseWaves(null).list;
  return {
    name: botCount === 2 ? `spectator:${planetType}:${seedStr}` : `spectator:${planetType}:${botCount}:${seedStr}`,
    seed: () => {
      const host = new SimHost({
        flags: flagsFromList(flagsList),
        hostRole: 'authority_external_bots',
      });
      const state = createPlanet({
        type: 'temperate',
        planetType,
        seed: seedStr,
        planetId: newId('pl'),
        radius: 36,
        capacity: 8,
      });
      const setupPostings: LedgerPosting[] = [];
      const off = host.onPostings((p) => setupPostings.push(...p));
      try {
        host.load(state);
        const colonyIndices = Array.from({ length: botCount }, (_, idx) => idx);
        seedRivalAiColonies(host.state, {
          count: botCount,
          colonyIndices,
          capacity: 8,
          tick: 0,
          data: host.pipeline.config.data,
          recordPosting: (p) => { setupPostings.push(p); },
        });
      } finally {
        off();
      }
      return { host, setupPostings };
    },
  };
}

/** Combat test sandbox planet (`/dev/combat-test/`): radius 56, 3 biomes, no player HQ/Hub, bots, insects, no PvP shield. */
export function combatTestSource(opts: {
  planetType?: string;
  seed?: string;
  waves?: readonly string[];
  botCount?: number;
} = {}): PlanetSource {
  const biome = normalizeCombatTestBiome(opts.planetType);
  const seedStr = opts.seed && opts.seed.trim() ? opts.seed.trim() : `combat-test-${biome}`;
  const botCount = Math.max(1, Math.min(5, opts.botCount ?? 3));
  const flagsList = opts.waves && opts.waves.length > 0 ? opts.waves : COMBAT_TEST_FLAGS;
  return {
    name: `combatTest:${biome}:${botCount}:${seedStr}`,
    seed: () => {
      const { host, setupPostings } = createCombatTestHost({
        planetType: biome,
        seed: seedStr,
        botCount,
        flags: flagsList,
      });
      return { host, setupPostings };
    },
  };
}

/** A planet made by `make` on a fresh `SimHost` running `flags`; `setup` may step it (e.g. seat a colony), its postings seed the journal. */
export function builtPlanetSource(name: string, flags: readonly string[], make: () => PlanetState, setup?: (host: SimHost) => void): PlanetSource {
  return {
    name,
    seed: () => {
      const host = new SimHost({ flags: flagsFromList(flags), hostRole: 'authority_external_bots' });
      host.load(make());
      const setupPostings: LedgerPosting[] = [];
      const off = host.onPostings((p) => { setupPostings.push(...p); });
      try { setup?.(host); } finally { off(); }
      return { host, setupPostings };
    },
  };
}
