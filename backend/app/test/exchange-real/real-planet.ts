import { randomUUID } from 'node:crypto';
import { build, flattenBox, spawnHq, type ColonySeed } from '@terra/scenarios/w13-markets';
import { createPlanet, creditResource, ensureColonyLedger, getColonyStock, PlanetJournal, regionForNewPlanet, restore, revealVision, SimHost, snapshot, type LedgerPosting, type PlanetState } from '@terra/sim';
import { FlagsService } from '../../src/flags/flags.service.js';
import { GamePlanets } from '../../src/game/game-planets.service.js';
import { Exchange, type World } from '../exchange/exchange-harness.js';

/** Colony origins on a 16-tile hex lattice (centre, then rings) of a radius-40 planet: far enough apart for separate territories. */
const ORIGINS: ReadonlyArray<readonly [number, number]> = (() => {
  const pts: Array<[number, number, number]> = [];
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
    const d = Math.max(Math.abs(i), Math.abs(j), Math.abs(i + j));
    if (d <= 2) pts.push([i * 16, j * 16, d]);
  }
  return pts.sort((x, y) => x[2] - y[2]).map(([q, r]) => [q, r] as const);
})();

export interface Variants {
  /** Colony indices without a Trade Hub (`no_trade_hub`). */
  readonly noHub?: readonly number[];
  /** Colony indices whose hub has no Solar (`hub_offline`). */
  readonly noPower?: readonly number[];
}

/** The W13 `seedColony` layout, minus the hub or the Solar for the variants. */
function seed(state: PlanetState, s: ColonySeed, v: Variants): void {
  const colony = ensureColonyLedger(
    { index: s.index, id: s.id, name: s.name, color: s.color, status: 'active', stage: 2, tradeHubAtS2: true, neighborContact: true, contactFake: false, guildVisit: false, changedAt: 0 },
    { depotCount: 2 },
  );
  state.colonies[s.index] = colony;
  const [q, r] = s.origin;
  flattenBox(state, s.origin, 5);
  build(state, s.index, 'commandHub', q, r);
  if (!v.noPower?.includes(s.index)) build(state, s.index, 'solar', q - 3, r + 2);
  if (!v.noHub?.includes(s.index)) build(state, s.index, 'tradeHub', q + 2, r + 1);
  build(state, s.index, 'supplyDepot', q - 4, r - 2);
  build(state, s.index, 'supplyDepot', q + 2, r - 4);
  spawnHq(state, s.index, q, r + 3);
  revealVision(state, s.index, q, r, 10, 0);
  for (const [key, amount] of Object.entries(s.stock)) creditResource(colony, key as never, amount, 0);
}

export interface RealWorld extends World { readonly indices: readonly number[] }

/**
 * Creates a REAL planet (on a sim thread) with `n` S2 colonies, each with an online Trade Hub (the W13 seed layout), and
 * returns a world whose colonies are those seats. Colony `i` is `col_i`.
 */
export async function realWorld(ex: Exchange, n = 4, v: Variants = {}): Promise<RealWorld> {
  const planetId = `pl_t3${randomUUID().slice(0, 8)}`;
  const flags = ex.get(FlagsService).list;
  const region = regionForNewPlanet({ flags, planetType: 'temperate', planetId });
  const state = createPlanet({ type: 'temperate', seed: 'w13-t3', planetId, planetType: 'temperate', radius: 40, worldSalt: randomUUID(), ...(region ? { region } : {}) });
  const host = new SimHost({ flags });
  host.load(state);
  const setup: LedgerPosting[] = [];
  const off = host.onPostings((p) => { setup.push(...p); });
  const seeds: ColonySeed[] = ORIGINS.slice(0, n).map((origin, i) => ({
    index: i, id: `col_${i}`, name: `T${i}`, color: 0xff6b00, origin,
    stock: { 'metals.t1': 600, 'minerals.t1': 300, 'bio.water': 900, 'bio.biomass': 200 },
  }));
  for (const s of seeds) seed(host.state, s, v);
  host.submit({ colonyIndex: null, source: 'dev', commandId: 'scn-skip', kind: 'dev.skipnight', args: {} });
  host.step(1);
  off();
  if (setup.length === 0) setup.push(...PlanetJournal.openingPostings(host.state.colonies.map((_c, i) => getColonyStock(host.state, i)), host.state.meta.tick, 'system:seed'));
  await ex.get(GamePlanets).load(planetId, { snapshot: snapshot(host.state), genesis: true, setupPostings: setup });
  const indices = seeds.map((s) => s.index);
  return { ...ex.adopt(planetId, indices), indices };
}

export interface SimColonyView {
  readonly inOrbit: Record<string, number>;
  readonly reservedInOrbit: Record<string, number>;
  readonly openRefs: readonly string[];
}

/** The sim's own view of a colony's market state (a fresh full snapshot from its thread). */
export async function simColony(ex: Exchange, planetId: string, idx: number): Promise<SimColonyView> {
  const st = restore((await ex.get(GamePlanets).fullState(planetId)).bytes);
  const c = st.colonies[idx] as unknown as { cargo?: { inOrbit?: Record<string, number> }; market?: { reservedInOrbit?: Record<string, number>; openOrders?: Record<string, unknown> } } | undefined;
  return { inOrbit: { ...(c?.cargo?.inOrbit ?? {}) }, reservedInOrbit: { ...(c?.market?.reservedInOrbit ?? {}) }, openRefs: Object.keys(c?.market?.openOrders ?? {}) };
}
