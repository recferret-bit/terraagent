import { defineScenario } from './_define';
import { seedColony, type ColonySeed } from './w13-markets';

/**
 * W13 multi-colony market scenario (`w13m`): four seated S2 colonies on ONE planet, each with a completed Command Hub, Solar,
 * online Trade Hub T1 and two Supply Depots, so the market has >= 4 distinct counterparties and the organic reference price
 * (board: >= 3 trades, >= 10 units, >= 3 counterparties, none above 40 %) can be reached end to end. The plain `w13` scenario
 * has only two colonies and stays as it is (its numbers feed the existing e2e/demo story).
 */
export const W13M_COLONIES: readonly ColonySeed[] = [
  { index: 0, id: 'col_0', name: 'Port A', color: 0xff6b00, origin: [-14, 0], stock: { 'metals.t1': 600, 'minerals.t1': 300, 'bio.water': 900, 'bio.biomass': 200 } },
  { index: 1, id: 'col_1', name: 'Port B', color: 0x2f8fff, origin: [14, 0], stock: { 'metals.t1': 600, 'minerals.t1': 300, 'bio.water': 200, 'bio.biomass': 200 } },
  { index: 2, id: 'col_2', name: 'Port C', color: 0x9b59ff, origin: [0, 16], stock: { 'metals.t1': 600, 'minerals.t1': 300, 'bio.water': 400, 'bio.biomass': 200 } },
  { index: 3, id: 'col_3', name: 'Port D', color: 0x2fbf71, origin: [0, -16], stock: { 'metals.t1': 600, 'minerals.t1': 300, 'bio.water': 400, 'bio.biomass': 200 } },
];

/**
 * Labelled FIXTURE balances (`organic: false`, same mechanism as `W13_FIXTURES`: the backend applies them when a dev session is
 * seated, `market/dev/market-fixtures.service.ts`): every colony holds water and metals T1 in orbit and mock USDC.
 * Accounts are planet-scoped (`<planet>--col_<n>`), so a second `w13m` planet starts from the same numbers again.
 */
export const W13M_FIXTURES: Readonly<Record<number, { readonly inOrbit?: Readonly<Record<string, number>>; readonly usdc?: string }>> = {
  0: { inOrbit: { 'bio.water': 300, 'metals.t1': 300 }, usdc: '300' },
  1: { inOrbit: { 'bio.water': 300, 'metals.t1': 300 }, usdc: '300' },
  2: { inOrbit: { 'bio.water': 300, 'metals.t1': 300 }, usdc: '300' },
  3: { inOrbit: { 'bio.water': 300, 'metals.t1': 300 }, usdc: '300' },
};

export const w13MarketsMultiScenario = defineScenario({
  id: 'w13m',
  title: 'W13 Markets (four colonies)',
  waves: '..13',
  seed: 'w13-markets-multi',
  planet: { type: 'temperate', planetType: 'temperate', radius: 28 },
  build(_host, api) {
    for (const s of W13M_COLONIES) seedColony(api.planet, s);
    api.command('dev.skipnight', {});
  },
});

export default w13MarketsMultiScenario;
