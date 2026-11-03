import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createRegistryPipeline,
  createState,
  ENTITY_KIND,
  ENTITY_STATE,
  getColonyPower,
  insertRow,
  step,
} from '../../src';

describe('W02-05 Power system (slot 7) v0 — single component', () => {
  it('Hub alone -> +8 / -5; + 1 working Harvester -> -6.5 demand (idle Harvester -> 50% drain = -5.75)', () => {
    const state = createState({ planetId: 'p1', planetType: 'temperate', seed: 'w02', radius: 8 });
    state.colonies.push({
      index: 0,
      id: 'col-0',
      name: 'Alpha',
      color: 0xff6b00,
      status: 'active',
      changedAt: 0,
    });
    const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });

    // Spawn completed Command Hub T1 at (0, 0)
    const hubRow = insertRow(state.entities, state.meta.nextEntityId++, 0);
    state.entities.cols.kind[hubRow] = ENTITY_KIND.commandHub;
    state.entities.cols.owner[hubRow] = 0;
    state.entities.cols.q[hubRow] = 0;
    state.entities.cols.r[hubRow] = 0;
    state.entities.cols.footprintW[hubRow] = 3;
    state.entities.cols.footprintD[hubRow] = 3;
    state.entities.cols.hp[hubRow] = 1500;
    state.entities.cols.hpMax[hubRow] = 1500;
    state.entities.cols.state[hubRow] = ENTITY_STATE.active;

    step(state, [], 1, pipeline);
    const pHubOnly = getColonyPower(state, 0);
    expect(pHubOnly.supply).toBe(8);
    expect(pHubOnly.demand).toBe(5);
    expect(pHubOnly.net).toBe(3);

    // Spawn 1 working Harvester
    const harvRow = insertRow(state.entities, state.meta.nextEntityId++, 1);
    state.entities.cols.kind[harvRow] = ENTITY_KIND.harvester;
    state.entities.cols.owner[harvRow] = 0;
    state.entities.cols.hp[harvRow] = 160;
    state.entities.cols.hpMax[harvRow] = 160;
    state.entities.cols.state[harvRow] = ENTITY_STATE.working;

    step(state, [], 1, pipeline);
    const pWithWorkingHarv = getColonyPower(state, 0);
    expect(pWithWorkingHarv.supply).toBe(8);
    expect(pWithWorkingHarv.demand).toBe(6.5);
    expect(pWithWorkingHarv.net).toBe(1.5);

    // When Harvester is idle, its drain is 50% (0.75 E/s -> total demand 5.75)
    state.entities.cols.state[harvRow] = ENTITY_STATE.idle;
    step(state, [], 1, pipeline);
    expect(getColonyPower(state, 0).demand).toBe(5.75);
  });

  it('attaches buildings within pylon radius of Hub and marks distant buildings offlineUnpowered', () => {
    const state = createState({ planetId: 'p1', planetType: 'temperate', seed: 'w02', radius: 16 });
    const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });

    const hubRow = insertRow(state.entities, state.meta.nextEntityId++, 0);
    state.entities.cols.kind[hubRow] = ENTITY_KIND.commandHub;
    state.entities.cols.owner[hubRow] = 0;
    state.entities.cols.q[hubRow] = 0;
    state.entities.cols.r[hubRow] = 0;
    state.entities.cols.footprintW[hubRow] = 3;
    state.entities.cols.footprintD[hubRow] = 3;
    state.entities.cols.hp[hubRow] = 1500;
    state.entities.cols.state[hubRow] = ENTITY_STATE.active;

    // Attached Solar at (3, 0) -> within 3 tiles of Hub footprint (0..2, 0..2)
    const solarRow = insertRow(state.entities, state.meta.nextEntityId++, 0);
    state.entities.cols.kind[solarRow] = ENTITY_KIND.solar;
    state.entities.cols.owner[solarRow] = 0;
    state.entities.cols.q[solarRow] = 3;
    state.entities.cols.r[solarRow] = 0;
    state.entities.cols.footprintW[solarRow] = 2;
    state.entities.cols.footprintD[solarRow] = 2;
    state.entities.cols.hp[solarRow] = 400;
    state.entities.cols.state[solarRow] = ENTITY_STATE.active;

    // Unattached Extractor far away at (12, 0)
    const farExtRow = insertRow(state.entities, state.meta.nextEntityId++, 0);
    state.entities.cols.kind[farExtRow] = ENTITY_KIND.metalsExtractor;
    state.entities.cols.owner[farExtRow] = 0;
    state.entities.cols.q[farExtRow] = 12;
    state.entities.cols.r[farExtRow] = 0;
    state.entities.cols.footprintW[farExtRow] = 2;
    state.entities.cols.footprintD[farExtRow] = 2;
    state.entities.cols.hp[farExtRow] = 500;
    state.entities.cols.state[farExtRow] = ENTITY_STATE.active;

    step(state, [], 1, pipeline);
    const power = getColonyPower(state, 0);
    expect(power.supply).toBe(28); // 8 Founder Core + 20 Solar net
    expect(power.demand).toBe(5); // Far extractor is unattached so it does not draw power
    expect(power.unpoweredEntityIds).toContain(state.entities.cols.id[farExtRow]);
    expect(state.entities.cols.state[farExtRow]).toBe(ENTITY_STATE.offlineUnpowered);
  });
});
