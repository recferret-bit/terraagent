import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createRegistryPipeline,
  createState,
  DEPOSIT,
  ensureColonyLedger,
  ensureColonyRecord,
  ENTITY_KIND,
  ENTITY_STATE,
  enqueueQueueTask,
  getAllQueueEntries,
  getColonyGoalHistory,
  getColonyGoals,
  getColonyQueue,
  getOpenColonyGoals,
  hexIndex,
  PREP,
  spawnHqUnit,
  startBuildingConstruction,
  step,
  type SimEvent,
} from '../../src';

function createS0ColonyPlanet(seed = 'w08-17') {
  const state = createState({ planetId: `pl-${seed}`, planetType: 'temperate', seed, radius: 10 });
  const colony = ensureColonyLedger(ensureColonyRecord(state, 0, 0));
  colony.status = 'active';
  colony.stock['metals.t1'] = 600;
  colony.stock['minerals.t1'] = 350;
  colony.stock['bio.water'] = 200;
  colony.stock['bio.biomass'] = 200;

  spawnHqUnit(state, { owner: 0, q: 0, r: 0 });

  const idx = hexIndex(state.grid.radius);
  const depTile = idx.indexOf(4, -2);
  state.grid.layers.deposit[depTile] = DEPOSIT.metals;
  state.grid.layers.richness[depTile] = 10000;

  const pipeline = createRegistryPipeline({ flags: parseWaves('..08') });
  return { state, colony, pipeline };
}

function countCompletedKind(state: ReturnType<typeof createState>, owner: number, kind: number): number {
  let found = 0;
  const { count, cols } = state.entities;
  for (let r = 0; r < count; r++) {
    if (cols.owner[r] !== owner || cols.kind[r] !== kind) continue;
    if (cols.hp[r] <= 0 && cols.hpMax[r] > 0) continue;
    if (cols.state[r] !== ENTITY_STATE.constructing && cols.state[r] !== ENTITY_STATE.waiting) {
      found++;
    }
  }
  return found;
}

describe('W08-17 Goal breakdown: establish_colony', () => {
  it('queues hq-tagged Hub, extractor, and solar orders at S0, emits goalProgress steps, and completes goalDone', () => {
    const { state, pipeline } = createS0ColonyPlanet('establish-s0');
    const idx = hexIndex(state.grid.radius);
    // Mark a tile near the Hub footprint raw so site prep is exercised before Hub completion
    state.grid.layers.prep[idx.indexOf(1, 0)] = PREP.wild;

    const rQueue = step(
      state,
      [{ commandId: 'g-est', colonyIndex: 0, source: 'player', kind: 'queueGoal', args: { goal: 'establish_colony' } }],
      1,
      pipeline,
    );
    expect(rQueue.outcomes[0].code).toBeUndefined();

    const active = getOpenColonyGoals(state, 0)[0];
    expect(active).toBeDefined();
    expect(active.goal).toBe('establish_colony');
    expect(active.status).toBe('active');
    expect(active.childTaskIds.length).toBeGreaterThanOrEqual(3);

    const queuedChildren = getAllQueueEntries(state).filter((e) => e.goalId === active.id);
    expect(queuedChildren.length).toBe(3);
    expect(queuedChildren.every((e) => e.precedence === 'hq')).toBe(true);
    expect(queuedChildren.map((e) => (e.task.kind === 'build' ? e.task.building : e.task.kind))).toEqual([
      'commandHub',
      'metalsExtractor',
      'solar',
    ]);

    const progressValues: number[] = [];
    const doneEvents: SimEvent[] = [];

    for (let i = 0; i < 120; i++) {
      const r = step(state, [], 5, pipeline);
      for (const ev of r.events) {
        if (ev.kind === 'goalProgress' && (ev.data as { goalId?: string }).goalId === active.id) {
          progressValues.push((ev.data as { progress: number }).progress);
        }
        if (ev.kind === 'goalDone') {
          doneEvents.push(ev);
        }
      }
      if (doneEvents.length > 0) break;
    }

    expect(countCompletedKind(state, 0, ENTITY_KIND.commandHub)).toBe(1);
    expect(countCompletedKind(state, 0, ENTITY_KIND.metalsExtractor)).toBe(1);
    expect(countCompletedKind(state, 0, ENTITY_KIND.solar)).toBe(1);

    expect(progressValues).toContain(0.5);
    expect(progressValues).toContain(0.75);
    expect(progressValues).toContain(1);
    expect(doneEvents).toHaveLength(1);
    expect(doneEvents[0].data).toMatchObject({
      colonyIndex: 0,
      goalId: active.id,
      goal: 'establish_colony',
    });

    const finalGoal = getColonyGoals(state, 0).find((g) => g.id === active.id);
    expect(finalGoal?.status).toBe('done');
    expect(finalGoal?.progress).toBe(1);
    expect(finalGoal?.stepsCompleted).toBe(4);
  });
});

describe('W08-17 acceptSuggestion establish_colony chain', () => {
  it('acceptSuggestion at S0 queues establish_colony and promotes a 2nd queued goal upon completion', () => {
    const { state, pipeline } = createS0ColonyPlanet('accept-s0-chain');

    step(
      state,
      [
        { commandId: 'acc-1', colonyIndex: 0, source: 'player', kind: 'acceptSuggestion', args: { stage: 0 } },
        {
          commandId: 'q-2',
          colonyIndex: 0,
          source: 'player',
          kind: 'queueGoal',
          args: { goal: 'secure_power', targetNetEnergyPerS: 30 },
        },
      ],
      1,
      pipeline,
    );

    const openStart = getOpenColonyGoals(state, 0);
    expect(openStart.map((g) => ({ goal: g.goal, status: g.status }))).toEqual([
      { goal: 'establish_colony', status: 'active' },
      { goal: 'secure_power', status: 'queued' },
    ]);

    const doneGoals: string[] = [];
    for (let i = 0; i < 160; i++) {
      const r = step(state, [], 5, pipeline);
      for (const ev of r.events) {
        if (ev.kind === 'goalDone') {
          doneGoals.push((ev.data as { goal: string }).goal);
        }
      }
      if (doneGoals.length >= 2) break;
    }

    expect(doneGoals).toEqual(['establish_colony', 'secure_power']);
    expect(countCompletedKind(state, 0, ENTITY_KIND.commandHub)).toBe(1);
    expect(countCompletedKind(state, 0, ENTITY_KIND.metalsExtractor)).toBe(1);
    expect(countCompletedKind(state, 0, ENTITY_KIND.solar)).toBe(2);
  });
});

describe('W08-17 Goal breakdown: grow_economy', () => {
  it('queues hq-tagged extractor order for { resource: "metals", targetRatePerMin: 10 }, emits goalProgress and goalDone', () => {
    const { state, pipeline } = createS0ColonyPlanet('grow-metals');
    const hubRes = startBuildingConstruction(state, {
      owner: 0,
      building: 'commandHub',
      q: -3,
      r: 0,
      instant: true,
      tick: 0,
    });
    expect(hubRes.ok).toBe(true);

    const rQueue = step(
      state,
      [
        {
          commandId: 'g-econ',
          colonyIndex: 0,
          source: 'player',
          kind: 'queueGoal',
          args: { goal: 'grow_economy', resource: 'metals', targetRatePerMin: 10 },
        },
      ],
      1,
      pipeline,
    );
    expect(rQueue.outcomes[0].code).toBeUndefined();

    const active = getOpenColonyGoals(state, 0)[0];
    expect(active.goal).toBe('grow_economy');
    expect(active.params.resource).toBe('metals.t1');
    expect(active.params.targetRatePerMin).toBe(10);

    const hqBuildOrders = getColonyQueue(state, 0, 'construction').filter((e) => e.goalId === active.id);
    expect(hqBuildOrders).toHaveLength(1);
    expect(hqBuildOrders[0].precedence).toBe('hq');
    expect(hqBuildOrders[0].task).toMatchObject({ kind: 'build', building: 'metalsExtractor' });

    const progressEvents: SimEvent[] = [];
    const doneEvents: SimEvent[] = [];
    for (let i = 0; i < 40; i++) {
      const r = step(state, [], 5, pipeline);
      for (const ev of r.events) {
        if (ev.kind === 'goalProgress' && (ev.data as { goalId?: string }).goalId === active.id) {
          progressEvents.push(ev);
        }
        if (ev.kind === 'goalDone') {
          doneEvents.push(ev);
        }
      }
      if (doneEvents.length > 0) break;
    }

    expect(countCompletedKind(state, 0, ENTITY_KIND.metalsExtractor)).toBe(1);
    expect(progressEvents.length).toBeGreaterThanOrEqual(2);
    expect(doneEvents).toHaveLength(1);
    expect(doneEvents[0].data).toMatchObject({
      colonyIndex: 0,
      goalId: active.id,
      goal: 'grow_economy',
    });
  });

  it('queues hq-tagged harvester buildUnit order when target is minerals or all metals deposits are occupied', () => {
    const { state, pipeline } = createS0ColonyPlanet('grow-harvester');
    startBuildingConstruction(state, {
      owner: 0,
      building: 'commandHub',
      q: -3,
      r: 0,
      instant: true,
      tick: 0,
    });

    step(
      state,
      [
        {
          commandId: 'g-min',
          colonyIndex: 0,
          source: 'player',
          kind: 'queueGoal',
          args: { goal: 'grow_economy', resource: 'minerals', targetRatePerMin: 10 },
        },
      ],
      1,
      pipeline,
    );

    const active = getOpenColonyGoals(state, 0)[0];
    expect(active.params.resource).toBe('minerals.t1');
    const unitOrders = getColonyQueue(state, 0, 'units').filter((e) => e.goalId === active.id);
    expect(unitOrders).toHaveLength(1);
    expect(unitOrders[0].precedence).toBe('hq');
    expect(unitOrders[0].task).toMatchObject({ kind: 'buildUnit', unit: 'harvester' });
  });
});

describe('W08-17 Goal breakdown: secure_power', () => {
  it('queues hq-tagged solar generator order for { targetNetEnergyPerS: 10 }, emits goalProgress and goalDone once held', () => {
    const { state, pipeline } = createS0ColonyPlanet('secure-power');
    startBuildingConstruction(state, {
      owner: 0,
      building: 'commandHub',
      q: -3,
      r: 0,
      instant: true,
      tick: 0,
    });

    const rQueue = step(
      state,
      [
        {
          commandId: 'g-pwr',
          colonyIndex: 0,
          source: 'player',
          kind: 'queueGoal',
          args: { goal: 'secure_power', targetNetEnergyPerS: 10 },
        },
      ],
      1,
      pipeline,
    );
    expect(rQueue.outcomes[0].code).toBeUndefined();

    const active = getOpenColonyGoals(state, 0)[0];
    expect(active.goal).toBe('secure_power');
    expect(active.params.targetNetEnergyPerS).toBe(10);

    const hqOrders = getColonyQueue(state, 0, 'construction').filter((e) => e.goalId === active.id);
    expect(hqOrders).toHaveLength(1);
    expect(hqOrders[0].precedence).toBe('hq');
    expect(hqOrders[0].task).toMatchObject({ kind: 'build', building: 'solar' });

    const progressEvents: SimEvent[] = [];
    const doneEvents: SimEvent[] = [];
    for (let i = 0; i < 40; i++) {
      const r = step(state, [], 5, pipeline);
      for (const ev of r.events) {
        if (ev.kind === 'goalProgress' && (ev.data as { goalId?: string }).goalId === active.id) {
          progressEvents.push(ev);
        }
        if (ev.kind === 'goalDone') {
          doneEvents.push(ev);
        }
      }
      if (doneEvents.length > 0) break;
    }

    expect(countCompletedKind(state, 0, ENTITY_KIND.solar)).toBe(1);
    expect(progressEvents.length).toBeGreaterThanOrEqual(2);
    expect(doneEvents).toHaveLength(1);
    expect(doneEvents[0].data).toMatchObject({
      colonyIndex: 0,
      goalId: active.id,
      goal: 'secure_power',
    });
  });
});

describe('W08-17 Cancelling an active goal removes waiting hq-tagged child orders', () => {
  it('removes waiting breakdown child orders when establish_colony is cancelled while keeping player orders intact', () => {
    const { state, pipeline } = createS0ColonyPlanet('cancel-breakdown');

    step(
      state,
      [{ commandId: 'g-est', colonyIndex: 0, source: 'player', kind: 'queueGoal', args: { goal: 'establish_colony' } }],
      1,
      pipeline,
    );
    const active = getOpenColonyGoals(state, 0)[0];
    expect(active).toBeDefined();

    // Enqueue a player order alongside the breakdown's HQ child orders
    enqueueQueueTask(state, {
      colonyIndex: 0,
      taskId: 'player-depot-1',
      precedence: 'player',
      task: { kind: 'build', building: 'depot', q: -4, r: 2 },
    });

    const beforeCancel = getColonyQueue(state, 0, 'construction');
    const waitingChildrenBefore = beforeCancel.filter(
      (e) => e.goalId === active.id && (e.state === 'queued' || e.state === 'waiting'),
    );
    expect(waitingChildrenBefore.length).toBe(2); // metalsExtractor + solar waiting behind in-progress commandHub

    const rCancel = step(
      state,
      [{ commandId: 'c-est', colonyIndex: 0, source: 'player', kind: 'cancelGoal', args: { goalId: active.id } }],
      1,
      pipeline,
    );
    expect(rCancel.outcomes[0].code).toBeUndefined();

    const afterCancel = getColonyQueue(state, 0, 'construction');
    const waitingChildrenAfter = afterCancel.filter(
      (e) => e.goalId === active.id && (e.state === 'queued' || e.state === 'waiting'),
    );
    expect(waitingChildrenAfter).toHaveLength(0);
    expect(afterCancel.some((e) => e.taskId === 'player-depot-1')).toBe(true);
    expect(getColonyGoalHistory(state, 0).some((g) => g.id === active.id && g.status === 'cancelled')).toBe(true);
  });
});
