import { ENTITY_KIND, getColonyPower, getColonyStock, getColonyTradeHubStatus } from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { createScenarioPlanet, getScenario } from '../_loader';
import { W15_STOCK } from '../w15-guild-agents';

describe('W15-34 w15-guild-agents seed', () => {
  it('resolves by both "w15" and "w15-guild-agents"', () => {
    const byId = getScenario('w15');
    const byFile = getScenario('w15-guild-agents');
    expect(byId).toBeDefined();
    expect(byFile).toBe(byId);
    expect(byId?.id).toBe('w15');
    expect(byId?.waves).toBe('..15');
    expect(byId?.seed).toBe('w15-guild-agents');
  });

  it('builds one S2 colony with a Trade Hub, 1400/1500 metals and 200 water', () => {
    const { host } = createScenarioPlanet('w15');
    const state = host.state;
    expect(state.colonies).toHaveLength(1);
    const colony = state.colonies[0]!;
    expect(colony.stage).toBe(2);
    expect(colony.tradeHubAtS2).toBe(true);
    const stock = getColonyStock(state, 0);
    expect(stock['metals.t1']).toBe(W15_STOCK['metals.t1']);
    expect(stock['bio.water']).toBe(W15_STOCK['bio.water']);
    expect(stock['minerals.t1']).toBe(W15_STOCK['minerals.t1']);
    expect(stock['bio.biomass']).toBe(W15_STOCK['bio.biomass']);
    const caps = colony.caps as { metals: number; bio: number };
    expect(caps.metals).toBe(1500);
    expect(caps.bio).toBe(1500);
    expect(stock['metals.t1']).toBeLessThan(caps.metals);

    let hubs = 0;
    let depots = 0;
    for (let row = 0; row < state.entities.count; row++) {
      if (state.entities.cols.kind[row] === ENTITY_KIND.tradeHub) hubs += 1;
      if (state.entities.cols.kind[row] === ENTITY_KIND.supplyDepot) depots += 1;
    }
    expect(hubs).toBe(1);
    expect(depots).toBe(1);
    const hub = getColonyTradeHubStatus(state, 0);
    expect(hub.hubCount).toBe(1);
    expect(hub.anyOnline).toBe(true);
    const power = getColonyPower(state, 0);
    expect(power.brownout).toBe(false);
    expect(power.phase).toBe('day');
  });
});
