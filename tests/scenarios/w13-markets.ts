import {
  creditResource,
  DEPOSIT,
  ensureColonyLedger,
  ENTITY_KIND,
  ENTITY_STATE,
  indexOf,
  insertRow,
  placeSpawnedEntity,
  PREP,
  revealVision,
  setTilePrep,
  startBuildingConstruction,
  TERRAIN,
  type PlanetState,
} from '@terra/sim';
import { defineScenario } from './_define';

/** Colony layout: Command Hub at `origin`, Solar, online Trade Hub and two Supply Depots around it, HQ drone below. */
interface ColonySeed {
  readonly index: number;
  readonly id: string;
  readonly name: string;
  readonly color: number;
  readonly origin: readonly [number, number];
  readonly stock: Readonly<Record<string, number>>;
}

/** A = seller (600 water for the demo), B = buyer (gets 20 mock USDC from the server fixture, not from the sim). */
export const W13_COLONIES: readonly ColonySeed[] = [
  { index: 0, id: 'col_0', name: 'Port A', color: 0xff6b00, origin: [-8, 0], stock: { 'metals.t1': 600, 'minerals.t1': 300, 'bio.water': 900, 'bio.biomass': 200 } },
  { index: 1, id: 'col_1', name: 'Port B', color: 0x2f8fff, origin: [8, 0], stock: { 'metals.t1': 600, 'minerals.t1': 300, 'bio.water': 200, 'bio.biomass': 200 } },
];

function flattenBox(state: PlanetState, [cq, cr]: readonly [number, number], radius: number): void {
  for (let r = cr - radius; r <= cr + radius; r++) {
    for (let q = cq - radius; q <= cq + radius; q++) {
      const idx = indexOf(state.grid.radius, q, r);
      if (idx < 0) continue;
      state.grid.layers.terrain[idx] = TERRAIN.flat;
      state.grid.layers.height[idx] = 0.08;
      state.grid.layers.deposit[idx] = DEPOSIT.none;
      state.grid.layers.richness[idx] = 0;
      setTilePrep(state, idx, PREP.prepared, 0);
    }
  }
}

function build(state: PlanetState, owner: number, building: string, q: number, r: number): void {
  const out = startBuildingConstruction(state, { owner, building, q, r, instant: true, costOverride: {}, tick: 0 });
  if (!out.ok) throw new Error(`w13 scenario: ${building} at (${q}, ${r}) for colony ${owner}: ${out.code} ${out.detail ?? ''}`);
}

function spawnHq(state: PlanetState, owner: number, q: number, r: number): void {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, 0);
  const c = state.entities.cols;
  c.kind[row] = ENTITY_KIND.hq;
  c.owner[row] = owner;
  c.tier[row] = 1;
  placeSpawnedEntity(state.entities, row, q, r, 0);
  c.hp[row] = 800;
  c.hpMax[row] = 800;
  c.cell[row] = 200;
  c.cellMax[row] = 200;
  c.workRate[row] = 1.5;
  c.state[row] = ENTITY_STATE.idle;
}

function seedColony(state: PlanetState, s: ColonySeed): void {
  const colony = ensureColonyLedger(
    {
      index: s.index, id: s.id, name: s.name, color: s.color, status: 'active', stage: 2, tradeHubAtS2: true,
      neighborContact: true, contactFake: false, guildVisit: false, changedAt: 0,
    },
    { depotCount: 2 },
  );
  state.colonies[s.index] = colony;
  const [q, r] = s.origin;
  flattenBox(state, s.origin, 5);
  build(state, s.index, 'commandHub', q, r);
  build(state, s.index, 'solar', q - 3, r + 2);
  build(state, s.index, 'tradeHub', q + 2, r + 1);
  build(state, s.index, 'supplyDepot', q - 4, r - 2);
  build(state, s.index, 'supplyDepot', q + 2, r - 4);
  spawnHq(state, s.index, q, r + 3);
  revealVision(state, s.index, q, r, 10, 0);
  for (const [key, amount] of Object.entries(s.stock)) creditResource(colony, key as never, amount, 0);
}

/**
 * W13 Markets seed scenario (`docs/plan/waves/W13-markets.md` demo step 1; skeleton from W13-01, finished by W13-35):
 * two S2 colonies, each with a completed Command Hub, Solar, online Trade Hub T1 and two powered Supply Depots, morning.
 * Sim part only: in-orbit cargo (A: 600 `bio.water`) and mock USDC (B: 20) are labelled **fixtures** the market
 * module/dev faucet writes to the cargo account and mock verifier when this scenario loads (W13-30, W13-35), because
 * those balances live in Postgres, not in the sim.
 */
export const w13MarketsScenario = defineScenario({
  id: 'w13',
  title: 'W13 Markets',
  waves: '..13',
  seed: 'w13-markets',
  planet: { type: 'temperate', planetType: 'temperate', radius: 16 },
  build(_host, api) {
    const state = api.planet;
    for (const s of W13_COLONIES) seedColony(state, s);
    api.command('dev.skipnight', {});
  },
});

export default w13MarketsScenario;
