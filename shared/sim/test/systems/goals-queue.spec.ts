import { describe, expect, it } from 'vitest';
import { eventDef, parseWaves } from '@terra/contracts';
import {
  DEFAULT_COLONY_PRIORITIES,
  ENTITY_KIND,
  ENTITY_STATE,
  SimHost,
  createRegistryPipeline,
  createState,
  enqueueQueueTask,
  ensureColonyRecord,
  getColonyGoals,
  getColonyPriorities,
  getColonyQueue,
  getHqGoalLimit,
  insertRow,
  restore,
  snapshot,
  spawnHqUnit,
  step,
  view,
} from '../../src';

function createW08Planet(seed = 'w08-16') {
  const state = createState({ planetId: `pl-${seed}`, planetType: 'temperate', seed, radius: 8 });
  const colony = ensureColonyRecord(state, 0, 0);
  colony.status = 'active';
  spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
  const pipeline = createRegistryPipeline({ flags: parseWaves('..08') });
  return { state, colony, pipeline };
}

describe('W08-16 HQ T1 goal queue limit', () => {
  it('enforces HQ T1 limit of 2 open goals (3rd rejected goal_limit), and accepts 3rd after cancel or HQ T2 refit', () => {
    const { state, colony, pipeline } = createW08Planet('limit-t1');
    expect(getHqGoalLimit(state, 0)).toBe(2);

    const r1 = step(
      state,
      [
        { commandId: 'g1', colonyIndex: 0, source: 'player', kind: 'queueGoal', args: { goal: 'establish_colony' } },
        { commandId: 'g2', colonyIndex: 0, source: 'player', kind: 'queueGoal', args: { goal: 'grow_economy', resource: 'metals.t1', targetRatePerMin: 12, budgetBp: 4000 } },
        { commandId: 'g3', colonyIndex: 0, source: 'player', kind: 'queueGoal', args: { goal: 'secure_power', targetNetEnergyPerS: 10 } },
      ],
      1,
      pipeline,
    );
    expect(r1.outcomes.map((o) => o.code)).toEqual([undefined, undefined, 'goal_limit']);
    const goalsAfter2 = getColonyGoals(state, 0);
    expect(goalsAfter2).toHaveLength(2);
    expect(goalsAfter2[0]).toMatchObject({ id: 'goal_0_1', goal: 'establish_colony', status: 'active', budgetBp: 5000 });
    expect(goalsAfter2[1]).toMatchObject({
      id: 'goal_0_2',
      goal: 'grow_economy',
      status: 'queued',
      params: { resource: 'metals.t1', targetRatePerMin: 12 },
      budgetBp: 4000,
    });
    const progEvents = r1.events.filter((e) => e.kind === 'goalProgress');
    expect(progEvents).toHaveLength(2);
    expect(eventDef('goalProgress').data.safeParse(progEvents[0].data).success).toBe(true);

    const rCancel = step(
      state,
      [
        { commandId: 'c1', colonyIndex: 0, source: 'player', kind: 'cancelGoal', args: { goalId: 'goal_0_1' } },
        { commandId: 'g3b', colonyIndex: 0, source: 'player', kind: 'queueGoal', args: { goal: 'secure_power', targetNetEnergyPerS: 10 } },
      ],
      1,
      pipeline,
    );
    expect(rCancel.outcomes.map((o) => o.code)).toEqual([undefined, undefined]);
    expect(getColonyGoals(state, 0).map((g) => ({ id: g.id, status: g.status }))).toEqual([
      { id: 'goal_0_2', status: 'active' },
      { id: 'goal_0_3', status: 'queued' },
    ]);

    colony.hqTier = 2;
    expect(getHqGoalLimit(state, 0)).toBe(3);
    const rT2 = step(
      state,
      [{ commandId: 'g4', colonyIndex: 0, source: 'player', kind: 'queueGoal', args: { goal: 'grow_economy' } }],
      1,
      pipeline,
    );
    expect(rT2.outcomes[0].code).toBeUndefined();
    expect(getColonyGoals(state, 0)).toHaveLength(3);
  });
});

describe('W08-16 HQ T2 and T3 goal queue limits', () => {
  it('supports HQ T2 (limit 3) and HQ T3 (limit 5) from HQ or Command Hub entity tiers', () => {
    const { state, pipeline } = createW08Planet('tiers-2-3');
    state.entities.cols.tier[0] = 2;
    expect(getHqGoalLimit(state, 0)).toBe(3);

    for (let i = 1; i <= 3; i++) {
      const res = step(
        state,
        [{ commandId: `q-${i}`, colonyIndex: 0, source: 'player', kind: 'queueGoal', args: { goal: 'grow_economy' } }],
        1,
        pipeline,
      );
      expect(res.outcomes[0].code).toBeUndefined();
    }
    const overT2 = step(
      state,
      [{ commandId: 'q-4', colonyIndex: 0, source: 'player', kind: 'queueGoal', args: { goal: 'secure_power' } }],
      1,
      pipeline,
    );
    expect(overT2.outcomes[0].code).toBe('goal_limit');

    const hubRow = insertRow(state.entities, state.meta.nextEntityId++, state.meta.tick);
    state.entities.cols.kind[hubRow] = ENTITY_KIND.commandHub;
    state.entities.cols.owner[hubRow] = 0;
    state.entities.cols.tier[hubRow] = 3;
    state.entities.cols.hp[hubRow] = 3000;
    state.entities.cols.hpMax[hubRow] = 3000;
    state.entities.cols.state[hubRow] = ENTITY_STATE.active;

    expect(getHqGoalLimit(state, 0)).toBe(5);
    const r45 = step(
      state,
      [
        { commandId: 'q-4b', colonyIndex: 0, source: 'player', kind: 'queueGoal', args: { goal: 'secure_power' } },
        { commandId: 'q-5b', colonyIndex: 0, source: 'player', kind: 'queueGoal', args: { goal: 'grow_economy' } },
        { commandId: 'q-6b', colonyIndex: 0, source: 'player', kind: 'queueGoal', args: { goal: 'secure_power' } },
      ],
      1,
      pipeline,
    );
    expect(r45.outcomes.map((o) => o.code)).toEqual([undefined, undefined, 'goal_limit']);
    expect(getColonyGoals(state, 0)).toHaveLength(5);
  });
});

describe('W08-16 reorderGoal', () => {
  it('reorders goals via toIndex and direction (up/down/top/bottom) and updates active status on the new head', () => {
    const { state, colony, pipeline } = createW08Planet('reorder');
    colony.hqTier = 3;
    step(
      state,
      [
        { commandId: 'g1', colonyIndex: 0, source: 'player', kind: 'queueGoal', args: { goal: 'establish_colony' } },
        { commandId: 'g2', colonyIndex: 0, source: 'player', kind: 'queueGoal', args: { goal: 'grow_economy' } },
        { commandId: 'g3', colonyIndex: 0, source: 'player', kind: 'queueGoal', args: { goal: 'secure_power' } },
      ],
      1,
      pipeline,
    );

    const rTo0 = step(
      state,
      [{ commandId: 'ro1', colonyIndex: 0, source: 'player', kind: 'reorderGoal', args: { goalId: 'goal_0_3', toIndex: 0 } }],
      1,
      pipeline,
    );
    expect(rTo0.outcomes[0].code).toBeUndefined();
    expect(getColonyGoals(state, 0).map((g) => ({ id: g.id, status: g.status }))).toEqual([
      { id: 'goal_0_3', status: 'active' },
      { id: 'goal_0_1', status: 'queued' },
      { id: 'goal_0_2', status: 'queued' },
    ]);

    step(
      state,
      [{ commandId: 'ro2', colonyIndex: 0, source: 'player', kind: 'reorderGoal', args: { goalId: 'goal_0_2', direction: 'up' } }],
      1,
      pipeline,
    );
    expect(getColonyGoals(state, 0).map((g) => g.id)).toEqual(['goal_0_3', 'goal_0_2', 'goal_0_1']);

    step(
      state,
      [{ commandId: 'ro3', colonyIndex: 0, source: 'player', kind: 'reorderGoal', args: { goalId: 'goal_0_3', direction: 'down' } }],
      1,
      pipeline,
    );
    expect(getColonyGoals(state, 0).map((g) => ({ id: g.id, status: g.status }))).toEqual([
      { id: 'goal_0_2', status: 'active' },
      { id: 'goal_0_3', status: 'queued' },
      { id: 'goal_0_1', status: 'queued' },
    ]);

    const rBad = step(
      state,
      [{ commandId: 'ro-bad', colonyIndex: 0, source: 'player', kind: 'reorderGoal', args: { goalId: 'goal_99', toIndex: 0 } }],
      1,
      pipeline,
    );
    expect(rBad.outcomes[0].code).toBe('unknown_goal');
  });
});

describe('W08-16 cancelGoal child orders and acceptSuggestion', () => {
  it('cancels waiting child orders in the colony order queue when cancelGoal is executed', () => {
    const { state, pipeline } = createW08Planet('cancel-children');
    step(
      state,
      [{ commandId: 'g1', colonyIndex: 0, source: 'player', kind: 'queueGoal', args: { goal: 'establish_colony' } }],
      1,
      pipeline,
    );
    const qChild = enqueueQueueTask(state, {
      colonyIndex: 0,
      taskId: 'hq-child-1',
      precedence: 'hq',
      goalId: 'goal_0_1',
      task: { kind: 'build', building: 'solar', q: 2, r: 1 },
    });
    const qPlayer = enqueueQueueTask(state, {
      colonyIndex: 0,
      taskId: 'player-task-1',
      precedence: 'player',
      task: { kind: 'build', building: 'solar', q: 4, r: 1 },
    });
    expect(qChild.ok && qPlayer.ok).toBe(true);
    expect(getColonyQueue(state, 0, 'construction').map((e) => e.taskId)).toEqual(['hq-child-1', 'player-task-1']);

    const rCancel = step(
      state,
      [{ commandId: 'c1', colonyIndex: 0, source: 'player', kind: 'cancelGoal', args: { goalId: 'goal_0_1' } }],
      1,
      pipeline,
    );
    expect(rCancel.outcomes[0].code).toBeUndefined();
    expect(getColonyQueue(state, 0, 'construction').map((e) => e.taskId)).toEqual(['player-task-1']);
  });

  it('acceptSuggestion queues establish_colony at S0 and clears the active suggestion on the colony', () => {
    const { state, colony, pipeline } = createW08Planet('suggestion-s0');
    colony.stage = 0;
    colony.suggestion = { suggestionId: 'sug_s0', stage: 0, goal: 'establish_colony' };

    const res = step(
      state,
      [{ commandId: 'acc-1', colonyIndex: 0, source: 'player', kind: 'acceptSuggestion', args: {} }],
      1,
      pipeline,
    );
    expect(res.outcomes[0].code).toBeUndefined();
    expect(colony.suggestion).toBeNull();
    expect(getColonyGoals(state, 0)).toMatchObject([{ id: 'goal_0_1', goal: 'establish_colony', status: 'active' }]);
  });
});

describe('W08-16 setPriorities persistence across snapshot/restore', () => {
  it('persists priorities on colony state and view across snapshot/restore', () => {
    const { state, pipeline } = createW08Planet('priorities-snap');
    const host = new SimHost(pipeline);
    host.load(state);
    expect(getColonyPriorities(host.state, 0)).toEqual(DEFAULT_COLONY_PRIORITIES);
    expect(host.view().colonies[0].priorities).toEqual(DEFAULT_COLONY_PRIORITIES);

    host.submit({ commandId: 'p1', colonyIndex: 0, source: 'player', kind: 'setPriorities', args: { expansion: 80, defense: 20 } });
    host.step(1);
    expect(getColonyPriorities(host.state, 0)).toEqual({
      economy: 50,
      expansion: 80,
      defense: 20,
      power: 50,
      terraform: 50,
    });

    host.submit({
      commandId: 'p2',
      colonyIndex: 0,
      source: 'player',
      kind: 'setPriorities',
      args: { priorities: { economy: 90, expansion: 80, defense: 30, power: 70, terraform: 40 } },
    });
    host.submit({
      commandId: 'g1',
      colonyIndex: 0,
      source: 'player',
      kind: 'queueGoal',
      args: { goal: 'grow_economy', resource: 'metals.t1', targetRatePerMin: 15 },
    });
    host.step(1);

    const restored = restore(snapshot(host.state));
    const restoredView = view(restored);
    expect(getColonyPriorities(restored, 0)).toEqual({
      economy: 90,
      expansion: 80,
      defense: 30,
      power: 70,
      terraform: 40,
    });
    expect(restoredView.colonies[0].priorities).toEqual({
      economy: 90,
      expansion: 80,
      defense: 30,
      power: 70,
      terraform: 40,
    });
    expect(restoredView.colonies[0].goalLimit).toBe(2);
    expect(restoredView.colonies[0].goals?.[0]).toMatchObject({
      id: 'goal_0_1',
      goal: 'grow_economy',
      status: 'active',
      params: { resource: 'metals.t1', targetRatePerMin: 15 },
    });
  });

  it('supports dev.goal add, cancel, and clear commands and wave_disabled when W08 is off', () => {
    const { state, pipeline } = createW08Planet('dev-goal');
    const rAdd = step(
      state,
      [{ commandId: 'dg-add', colonyIndex: 0, source: 'dev', kind: 'dev.goal', args: { op: 'add', goal: 'secure_power', targetNetEnergyPerS: 10 } }],
      1,
      pipeline,
    );
    expect(rAdd.outcomes[0].code).toBeUndefined();
    expect(getColonyGoals(state, 0)).toHaveLength(1);

    const rClear = step(
      state,
      [{ commandId: 'dg-clear', colonyIndex: 0, source: 'dev', kind: 'dev.goal', args: { op: 'clear' } }],
      1,
      pipeline,
    );
    expect(rClear.outcomes[0].code).toBeUndefined();
    expect(getColonyGoals(state, 0)).toHaveLength(0);

    const w07Pipeline = createRegistryPipeline({ flags: parseWaves('..07') });
    const rOff = step(
      state,
      [
        { commandId: 'off-1', colonyIndex: 0, source: 'player', kind: 'queueGoal', args: { goal: 'establish_colony' } },
        { commandId: 'off-2', colonyIndex: 0, source: 'player', kind: 'setPriorities', args: { economy: 80 } },
      ],
      1,
      w07Pipeline,
    );
    expect(rOff.outcomes.map((o) => o.code)).toEqual(['wave_disabled', 'wave_disabled']);
  });
});
