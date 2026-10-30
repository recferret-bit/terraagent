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

describe('W02-13 Queue v1 part 1 — Construction and Units lanes, payment at start, cancel refunds, reorderTask', () => {
  it('cancel a waiting entry -> 100 % stock unchanged; cancel an in_progress entry -> 75 % refunded', () => {
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

    // Entry 1: Solar at (2, 1) -> starts immediately (in_progress), pays 60/75/10/5 -> stock is now 40/25/10/5
    const q1 = enqueueQueueTask(state, {
      colonyIndex: 0,
      taskId: 'solar-1',
      task: { kind: 'build', building: 'solar', q: 2, r: 1 },
    });
    expect(q1.ok).toBe(true);
    if (!q1.ok) throw new Error('expected ok');
    expect(q1.entry.state).toBe('in_progress');
    expect(q1.entry.paid).toBe(true);
    expect(colony.stock['metals.t1']).toBe(40);
    expect(colony.stock['minerals.t1']).toBe(25);

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

    // 1. Cancel waiting entry (solar-2) -> 100% stock unchanged (40/25/10/5)
    const cWait = cancelQueueTask(state, 'solar-2', 0);
    expect(cWait).toEqual({ ok: true, refunded: false });
    expect(colony.stock['metals.t1']).toBe(40);
    expect(colony.stock['minerals.t1']).toBe(25);
    expect(colony.stock['bio.biomass']).toBe(10);
    expect(colony.stock['bio.water']).toBe(5);

    // 2. Cancel in_progress entry (solar-1) -> 75% of (60/75/10/5) = (45/56.25/7.5/3.75) refunded!
    const cProg = cancelQueueTask(state, 'solar-1', 0);
    expect(cProg).toEqual({ ok: true, refunded: true });
    expect(colony.stock['metals.t1']).toBe(40 + 45);
    expect(colony.stock['minerals.t1']).toBe(25 + 56.25);
    expect(colony.stock['bio.biomass']).toBe(10 + 7.5);
    expect(colony.stock['bio.water']).toBe(5 + 3.75);
  });

  it('reorderTask moves player entry within its lane', () => {
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
      [{ commandId: 'c-ro', colonyIndex: 0, kind: 'reorderTask', args: { taskId: 't-2', toIndex: 0 } }],
      1,
      pipeline,
    );
    expect(res.outcomes[0].code).toBeUndefined();
    expect(getColonyQueue(state, 0, 'construction').map((e) => e.taskId)).toEqual(['t-2', 't-3', 't-1']);
  });
});
