import {
  creditResource, ensureColonyLedger, ENTITY_KIND, ENTITY_STATE, insertRow, placeSpawnedEntity, revealVision, type PlanetState,
} from '@terra/sim';
import { defineScenario } from './_define';
import { build, flattenBox, spawnHq, type ColonySeed } from './w13-markets';

/** A colony of the owner story: its seed, whether it gets a Supply Depot and how many idle builder units stand ready. */
export interface RegionColonySeed extends ColonySeed {
  readonly depots: number;
  readonly army: number;
  /** Builders standing in the `working` state (they count as combat load: weight at 100 %, not the 25 % of a ready unit). */
  readonly fighting: number;
  /** Extra Solar Arrays so a big army's power draw never browns the Depot out (the story measures logistics, not power). */
  readonly extraSolar: number;
}

/**
 * W13 regions and logistics owner story (`docs/plan/waves/W13-markets.md`, "Planet and sector trade motivation and logistics"):
 * ONE desert planet (pre-W11: the whole planet is a single region, so the crystal-poor desert preset applies to everybody; no
 * invented sectors). The colonies differ by what they hold, which is a labelled fixture: the metal specialist and the crystal-ridge
 * supplier are stock, not regional generation (W11 sector regions are a counterfactual until that wave lands).
 *  - col_0 Dune Works (the player, `?as=a`): metal-rich, crystal-poor, one Supply Depot, a small army. Spawn more units (`spawn`)
 *    and the logistics bill rises (the same capacity serves more load); build a Supply Depot and it drops; `unitReserve` cheapens it.
 *  - col_1 Crystal Ridge: the supplier of `minerals.t3` (crystal) the desert cannot mine cheaply.
 *  - col_2 Iron Guard: a bigger army on a Command Hub alone (fixed, low capacity): the comparison colony.
 */
export const W13_REGION_COLONIES: readonly RegionColonySeed[] = [
  { index: 0, id: 'col_0', name: 'Dune Works', color: 0xff6b00, origin: [-10, 0], depots: 0, army: 4, fighting: 20, extraSolar: 5, stock: { 'metals.t1': 900, 'minerals.t1': 200, 'minerals.t3': 0, 'bio.water': 400, 'bio.biomass': 100 } },
  { index: 1, id: 'col_1', name: 'Crystal Ridge', color: 0x2f8fff, origin: [10, 0], depots: 1, army: 0, fighting: 0, extraSolar: 0, stock: { 'metals.t1': 100, 'minerals.t1': 300, 'minerals.t3': 400, 'bio.water': 300, 'bio.biomass': 100 } },
  { index: 2, id: 'col_2', name: 'Iron Guard', color: 0x9b59ff, origin: [0, 11], depots: 1, army: 12, fighting: 6, extraSolar: 0, stock: { 'metals.t1': 300, 'minerals.t1': 100, 'minerals.t3': 0, 'bio.water': 400, 'bio.biomass': 50 } },
];

const EXTRA_SOLAR: readonly (readonly [number, number])[] = [[4, -3], [1, -4], [-2, -4], [-4, 4], [3, -5]];

function spawnBuilder(state: PlanetState, owner: number, q: number, r: number, st: number): void {
  const row = insertRow(state.entities, state.meta.nextEntityId++, 0);
  const c = state.entities.cols;
  c.kind[row] = ENTITY_KIND.builder; c.owner[row] = owner; c.tier[row] = 1;
  placeSpawnedEntity(state.entities, row, q, r, 0);
  c.hp[row] = 100; c.hpMax[row] = 100; c.state[row] = st;
}

function seedColony(state: PlanetState, s: RegionColonySeed): void {
  const colony = ensureColonyLedger(
    { index: s.index, id: s.id, name: s.name, color: s.color, status: 'active', stage: 2, tradeHubAtS2: true, neighborContact: true, contactFake: false, guildVisit: false, changedAt: 0 },
    { depotCount: s.depots },
  );
  state.colonies[s.index] = colony;
  const [q, r] = s.origin;
  flattenBox(state, s.origin, 5);
  build(state, s.index, 'commandHub', q, r);
  build(state, s.index, 'solar', q - 3, r + 2);
  for (const [dq, dr] of EXTRA_SOLAR.slice(0, s.extraSolar)) build(state, s.index, 'solar', q + dq, r + dr);
  build(state, s.index, 'tradeHub', q + 2, r + 1);
  if (s.depots > 0) build(state, s.index, 'supplyDepot', q - 4, r - 2);
  spawnHq(state, s.index, q, r + 3);
  for (let i = 0; i < s.army + s.fighting; i++) spawnBuilder(state, s.index, q - 2 + (i % 6), r + 4 + Math.floor(i / 6), i < s.army ? ENTITY_STATE.idle : ENTITY_STATE.working);
  revealVision(state, s.index, q, r, 10, 0);
  for (const [key, amount] of Object.entries(s.stock)) if (amount > 0) creditResource(colony, key as never, amount, 0);
}

export const w13RegionsScenario = defineScenario({
  id: 'w13r',
  title: 'W13 Regions and logistics',
  waves: '..13',
  seed: 'w13-regions',
  planet: { type: 'desert', planetType: 'desert', radius: 16 },
  build(_host, api) {
    // Morning first: the step must run before any colony exists, or the logistics window of tick 1 would post supply
    // against stock the journal has not opened yet (the loader opens it from the final stocks when setup posted nothing).
    api.command('dev.skipnight', {});
    for (const s of W13_REGION_COLONIES) seedColony(api.planet, s);
  },
});

export default w13RegionsScenario;
