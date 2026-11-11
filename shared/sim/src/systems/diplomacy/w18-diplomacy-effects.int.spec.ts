import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createPlanet,
  ensureColonyRecord,
  ENTITY_KIND,
  ENTITY_STATE,
  hexIndex,
  insertRow,
  placeSpawnedEntity,
  SimHost,
} from '../../index';
import { markColonyContact } from './index';

function bootEffectsSim(): {
  sim: SimHost;
  unit0Id: number;
  turret1Id: number;
} {
  const sim = new SimHost({ flags: parseWaves('..18') });
  sim.load(createPlanet({ type: 'flat', seed: 'w18-13-int', radius: 24 }));
  for (const idx of [0, 1]) {
    const col = ensureColonyRecord(sim.state, idx, sim.tick);
    col.status = 'active';
    const hq = insertRow(sim.state.entities, sim.state.meta.nextEntityId++, sim.tick);
    sim.state.entities.cols.kind[hq] = ENTITY_KIND.hq;
    sim.state.entities.cols.owner[hq] = idx;
    sim.state.entities.cols.tier[hq] = 1;
    sim.state.entities.cols.hp[hq] = 500;
    sim.state.entities.cols.hpMax[hq] = 500;
    sim.state.entities.cols.state[hq] = ENTITY_STATE.idle;
    placeSpawnedEntity(sim.state.entities, hq, idx * 6, 0, sim.tick);
  }

  const unit0Id = sim.state.meta.nextEntityId++;
  const u0 = insertRow(sim.state.entities, unit0Id, sim.tick);
  sim.state.entities.cols.kind[u0] = ENTITY_KIND.recon;
  sim.state.entities.cols.owner[u0] = 0;
  sim.state.entities.cols.hp[u0] = 80;
  sim.state.entities.cols.hpMax[u0] = 80;
  sim.state.entities.cols.state[u0] = ENTITY_STATE.idle;
  placeSpawnedEntity(sim.state.entities, u0, 4, 0, sim.tick);

  const turret1Id = sim.state.meta.nextEntityId++;
  const t1 = insertRow(sim.state.entities, turret1Id, sim.tick);
  sim.state.entities.cols.kind[t1] = ENTITY_KIND.autocannon;
  sim.state.entities.cols.owner[t1] = 1;
  sim.state.entities.cols.hp[t1] = 200;
  sim.state.entities.cols.hpMax[t1] = 200;
  sim.state.entities.cols.state[t1] = ENTITY_STATE.idle;
  placeSpawnedEntity(sim.state.entities, t1, 5, 0, sim.tick);

  const tileIdx = hexIndex(sim.state.grid.radius).indexOf(5, 0);
  sim.state.grid.layers.owner[tileIdx] = 1;

  markColonyContact(sim.state, 0, 1, sim.tick);
  return { sim, unit0Id, turret1Id };
}

describe('W18-13 SimHost integration — active truce blocks raid, attackMove, attackTarget & turret fire', () => {
  it('Active truce -> raid, enqueueTask(raid), attackMove & attackTarget into partner -> rejected truce_active; turrets do not fire', () => {
    const { sim, unit0Id, turret1Id } = bootEffectsSim();

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
    sim.step(1);

    sim.submit({
      colonyIndex: 0,
      source: 'player',
      commandId: 'cm_raid_partner',
      kind: 'raid',
      args: { targetColonyId: 'col_1' },
    });
    expect(sim.step(1).outcomes[0]?.code).toBe('truce_active');

    sim.submit({
      colonyIndex: 0,
      source: 'player',
      commandId: 'cm_enq_raid_partner',
      kind: 'enqueueTask',
      args: { raid: { targetColonyId: 'col_1' } },
    });
    expect(sim.step(1).outcomes[0]?.code).toBe('truce_active');

    sim.submit({
      colonyIndex: 0,
      source: 'player',
      commandId: 'cm_am_partner',
      kind: 'attackMove',
      args: { entityId: unit0Id, q: 5, r: 0 },
    });
    expect(sim.step(1).outcomes[0]?.code).toBe('truce_active');

    sim.submit({
      colonyIndex: 0,
      source: 'player',
      commandId: 'cm_at_partner',
      kind: 'attackTarget',
      args: { entityId: unit0Id, targetId: turret1Id },
    });
    expect(sim.step(1).outcomes[0]?.code).toBe('truce_active');

    sim.step(20);
    expect(sim.state.entities.cols.hp[2]).toBe(80);
    expect(sim.state.entities.cols.hp[3]).toBe(200);
  });
});
