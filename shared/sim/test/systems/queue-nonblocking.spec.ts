import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createRegistryPipeline,
  createState,
  creditResource,
  enqueueQueueTask,
  ensureColonyLedger,
  getColonyQueue,
  step,
} from '../../src';
import { readyBuilder } from '../helpers/builder';
import { resourceValue } from '../../src/systems/economy/ledger';

describe('W02-15 Non-blocking queue scan', () => {
  it('entry 1 waiting on Minerals, entry 2 needs only Metals (in stock) -> entry 2 starts immediately', () => {
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

    // Colony has 100 Metals, 0 Minerals
    creditResource(colony, 'metals.t1', 100, 0);

    // Entry 1 (head): requires 50 Metals + 50 Minerals -> blocked waiting on Minerals
    const q1 = enqueueQueueTask(state, {
      colonyIndex: 0,
      taskId: 'entry-1',
      costOverride: { 'metals.t1': 50, 'minerals.t1': 50 },
      task: { kind: 'build', building: 'solar', q: 2, r: 1 },
    });
    expect(q1.ok).toBe(true);
    if (!q1.ok) throw new Error('expected ok');
    expect(q1.entry.state).toBe('waiting');
    expect(q1.entry.waitReason).toBe('resources');
    expect(resourceValue(colony, 'metals.t1')).toBe(100); // Not earmarked by entry 1!

    // Entry 2: requires only 60 Metals (in stock!) -> starts immediately despite entry 1 waiting ahead of it
    const q2 = enqueueQueueTask(state, {
      colonyIndex: 0,
      taskId: 'entry-2',
      costOverride: { 'metals.t1': 60 },
      task: { kind: 'build', building: 'solar', q: 5, r: 1 },
    });
    expect(q2.ok).toBe(true);
    if (!q2.ok) throw new Error('expected ok');
    expect(q2.entry.state).toBe('in_progress');
    expect(resourceValue(colony, 'metals.t1')).toBe(100); // Deducted progressively on ticks

    const queue = getColonyQueue(state, 0, 'construction');
    expect(queue[0].taskId).toBe('entry-1');
    expect(queue[0].state).toBe('waiting');
    expect(queue[1].taskId).toBe('entry-2');
    expect(queue[1].state).toBe('in_progress');
  });

  it('on tick scan, when both entries are waiting and entry 2 becomes affordable first, entry 2 starts without being blocked by entry 1', () => {
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

    // Queue entry 1 (needs 50 Minerals) and entry 2 (needs 40 Metals) with 0 stock
    enqueueQueueTask(state, {
      colonyIndex: 0,
      taskId: 'wait-minerals',
      costOverride: { 'minerals.t1': 50 },
      task: { kind: 'build', building: 'solar', q: 2, r: 1 },
    });
    enqueueQueueTask(state, {
      colonyIndex: 0,
      taskId: 'wait-metals',
      costOverride: { 'metals.t1': 40 },
      task: { kind: 'build', building: 'solar', q: 5, r: 1 },
    });

    // Credit 40 Metals and step the simulation -> entry 2 starts while entry 1 stays waiting (its site is prepared and
    // the HQ stands in build reach, so it builds from this step on: W02-16)
    readyBuilder(state, [{ q: 5, r: 1 }], { q: 3, r: 0 });
    creditResource(colony, 'metals.t1', 40, 0);
    const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });
    step(state, [], 1, pipeline);

    const queue = getColonyQueue(state, 0, 'construction');
    expect(queue.find((e) => e.taskId === 'wait-minerals')?.state).toBe('waiting');
    expect(queue.find((e) => e.taskId === 'wait-metals')?.state).toBe('in_progress');
    // 1 tick of progressive deduction at 1.5/90 of 40 Metals = 0.666667 deducted
    expect(resourceValue(colony, 'metals.t1')).toBeCloseTo(40 - 40 * (1.5 / 90), 4);
  });
});
