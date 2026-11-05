import {
  createPlanet, DEPOSIT, indexOf, placeMetalsExtractor, resolvePlanetRegion, setTileDeposit, SimHost, startBuildingConstruction,
  type CompiledDataLike, type PlanetState, type ResolvedRegion,
} from '@terra/sim';
import { RegionsContent, type ResourceKey } from '@terra/contracts';
import { seedColony } from '../../../scenarios/w13-markets';

/**
 * Stress-suite planet builder (W13-47). Every number comes from the scenario's `assumptions.stress` block, labelled as an
 * assumption in the fixture; nothing here is a game rule. Colonies are laid out on a grid (spacing `SPACING` tiles), each
 * with a Command Hub, Solar, online Trade Hub, two Supply Depots, an HQ drone and REAL producers: `extractors` Metals
 * Extractors on starter T1 deposits (fixture), so production flows are measured, not zero.
 */
export interface StressSpec {
  readonly colonies: number;
  /** Metals extractors per colony (2x production capacity = double). */
  readonly extractors: number;
  readonly radius: number;
  readonly planetType: 'temperate' | 'desert' | 'ocean';
  /** Starter stock per colony (a fixture credited before tick 0; the measure window starts later). */
  readonly starterStock: Readonly<Partial<Record<ResourceKey, number>>>;
  /** Per-colony stock overrides by colony index (specialisation). */
  readonly stockByColony?: Readonly<Record<string, Partial<Record<ResourceKey, number>>>>;
  /** Resolve the planet's regional endowment (W13-51) with these region contents (`{}` = the planet-type preset). */
  readonly region?: { readonly regions?: unknown };
}

const SPACING = 20;
const COLS = 5;

const origin = (i: number): [number, number] => [(i % COLS) * SPACING - 40, Math.floor(i / COLS) * SPACING - 30];

function seedStressColony(state: PlanetState, i: number, spec: StressSpec): void {
  const [q, r] = origin(i);
  const stock = { ...spec.starterStock, ...(spec.stockByColony?.[String(i)] ?? {}) };
  // the W13 seed colony (Command Hub, Solar, online Trade Hub, two Supply Depots, HQ drone), reused from the seed scenario
  seedColony(state, { index: i, id: `col_${i}`, name: `Colony ${i}`, color: 0xff6b00, origin: [q, r], stock: stock as Record<string, number> });
  startBuild(state, i, 'solar', q + 4, r - 1);
  for (let e = 0; e < spec.extractors; e++) {
    const [eq, er] = [q + 3 - e * 3, r + 3 + (e % 2)];
    setTileDeposit(state.grid, indexOf(state.grid.radius, eq + 1, er + 1), DEPOSIT.metals, 10000, 0, 1);
    const placed = placeMetalsExtractor(state, { owner: i, q: eq, r: er });
    if (!placed.ok) throw new Error(`stress builder: extractor for colony ${i}: ${placed.code} ${placed.detail}`);
  }
}

function startBuild(state: PlanetState, owner: number, building: string, q: number, r: number): void {
  const out = startBuildingConstruction(state, { owner, building, q, r, instant: true, costOverride: {}, tick: 0 });
  if (!out.ok) throw new Error(`stress builder: ${building} at (${q}, ${r}) for colony ${owner}: ${out.code} ${out.detail ?? ''}`);
}

function regionOf(spec: StressSpec, seed: number): ResolvedRegion | undefined {
  if (!spec.region) return undefined;
  const r = resolvePlanetRegion({ regions: RegionsContent.parse(spec.region.regions ?? {}) }, { planetType: spec.planetType, planetId: `pl_stress_${seed}` });
  if (!r.ok) throw new Error(`stress builder: region does not resolve: ${JSON.stringify(r.errors)}`);
  return r.region;
}

/** The seeded stress planet and a host that runs `data` (the compiled profile's tables). Pure and deterministic. */
export function buildStressHost(spec: StressSpec, input: { seed: number; flags: readonly string[]; data: CompiledDataLike }): SimHost {
  const region = regionOf(spec, input.seed);
  const state = createPlanet({
    type: spec.planetType, planetType: spec.planetType, seed: `stress:${input.seed}`, planetId: `pl_stress_${input.seed}`, radius: spec.radius, worldSalt: 'stress-salt',
    ...(region ? { region } : {}),
  });
  for (let i = 0; i < spec.colonies; i++) seedStressColony(state, i, spec);
  const host = new SimHost({ flags: input.flags, data: input.data });
  host.load(state);
  host.step(1);
  return host;
}
