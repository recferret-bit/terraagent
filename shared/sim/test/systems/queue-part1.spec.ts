import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  cancelQueueTask,
  createRegistryPipeline,
  createState,
  creditResource,
  enqueueQueueTask,
  ensureColonyLedger,
  getColonyQueue,
  reorderQueueTask,
  step,
} from '../../src';

describe('W02-13 Queue v1 part 1 — Construction and Units lanes, progressive payment, cancel refunds, reorderTask', () => {
  it('cancel a waiting entry -> 100 % stock unchanged; cancel an in_progress entry -> 50 % of spentCost refunded', () => {
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

    // Seed colony with enough for 1 Solar (60/75/10/5), not enough for a second Solar
    creditResource(colony, 'metals.t1', 100, 0);
    creditResource(colony, 'minerals.t1', 100, 0);
    creditResource(colony, 'bio.biomass', 20, 0);
    creditResource(colony, 'bio.water', 10, 0);

    // Entry 1: Solar at (2, 1) -> starts immediately (in_progress), deducts progressively
    const q1 = enqueueQueueTask(state, {
      colonyIndex: 0,
      taskId: 'solar-1',
      task: { kind: 'build', building: 'solar', q: 2, r: 1 },
    });
    expect(q1.ok).toBe(true);
    if (!q1.ok) throw new Error('expected ok');
    expect(q1.entry.state).toBe('in_progress');

    // Entry 2: Solar at (5, 1) -> waits on resources (unpaid)
    const q2 = enqueueQueueTask(state, {
      colonyIndex: 0,
      taskId: 'solar-2',
      task: { kind: 'build', building: 'solar', q: 5, r: 1 },
    });
    expect(q2.ok).toBe(true);
    if (!q2.ok) throw new Error('expected ok');
    expect(q2.entry.state).toBe('waiting');
    expect(q2.entry.paid).toBe(false);

    // Step 30 ticks (halfway: 45/90 = 50% progress -> spent 30/37.5/5/2.5, remaining stock 70/62.5/15/7.5)
    const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });
    step(state, [], 30, pipeline);
    expect(colony.stock['metals.t1']).toBeCloseTo(70, 4);
    expect(colony.stock['minerals.t1']).toBeCloseTo(62.5, 4);

    // 1. Cancel waiting entry (solar-2) -> stock unchanged
    const cWait = cancelQueueTask(state, 'solar-2', 0);
    expect(cWait).toEqual({ ok: true, refunded: false });
    expect(colony.stock['metals.t1']).toBeCloseTo(70, 4);

    // 2. Cancel in_progress entry (solar-1) -> 50% of spent (30/37.5/5/2.5) = (15/18.75/2.5/1.25) refunded!
    const cProg = cancelQueueTask(state, 'solar-1', 0);
    expect(cProg).toEqual({ ok: true, refunded: true });
    expect(colony.stock['metals.t1']).toBeCloseTo(70 + 15, 4);
    expect(colony.stock['minerals.t1']).toBeCloseTo(62.5 + 18.75, 4);
    expect(colony.stock['bio.biomass']).toBeCloseTo(15 + 2.5, 4);
    expect(colony.stock['bio.water']).toBeCloseTo(7.5 + 1.25, 4);
  });

  it('reorderTask moves player entry within its lane, and the new head starts first', () => {
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

    enqueueQueueTask(state, { colonyIndex: 0, taskId: 't-1', task: { kind: 'build', building: 'solar', q: 1, r: 1 } });
    enqueueQueueTask(state, { colonyIndex: 0, taskId: 't-2', task: { kind: 'build', building: 'solar', q: 3, r: 1 } });
    enqueueQueueTask(state, { colonyIndex: 0, taskId: 't-3', task: { kind: 'build', building: 'solar', q: 5, r: 1 } });

    const reordered = reorderQueueTask(state, 't-3', { toIndex: 0, colonyIndex: 0 });
    expect(reordered.ok).toBe(true);
    expect(getColonyQueue(state, 0, 'construction').map((e) => e.taskId)).toEqual(['t-3', 't-1', 't-2']);

    // Also test via command handler in step
    const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });
    const res = step(
      state,
      [{ commandId: 'c-ro', colonyIndex: 0, source: 'player', kind: 'reorderTask', args: { taskId: 't-2', toIndex: 0 } }],
      1,
      pipeline,
    );
    expect(res.outcomes[0].code).toBeUndefined();
    expect(getColonyQueue(state, 0, 'construction').map((e) => e.taskId)).toEqual(['t-2', 't-3', 't-1']);

    // Stock for one Solar arrives: the reordered head (t-2) starts, the others wait (W02-13 acceptance)
    for (const [k, v] of [['metals.t1', 100], ['minerals.t1', 100], ['bio.biomass', 20], ['bio.water', 10]] as const) creditResource(colony, k, v, 1);
    step(state, [], 1, pipeline);
    expect(getColonyQueue(state, 0, 'construction').filter((e) => e.state === 'in_progress').map((e) => e.taskId)).toEqual(['t-2']);
  });
});
