import { parseWaves } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import {
  computeAtlasSectorColonyMetrics,
  ENTITY_KIND,
  getColonyQueue,
  hasActiveTruce,
  isColonyOathbreaker,
  isColonyRaidProtected,
  readDiplomacyBlob,
  resourceValue,
} from '@terra/sim';
import { createScenarioPlanet, getScenario } from '../_loader';

describe('W18 PvP & Diplomacy scenario (w18 / w18-pvp-diplomacy)', () => {
  it('discovers w18 by id and file name and seeds 5 colonies A..E in sec_0_0 with deterministic shield states', () => {
    expect(getScenario('w18').id).toBe('w18');
    expect(getScenario('w18-pvp-diplomacy')).toBe(getScenario('w18'));

    const { host } = createScenarioPlanet('w18');
    const state = host.state;
    expect(state.colonies).toHaveLength(5);
    expect(state.colonies.map((c) => c.name)).toEqual([
      'Colony A',
      'Colony B',
      'Colony C',
      'Colony D',
      'Colony E',
    ]);
    expect(isColonyRaidProtected(state, 0, host.tick)).toBe(false);
    expect(isColonyRaidProtected(state, 1, host.tick)).toBe(false);
    expect(isColonyRaidProtected(state, 2, host.tick)).toBe(true);
    expect(isColonyRaidProtected(state, 3, host.tick)).toBe(false);
    expect(isColonyRaidProtected(state, 4, host.tick)).toBe(false);

    const metrics = computeAtlasSectorColonyMetrics(state);
    expect(metrics.sec_0_0?.foundedSeats).toBe(5);
    expect(metrics.sec_0_0?.livingColonies).toBe(5);
  });

  it('executes Step 1 & Step 2: A raids B (turrets engage + depot siphoned into A) and C rejects raid_protected', () => {
    const { host } = createScenarioPlanet('w18');
    const state = host.state;
    const aMetalsBefore = resourceValue(state.colonies[0]!, 'metals.t1');
    const bMetalsBefore = resourceValue(state.colonies[1]!, 'metals.t1');

    host.submit({
      commandId: 'c_raid_c',
      colonyIndex: 0,
      source: 'player',
      kind: 'raid',
      args: { targetColonyId: 'col_2' },
    });
    expect(host.step(1).outcomes[0]?.code).toBe('raid_protected');

    host.submit({
      commandId: 'c_raid_b',
      colonyIndex: 0,
      source: 'player',
      kind: 'raid',
      args: { targetColonyId: 'col_1' },
    });
    expect(host.step(1).outcomes[0]?.code).toBeUndefined();

    // Advance 60 ticks (12s) so A's 4 Recons march to B's frontier turret & depot, engage, and siphon
    host.step(60);

    const aMetalsAfter = resourceValue(state.colonies[0]!, 'metals.t1');
    const bMetalsAfter = resourceValue(state.colonies[1]!, 'metals.t1');
    expect(aMetalsAfter).toBeGreaterThan(aMetalsBefore);
    expect(bMetalsAfter).toBeLessThan(bMetalsBefore);
  });
});

describe('W18 PvP & Diplomacy scenario — Step 3 elimination & ruins', () => {
  it('executes Step 3: B killHq reprints HQ, killHub turns critical, second killHq eliminates B into ruins & updates sec_0_0 livingColonies', () => {
    const { host } = createScenarioPlanet('w18');
    const state = host.state;

    host.submit({
      commandId: 'b_kill_hq_1',
      colonyIndex: 1,
      source: 'dev',
      kind: 'dev.killHq',
      args: {},
    });
    expect(host.step(1).outcomes[0]?.code).toBeUndefined();
    const unitsQueue = getColonyQueue(state, 1, 'units');
    expect(unitsQueue[0]?.task).toEqual({ kind: 'buildUnit', unit: 'hq', tier: 1, count: 1 });

    // Complete HQ reprint (300 ticks = 60s)
    host.step(305);

    host.submit({
      commandId: 'b_kill_hub',
      colonyIndex: 1,
      source: 'dev',
      kind: 'dev.killHub',
      args: {},
    });
    expect(host.step(1).outcomes[0]?.code).toBeUndefined();
    expect(state.colonies[1]?.status).toBe('critical');

    host.submit({
      commandId: 'b_kill_hq_2',
      colonyIndex: 1,
      source: 'dev',
      kind: 'dev.killHq',
      args: {},
    });
    expect(host.step(1).outcomes[0]?.code).toBeUndefined();
    expect(state.colonies[1]?.status).toBe('eliminated');

    // Buildings of B became neutral ruins (owner === -1)
    let ruinCount = 0;
    for (let r = 0; r < state.entities.count; r++) {
      if (state.entities.cols.owner[r] === -1 && state.entities.cols.hp[r]! > 0) {
        ruinCount++;
      }
    }
    expect(ruinCount).toBeGreaterThanOrEqual(3);

    const metrics = computeAtlasSectorColonyMetrics(state);
    expect(metrics.sec_0_0?.foundedSeats).toBe(5);
    expect(metrics.sec_0_0?.livingColonies).toBe(4);
  });
});

describe('W18 PvP & Diplomacy scenario — Steps 4–7 diplomacy & wave gate', () => {
  it('executes Steps 4–6: A & D sign truce (blocks attackMove), A cancels (notice + Oathbreaker), away D auto-accepts E truce', () => {
    const { host } = createScenarioPlanet('w18');
    const state = host.state;

    host.submit({
      commandId: 'a_propose_d',
      colonyIndex: 0,
      source: 'player',
      kind: 'diplomacy.proposeTruce',
      args: { targetColonyId: 'col_3', hours: 6 },
    });
    expect(host.step(1).outcomes[0]?.code).toBeUndefined();

    const offerId = Object.keys(readDiplomacyBlob(state).offers)[0]!;
    host.submit({
      commandId: 'd_accept_a',
      colonyIndex: 3,
      source: 'player',
      kind: 'diplomacy.respondTruce',
      args: { offerId, accept: true },
    });
    expect(host.step(1).outcomes[0]?.code).toBeUndefined();
    expect(hasActiveTruce(state, 0, 3, host.tick)).toBe(true);

    let aReconId = -1;
    for (let r = 0; r < state.entities.count; r++) {
      if (state.entities.cols.owner[r] === 0 && state.entities.cols.kind[r] === ENTITY_KIND.recon) {
        aReconId = state.entities.cols.id[r]!;
        break;
      }
    }
    host.submit({
      commandId: 'a_am_d',
      colonyIndex: 0,
      source: 'player',
      kind: 'attackMove',
      args: { entityId: aReconId, q: 0, r: -16 },
    });
    expect(host.step(1).outcomes[0]?.code).toBe('truce_active');

    const truceId = Object.keys(readDiplomacyBlob(state).truces)[0]!;
    host.submit({
      commandId: 'a_cancel_truce',
      colonyIndex: 0,
      source: 'player',
      kind: 'diplomacy.cancelTruce',
      args: { truceId },
    });
    expect(host.step(1).outcomes[0]?.code).toBeUndefined();
    expect(hasActiveTruce(state, 0, 3, host.tick)).toBe(true);
    expect(isColonyOathbreaker(state, 0, host.tick)).toBe(true);

    // Step 6: D goes away and receives truce offer from E -> auto-accepted
    host.submit({
      commandId: 'd_away',
      colonyIndex: 3,
      source: 'dev',
      kind: 'system.presence',
      args: { colonyId: 'co_0000000003', away: true },
    });
    expect(host.step(1).outcomes[0]?.code).toBeUndefined();

    host.submit({
      commandId: 'e_offer_d',
      colonyIndex: 4,
      source: 'dev',
      kind: 'dev.offerTruce',
      args: { fromColony: 'd', toColony: 4, hours: 6 },
    });
    expect(host.step(1).outcomes[0]?.code).toBeUndefined();
    host.step(6);
    expect(hasActiveTruce(state, 3, 4, host.tick)).toBe(true);
  });
});

describe('W18 PvP & Diplomacy scenario — Step 7 wave gate', () => {
  it('executes Step 7: with waves ..17, raid and truce commands reject wave_disabled and Hub loss does not eliminate', () => {
    const { host } = createScenarioPlanet('w18', { flags: parseWaves('..17').list });
    host.submit({
      commandId: 'w17_raid',
      colonyIndex: 0,
      source: 'player',
      kind: 'raid',
      args: { targetColonyId: 'col_1' },
    });
    expect(host.step(1).outcomes[0]?.code).toBe('wave_disabled');

    host.submit({
      commandId: 'w17_truce',
      colonyIndex: 0,
      source: 'player',
      kind: 'diplomacy.proposeTruce',
      args: { targetColonyId: 'col_3', hours: 6 },
    });
    expect(host.step(1).outcomes[0]?.code).toBe('wave_disabled');

    host.submit({
      commandId: 'w17_kill_hub',
      colonyIndex: 1,
      source: 'dev',
      kind: 'dev.killHub',
      args: {},
    });
    expect(host.step(1).outcomes[0]?.code).toBe('wave_disabled');
    expect(host.state.colonies[1]?.status).toBe('active');
  });
});
