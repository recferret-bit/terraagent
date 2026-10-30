import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  assignHarvesterSubJob,
  createRegistryPipeline,
  createState,
  DEPOSIT,
  ensureColonyLedger,
  hexIndex,
  setTileDeposit,
  setTileTerrain,
  spawnHarvesterUnit,
  step,
  TERRAIN,
} from '../../src';

describe('W02-12 Standing harvest job & setHarvestWeights retargeting', () => {
  it('1 idle Harvester -> walks to nearest deposit and credits +0.5/s; setHarvestWeights retargets it', () => {
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

    const idx = hexIndex(state.grid.radius);
    // Nearest deposit: metals at (1, 0) (dist 1)
    setTileDeposit(state, idx.indexOf(1, 0), DEPOSIT.metals, 10000, 0);
    // Slightly farther deposit: minerals at (0, 2) (dist 2)
    setTileDeposit(state, idx.indexOf(0, 2), DEPOSIT.minerals, 10000, 0);

    // Spawn 1 idle Harvester at (0, 0)
    const harvId = spawnHarvesterUnit(state, { owner: 0, q: 0, r: 0 });
    const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });

    // Walk 5 ticks (1.0 s -> moves 1.5 tiles -> arrives at (1, 0) on tick 4)
    for (let i = 0; i < 4; i++) step(state, [], 1, pipeline);
    expect(state.entities.cols.q[0]).toBe(1);
    expect(state.entities.cols.r[0]).toBe(0);

    const beforeMetals = colony.stock['metals.t1'];
    // Harvest for 5 ticks (1.0 second at 5 TPS) -> credits +0.5 metals.t1
    step(state, [], 5, pipeline);
    expect(colony.stock['metals.t1'] - beforeMetals).toBeCloseTo(0.5, 5);

    // Send setHarvestWeights to prioritize Minerals (metals: 0, minerals: 100, bio: 0) -> retargets to (0, 2)
    const retargetStep = step(
      state,
      [{ commandId: 'c-w', colonyIndex: 0, source: 'player', kind: 'setHarvestWeights', args: { metals: 0, minerals: 100, bio: 0 } }],
      1,
      pipeline,
    );
    expect(retargetStep.outcomes[0].code).toBeUndefined();
    expect(state.entities.cols.targetQ[0]).toBe(0);
    expect(state.entities.cols.targetR[0]).toBe(2);

    // Walk to (0, 2) and harvest for 1 second -> credits +0.5 minerals.t1
    for (let i = 0; i < 8; i++) step(state, [], 1, pipeline);
    expect(state.entities.cols.q[0]).toBe(0);
    expect(state.entities.cols.r[0]).toBe(2);
    const beforeMinerals = colony.stock['minerals.t1'];
    step(state, [], 5, pipeline);
    expect(colony.stock['minerals.t1'] - beforeMinerals).toBeCloseTo(0.5, 5);

    // Also verify Clear sub-job on a forest tile
    const forestTile = idx.indexOf(0, 1);
    setTileTerrain(state, forestTile, TERRAIN.forest, state.meta.tick);
    expect(assignHarvesterSubJob(state, harvId, 'clear', 0, 1).ok).toBe(true);
    expect(assignHarvesterSubJob(state, harvId, 'flatten', 0, 1)).toEqual({ ok: false, code: 'op_not_allowed' });
  });
});
