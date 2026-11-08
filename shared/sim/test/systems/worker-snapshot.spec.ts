import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createPlanet,
  createRegistryPipeline,
  restore,
  snapshot,
  spawnWorkerUnit,
  spawnHqUnit,
  step,
  type PlanetState,
} from '../../src';

/**
 * Regression (dev server, planet `pl_01M6EG80…`): `col.workers` got an index alias (`list[entityId] = view`), so a
 * Worker with entity id 3 made a sparse `[view, , , view]`. The snapshot codec saves holes as `null`, and the
 * first step after a restore crashed in `syncWorkerView` ("Cannot read properties of null (reading 'entityId')").
 */
function planetWithWorker(): { state: PlanetState; workerId: number } {
  const state = createPlanet({ type: 'flat', seed: 'worker-snapshot', radius: 12 });
  spawnHqUnit(state, { owner: 0, q: 2, r: -1 }); // entity ids 1.. go to others first, so the Worker's id > its index
  spawnHqUnit(state, { owner: 0, q: -2, r: 1 });
  const workerId = spawnWorkerUnit(state, { owner: 0, q: 3, r: 0 });
  return { state, workerId };
}

const ids = (list: unknown): unknown[] => (list as Array<{ entityId?: number } | null>).map((u) => (u ? u.entityId : u));

describe('Worker colony views survive a snapshot round trip', () => {
  it('keeps col.workers / col.units dense (one view per Worker) and steps after restore', () => {
    const { state, workerId } = planetWithWorker();
    const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });
    step(state, [], 1, pipeline);
    expect(ids(state.colonies[0]?.workers)).toEqual([workerId]);
    expect(ids(state.colonies[0]?.units)).toEqual([workerId]);

    const back = restore(snapshot(state));
    expect(ids(back.colonies[0]?.workers)).toEqual([workerId]);
    expect(() => step(back, [], 1, pipeline)).not.toThrow();
    expect(ids(back.colonies[0]?.workers)).toEqual([workerId]);
  });

  it('heals a saved planet whose lists hold null holes (written by the old index alias)', () => {
    const { state, workerId } = planetWithWorker();
    const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });
    step(state, [], 1, pipeline);
    const view = (state.colonies[0]?.workers as unknown[])[0];
    // what the old code left in a snapshot: the view, null holes, and the alias copy at index `entityId`
    const sparse: unknown[] = [view];
    for (let i = 1; i < workerId; i++) sparse.push(null);
    sparse.push(view);
    state.colonies[0]!.workers = sparse;

    const back = restore(snapshot(state));
    expect(ids(back.colonies[0]?.workers)).toContain(null);
    expect(() => step(back, [], 1, pipeline)).not.toThrow();
    expect(ids(back.colonies[0]?.workers)).toEqual([workerId]);
  });
});
