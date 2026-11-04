import {
  ENTITY_KIND,
  ENTITY_STATE,
  getColonyPower,
  getColonyStock,
  getColonyTradeHubStatus,
  indexOf,
  PREP,
} from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { createScenarioPlanet, getScenario } from '../_loader';

describe('W10-30 w10-cargo-trade-hub seed scenario', () => {
  it('resolves by both "w10" and "w10-cargo-trade-hub"', () => {
    const byId = getScenario('w10');
    const byFile = getScenario('w10-cargo-trade-hub');
    expect(byId).toBeDefined();
    expect(byFile).toBe(byId);
    expect(byId?.waves).toBe('..10');
  });

  it('builds a Stage 2 colony with 900 metals.t1 stock, an online Trade Hub T1 at (2, 1), and powered storage', () => {
    const { host } = createScenarioPlanet('w10-cargo-trade-hub');
    const state = host.state;
    const colony = state.colonies[0];
    expect(colony).toBeDefined();
    expect(colony.stage).toBe(2);

    const stock = getColonyStock(state, 0);
    expect(stock['metals.t1']).toBe(900);
    expect(stock['minerals.t1']).toBe(400);
    expect(stock['bio.water']).toBe(300);
    expect(stock['bio.biomass']).toBe(200);
    expect((colony.caps as Record<string, number> | undefined)?.metals).toBe(2500);

    const power = getColonyPower(state, 0);
    expect(power.hasHub).toBe(true);
    expect(power.supply).toBe(29);
    expect(power.demand).toBe(19);
    expect(power.net).toBe(10);
    expect(power.brownout).toBe(false);
    expect(power.phase).toBe('day');

    const hubStatus = getColonyTradeHubStatus(state, 0);
    expect(hubStatus.hubCount).toBe(1);
    expect(hubStatus.anyOnline).toBe(true);
    expect(hubStatus.totalOnlineThroughputPerMin).toBe(250);

    // Prepared 2x2 pad at (2, -3)
    for (let r = -3; r <= -1; r++) {
      for (let q = 2; q <= 4; q++) {
        const idx = indexOf(state.grid.radius, q, r);
        expect(state.grid.layers.prep[idx]).toBe(PREP.prepared);
      }
    }
  });

  it('marks the existing Trade Hub inert when loaded with ..09 flags', () => {
    const { host } = createScenarioPlanet('w10', { flags: ['W00', 'W01', 'W02', 'W06'] });
    const state = host.state;
    let tradeHubRow = -1;
    for (let r = 0; r < state.entities.count; r++) {
      if (state.entities.cols.kind[r] === ENTITY_KIND.tradeHub) {
        tradeHubRow = r;
        break;
      }
    }
    expect(tradeHubRow).toBeGreaterThanOrEqual(0);
    expect(state.entities.cols.state[tradeHubRow]).toBe(ENTITY_STATE.inert);
    const power = getColonyPower(state, 0);
    expect(power.demand).toBe(13);
  });
});
