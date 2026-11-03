import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createRegistryPipeline, createState, getUnitRecord, hexDistance, ensureColonyLedger, hexIndex, PREP,
  setTilePrep, setTileTerrain, spawnHqUnit, step, TERRAIN,
} from '../../src';

describe('Terraform WORK click on a forest tile (HQ drone only)', () => {
  it('enqueueTask work on forest clears the tree and grants biomass', () => {
    const state = createState({ planetId: 'p-wf', planetType: 'temperate', seed: 'wf', radius: 8 });
    const colony = ensureColonyLedger({ index: 0, id: 'col-0', name: 'A', color: 0xff6b00, status: 'active', changedAt: 0 });
    state.colonies.push(colony);
    spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });
    const hx0 = hexIndex(state.grid.radius);
    for (let k = 0; k < state.grid.count; k++) { setTileTerrain(state, k, TERRAIN.flat, 0); setTilePrep(state.grid, k, PREP.wild, 0); state.grid.layers.deposit[k] = 0; }
    const i = hx0.indexOf(6, 0);
    setTileTerrain(state, i, TERRAIN.forest, state.meta.tick);
    setTilePrep(state.grid, i, PREP.wild, state.meta.tick);
    const before = colony.stock['bio.biomass'] ?? 0;
    const res = step(state, [{ commandId: 'w1', colonyIndex: 0, source: 'player', kind: 'enqueueTask', args: { terraform: { op: 'work', tiles: [{ q: 6, r: 0 }] } } }], 1, pipeline);
    expect(res.outcomes[0].code).toBeUndefined();
    step(state, [], 400, pipeline);
    expect(state.grid.layers.terrain[i]).toBe(TERRAIN.flat);
    expect((colony.stock['bio.biomass'] ?? 0) - before).toBeCloseTo(15, 4);
  });

  it('a tree no ground worker can get next to (inside a forest) ends the order with a no_path failure, not a silent retry loop', () => {
    const state = createState({ planetId: 'p-wf2', planetType: 'temperate', seed: 'wf2', radius: 10 });
    const colony = ensureColonyLedger({ index: 0, id: 'col-0', name: 'A', color: 0xff6b00, status: 'active', changedAt: 0 });
    state.colonies.push(colony);
    const hq = spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });
    const hx = hexIndex(state.grid.radius);
    for (let i = 0; i < state.grid.count; i++) {
      if (hexDistance(6, 0, hx.q[i], hx.r[i]) <= 2) { setTileTerrain(state, i, TERRAIN.forest, 0); setTilePrep(state.grid, i, PREP.wild, 0); }
    }
    const i = hx.indexOf(6, 0);
    step(state, [{ commandId: 'w2', colonyIndex: 0, source: 'player', kind: 'enqueueTask', args: { terraform: { op: 'work', tiles: [{ q: 6, r: 0 }] } } }], 1, pipeline);
    step(state, [], 200, pipeline);
    expect(state.grid.layers.terrain[i]).toBe(TERRAIN.forest);
    expect(Object.keys((state.blobs.workJobs?.value as { byId: object }).byId)).toHaveLength(0);
    expect(getUnitRecord(state, typeof hq === 'number' ? hq : (hq as { entityId: number }).entityId)?.lastFailure?.code).toBe('no_path');
  });
});
