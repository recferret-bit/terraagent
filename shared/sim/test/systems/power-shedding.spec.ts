import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createRegistryPipeline,
  createState,
  ENTITY_KIND,
  ENTITY_STATE,
  getColonyPower,
  insertRow,
  rowOf,
  setHqCellEnergy,
  spawnHqUnit,
  step,
} from '../../src';

describe('W02-06 Brownout shedding by data-driven groups 1..4 (newest entityId descending first)', () => {
  it('Hub (+16/-7) + 2 Extractors (-16) -> demand 23 > 16 -> the newest Extractor is shed, the older one keeps running', () => {
    const state = createState({ planetId: 'p1', planetType: 'temperate', seed: 'w02', radius: 8 });
    const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });

    // Spawn Hub at (0, 0) -> entityId 1 (+16 / -7)
    const hubRow = insertRow(state.entities, state.meta.nextEntityId++, 0);
    state.entities.cols.kind[hubRow] = ENTITY_KIND.commandHub;
    state.entities.cols.owner[hubRow] = 0;
    state.entities.cols.q[hubRow] = 0;
    state.entities.cols.r[hubRow] = 0;
    state.entities.cols.footprintW[hubRow] = 3;
    state.entities.cols.footprintD[hubRow] = 3;
    state.entities.cols.hp[hubRow] = 1500;
    state.entities.cols.state[hubRow] = ENTITY_STATE.active;

    // Spawn HQ near Hub (for group 3 fast-recharge shedding check), its cell empty: the grid's first store would
    // otherwise carry the deficit (`power-core/hqCell.ts`) and nothing would be shed
    const hqId = spawnHqUnit(state, { owner: 0, q: 1, r: 0 });
    setHqCellEnergy(state, rowOf(state.entities, hqId), 0);

    // Spawn Older Extractor -> entityId 3 (-8 E/s, group 3)
    const ext1Id = state.meta.nextEntityId++;
    const ext1Row = insertRow(state.entities, ext1Id, 0);
    state.entities.cols.kind[ext1Row] = ENTITY_KIND.metalsExtractor;
    state.entities.cols.owner[ext1Row] = 0;
    state.entities.cols.q[ext1Row] = 2;
    state.entities.cols.r[ext1Row] = 0;
    state.entities.cols.footprintW[ext1Row] = 2;
    state.entities.cols.footprintD[ext1Row] = 2;
    state.entities.cols.shedGroup[ext1Row] = 3;
    state.entities.cols.hp[ext1Row] = 500;
    state.entities.cols.state[ext1Row] = ENTITY_STATE.active;

    // Spawn Newer Extractor -> entityId 4 (-8 E/s, group 3)
    const ext2Id = state.meta.nextEntityId++;
    const ext2Row = insertRow(state.entities, ext2Id, 0);
    state.entities.cols.kind[ext2Row] = ENTITY_KIND.metalsExtractor;
    state.entities.cols.owner[ext2Row] = 0;
    state.entities.cols.q[ext2Row] = 0;
    state.entities.cols.r[ext2Row] = 2;
    state.entities.cols.footprintW[ext2Row] = 2;
    state.entities.cols.footprintD[ext2Row] = 2;
    state.entities.cols.shedGroup[ext2Row] = 3;
    state.entities.cols.hp[ext2Row] = 500;
    state.entities.cols.state[ext2Row] = ENTITY_STATE.active;

    step(state, [], 1, pipeline);
    const power = getColonyPower(state, 0);

    expect(power.supply).toBe(16);
    expect(power.rawDemand).toBe(23);
    expect(power.brownout).toBe(true);
    // Newest Extractor (ext2Id) sheds first; 7 + 8 = 15 <= 16 then fits, so the older one (ext1Id) stays on
    expect(power.shedEntityIds).toEqual([ext2Id]);
    expect(power.shedGroupsActive).toEqual([3]);
    expect(power.hqFastRechargeShed).toBe(true);
    expect(power.offlineReasons[ext2Id]).toBe('offline: brownout');
    expect(power.offlineReasons[ext1Id]).toBeUndefined();
    expect(state.entities.cols.state[ext2Row]).toBe(ENTITY_STATE.offlineBrownout);
    expect(state.entities.cols.state[ext1Row]).toBe(ENTITY_STATE.active);
    expect(power.demand).toBe(15); // Remaining online demand: Hub (7) + older Extractor (8)
  });
});
