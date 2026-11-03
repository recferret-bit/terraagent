import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  CONSTRUCTION_LANE_LIMIT,
  ENTITY_KIND,
  ENTITY_STATE,
  HQ_GOALS_LANE_LIMIT,
  PRECEDENCE_RANK,
  PRODUCER_BUFFER_LIMIT,
  TERRAFORM_LANE_LIMIT,
  UNITS_LANE_LIMIT,
  createRegistryPipeline,
  createState,
  creditResource,
  enqueueQueueTask,
  ensureColonyLedger,
  getAllQueueEntries,
  getColonyQueue,
  insertRow,
  reorderQueueTask,
  saveQueueEntries,
  scanAndStartQueueEntries,
  step,
} from '../../src';

function createColonyState(id: string) {
  const state = createState({ planetId: id, planetType: 'temperate', seed: 'w03', radius: 12 });
  const colony = ensureColonyLedger({
    index: 0,
    id: 'col-0',
    name: 'Alpha',
    color: 0xff6b00,
    status: 'active',
    changedAt: 0,
  });
  state.colonies.push(colony);
  return { state, colony };
}

describe('W03-12 Four lanes in sim — lane routing & HQ-goal shell', () => {
  it('routes tasks to all 4 lanes (construction, terraform, units, hqGoals) and persists per-lane colony queues', () => {
    const { state, colony } = createColonyState('p-w03-12');

    expect(CONSTRUCTION_LANE_LIMIT).toBe(20);
    expect(TERRAFORM_LANE_LIMIT).toBe(20);
    expect(UNITS_LANE_LIMIT).toBe(10);
    expect(PRODUCER_BUFFER_LIMIT).toBe(5);
    expect(HQ_GOALS_LANE_LIMIT).toBe(20);

    const cBuild = enqueueQueueTask(state, {
      colonyIndex: 0,
      taskId: 'c-build',
      task: { kind: 'build', building: 'solar', q: 2, r: 0 },
    });
    const cPowerLine = enqueueQueueTask(state, {
      colonyIndex: 0,
      taskId: 'c-line',
      task: { kind: 'powerLine', tiles: [{ q: 3, r: 0 }, { q: 4, r: 0 }] },
    });
    const cRepair = enqueueQueueTask(state, {
      colonyIndex: 0,
      taskId: 'c-repair',
      task: { kind: 'repair', entityId: 42, q: 2, r: 0 },
    });
    const tfEntry = enqueueQueueTask(state, {
      colonyIndex: 0,
      taskId: 'tf-grade',
      task: { kind: 'terraform', op: 'grade', q: 5, r: 0 },
    });
    const uBuilder = enqueueQueueTask(state, {
      colonyIndex: 0,
      taskId: 'u-builder',
      task: { kind: 'buildUnit', unit: 'builder', count: 1 },
    });
    const gGoal = enqueueQueueTask(state, {
      colonyIndex: 0,
      taskId: 'g-power',
      precedence: 'hq',
      task: { kind: 'hqGoal', goal: 'secure_power' },
    });

    expect(cBuild.ok && cBuild.entry.lane).toBe('construction');
    expect(cPowerLine.ok && cPowerLine.entry.lane).toBe('construction');
    expect(cRepair.ok && cRepair.entry.lane).toBe('construction');
    expect(tfEntry.ok && tfEntry.entry.lane).toBe('terraform');
    expect(uBuilder.ok && uBuilder.entry.lane).toBe('units');
    expect(uBuilder.ok && uBuilder.entry.cost).toEqual({ 'metals.t1': 45, 'minerals.t1': 25, 'bio.biomass': 10 });
    expect(gGoal.ok && gGoal.entry.lane).toBe('hqGoals');

    expect(getColonyQueue(state, 0, 'construction').map((e) => e.taskId)).toEqual(['c-build', 'c-line', 'c-repair']);
    expect(getColonyQueue(state, 0, 'terraform').map((e) => e.taskId)).toEqual(['tf-grade']);
    expect(getColonyQueue(state, 0, 'units').map((e) => e.taskId)).toEqual(['u-builder']);
    expect(getColonyQueue(state, 0, 'hqGoals').map((e) => e.taskId)).toEqual(['g-power']);

    const pipeline = createRegistryPipeline({ flags: parseWaves('..03') });
    step(state, [], 5, pipeline);
    expect(getColonyQueue(state, 0, 'hqGoals').map((e) => e.taskId)).toEqual(['g-power']);
    expect((colony.hqGoalQueue as Array<{ taskId: string }>).map((e) => e.taskId)).toEqual(['g-power']);
    expect((colony.terraformQueue as Array<{ taskId: string }>).map((e) => e.taskId)).toEqual(['tf-grade']);
  });
});

describe('W03-12 Five-level precedence & multi-builder concurrency', () => {
  it('orders scan by 5-level precedence system > player > hq > ai > auto', () => {
    expect(PRECEDENCE_RANK.system).toBeGreaterThan(PRECEDENCE_RANK.player);
    expect(PRECEDENCE_RANK.player).toBeGreaterThan(PRECEDENCE_RANK.hq);
    expect(PRECEDENCE_RANK.hq).toBeGreaterThan(PRECEDENCE_RANK.ai);
    expect(PRECEDENCE_RANK.ai).toBeGreaterThan(PRECEDENCE_RANK.auto);

    const order = ['auto', 'ai', 'hq', 'player', 'system'] as const;
    const expectedWinners = ['system', 'player', 'hq', 'ai', 'auto'] as const;

    for (let startIdx = 0; startIdx < expectedWinners.length; startIdx++) {
      const { state, colony } = createColonyState(`p-prec-${startIdx}`);
      const allowed = new Set(expectedWinners.slice(startIdx));
      let idx = 0;
      for (const prec of order) {
        if (!allowed.has(prec)) continue;
        idx++;
        enqueueQueueTask(state, {
          colonyIndex: 0,
          taskId: `entry-${prec}`,
          precedence: prec,
          costOverride: { 'metals.t1': 50 },
          task: { kind: 'terraform', op: 'grade', q: idx, r: 0 },
        });
      }

      creditResource(colony, 'metals.t1', 50, 1);
      const entries = getAllQueueEntries(state);
      const started = scanAndStartQueueEntries(state, entries, 0, 1);
      saveQueueEntries(state, entries, 1);

      expect(started.map((e) => e.taskId)).toEqual([`entry-${expectedWinners[startIdx]}`]);
    }
  });

  it('allows multiple concurrent in_progress construction entries when the colony has both HQ and Builder Drone', () => {
    const { state, colony } = createColonyState('p-multi-builder');

    const hqRow = insertRow(state.entities, 1, 0);
    state.entities.cols.kind[hqRow] = ENTITY_KIND.hq;
    state.entities.cols.owner[hqRow] = 0;
    state.entities.cols.hp[hqRow] = 900;
    state.entities.cols.state[hqRow] = ENTITY_STATE.idle;

    const bRow = insertRow(state.entities, 2, 0);
    state.entities.cols.kind[bRow] = ENTITY_KIND.builder;
    state.entities.cols.owner[bRow] = 0;
    state.entities.cols.hp[bRow] = 150;
    state.entities.cols.state[bRow] = ENTITY_STATE.idle;

    creditResource(colony, 'metals.t1', 300, 0);
    creditResource(colony, 'minerals.t1', 300, 0);
    creditResource(colony, 'bio.biomass', 100, 0);
    creditResource(colony, 'bio.water', 100, 0);

    const q1 = enqueueQueueTask(state, {
      colonyIndex: 0,
      taskId: 'b-1',
      task: { kind: 'build', building: 'solar', q: 2, r: 1 },
    });
    const q2 = enqueueQueueTask(state, {
      colonyIndex: 0,
      taskId: 'b-2',
      task: { kind: 'build', building: 'solar', q: 5, r: 1 },
    });
    expect(q1.ok && q1.entry.state).toBe('in_progress');
    expect(q2.ok && q2.entry.state).toBe('in_progress');
  });
});

describe('W03-12 Lane limits & lane_full auto-eviction', () => {
  it('when a lane is full with 20 auto entries, enqueuing a player entry drops the oldest auto entry and accepts the player entry', () => {
    const { state } = createColonyState('p-evict');

    for (let i = 0; i < CONSTRUCTION_LANE_LIMIT; i++) {
      const res = enqueueQueueTask(state, {
        colonyIndex: 0,
        taskId: `auto-${i}`,
        precedence: 'auto',
        costOverride: { 'metals.t1': 100 },
        tick: i + 1,
        task: { kind: 'repair', entityId: 100 + i, q: 1, r: 0 },
      });
      expect(res.ok).toBe(true);
    }
    expect(getColonyQueue(state, 0, 'construction')).toHaveLength(20);

    const playerRes = enqueueQueueTask(state, {
      colonyIndex: 0,
      taskId: 'player-21',
      precedence: 'player',
      costOverride: { 'metals.t1': 100 },
      tick: 21,
      task: { kind: 'repair', entityId: 999, q: 2, r: 0 },
    });
    expect(playerRes.ok).toBe(true);

    const afterIds = getColonyQueue(state, 0, 'construction').map((e) => e.taskId);
    expect(afterIds).toHaveLength(20);
    expect(afterIds).not.toContain('auto-0');
    expect(afterIds[0]).toBe('auto-1');
    expect(afterIds[19]).toBe('player-21');
  });

  it('when a lane is full with 20 player entries, enqueuing a 21st player entry is rejected with lane_full', () => {
    const { state } = createColonyState('p-full');

    for (let i = 0; i < CONSTRUCTION_LANE_LIMIT; i++) {
      const res = enqueueQueueTask(state, {
        colonyIndex: 0,
        taskId: `player-${i}`,
        precedence: 'player',
        costOverride: { 'metals.t1': 100 },
        tick: i + 1,
        task: { kind: 'repair', entityId: 200 + i, q: 1, r: 0 },
      });
      expect(res.ok).toBe(true);
    }
    expect(getColonyQueue(state, 0, 'construction')).toHaveLength(20);

    const over = enqueueQueueTask(state, {
      colonyIndex: 0,
      taskId: 'player-overflow',
      precedence: 'player',
      costOverride: { 'metals.t1': 100 },
      tick: 25,
      task: { kind: 'repair', entityId: 500, q: 2, r: 0 },
    });
    expect(over).toEqual({ ok: false, code: 'lane_full', detail: 'construction lane full' });

    const pipeline = createRegistryPipeline({ flags: parseWaves('..03') });
    const stepRes = step(
      state,
      [
        {
          commandId: 'cmd-over-21',
          colonyIndex: 0,
          source: 'player',
          kind: 'enqueueTask',
          args: { taskId: 'cmd-overflow', repair: { entityId: 501, q: 2, r: 0 } },
        },
      ],
      1,
      pipeline,
    );
    expect(stepRes.outcomes[0].code).toBe('lane_full');

    const ro = reorderQueueTask(state, 'player-19', { direction: 'top', colonyIndex: 0 });
    expect(ro.ok).toBe(true);
    expect(getColonyQueue(state, 0, 'construction')[0].taskId).toBe('player-19');
  });
});
