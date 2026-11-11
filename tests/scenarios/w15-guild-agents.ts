import { creditResource, ensureColonyLedger, revealVision, type PlanetState } from '@terra/sim';
import { defineScenario } from './_define';
import { build, flattenBox, spawnHq } from './w13-markets';

/** Demo stock (W15 step 1). One Supply Depot keeps each family cap at 1 500 (`500` hub + `1 000`). */
export const W15_STOCK: Readonly<Record<string, number>> = {
  'metals.t1': 1400,
  'minerals.t1': 200,
  'bio.water': 200,
  'bio.biomass': 100,
};

const ORIGIN = [0, 0] as const;

function placeYard(state: PlanetState): void {
  flattenBox(state, ORIGIN, 5);
  build(state, 0, 'commandHub', 0, 0);
  build(state, 0, 'solar', -3, 2);
  build(state, 0, 'tradeHub', 2, 1);
  build(state, 0, 'supplyDepot', -4, -2);
  spawnHq(state, 0, 0, 3);
  revealVision(state, 0, 0, 0, 10, 0);
}

function creditDemo(state: PlanetState): void {
  const colony = state.colonies[0];
  if (!colony) throw new Error('w15 scenario: colony 0 missing');
  for (const [key, amount] of Object.entries(W15_STOCK)) creditResource(colony, key as never, amount, 0);
}

/**
 * W15 Guild agents (`docs/plan/waves/W15-guild-agents.md` demo step 1).
 * Solo S2 colony, online Trade Hub, metals near full (1 400 / 1 500), water low (200).
 * Kestrel and Vanguard are the guild data roster (two NPCs). They are not sim entities.
 * The live visit clock is `dockWindowS` 720 / `visitGapS` 1800, not a 30 s sim timer.
 * The e2e docks with `guild.summon kestrel` instead of waiting out that clock.
 */
export const w15GuildAgentsScenario = defineScenario({
  id: 'w15',
  title: 'W15 Guild agents',
  waves: '..15',
  seed: 'w15-guild-agents',
  planet: { type: 'temperate', planetType: 'temperate', radius: 16 },
  build(_host, api) {
    const state = api.planet;
    state.colonies[0] = ensureColonyLedger(
      {
        index: 0, id: 'col_0', name: 'Guild Port', color: 0xff6b00, status: 'active', stage: 2,
        tradeHubAtS2: true, neighborContact: true, contactFake: false, guildVisit: false, changedAt: 0,
      },
      { depotCount: 1 },
    );
    placeYard(state);
    creditDemo(state);
    api.command('dev.skipnight', {});
  },
});

export default w15GuildAgentsScenario;
