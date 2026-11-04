import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createRegistryPipeline,
  createState,
  creditResource,
  enqueueHubUnit,
  ensureColonyLedger,
  ENTITY_KIND,
  ENTITY_STATE,
  computeColonySupply,
  getHubUnitQueue,
  insertRow,
  step,
} from '../../src';
import { resourceValue } from '../../src/systems/economy/ledger';

describe('W02-10 Hub worker production (slot 9): Units lane, paid progressively, 10s build, supply cap 10', () => {
  it('queue 1 Harvester -> 40/15/5/0 paid progressively, spawns after 10 s; queue an 11th -> waits on waiting(supply)', () => {
    const state = createState({ planetId: 'p1', planetType: 'temperate', seed: 'w02', radius: 8 });
    const colony = ensureColonyLedger({
      index: 0,
      id: 'col-0',
      name: 'Alpha',
      color: 0xff6b00,
      status: 'active',
      changedAt: 0,
    });
    state.colonies.push(colony);

    // Spawn completed Command Hub T1 at (0, 0) -> provides supplyCap = 10
    const hubRow = insertRow(state.entities, state.meta.nextEntityId++, 0);
    state.entities.cols.kind[hubRow] = ENTITY_KIND.commandHub;
    state.entities.cols.owner[hubRow] = 0;
    state.entities.cols.q[hubRow] = 0;
    state.entities.cols.r[hubRow] = 0;
    state.entities.cols.footprintW[hubRow] = 3;
    state.entities.cols.footprintD[hubRow] = 3;
    state.entities.cols.hp[hubRow] = 1500;
    state.entities.cols.state[hubRow] = ENTITY_STATE.active;

    // Give colony 500 of each T1 resource
    creditResource(colony, 'metals.t1', 500, 0);
    creditResource(colony, 'minerals.t1', 500, 0);
    creditResource(colony, 'bio.biomass', 500, 0);

    const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });

    // Queue 1 Harvester: starts in_progress, cost (40/15/5) is deducted progressively across 50 ticks
    const q1 = enqueueHubUnit(state, { colonyIndex: 0, unit: 'harvester' });
    expect(q1.ok).toBe(true);
    if (!q1.ok) throw new Error('expected ok');
    expect(q1.entry.state).toBe('in_progress');
    expect(resourceValue(colony, 'metals.t1')).toBe(500);

    // Step 49 ticks (9.8 s) -> not spawned yet, progressive cost deducted
    step(state, [], 49, pipeline);
    expect(getHubUnitQueue(state, 0)).toHaveLength(1);
    expect(resourceValue(colony, 'metals.t1')).toBeCloseTo(460.8, 4);

    // Step 1 more tick (50 ticks = 10.0 s) -> Harvester spawns at Hub edge and full 40/15/5 is deducted!
    const doneRes = step(state, [], 1, pipeline);
    expect(doneRes.events.some((e) => e.kind === 'unitProduced')).toBe(true);
    expect(getHubUnitQueue(state, 0)).toHaveLength(0);
    expect(computeColonySupply(state, 0).units).toBe(1);
    expect(resourceValue(colony, 'metals.t1')).toBe(460);
    expect(resourceValue(colony, 'minerals.t1')).toBe(485);
    expect(resourceValue(colony, 'bio.biomass')).toBe(495);

    // Spawn 9 more Harvesters so total active Harvesters = 10 (at Hub T1 supply cap 10)
    for (let i = 0; i < 9; i++) {
      const r = insertRow(state.entities, state.meta.nextEntityId++, state.meta.tick);
      state.entities.cols.kind[r] = ENTITY_KIND.harvester;
      state.entities.cols.owner[r] = 0;
      state.entities.cols.hp[r] = 160;
      state.entities.cols.state[r] = ENTITY_STATE.idle;
    }
    expect(computeColonySupply(state, 0)).toMatchObject({ used: 10, cap: 10, available: 0 });

    // Queue an 11th Harvester -> waits on waiting(supply) and does NOT debit resources
    const q11 = enqueueHubUnit(state, { colonyIndex: 0, unit: 'harvester' });
    expect(q11.ok).toBe(true);
    if (!q11.ok) throw new Error('expected ok');
    expect(q11.entry.state).toBe('waiting');
    expect(q11.entry.waitReason).toBe('supply');
    expect(q11.entry.waitDetail).toBe('waiting(supply)');
    expect(q11.entry.paid).toBe(false);
    expect(resourceValue(colony, 'metals.t1')).toBe(460);
  });
});
