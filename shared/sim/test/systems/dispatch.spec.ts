import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createRegistryPipeline,
  createState,
  DEPOSIT,
  dispatchJob,
  ensureColonyLedger,
  ENTITY_STATE,
  getWorkerDispatch,
  hexIndex,
  setTileDeposit,
  setTileTerrain,
  spawnHarvesterUnit,
  spawnHqUnit,
  step,
  TERRAIN,
} from '../../src';

describe('W02-16 Dispatch v1: nearest idle eligible worker, lowest tier on ties, pre-emption of auto by player', () => {
  it('Harvester harvesting (auto) + player Clear order -> Harvester is pre-empted to Clear', () => {
    const state = createState({ planetId: 'p1', planetType: 'temperate', seed: 'w02', radius: 8 });
    state.colonies.push(
      ensureColonyLedger({
        index: 0,
        id: 'col-0',
        name: 'Alpha',
        color: 0xff6b00,
        status: 'active',
        changedAt: 0,
      }),
    );

    const idx = hexIndex(state.grid.radius);
    setTileDeposit(state, idx.indexOf(1, 0), DEPOSIT.metals, 10000, 0);
    setTileTerrain(state, idx.indexOf(2, 0), TERRAIN.forest, 0);

    // Spawn Harvester at (0, 0) adjacent to the deposit at (1, 0) and step once so it is actively harvesting (auto precedence)
    const harvId = spawnHarvesterUnit(state, { owner: 0, q: 0, r: 0 });
    const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });
    step(state, [], 1, pipeline);
    expect(state.entities.cols.state[0]).toBe(ENTITY_STATE.harvesting);

    // Issue player Clear order at (2, 0) -> pre-empts the harvesting Harvester!
    const dispatched = dispatchJob(state, {
      colonyIndex: 0,
      kind: 'terraform',
      op: 'clear',
      q: 2,
      r: 0,
      precedence: 'player',
    });
    expect(dispatched.ok).toBe(true);
    if (!dispatched.ok) throw new Error('expected ok');
    expect(dispatched.record.workerEntityId).toBe(harvId);
    expect(dispatched.record.preEmptedFrom).toBe('auto');
    expect(state.entities.cols.targetQ[0]).toBe(2);
    expect(state.entities.cols.targetR[0]).toBe(0);
    expect(getWorkerDispatch(state, harvId)?.op).toBe('clear');
  });

  it('routes linked prep and T1 building construction to HQ (terraform/build-capable) and prefers lowest maxBuildTier on ties', () => {
    const state = createState({ planetId: 'p1', planetType: 'temperate', seed: 'w02', radius: 8 });
    const hqId = spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const harvId = spawnHarvesterUnit(state, { owner: 0, q: 0, r: 0 });

    // Linked prep goes only to HQ (Harvester cannot prepare/flatten)
    const prepRes = dispatchJob(state, { colonyIndex: 0, kind: 'linkedPrep', op: 'prepare', q: 2, r: 0 });
    expect(prepRes.ok).toBe(true);
    if (prepRes.ok) expect(prepRes.record.workerEntityId).toBe(hqId);

    // Reset HQ to idle at (0, 0); on equal distance for Clear, Harvester (maxBuildTier 0) wins tie over HQ (maxBuildTier 1)
    state.entities.cols.state[0] = ENTITY_STATE.idle;
    const clearTie = dispatchJob(state, { colonyIndex: 0, kind: 'terraform', op: 'clear', q: 1, r: 0 });
    expect(clearTie.ok).toBe(true);
    if (clearTie.ok) expect(clearTie.record.workerEntityId).toBe(harvId);
  });
});
