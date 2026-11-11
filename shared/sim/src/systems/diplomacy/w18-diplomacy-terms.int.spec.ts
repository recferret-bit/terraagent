import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createPlanet,
  ensureColonyRecord,
  ENTITY_KIND,
  ENTITY_STATE,
  insertRow,
  placeSpawnedEntity,
  SimHost,
} from '../../index';
import { markColonyContact, readDiplomacyBlob } from './index';

function bootTermsSim(tiers: Array<1 | 2 | 3> = [1, 1, 1]): SimHost {
  const sim = new SimHost({ flags: parseWaves('..18') });
  sim.load(createPlanet({ type: 'flat', seed: 'w18-12-int', radius: 24 }));
  tiers.forEach((tier, idx) => {
    const col = ensureColonyRecord(sim.state, idx, sim.tick);
    col.status = 'active';
    const r = insertRow(sim.state.entities, sim.state.meta.nextEntityId++, sim.tick);
    sim.state.entities.cols.kind[r] = ENTITY_KIND.hq;
    sim.state.entities.cols.owner[r] = idx;
    sim.state.entities.cols.tier[r] = tier;
    sim.state.entities.cols.hp[r] = 500;
    sim.state.entities.cols.hpMax[r] = 500;
    sim.state.entities.cols.state[r] = ENTITY_STATE.idle;
    placeSpawnedEntity(sim.state.entities, r, idx * 8, 0, sim.tick);
  });
  for (let i = 0; i < tiers.length; i++) {
    for (let j = i + 1; j < tiers.length; j++) {
      markColonyContact(sim.state, i, j, sim.tick);
    }
  }
  return sim;
}

describe('W18-12 SimHost integration — truce duration tier lock, active caps & 10-min offer expiry', () => {
  it('rejects 72 h offer on T1 HQ with tier_locked, allows 24 h, and rejects a second truce on T1 with truce_cap', () => {
    const sim = bootTermsSim([1, 2, 2]);
    sim.submit({
      colonyIndex: 0,
      source: 'player',
      commandId: 'cm_72h_t1',
      kind: 'diplomacy.proposeTruce',
      args: { targetColonyId: 'col_1', hours: 72 },
    });
    const rej72 = sim.step(1);
    expect(rej72.outcomes[0]?.code).toBe('tier_locked');

    sim.submit({
      colonyIndex: 0,
      source: 'player',
      commandId: 'cm_24h_t1',
      kind: 'diplomacy.proposeTruce',
      args: { targetColonyId: 'col_1', hours: 24 },
    });
    const ok24 = sim.step(1);
    expect(ok24.outcomes[0]?.code).toBeUndefined();
    const offerId = (ok24.events.find((e) => e.kind === 'truceOffered')?.data as { offerId: string }).offerId;

    sim.submit({
      colonyIndex: 1,
      source: 'player',
      commandId: 'cm_accept_24h',
      kind: 'diplomacy.respondTruce',
      args: { offerId, accept: true },
    });
    expect(sim.step(1).outcomes[0]?.code).toBeUndefined();

    sim.submit({
      colonyIndex: 0,
      source: 'player',
      commandId: 'cm_cap_t1',
      kind: 'diplomacy.proposeTruce',
      args: { targetColonyId: 'col_2', hours: 6 },
    });
    expect(sim.step(1).outcomes[0]?.code).toBe('truce_cap');
  });

  it('auto-expires unanswered truce offers after 10 minutes (3000 ticks) via diplomacySystem', () => {
    const sim = bootTermsSim([1, 1]);
    sim.submit({
      colonyIndex: 0,
      source: 'player',
      commandId: 'cm_offer_exp',
      kind: 'diplomacy.proposeTruce',
      args: { targetColonyId: 'col_1', hours: 6 },
    });
    const offerStep = sim.step(1);
    const offerId = (offerStep.events.find((e) => e.kind === 'truceOffered')?.data as { offerId: string }).offerId;

    sim.step(3000);
    expect(readDiplomacyBlob(sim.state).offers[offerId]?.status).toBe('expired');

    sim.submit({
      colonyIndex: 1,
      source: 'player',
      commandId: 'cm_resp_late',
      kind: 'diplomacy.respondTruce',
      args: { offerId, accept: true },
    });
    expect(sim.step(1).outcomes[0]?.code).toBe('unknown_offer');
  });
});
