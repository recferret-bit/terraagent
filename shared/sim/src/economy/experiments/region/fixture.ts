import type { ResourceKey } from '@terra/contracts';
import type { CompiledDataLike } from '../../../kernel/config';
import { createPlanet } from '../../../gen/createPlanet';
import { SimHost } from '../../../host/SimHost';
import { placeSpawnedEntity } from '../../../ecs/placement';
import { insertRow } from '../../../ecs/store';
import { ENTITY_KIND, ENTITY_STATE } from '../../../ecs/columns';
import { applyEnvironmentState, environmentFromPlanetTime } from '../../../systems/environment';
import { setPlanetTime } from '../../../systems/time';
import { creditResource, ensureColonyLedger } from '../../../systems/economy/ledger';
import type { PlanetState } from '../../../kernel/state';
import { canonical } from '../../../data/_hash';
import { sha256Hex } from '../../sha256';
import { resolvePlanetRegion } from '../../regions/planetRegion';
import { defaultParamRegistry } from '../../params';
import { logisticsCoefficients } from '../../logistics';
import { parseRegionSpec, type RegionFixtureSpec } from './spec';

const WORLD_SALT = 'region-experiment';
const hashOf = (v: unknown): string => `sha256:${sha256Hex(canonical(v))}`;

/** The §9 pins of a fixture: bindings, endowment and runtime hashes of the planet region and the logistics policy hash. */
export function regionHashesOf(spec: RegionFixtureSpec, planetId = 'pl_region'): { regionBindingsHash: string; endowmentHash: string; runtimeEconomyHash: string; logisticsPolicyHash: string } {
  const res = resolvePlanetRegion({ regions: spec.regions }, { planetType: spec.planetType, planetId });
  if (!res.ok) throw new Error(`region fixture does not resolve: ${res.errors.map((e) => e.code).join(', ')}`);
  return {
    regionBindingsHash: hashOf(spec.regions), endowmentHash: res.region.endowmentHash, runtimeEconomyHash: res.region.runtimeHash,
    logisticsPolicyHash: hashOf(logisticsCoefficients(defaultParamRegistry())),
  };
}

function put(state: PlanetState, owner: number, kind: number, q: number, r: number, w: number, hp: number, st: number): void {
  const cols = state.entities.cols;
  const row = insertRow(state.entities, state.meta.nextEntityId++, 0);
  cols.kind[row] = kind; cols.owner[row] = owner; cols.tier[row] = 1; placeSpawnedEntity(state.entities, row, q, r, 0);
  cols.footprintW[row] = w; cols.footprintD[row] = w; cols.shedGroup[row] = 4; cols.hp[row] = hp; cols.hpMax[row] = hp; cols.state[row] = st;
}

/** Tiles 3..5 from a Hub at (0, ho): inside its power zone and clear of its footprint, in a fixed order. */
function hubZoneTiles(ho: number): [number, number][] {
  const out: [number, number][] = [];
  for (let q = -5; q <= 5; q++) for (let r = -5; r <= 5; r++) {
    const d = Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r));
    if (d >= 3 && d <= 5 && !(r === 0 && q > 0)) out.push([q, ho + r]);
  }
  return out;
}

/** Colony `i` of the fixture: Hub, depots, solar plant and its logistics load, all on the seeded regional planet. */
function placeColony(state: PlanetState, spec: RegionFixtureSpec, i: number): void {
  state.colonies[i] = { index: i, id: `col_${i}`, name: `Colony ${i}`, color: 0xff6b00, status: 'active', harvestWeights: { metals: 0, minerals: 0, bio: 0 }, changedAt: 0 };
  const col = ensureColonyLedger(state.colonies[i]!);
  for (const [k, v] of Object.entries(spec.stock)) creditResource(col, k as ResourceKey, v, 0);
  const ho = i * 12; // hubs on the r axis, clear of each other
  put(state, i, ENTITY_KIND.commandHub, 0, ho, 3, 1500, ENTITY_STATE.active);
  const solars = 3 + spec.extractors + spec.units; // enough generation that the load, not a brownout, is what the experiment measures
  for (const [q, r] of hubZoneTiles(ho).slice(0, solars)) put(state, i, ENTITY_KIND.solar, q, r, 2, 400, ENTITY_STATE.active);
  for (let d = 0; d < spec.depots; d++) put(state, i, ENTITY_KIND.supplyDepot, -4 - d * 3, ho, 2, 600, ENTITY_STATE.active);
  if (spec.routeTiles <= 5) {
    // Load inside the Hub's power zone (no relay chain): taken from the far end of the zone tiles, clear of the solar plant.
    for (const [q, r] of hubZoneTiles(ho).reverse().slice(0, spec.extractors)) put(state, i, ENTITY_KIND.metalsExtractor, q, r, 2, 300, ENTITY_STATE.active);
  } else {
    // Power Pylons chain the grid out to a remote load, so only its logistics route is under test.
    for (let q = 5; q < spec.routeTiles + 5; q += 5) put(state, i, ENTITY_KIND.pylon, q, ho, 1, 200, ENTITY_STATE.active);
    for (let p = 0; p < 1 + Math.floor(spec.extractors / 3); p++) put(state, i, ENTITY_KIND.pylon, spec.routeTiles + (p % 8), ho + 1 - Math.floor(p / 8), 1, 200, ENTITY_STATE.active);
    for (let e = 0; e < spec.extractors; e++) put(state, i, ENTITY_KIND.metalsExtractor, spec.routeTiles + (e % 5), ho + 3 + Math.floor(e / 5), 2, 300, ENTITY_STATE.active);
  }
  for (let u = 0; u < spec.units; u++) put(state, i, ENTITY_KIND.worker, 2, ho + 4 + u, 1, 100, ENTITY_STATE.idle);
}

/**
 * Builds the host of a region experiment scenario: the planet is generated from the RESOLVED region of `assumptions.region`
 * (`resolvePlanetRegion` -> `createPlanet({ region })`), so an endowment candidate really regenerates terrain, then the
 * colonies, Hub, depots and logistics load are placed. Pure and deterministic for (spec, seed).
 */
export function createRegionHost(assumptions: Readonly<Record<string, unknown>>, input: { seed: number; flags: readonly string[]; data: CompiledDataLike }): SimHost {
  const spec = parseRegionSpec(assumptions);
  if (!spec) throw new Error('scenario has no assumptions.region');
  const res = resolvePlanetRegion({ regions: spec.regions }, { planetType: spec.planetType, planetId: 'pl_region' });
  if (!res.ok) throw new Error(`region fixture does not resolve: ${res.errors.map((e) => e.code).join(', ')}`);
  const radius = Math.max(30, spec.routeTiles + 12 * spec.colonies + 10);
  const state = createPlanet({ type: spec.planetType, planetType: spec.planetType, seed: `region-${input.seed}`, id: 'pl_region', radius, worldSalt: WORLD_SALT, region: res.region });
  // Frozen solar noon: generation is constant, so the experiment measures logistics, not the day/night cycle.
  setPlanetTime(state, { timeOfDay: 12, timeScale: 0 }, 0, input.data);
  applyEnvironmentState(state, environmentFromPlanetTime(state, input.data, false, 0), 0);
  for (let i = 0; i < spec.colonies; i++) placeColony(state, spec, i);
  const host = new SimHost({ flags: new Set(input.flags), data: input.data });
  host.load(state);
  return host;
}
