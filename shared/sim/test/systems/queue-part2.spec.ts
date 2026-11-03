import { describe, expect, it } from 'vitest';
import {
  CONSTRUCTION_LANE_LIMIT,
  ENTITY_KIND,
  ENTITY_STATE,
  PRODUCER_BUFFER_LIMIT,
  UNITS_LANE_LIMIT,
  createState,
  creditResource,
  enqueueQueueTask,
  ensureColonyLedger,
  getColonyQueue,
  insertRow,
} from '../../src';

describe('W02-14 Queue v1 part 2 — wait reasons, ETA, storage non-earmarking, precedence & limits', () => {
  it('queue something costing 600 Metals at 500 cap -> waiting: storage (no ETA), later affordable entry still starts', () => {
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

    // Colony has 100 Metals, 100 Minerals, 50 Biomass, 50 Water; cap is 500 per family
    creditResource(colony, 'metals.t1', 100, 0);
    creditResource(colony, 'minerals.t1', 100, 0);
    creditResource(colony, 'bio.biomass', 50, 0);
    creditResource(colony, 'bio.water', 50, 0);

    // Entry 1: costs 600 Metals (> 500 cap) -> waiting: storage (no ETA), never earmarks stock!
    const q1 = enqueueQueueTask(state, {
      colonyIndex: 0,
      taskId: 'over-cap',
      costOverride: { 'metals.t1': 600 },
      task: { kind: 'build', building: 'solar', q: 2, r: 1 },
    });
    expect(q1.ok).toBe(true);
    if (!q1.ok) throw new Error('expected ok');
    expect(q1.entry.state).toBe('waiting');
    expect(q1.entry.waitReason).toBe('storage');
    expect(q1.entry.etaSeconds).toBeNull();
    expect(q1.entry.waitDetail).toBe('waiting: storage (no ETA)');
    expect(colony.stock['metals.t1']).toBe(100);

    // Entry 2: affordable Solar (60/75/10/5) -> still starts immediately (progressive cost deducted on ticks)!
    const q2 = enqueueQueueTask(state, {
      colonyIndex: 0,
      taskId: 'affordable-solar',
      task: { kind: 'build', building: 'solar', q: 5, r: 1 },
    });
    expect(q2.ok).toBe(true);
    if (!q2.ok) throw new Error('expected ok');
    expect(q2.entry.state).toBe('in_progress');
    expect(colony.stock['metals.t1']).toBe(100);
  });

  it('computes missing resource ETA from current income (e.g. Minerals 5/20 · ~30 s at 0.5/s)', () => {
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

    // Spawn 1 Harvester (0.5/s income)
    const hRow = insertRow(state.entities, 10, 0);
    state.entities.cols.kind[hRow] = ENTITY_KIND.harvester;
    state.entities.cols.owner[hRow] = 0;
    state.entities.cols.state[hRow] = ENTITY_STATE.idle;

    // Stock: plenty of metals/biomass/water, only 5 Minerals for a task costing 20 Minerals (missing 15 @ 0.5/s = 30s)
    creditResource(colony, 'metals.t1', 200, 0);
    creditResource(colony, 'minerals.t1', 5, 0);
    creditResource(colony, 'bio.biomass', 50, 0);
    creditResource(colony, 'bio.water', 50, 0);

    const q = enqueueQueueTask(state, {
      colonyIndex: 0,
      taskId: 'need-minerals',
      costOverride: { 'metals.t1': 60, 'minerals.t1': 20 },
      task: { kind: 'build', building: 'solar', q: 2, r: 1 },
    });
    expect(q.ok).toBe(true);
    if (!q.ok) throw new Error('expected ok');
    expect(q.entry.state).toBe('waiting');
    expect(q.entry.waitReason).toBe('resources');
    expect(q.entry.etaSeconds).toBe(30);
    expect(q.entry.waitDetail).toBe('waiting: Minerals 5/20 · ~30 s');
  });
});

describe('W02-14 Queue v1 part 2 — precedence & limits', () => {
  it('enforces precedence system > player > auto and limits Construction 20, Units 10 + 5 per producer', () => {
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

    // Queue 1 auto and 1 system entry while short on resources, then credit enough for 1 entry -> system entry starts first!
    enqueueQueueTask(state, {
      colonyIndex: 0,
      taskId: 'auto-1',
      precedence: 'auto',
      task: { kind: 'build', building: 'solar', q: 1, r: 1 },
    });
    enqueueQueueTask(state, {
      colonyIndex: 0,
      taskId: 'sys-1',
      precedence: 'system',
      task: { kind: 'build', building: 'solar', q: 4, r: 1 },
    });

    creditResource(colony, 'metals.t1', 60, 0);
    creditResource(colony, 'minerals.t1', 75, 0);
    creditResource(colony, 'bio.biomass', 10, 0);
    creditResource(colony, 'bio.water', 5, 0);

    // Re-scan via another enqueue
    enqueueQueueTask(state, {
      colonyIndex: 0,
      taskId: 'player-1',
      precedence: 'player',
      task: { kind: 'build', building: 'solar', q: 6, r: 1 },
    });

    const queue = getColonyQueue(state, 0, 'construction');
    expect(queue.find((e) => e.taskId === 'sys-1')?.state).toBe('in_progress');
    expect(queue.find((e) => e.taskId === 'player-1')?.state).toBe('waiting');
    expect(queue.find((e) => e.taskId === 'auto-1')?.state).toBe('waiting');

    // Producer buffer limit (5 per producer)
    for (let i = 0; i < PRODUCER_BUFFER_LIMIT; i++) {
      const u = enqueueQueueTask(state, {
        colonyIndex: 0,
        taskId: `u-p1-${i}`,
        task: { kind: 'buildUnit', unit: 'harvester', producerId: 100 },
      });
      expect(u.ok).toBe(true);
    }
    const uOver = enqueueQueueTask(state, {
      colonyIndex: 0,
      taskId: 'u-p1-over',
      task: { kind: 'buildUnit', unit: 'harvester', producerId: 100 },
    });
    expect(uOver).toEqual({ ok: false, code: 'producer_buffer_full', detail: 'producer buffer full' });

    // Units lane limit (10 total across producers)
    for (let i = 0; i < UNITS_LANE_LIMIT - PRODUCER_BUFFER_LIMIT; i++) {
      const u = enqueueQueueTask(state, {
        colonyIndex: 0,
        taskId: `u-p2-${i}`,
        task: { kind: 'buildUnit', unit: 'harvester', producerId: 200 },
      });
      expect(u.ok).toBe(true);
    }
    const laneOver = enqueueQueueTask(state, {
      colonyIndex: 0,
      taskId: 'u-lane-over',
      task: { kind: 'buildUnit', unit: 'harvester', producerId: 300 },
    });
    expect(laneOver).toEqual({ ok: false, code: 'queue_full', detail: 'units lane full' });

    // Construction lane limit (20)
    expect(CONSTRUCTION_LANE_LIMIT).toBe(20);
  });
});
