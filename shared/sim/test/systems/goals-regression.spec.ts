import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createState, createRegistryPipeline, ensureColonyLedger, ensureColonyRecord,
  spawnHqUnit, startBuildingConstruction, hexIndex, DEPOSIT, step,
  getColonyGoals, getColonyQueue, computeColonyResourceRatePerMin, setPlanetTime,
  getColonyHarvestWeights,
} from '../../src';

function fixture() {
  const state = createState({ planetId: 'goal-regression', planetType: 'temperate', seed: 'goals', radius: 10 });
  const colony = ensureColonyLedger(ensureColonyRecord(state, 0, 0));
  colony.status = 'active';
  colony.stock['metals.t1'] = 500;
  colony.stock['minerals.t1'] = 300;
  colony.stock['bio.biomass'] = 200;
  colony.stock['bio.water'] = 200;
  spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
  expect(startBuildingConstruction(state, { owner: 0, building: 'commandHub', q: -3, r: 0, instant: true }).ok).toBe(true);
  expect(startBuildingConstruction(state, { owner: 0, building: 'solar', q: -3, r: 3, instant: true }).ok).toBe(true);
  const i = hexIndex(10).indexOf(2, -2);
  state.grid.layers.deposit[i] = DEPOSIT.metals;
  state.grid.layers.richness[i] = 10000;
  setPlanetTime(state, { timeOfDay: 12 }, 0);
  const pipeline = createRegistryPipeline({ flags: parseWaves('..08') });
  return { state, colony, pipeline };
}

describe('W08 owner goal regressions', () => {
  it('full starting metals expands storage, builds an extractor and produces real metals', () => {
    const { state, colony, pipeline } = fixture();
    colony.stock['metals.t1'] = colony.caps.metals;
    const result = step(state, [{ commandId: 'grow', colonyIndex: 0, source: 'player', kind: 'queueGoal',
      args: { goal: 'grow_economy', resource: 'metals.t1', targetRatePerMin: 10 } }], 1, pipeline);
    expect(result.outcomes[0].code).toBeUndefined();
    expect(getColonyQueue(state, 0, 'construction').some((e) => e.task.kind === 'build' && e.task.building === 'depot')).toBe(true);
    for (let n = 0; n < 400 && getColonyGoals(state, 0)[0].status !== 'done'; n++) step(state, [], 5, pipeline);
    expect(getColonyGoals(state, 0)[0].status, JSON.stringify({ goal: getColonyGoals(state, 0)[0], queue: getColonyQueue(state, 0, 'construction'), power: colony.power, stock: colony.stock })).toBe('done');
    expect(computeColonyResourceRatePerMin(state, 0, 'metals.t1')).toBeGreaterThanOrEqual(10);
  });

  it('idle entities never count as measured production', () => {
    const { state } = fixture();
    expect(computeColonyResourceRatePerMin(state, 0, 'metals.t1')).toBe(0);
    expect(computeColonyResourceRatePerMin(state, 0, 'minerals.t1')).toBe(0);
  });

  it('unsupported goals and water growth are rejected without occupying a queue slot', () => {
    const { state, pipeline } = fixture();
    for (const args of [{ goal: 'defend_colony' }, { goal: 'grow_economy', resource: 'bio.water' }]) {
      const result = step(state, [{ commandId: String(state.meta.tick), colonyIndex: 0, source: 'player', kind: 'queueGoal', args }], 1, pipeline);
      expect(result.outcomes[0].code).toBe('wave_disabled');
    }
    expect(getColonyGoals(state, 0)).toHaveLength(0);
  });

  it('resource goal steers automatic harvesting and cancel restores saved player weights', () => {
    const { state, colony, pipeline } = fixture();
    colony.harvestWeights = { metals: 20, minerals: 50, bio: 80 };
    step(state, [{ commandId: 'minerals', colonyIndex: 0, source: 'player', kind: 'queueGoal',
      args: { goal: 'grow_economy', resource: 'minerals.t1', targetRatePerMin: 100 } }], 1, pipeline);
    expect(getColonyHarvestWeights(state, 0)).toEqual({ metals: 0, minerals: 100, bio: 0 });
    step(state, [{ commandId: 'cancel', colonyIndex: 0, source: 'player', kind: 'cancelGoal', args: { goalId: getColonyGoals(state, 0)[0].id } }], 1, pipeline);
    expect(getColonyHarvestWeights(state, 0)).toEqual({ metals: 20, minerals: 50, bio: 80 });
  });

  it('completes a feasible night target only after real night output is held', () => {
    const { state, pipeline } = fixture();
    setPlanetTime(state, { timeOfDay: 22 }, state.meta.tick);
    step(state, [], 1, pipeline);
    step(state, [{ commandId: 'feasible-power', colonyIndex: 0, source: 'player', kind: 'queueGoal',
      args: { goal: 'secure_power', targetNetEnergyPerS: 0 } }], 1, pipeline);
    expect(getColonyGoals(state, 0)[0].status).toBe('active');
    for (let i = 0; i < 10; i++) step(state, [], 1, pipeline);
    expect(getColonyGoals(state, 0)[0].status).toBe('done');
  });

  it('night deficit stays explained and does not build an endless queue of solar panels', () => {
    const { state, pipeline } = fixture();
    setPlanetTime(state, { timeOfDay: 22 }, state.meta.tick);
    step(state, [], 1, pipeline);
    step(state, [{ commandId: 'power', colonyIndex: 0, source: 'player', kind: 'queueGoal', args: { goal: 'secure_power', targetNetEnergyPerS: 10 } }], 1, pipeline);
    for (let i = 0; i < 20; i++) step(state, [], 5, pipeline);
    expect(getColonyGoals(state, 0)[0]).toMatchObject({ status: 'active' });
    expect(getColonyGoals(state, 0)[0].detail).toContain('night generators');
    expect(getColonyQueue(state, 0, 'construction').filter((e) => e.goalId)).toHaveLength(0);
  });
});
