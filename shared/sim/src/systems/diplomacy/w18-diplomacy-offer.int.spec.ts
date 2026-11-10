import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createPlanet,
  ensureColonyRecord,
  ENTITY_KIND,
  ENTITY_STATE,
  insertRow,
  SimHost,
} from '../../index';
import {
  hasActiveTruce,
  markColonyContact,
  recordHostilityBetween,
} from './index';

function bootDiplomacySim(waveSpec = '..18'): SimHost {
  const sim = new SimHost({ flags: parseWaves(waveSpec) });
  sim.load(createPlanet({ type: 'flat', seed: 'w18-11-int', radius: 24 }));
  const col0 = ensureColonyRecord(sim.state, 0, sim.tick);
  col0.status = 'active';
  const col1 = ensureColonyRecord(sim.state, 1, sim.tick);
  col1.status = 'active';

  const r0 = insertRow(sim.state.entities, sim.state.meta.nextEntityId++, sim.tick);
  sim.state.entities.cols.kind[r0] = ENTITY_KIND.hq;
  sim.state.entities.cols.owner[r0] = 0;
  sim.state.entities.cols.tier[r0] = 1;
  sim.state.entities.cols.hp[r0] = 500;
  sim.state.entities.cols.hpMax[r0] = 500;
  sim.state.entities.cols.state[r0] = ENTITY_STATE.idle;
  sim.state.entities.cols.q[r0] = 0;
  sim.state.entities.cols.r[r0] = 0;

  const r1 = insertRow(sim.state.entities, sim.state.meta.nextEntityId++, sim.tick);
  sim.state.entities.cols.kind[r1] = ENTITY_KIND.hq;
  sim.state.entities.cols.owner[r1] = 1;
  sim.state.entities.cols.tier[r1] = 1;
  sim.state.entities.cols.hp[r1] = 500;
  sim.state.entities.cols.hpMax[r1] = 500;
  sim.state.entities.cols.state[r1] = ENTITY_STATE.idle;
  sim.state.entities.cols.q[r1] = 20;
  sim.state.entities.cols.r[r1] = 0;

  return sim;
}

describe('W18-11 SimHost integration — proposeTruce, respondTruce & dev.offerTruce', () => {
  it('rejects proposeTruce right after a fight with recent_hostility, then allows propose and accept after cooldown', () => {
    const sim = bootDiplomacySim('..18');
    recordHostilityBetween(sim.state, 0, 1, sim.tick);

    sim.submit({
      colonyIndex: 0,
      source: 'player',
      commandId: 'cm_prop_hostile',
      kind: 'diplomacy.proposeTruce',
      args: { targetColonyId: 'col_1', durationHours: 6 },
    });
    const hostileStep = sim.step(1);
    expect(hostileStep.outcomes[0]?.code).toBe('recent_hostility');

    sim.step(3000);
    sim.submit({
      colonyIndex: 0,
      source: 'player',
      commandId: 'cm_prop_ok',
      kind: 'diplomacy.proposeTruce',
      args: { targetColonyId: 'col_1', durationHours: 6 },
    });
    const offerStep = sim.step(1);
    expect(offerStep.outcomes[0]?.code).toBeUndefined();
    const offerEvt = offerStep.events.find((e) => e.kind === 'truceOffered');
    expect(offerEvt).toBeDefined();
    const offerId = (offerEvt?.data as { offerId: string }).offerId;

    sim.submit({
      colonyIndex: 1,
      source: 'player',
      commandId: 'cm_resp_ok',
      kind: 'diplomacy.respondTruce',
      args: { offerId, accept: true },
    });
    const signStep = sim.step(1);
    expect(signStep.outcomes[0]?.code).toBeUndefined();
    expect(signStep.events.some((e) => e.kind === 'truceSigned')).toBe(true);
    expect(hasActiveTruce(sim.state, 0, 1, sim.tick)).toBe(true);
  });

  it('supports dev.offerTruce and fences diplomacy commands behind W18 wave flag', () => {
    const sim = bootDiplomacySim('..18');
    markColonyContact(sim.state, 0, 1, sim.tick);
    sim.submit({
      colonyIndex: 0,
      source: 'dev',
      commandId: 'cm_dev_offer',
      kind: 'dev.offerTruce',
      args: { fromColony: 1, toColony: 0, durationHours: 2 },
    });
    const devStep = sim.step(1);
    expect(devStep.outcomes[0]?.code).toBeUndefined();
    expect(devStep.events.some((e) => e.kind === 'truceOffered')).toBe(true);

    const preW18 = bootDiplomacySim('..17');
    markColonyContact(preW18.state, 0, 1, preW18.tick);
    preW18.submit({
      colonyIndex: 0,
      source: 'player',
      commandId: 'cm_pre_w18',
      kind: 'diplomacy.proposeTruce',
      args: { targetColonyId: 'col_1', durationHours: 6 },
    });
    const preStep = preW18.step(1);
    expect(preStep.outcomes[0]?.code).toBe('wave_disabled');
  });
});
