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
import { hasActiveTruce, isColonyOathbreaker, markColonyContact } from './index';

function bootCancelSim(): SimHost {
  const sim = new SimHost({ flags: parseWaves('..18') });
  sim.load(createPlanet({ type: 'flat', seed: 'w18-14-int', radius: 24 }));
  for (const idx of [0, 1]) {
    const col = ensureColonyRecord(sim.state, idx, sim.tick);
    col.status = 'active';
    const r = insertRow(sim.state.entities, sim.state.meta.nextEntityId++, sim.tick);
    sim.state.entities.cols.kind[r] = ENTITY_KIND.hq;
    sim.state.entities.cols.owner[r] = idx;
    sim.state.entities.cols.tier[r] = 1;
    sim.state.entities.cols.hp[r] = 500;
    sim.state.entities.cols.hpMax[r] = 500;
    sim.state.entities.cols.state[r] = ENTITY_STATE.idle;
    sim.state.entities.cols.q[r] = idx * 4;
    sim.state.entities.cols.r[r] = 0;
  }
  markColonyContact(sim.state, 0, 1, sim.tick);
  return sim;
}

describe('W18-14 SimHost integration — cancelTruce 10-min notice, Oathbreaker & natural expiry', () => {
  it('Cancel -> 10 min notice (truceNotice), then truceEnded(cancelled); Oathbreaker blocks new offer for 24 h', () => {
    const sim = bootCancelSim();
    sim.submit({
      colonyIndex: 0,
      source: 'player',
      commandId: 'cm_prop',
      kind: 'diplomacy.proposeTruce',
      args: { targetColonyId: 'col_1', hours: 6 },
    });
    const offerStep = sim.step(1);
    const offerId = (offerStep.events.find((e) => e.kind === 'truceOffered')?.data as { offerId: string }).offerId;

    sim.submit({
      colonyIndex: 1,
      source: 'player',
      commandId: 'cm_resp',
      kind: 'diplomacy.respondTruce',
      args: { offerId, accept: true },
    });
    const signStep = sim.step(1);
    const truceId = (signStep.events.find((e) => e.kind === 'truceSigned')?.data as { truceId: string }).truceId;

    sim.submit({
      colonyIndex: 0,
      source: 'player',
      commandId: 'cm_cancel',
      kind: 'diplomacy.cancelTruce',
      args: { truceId },
    });
    const cancelStep = sim.step(1);
    expect(cancelStep.outcomes[0]?.code).toBeUndefined();
    expect(cancelStep.events.some((e) => e.kind === 'truceNotice')).toBe(true);
    expect(hasActiveTruce(sim.state, 0, 1, sim.tick)).toBe(true);
    expect(isColonyOathbreaker(sim.state, 0, sim.tick)).toBe(true);

    const midNotice = sim.step(2999);
    expect(midNotice.events.some((e) => e.kind === 'truceEnded')).toBe(false);
    expect(hasActiveTruce(sim.state, 0, 1, sim.tick)).toBe(true);

    const endNotice = sim.step(1);
    const endedEvt = endNotice.events.find((e) => e.kind === 'truceEnded');
    expect(endedEvt).toBeDefined();
    expect((endedEvt?.data as { reason: string }).reason).toBe('cancelled');
    expect(hasActiveTruce(sim.state, 0, 1, sim.tick)).toBe(false);

    sim.submit({
      colonyIndex: 0,
      source: 'player',
      commandId: 'cm_reoffer_oathbreaker',
      kind: 'diplomacy.proposeTruce',
      args: { targetColonyId: 'col_1', hours: 2 },
    });
    expect(sim.step(1).outcomes[0]?.code).toBe('oathbreaker');
  });

  it('expires naturally at term with truceEnded(expired) and zero Oathbreaker penalty', () => {
    const sim = bootCancelSim();
    sim.submit({
      colonyIndex: 0,
      source: 'player',
      commandId: 'cm_prop_2h',
      kind: 'diplomacy.proposeTruce',
      args: { targetColonyId: 'col_1', hours: 2 },
    });
    const offerStep = sim.step(1);
    const offerId = (offerStep.events.find((e) => e.kind === 'truceOffered')?.data as { offerId: string }).offerId;

    sim.submit({
      colonyIndex: 1,
      source: 'player',
      commandId: 'cm_resp_2h',
      kind: 'diplomacy.respondTruce',
      args: { offerId, accept: true },
    });
    sim.step(1);

    const termStep = sim.step(2 * 3600 * 5);
    const endedEvt = termStep.events.find((e) => e.kind === 'truceEnded');
    expect(endedEvt).toBeDefined();
    expect((endedEvt?.data as { reason: string }).reason).toBe('expired');
    expect(isColonyOathbreaker(sim.state, 0, sim.tick)).toBe(false);
    expect(isColonyOathbreaker(sim.state, 1, sim.tick)).toBe(false);

    sim.submit({
      colonyIndex: 0,
      source: 'player',
      commandId: 'cm_reoffer_clean',
      kind: 'diplomacy.proposeTruce',
      args: { targetColonyId: 'col_1', hours: 2 },
    });
    expect(sim.step(1).outcomes[0]?.code).toBeUndefined();
  });
});
