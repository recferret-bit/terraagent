import {
  createPlanet, creditResource, DEPOSIT, ensureColonyLedger, ENTITY_KIND, ENTITY_STATE, indexOf, insertRow, placeMetalsExtractor, placeSpawnedEntity, PREP,
  resolvePlanetRegion, revealVision, setTilePrep, setTileDeposit, SimHost, startBuildingConstruction, TERRAIN,
  type CompiledDataLike, type PlanetState, type ResolvedRegion,
} from '@terra/sim';
import { RegionsContent, type ResourceKey } from '@terra/contracts';

/**
 * Stress-suite planet builder (W13-47). Every number comes from the scenario's `assumptions.stress` block, labelled as an
 * assumption in the fixture; nothing here is a game rule. Colonies are laid out on a grid (spacing `SPACING` tiles), each
 * with a Command Hub, Solar, online Trade Hub, two Supply Depots, an HQ drone and REAL producers: `extractors` Metals
 * Extractors on starter T1 deposits (fixture) plus one Water Extractor, so production flows are measured, not zero.
 */
export interface StressSpec {
  readonly colonies: number;
  /** Metals extractors per colony (2x production capacity = double). */
  readonly extractors: number;
  readonly radius: number;
  readonly planetType: 'temperate' | 'desert' | 'ocean';
  /** Starter grants per colony (labelled `landing.cargo`, a starter grant: never counted as production or subsidy). */
  readonly starterStock: Readonly<Partial<Record<ResourceKey, number>>>;
  /** Per-colony stock overrides by colony index (specialisation). */
  readonly stockByColony?: Readonly<Record<string, Partial<Record<ResourceKey, number>>>>;
  /** Resolve the planet's regional endowment (W13-51) with these region contents (`{}` = the planet-type preset). */
  readonly region?: { readonly regions?: unknown };
}

const SPACING = 20;
const COLS = 5;

const origin = (i: number): [number, number] => [(i % COLS) * SPACING - 40, Math.floor(i / COLS) * SPACING - 30];

function flat(state: PlanetState, [cq, cr]: readonly [number, number], radius: number): void {
  const L = state.grid.layers;
  for (let r = cr - radius; r <= cr + radius; r++) {
    for (let q = cq - radius; q <= cq + radius; q++) {
      const idx = indexOf(state.grid.radius, q, r);
      if (idx < 0) continue;
      L.terrain[idx] = TERRAIN.flat;
      L.height[idx] = 0.08;
      setTileDeposit(state.grid, idx, DEPOSIT.none, 0, 0);
      setTilePrep(state, idx, PREP.prepared, 0);
    }
  }
}

function build(state: PlanetState, owner: number, building: string, q: number, r: number): void {
  const out = startBuildingConstruction(state, { owner, building, q, r, instant: true, costOverride: {}, tick: 0 });
  if (!out.ok) throw new Error(`stress builder: ${building} at (${q}, ${r}) for colony ${owner}: ${out.code} ${out.detail ?? ''}`);
}

function spawnHq(state: PlanetState, owner: number, q: number, r: number): void {
  const row = insertRow(state.entities, state.meta.nextEntityId++, 0);
  const c = state.entities.cols;
  c.kind[row] = ENTITY_KIND.hq; c.owner[row] = owner; c.tier[row] = 1;
  placeSpawnedEntity(state.entities, row, q, r, 0);
  c.hp[row] = 800; c.hpMax[row] = 800; c.cell[row] = 200; c.cellMax[row] = 200; c.workRate[row] = 1.5; c.state[row] = ENTITY_STATE.idle;
}

function seedColony(state: PlanetState, i: number, spec: StressSpec): void {
  const colony = ensureColonyLedger(
    { index: i, id: `col_${i}`, name: `Colony ${i}`, color: 0xff6b00, status: 'active', stage: 2, tradeHubAtS2: true, neighborContact: true, contactFake: false, guildVisit: false, changedAt: 0 },
    { depotCount: 2 },
  );
  state.colonies[i] = colony;
  const [q, r] = origin(i);
  flat(state, [q, r], 5);
  build(state, i, 'commandHub', q, r);
  build(state, i, 'solar', q - 3, r + 2);
  build(state, i, 'solar', q + 4, r - 1);
  build(state, i, 'tradeHub', q + 2, r + 1);
  build(state, i, 'supplyDepot', q - 4, r - 2);
  build(state, i, 'supplyDepot', q + 2, r - 4);
  spawnHq(state, i, q, r + 3);
  revealVision(state, i, q, r, 10, 0);
  for (let e = 0; e < spec.extractors; e++) {
    const [eq, er] = [q + 3 - e * 3, r + 3 + (e % 2)];
    setTileDeposit(state.grid, indexOf(state.grid.radius, eq + 1, er + 1), DEPOSIT.metals, 10000, 0, 1);
    const placed = placeMetalsExtractor(state, { owner: i, q: eq, r: er });
    if (!placed.ok) throw new Error(`stress builder: extractor for colony ${i}: ${placed.code} ${placed.detail}`);
  }
  const stock = { ...spec.starterStock, ...(spec.stockByColony?.[String(i)] ?? {}) };
  for (const [key, amount] of Object.entries(stock)) creditResource(colony, key as ResourceKey, amount, 0, { reason: 'landing.cargo' });
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
  for (let i = 0; i < spec.colonies; i++) seedColony(state, i, spec);
  const host = new SimHost({ flags: input.flags, data: input.data });
  host.load(state);
  host.step(1);
  return host;
}
